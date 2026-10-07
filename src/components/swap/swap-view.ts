/**
 * The swap page's readings of the engine: which rows a page opens on, what the
 * button says, how much Max may spend, how a route reads, and what a signed
 * swap is tracked by. The figures the analysis panels compute (costs, what the
 * wallet can swap, past rates, the pair's implied rate) are ./swap-analysis.ts.
 *
 * Everything that decides what is *signed* lives in the engine
 * (src/lib/swap/*: quote request, frozen review, built messages, the pre-sign
 * checks). This module only decides what the page *shows* around it, so the
 * words and numbers every surface uses (form, route panel, review card,
 * toasts) come from one place and can be tested without a browser.
 *
 * Pure: no React, no network, no storage, no clock (callers pass `now`).
 */

import { SWAP_FEE_BPS } from "@/config/fees";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { fromBaseUnits, toBaseUnits } from "@/lib/interchain/amounts";
import type { RoutePlanWire } from "@/lib/interchain/wire";
import type { AssetOption } from "@/lib/swap/assets";
import { swapFeeFor, type SwapFee } from "@/lib/swap/fee";
import { priceImpactLevel, signBlock, type PriceImpactLevel } from "@/lib/swap/form";
import type { SignedSwapPath } from "@/lib/swap/review";
import type { SwapPath } from "@/lib/swap/path";
import { executable, type XcsRouteTable } from "@/lib/swap/xcs";
import type {
  SwapBlockedCode,
  SwapDeliveryWire,
  SwapInboundWire,
  SwapQuotePrice,
  SwapRoutePool,
  SwapRouteWire,
} from "@/lib/swap/wire";
import { formatFiat } from "@/lib/format";
import { computeFee, type FeeChain } from "@/lib/tx/fees";
import type { SignStage } from "@/lib/tx/types";

const VENUE = SWAP_VENUE_CHAIN_ID;
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

/* -------------------------------------------------------------------------- *
 * Deep links (parsing lives in ./swap-link.ts, light enough for the server page)
 * -------------------------------------------------------------------------- */

export { readSwapLink, swapHref, swapLinkKey, type SwapLink } from "./swap-link";

/**
 * The row a link names: its exact `chainId:denom` first; else the same asset
 * by identity key (`cosmoshub-4:uatom` for ATOM wherever it sits), preferring
 * the holding on the key's own chain, then the one on Osmosis, then the first
 * listed (lists come largest or most useful first). Rows that cannot be
 * picked are only matched exactly, so a link never lands on a disabled twin
 * when a usable one exists.
 */
export function resolveLinkedOption(options: readonly AssetOption[], key: string | null): AssetOption | undefined {
  if (!key) return undefined;
  const exact = options.find((option) => option.key === key);
  if (exact) return exact;
  const same = options.filter((option) => option.identity.key === key && option.disabledReason === null);
  if (same.length === 0) return undefined;
  const chainId = key.slice(0, key.indexOf(":"));
  return same.find((option) => option.chainId === chainId) ?? same.find((option) => option.chainId === VENUE) ?? same[0];
}

/* -------------------------------------------------------------------------- *
 * Which rows the page opens on
 * -------------------------------------------------------------------------- */

/** Osmosis denoms the venue lists as tradable (`/api/swap/assets`). */
export function listedVenueDenoms(assets: readonly { readonly osmosisDenom: string; readonly tradable: boolean }[]): Set<string> {
  const out = new Set<string>();
  for (const asset of assets) if (asset.tradable) out.add(asset.osmosisDenom);
  return out;
}

/**
 * How a held row stands on the venue, for the sell picker's tag:
 * - `tradable`: Osmosis lists it;
 * - `unlisted`: it has an Osmosis denom the venue does not offer (the quote says why);
 * - `not-traded`: nothing on Osmosis is this token.
 * While the listing is still loading every row with an Osmosis denom reads `tradable`.
 */
export type SellStanding = "tradable" | "unlisted" | "not-traded";

export function sellStanding(option: Pick<AssetOption, "osmosisDenom">, listed: ReadonlySet<string> | null): SellStanding {
  if (!option.osmosisDenom) return "not-traded";
  if (listed && listed.size > 0 && !listed.has(option.osmosisDenom)) return "unlisted";
  return "tradable";
}

function largest<T>(rows: readonly T[], worth: (row: T) => number): T | undefined {
  let best: T | undefined;
  let bestWorth = -Infinity;
  for (const row of rows) {
    const value = worth(row);
    if (value > bestWorth) {
      best = row;
      bestWorth = value;
    }
  }
  return best;
}

/**
 * The From a page opens on, when nothing asked for one, first match first:
 * 1. the most valuable tradable holding already on Osmosis worth at least one
 *    unit of currency (it swaps in one transaction there);
 * 2. the most valuable priced tradable holding whose opening pair is signed
 *    once (`oneSignature`: on Osmosis, or through Zunia's contract from its
 *    own chain), so a small wallet does not open on a two-step swap when a
 *    one-step one is there;
 * 3. the most valuable tradable holding anywhere (a two-step one included);
 * 4. the first row (whose reason the form then explains).
 *
 * Without `oneSignature` every holding counts as signed once, as the path
 * itself presumes the contract until its route table says otherwise.
 */
export function defaultFromKey(
  sell: readonly AssetOption[],
  listed: ReadonlySet<string> | null,
  valueOf: (option: AssetOption) => number | null,
  oneSignature: (option: AssetOption) => boolean = () => true,
): string | null {
  if (sell.length === 0) return null;
  const worth = (option: AssetOption) => valueOf(option) ?? 0;
  const tradable = sell.filter((option) => option.decimals !== null && sellStanding(option, listed) === "tradable");
  const onVenue = tradable.filter((option) => option.chainId === VENUE && worth(option) >= 1);
  const signedOnce = tradable.filter((option) => worth(option) > 0 && oneSignature(option));
  return (largest(onVenue, worth) ?? largest(signedOnce, worth) ?? largest(tradable, worth) ?? sell[0])?.key ?? null;
}

/**
 * Whether the pair a page opens on for `option` (sold for OSMO, or for ATOM
 * when it is OSMO: {@link defaultToKey}) is signed once: from Osmosis, or
 * through Zunia's contract from the token's own chain. `false` when the
 * token has nothing on Osmosis, or when the contract's route table has no
 * route for that pair (the tokens would move to Osmosis first). Without a
 * table, or a name for ATOM on Osmosis, the contract is presumed, as the path
 * itself does (src/lib/swap/path.ts).
 */
export function opensInOneSignature(
  option: Pick<AssetOption, "chainId" | "osmosisDenom">,
  table: XcsRouteTable | null,
  atomOnVenue: string | null,
): boolean {
  if (option.chainId === VENUE) return true;
  if (!option.osmosisDenom) return false;
  const vout = option.osmosisDenom === "uosmo" ? atomOnVenue : "uosmo";
  return vout === null || executable(table, option.osmosisDenom, vout) !== "no";
}

/**
 * The To a page opens on, when nothing asked for one: OSMO on Osmosis (the
 * venue's own coin pairs with almost everything), or ATOM on Osmosis when
 * OSMO is what is sold; else the first row that can be used. Never a
 * disabled row, never the From itself.
 */
export function defaultToKey(from: AssetOption | undefined, buy: readonly AssetOption[]): string | null {
  if (!from) return null;
  const usable = buy.filter((option) => option.disabledReason === null && option.key !== from.key);
  const sellsOsmo = from.osmosisDenom === "uosmo";
  const preferred = sellsOsmo
    ? usable.find(
        (option) =>
          option.chainId === VENUE && option.identity.originChainId === "cosmoshub-4" && option.identity.originDenom === "uatom",
      )
    : usable.find((option) => option.chainId === VENUE && option.denom === "uosmo");
  return (preferred ?? usable[0])?.key ?? null;
}

/* -------------------------------------------------------------------------- *
 * Amounts: Max, shares, the indicative price
 * -------------------------------------------------------------------------- */

/** Gas assumed for a swap when nothing was measured yet: above a split route + fee + delivery (~600k). */
export const FALLBACK_SWAP_GAS = 1_000_000;

export interface FeeReserve {
  /** Base units of the token sold that Max leaves for the network fee. */
  readonly units: bigint;
  /** From a simulation of this swap (else a generous fixed estimate). */
  readonly measured: boolean;
}

/**
 * What Max keeps back for the network fee. Only when the token sold is the
 * signing chain's fee token (every swap signs on the From's own chain): 1.5×
 * the fee a simulation measured, when there is one in that token, else the
 * fee of {@link FALLBACK_SWAP_GAS} at the chain's average price. `null` when
 * nothing needs keeping or the chain publishes no gas price.
 */
export function feeReserve(
  fromDenom: string,
  chain: FeeChain | undefined,
  measured: { readonly denom: string; readonly amount: bigint } | null,
): FeeReserve | null {
  if (!chain || fromDenom !== chain.feeMinimalDenom) return null;
  if (measured && measured.denom === fromDenom && measured.amount > ZERO) {
    return { units: (measured.amount * BigInt(3) + BigInt(1)) / BigInt(2), measured: true };
  }
  try {
    const amount = computeFee(chain, FALLBACK_SWAP_GAS, "average").amount[0]?.amount;
    return amount ? { units: BigInt(amount), measured: false } : null;
  } catch {
    return null;
  }
}

/** What Max may spend: the balance less the reserve, never below zero. */
export function spendableUnits(balance: bigint, reserve: FeeReserve | null): bigint {
  const keep = reserve?.units ?? ZERO;
  return balance > keep ? balance - keep : ZERO;
}

/**
 * The amount field's text for `percent` of `units`: exact display units, cut
 * never rounded up; the raw integer when the exponent is unknown (only Max is
 * meaningful then). Empty when the share rounds to nothing.
 */
export function shareText(units: bigint, percent: number, decimals: number | null): string {
  const share = BigInt(Math.max(0, Math.min(100, Math.round(percent))));
  const part = (units * share) / HUNDRED;
  if (part <= ZERO) return "";
  return decimals === null ? part.toString() : fromBaseUnits(part.toString(), decimals);
}

/**
 * A round amount worth about `target` of the token (two significant digits),
 * priced before anything is typed so the route and rate are on screen from
 * the start; one whole token when the token has no price. Base units; `null`
 * when the exponent is unknown.
 */
export function indicativeUnits(decimals: number | null, price: number | null, target = 100): bigint | null {
  if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  let whole = price !== null && Number.isFinite(price) && price > 0 ? target / price : 1;
  if (!Number.isFinite(whole) || whole <= 0) whole = 1;
  const step = 10 ** (Math.floor(Math.log10(whole)) - 1);
  const rounded = Math.round(whole / step) * step;
  const text = rounded.toFixed(Math.min(decimals, 20));
  const base = toBaseUnits(text, decimals);
  if (base === null) return null;
  const units = BigInt(base);
  return units > ZERO ? units : BigInt(1);
}

/** What the page prices before anything is typed. */
export interface IndicativeAmount {
  /** Base units spent in all (the Zunia fee included), as a typed amount would be. */
  readonly units: bigint;
  /** The whole balance, worth less than the usual amount. */
  readonly ofBalance: boolean;
}

/** Below this worth (in the user's currency) a balance is dust: a quote for it has no rate worth reading. */
const DUST_WORTH = 0.01;

/**
 * The amount priced before anything is typed: about `target` of the user's
 * currency ({@link indicativeUnits}), or the whole balance when it is worth
 * less, so a wallet holding 0.89 worth of a token reads the route, the fees
 * and the minimum for what it can swap, not for a hundred. Dust and an
 * unpriced token keep the usual amount (a dust quote reads no rate, and an
 * unpriced balance cannot be told from dust). `null` when the exponent is
 * unknown.
 */
export function indicativeAmount(
  decimals: number | null,
  price: number | null,
  balance: bigint,
  target = 100,
): IndicativeAmount | null {
  const usual = indicativeUnits(decimals, price, target);
  if (usual === null) return null;
  if (balance <= ZERO || balance >= usual || price === null || !(price > 0)) return { units: usual, ofBalance: false };
  const whole = displayValue(balance, decimals);
  if (whole === null || whole * price < DUST_WORTH) return { units: usual, ofBalance: false };
  return { units: balance, ofBalance: true };
}

/**
 * The Zunia fee a quote's own amount was priced with: the inverse of
 * `swapFeeFor`, from what the swap sells (a quote's `amountIn`, the fee
 * already taken out) back to what was spent in all (`net + fee`).
 *
 * For display only. A quote kept on screen (dimmed) while the next one loads
 * was priced for an earlier amount than the form's, and its costs must be
 * read against that amount: set against a new one, an indicative quote for
 * 2,900 OSMO read "+572,138% vs market" for 0.5 typed. Rounding makes two
 * amounts a unit apart sell the same net now and then (one carries a fee
 * unit, the other none); either reads the same to the cent. `null` for
 * anything that is not a base-unit amount above zero.
 */
export function feeForNet(chainId: string, net: string): SwapFee | null {
  if (!/^\d+$/.test(net)) return null;
  const sold = BigInt(net);
  if (sold <= ZERO) return null;
  const kept = BigInt(10_000 - SWAP_FEE_BPS);
  const guess = kept > ZERO ? (sold * BigInt(10_000)) / kept : sold;
  const one = BigInt(1);
  // The last candidate is the chains (and amounts) that carry no fee at all.
  for (const spent of [guess, guess + one, guess - one, sold]) {
    if (spent <= ZERO) continue;
    const fee = swapFeeFor(chainId, spent);
    if (fee.net === sold) return fee;
  }
  return null;
}

/** Display units of a base-unit amount as a float, for valuing (never for signing). */
export function displayValue(units: bigint | string, decimals: number | null): number | null {
  if (decimals === null) return null;
  const text = typeof units === "bigint" ? units.toString() : units;
  if (!/^\d+$/.test(text)) return null;
  return Number(fromBaseUnits(text, decimals));
}

/**
 * Fraction digits worth showing for an amount in a tight spot: 2 from a
 * thousand whole tokens up, 4 from one, 6 below (cut, never rounded up, by
 * the formatter). The exact figure stays in the review card.
 */
export function fractionDigits(units: bigint | string, decimals: number | null): number {
  const whole = displayValue(units, decimals);
  if (whole === null) return 6;
  return whole >= 1000 ? 2 : whole >= 1 ? 4 : 6;
}

/* -------------------------------------------------------------------------- *
 * The form's button
 * -------------------------------------------------------------------------- */

export type CtaAction = "review" | "move-first" | "retry" | null;

export interface CtaState {
  readonly label: string;
  /** The sentence behind a disabled button (shown under it). */
  readonly reason: string | null;
  /** What a click does; `null` for a disabled button. */
  readonly action: CtaAction;
  /** A wait, not a problem: draw a spinner. */
  readonly busy: boolean;
}

export interface CtaInput {
  readonly holdingsLoading: boolean;
  readonly sellCount: number;
  readonly from: Pick<AssetOption, "ticker" | "amount" | "osmosisDenom" | "chainName"> | undefined;
  readonly to: Pick<AssetOption, "disabledReason"> | undefined;
  readonly amountText: string;
  readonly amountUnits: bigint | null;
  readonly slippageValid: boolean;
  /** `quoteRequestFor` made a request (the amount is above the fee). */
  readonly requestReady: boolean;
  readonly quote: {
    readonly loading: boolean;
    readonly stale: boolean;
    readonly refreshing: boolean;
    readonly error: { readonly message: string } | null;
    readonly blocked: { readonly code: SwapBlockedCode; readonly message: string } | null;
    /** The signable answer for the current request (`useSwapQuote().quote`). */
    readonly current: Pick<SwapQuotePrice, "path" | "expiresAt"> | null;
  };
  readonly feeShort: boolean;
  readonly now: number;
}

/** The short label for a pair the venue refuses; the reason is the server's own sentence. */
export function blockedLabel(code: SwapBlockedCode): string {
  switch (code) {
    case "testnet":
      return "Testnets can't swap";
    case "same-token":
      return "Same token on both sides";
    case "not-traded":
      return "Not traded on Osmosis";
    case "venue-denom-unknown":
    case "variant-mismatch":
      return "Token not recognised on Osmosis";
    case "no-pool-route":
      return "No route for this amount";
    case "routes-invalid":
    case "no-floor":
      return "No safe route right now";
    case "no-contract-route":
    case "route-unreadable":
    case "route-unpriced":
    case "venue-unavailable":
      return "Cross-chain route unavailable";
    case "delivery-unavailable":
      return "Can't deliver to that chain";
    case "inbound-unavailable":
      return "Can't reach Osmosis from here";
  }
}

const idle = (label: string, reason: string | null = null): CtaState => ({ label, reason, action: null, busy: false });
const waiting = (label: string): CtaState => ({ label, reason: null, action: null, busy: true });

/**
 * What the form's main button says and does, first problem first: holdings,
 * picks, amount, balance, tolerance, then the price (refused, failed, loading,
 * stale), then the engine's own sign block (updating, expired, fee room).
 * Move-first answers open the first step instead of a review.
 */
export function formCta(input: CtaInput): CtaState {
  const { from, to, quote } = input;
  if (!from) {
    if (input.holdingsLoading) return waiting("Loading your balances…");
    return input.sellCount === 0 ? idle("Nothing to swap here", "No balance in this scope can be sold.") : idle("Choose a token to pay with");
  }
  if (!from.osmosisDenom) return idle("Not traded on Osmosis", `${from.ticker} is not traded on Osmosis, so Zunia cannot swap it.`);
  if (!to) return idle("Choose a token to receive");
  if (to.disabledReason) return idle("Pair unavailable", to.disabledReason);
  if (!input.amountText.trim()) return idle("Enter an amount");
  if (input.amountUnits === null) return idle("Enter a valid amount", "Use digits and at most the token's decimals.");
  if (input.amountUnits <= ZERO) return idle("Enter an amount");
  if (input.amountUnits > BigInt(/^\d+$/.test(from.amount) ? from.amount : "0")) {
    return idle(`Insufficient ${from.ticker} balance`, `You hold less ${from.ticker} on ${from.chainName} than this amount.`);
  }
  if (!input.slippageValid) return idle("Check the slippage tolerance");
  if (!input.requestReady) return idle("Amount too small", "After the Zunia fee nothing would be left to swap.");
  if (quote.blocked && !quote.stale) return idle(blockedLabel(quote.blocked.code), quote.blocked.message);
  if (quote.error && !quote.refreshing) {
    return { label: "Try the price again", reason: quote.error.message, action: "retry", busy: false };
  }
  if (!quote.current) return waiting(quote.stale ? "Updating the price…" : "Getting the best price…");
  if (quote.current.path === "move-first") {
    return { label: `Step 1: move ${from.ticker} to Osmosis`, reason: null, action: "move-first", busy: false };
  }
  const block = signBlock({
    problem: null,
    drift: null,
    quote: quote.current,
    refreshing: quote.refreshing,
    now: input.now,
    feeShort: input.feeShort,
  });
  if (block) {
    const busy = block.label.startsWith("Updating");
    // The engine's sentence mentions a gas speed, which this form has no
    // control for: point at what the form does have (Max keeps the room).
    const reason = input.feeShort && !busy && block.label === FEE_ROOM_LABEL ? FEE_ROOM_REASON : block.reason;
    return { label: block.label, reason: busy ? null : reason, action: null, busy };
  }
  return { label: "Review swap", reason: null, action: "review", busy: false };
}

/** `signBlock`'s label when the network fee no longer fits. */
const FEE_ROOM_LABEL = "Need fee room";
const FEE_ROOM_REASON = "Not enough would be left for the network fee. Lower the amount: Max keeps room for it.";

/* -------------------------------------------------------------------------- *
 * Reading a quote
 * -------------------------------------------------------------------------- */

export type StatusTone = "success" | "warning" | "danger" | "neutral";

/** A price impact's word and colour (the shared 1% / 5% thresholds). */
export function impactView(percent: number | null): { readonly level: PriceImpactLevel; readonly label: string; readonly tone: StatusTone } {
  const level = priceImpactLevel(percent);
  switch (level) {
    case "normal":
      return { level, label: percent !== null && percent < 0 ? "In your favour" : "Low", tone: "success" };
    case "caution":
      return { level, label: "Noticeable", tone: "warning" };
    case "warning":
      return { level, label: "High", tone: "danger" };
    default:
      return { level, label: "Not reported", tone: "neutral" };
  }
}

/** How much To one whole From buys at each token's fiat price; `null` without both prices. */
export function marketRate(fromPrice: number | null | undefined, toPrice: number | null | undefined): number | null {
  if (fromPrice === null || fromPrice === undefined || toPrice === null || toPrice === undefined) return null;
  if (!(fromPrice > 0) || !(toPrice > 0)) return null;
  return fromPrice / toPrice;
}

/** `value` against `reference`, in percent (`+2` is 2% more); `null` when either is missing. */
export function versus(value: number | null | undefined, reference: number | null | undefined): number | null {
  if (value === null || value === undefined || reference === null || reference === undefined) return null;
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) return null;
  return (value / reference - 1) * 100;
}

/** One split of an order as the route diagram draws it. */
export interface SplitView {
  /** Percent of the input this split takes. */
  readonly share: number;
  readonly inAmount: string;
  readonly outAmount: string;
  readonly pools: readonly SwapRoutePool[];
}

/**
 * The order's splits with their share of the input; a contract-path route
 * (which reports no splits) is one split of the whole amount. Shares come
 * from base units, so they add up to 100 within rounding.
 */
export function splitViews(route: SwapRouteWire, amountIn: string, amountOut: string): SplitView[] {
  const splits = route.splits && route.splits.length > 0 ? route.splits : null;
  if (!splits) {
    return route.pools.length > 0 ? [{ share: 100, inAmount: amountIn, outAmount: amountOut, pools: route.pools }] : [];
  }
  const total = splits.reduce((sum, split) => sum + (/^\d+$/.test(split.inAmount) ? BigInt(split.inAmount) : ZERO), ZERO);
  return splits.map((split) => ({
    share: total > ZERO && /^\d+$/.test(split.inAmount) ? Number((BigInt(split.inAmount) * BigInt(10_000)) / total) / 100 : 0,
    inAmount: split.inAmount,
    outAmount: split.outAmount,
    pools: split.pools,
  }));
}

/**
 * The pools' own spread fees along the order, weighted by each split's share
 * (Osmosis's taker fee is separate: `effectiveFee`). Percent. `null` when
 * any pool on the route did not report one: a partial sum would read low.
 */
export function routeSpread(route: SwapRouteWire, amountIn: string, amountOut: string): number | null {
  const views = splitViews(route, amountIn, amountOut);
  if (views.length === 0) return null;
  let total = 0;
  for (const view of views) {
    let along = 0;
    for (const pool of view.pools) {
      if (typeof pool.spread !== "number" || !Number.isFinite(pool.spread)) return null;
      along += pool.spread;
    }
    total += (along * view.share) / 100;
  }
  return total;
}

/**
 * What the To field shows for a quote, by where the output lands:
 * - `pool` and `contract`: the router's output, an estimate;
 * - `pool-deliver`: exactly the floor, which is what the transfer sends home;
 *   whatever the swap pays above it stays on Osmosis (`kept`);
 * - `move-first`: an estimate priced as if the tokens were already there.
 */
export function receiveView(
  quote: Pick<SwapQuotePrice, "path" | "amountOut" | "minOut">,
): { readonly amount: string; readonly exact: boolean; readonly kept: string | null } {
  if (quote.path === "pool-deliver" && quote.minOut && /^\d+$/.test(quote.amountOut)) {
    const surplus = BigInt(quote.amountOut) - BigInt(quote.minOut);
    return { amount: quote.minOut, exact: true, kept: surplus > ZERO ? surplus.toString() : null };
  }
  return { amount: quote.amountOut, exact: false, kept: null };
}

/**
 * Whether a quote on screen is for this pair: the same Osmosis denoms in and
 * out, and the same delivery chain. A quote kept on screen while the next one
 * loads (`stale`) is only shown dimmed when it is: an old route for another
 * token, labelled with the new token's name, would be wrong, not just late.
 */
export function quoteMatchesPair(
  quote: Pick<SwapQuotePrice, "venueInputDenom" | "venueOutputDenom" | "delivery">,
  from: Pick<AssetOption, "osmosisDenom">,
  to: Pick<AssetOption, "osmosisDenom" | "chainId">,
): boolean {
  if (!from.osmosisDenom || !to.osmosisDenom) return false;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(quote.venueInputDenom, from.osmosisDenom) || !same(quote.venueOutputDenom, to.osmosisDenom)) return false;
  return to.chainId === VENUE ? !quote.delivery : quote.delivery?.destChainId === to.chainId;
}

/* -------------------------------------------------------------------------- *
 * The path, in plain words
 * -------------------------------------------------------------------------- */

export interface PathCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * One title and one or two sentences per path: where it signs, what happens
 * in which order, and what becomes of the funds if it does not go through.
 */
export function pathCopy(args: {
  readonly path: SwapPath;
  readonly from: Pick<AssetOption, "ticker" | "chainName" | "chainId">;
  readonly to: Pick<AssetOption, "ticker" | "chainName" | "chainId">;
  /** Display text of the guaranteed minimum (pool-deliver), e.g. `0.3446 USDC.inj`. */
  readonly minimumText?: string | null;
  readonly delivery?: Pick<SwapDeliveryWire, "channelId"> | null;
  readonly inbound?: Pick<SwapInboundWire, "channelId"> | null;
}): PathCopy {
  const { from, to } = args;
  switch (args.path) {
    case "pool":
      return {
        title: "One transaction on Osmosis",
        body: `Swapped in Osmosis pools and paid to your Osmosis address. If the price moves past your minimum, nothing happens and no fee is taken.`,
      };
    case "pool-deliver":
      return {
        title: `Swap on Osmosis, then send to ${to.chainName}`,
        body: `One transaction: the swap, then an IBC transfer of ${args.minimumText ? `exactly the guaranteed ${args.minimumText}` : "the guaranteed minimum"} to your ${to.chainName} address${args.delivery ? ` over ${args.delivery.channelId}` : ""}. Anything the swap pays above it stays in your Osmosis balance.`,
      };
    case "contract":
      return from.chainId === VENUE
        ? {
            title: `Swap on Osmosis, delivered to ${to.chainName}`,
            body: `Zunia's verified swap contract swaps your ${from.ticker} and sends the whole output to your ${to.chainName} address. If delivery fails, your Osmosis address can recover it.`,
          }
        : {
            title: `One signature on ${from.chainName}`,
            body: `Your ${from.ticker} travels to Osmosis${args.inbound ? ` over ${args.inbound.channelId}` : ""}, Zunia's verified swap contract swaps it and delivers ${to.ticker} to your ${to.chainName} address. Gas is paid once, on ${from.chainName}.`,
          };
    case "move-first":
      return {
        title: "Two steps: move, then swap",
        body: `Osmosis's swap contract cannot take ${from.ticker} from ${from.chainName} for this pair, so the tokens move to Osmosis first. The price shown is an estimate for when they arrive.`,
      };
  }
}

/* -------------------------------------------------------------------------- *
 * Ages and liquidity, as the panels word them
 * -------------------------------------------------------------------------- */

/**
 * How old a figure read seconds ago is: `just now`, `12s ago`, `3 min ago`,
 * `2 h ago`. Takes the caller's clock (the page ticks every second; the
 * kit's shared 30-second clock would call a fresh quote "in under a minute").
 * `null` without a time.
 */
export function ageText(at: number | null | undefined, now: number): string | null {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/**
 * Osmosis pool liquidity for a token, as the router reports it (USD whatever
 * the user's currency: the pickers and the chart say so). `null` when not
 * reported.
 */
export function liquidityText(usd: number | null): string | null {
  return usd !== null && Number.isFinite(usd) && usd > 0 ? `${formatFiat(usd, "usd", { compact: true })} liquidity` : null;
}

/* -------------------------------------------------------------------------- *
 * After signing: progress and tracking
 * -------------------------------------------------------------------------- */

export type StepState = "done" | "current" | "todo" | "error";

export interface StepView {
  readonly label: string;
  readonly state: StepState;
  readonly description?: string;
}

/** Where a failed attempt stopped, for the progress steps. */
export type FailedAt = "sign" | "broadcast" | "confirm";

/**
 * The failure's step: the stage the attempt last reached when it is known
 * (preparing counts as signing: nothing reached the wallet or the chain),
 * else by the error: refused or never answered by the wallet, refused by the
 * node, or failed in a block.
 */
export function failedAt(kind: string | null | undefined, txHash: string | null, lastStage?: SignStage | null): FailedAt {
  if (lastStage === "preparing" || lastStage === "awaiting-signature") return "sign";
  if (lastStage === "broadcasting") return "broadcast";
  if (lastStage === "confirming") return "confirm";
  if (kind === "user-rejected" || kind === "wallet-timeout" || kind === "wallet-disconnected") return "sign";
  return txHash ? "confirm" : "broadcast";
}

/**
 * The three signing steps for a stage of `useSignAndBroadcast`: sign in the
 * wallet, broadcast, confirm in a block. `submitted` (not in a block within
 * the watch window) is a pending confirmation, not a failure.
 */
export function signSteps(stage: SignStage, chainName: string, failed: FailedAt | null): StepView[] {
  const steps: [string, string][] = [
    ["Sign in your wallet", "Check the amounts in the wallet window, then approve."],
    ["Broadcast", `Sent to a ${chainName} node.`],
    ["Confirm", `Included in a ${chainName} block.`],
  ];
  const index: Record<SignStage, number> = {
    idle: 0,
    preparing: 0,
    "awaiting-signature": 0,
    broadcasting: 1,
    confirming: 2,
    success: 3,
    submitted: 2,
    failed: failed === "sign" ? 0 : failed === "broadcast" ? 1 : 2,
  };
  const at = index[stage];
  return steps.map(([label, description], i) => {
    if (stage === "failed" && i === at) return { label, state: "error" as const };
    if (i < at) return { label, state: "done" as const };
    if (i === at && stage !== "failed") {
      const hint =
        stage === "preparing"
          ? "Measuring gas and fees…"
          : stage === "submitted"
            ? "Not in a block yet. It may still land: check Activity before trying again."
            : description;
      return { label, state: "current" as const, description: hint };
    }
    return { label, state: "todo" as const };
  });
}

/**
 * What `/api/interchain/track` follows after a swap that moves a packet, or
 * `null` for a swap that settles in its own transaction (`pool`):
 * - `pool-deliver`: the transfer of the floor, Osmosis → the To's chain;
 * - `contract` from another chain: the transfer into Osmosis, the contract's
 *   swap there, and its delivery onward when the To is elsewhere;
 * - `contract` from Osmosis: the swap inside the signed transaction, then the
 *   delivery.
 */
export function trackingPlan(review: {
  readonly path: SignedSwapPath;
  readonly from: { readonly chainId: string; readonly denom: string };
  readonly to: { readonly chainId: string; readonly denom: string };
  readonly quote: Pick<SwapQuotePrice, "delivery" | "inbound">;
}): RoutePlanWire | null {
  const { path, from, to, quote } = review;
  const delivery = quote.delivery && to.chainId !== VENUE ? quote.delivery : null;
  const deliver = delivery
    ? [{ chainId: VENUE, channelId: delivery.channelId, port: delivery.port, counterpartyChainId: to.chainId, kind: "forward" as const }]
    : [];
  const base = {
    sourceChainId: path === "pool-deliver" ? VENUE : from.chainId,
    destChainId: to.chainId,
    inputDenom: from.denom,
    outputDenom: to.denom,
    memo: "",
    warnings: [],
    requiresPfm: false,
  };
  if (path === "pool") return null;
  if (path === "pool-deliver") {
    if (!delivery) return null;
    return {
      ...base,
      hops: [{ chainId: VENUE, channelId: delivery.channelId, port: delivery.port, counterpartyChainId: to.chainId, kind: "transfer" }],
      estimatedDurationSeconds: 60,
      requiresIbcHooks: false,
    };
  }
  const swap = { chainId: VENUE, channelId: "", port: "transfer", counterpartyChainId: null, kind: "swap" as const };
  if (from.chainId === VENUE) {
    if (deliver.length === 0) return null;
    return { ...base, hops: [swap, ...deliver], estimatedDurationSeconds: 60, requiresIbcHooks: false };
  }
  const inbound = quote.inbound;
  if (!inbound) return null;
  return {
    ...base,
    hops: [
      { chainId: from.chainId, channelId: inbound.channelId, port: inbound.port, counterpartyChainId: VENUE, kind: "transfer" },
      swap,
      ...deliver,
    ],
    estimatedDurationSeconds: deliver.length > 0 ? 120 : 60,
    requiresIbcHooks: true,
  };
}
