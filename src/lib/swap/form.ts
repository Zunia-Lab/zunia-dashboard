/**
 * The swap form's glue: the quote request a form state makes, the review it
 * freezes, whether that review still stands, what the sign button says, and
 * the few readings of a quote every surface must word the same way (slippage,
 * price impact, the minimum received).
 *
 * Ported from zunia-extension SwapScreen.tsx (`swapFeeLine`, `swapFeeOutcome`,
 * `poolFeeOutcome`, `reviewDrift`/`poolReviewDrift`, `swapSignBlock`) @ 1453e7a,
 * reshaped around the dashboard's quote (one server answer per form state
 * instead of a planner object). Pure.
 */

import {
  HIGH_SLIPPAGE_PERCENT,
  MAX_SLIPPAGE_PERCENT,
  PRICE_IMPACT_CAUTION_PERCENT,
  PRICE_IMPACT_WARNING_PERCENT,
  SWAP_VENUE_CHAIN_ID,
} from "@/config/interchain";
import { swapFeeFor, feeRateText, feeToWire, sameSwapFee, type SwapFee } from "@/lib/swap/fee";
import { tickerAmount, type AmountLabel } from "@/lib/swap/format";
import { expectedVenueDenoms, type AssetOption } from "@/lib/swap/assets";
import { priceExpired, PRICE_EXPIRED } from "@/lib/swap/checks";
import { sameDenom } from "@/lib/swap/denoms";
import { signingChainFor, type SwapPath } from "@/lib/swap/path";
import type { ReviewSide, SignedSwapPath, SwapReview } from "@/lib/swap/review";
import type { SwapQuoteOk, SwapQuotePrice, SwapQuoteRequest } from "@/lib/swap/wire";

const VENUE = SWAP_VENUE_CHAIN_ID;

/* -------------------------------------------------------------------------- *
 * Slippage
 * -------------------------------------------------------------------------- */

/**
 * Whether a typed tolerance can be quoted, and what to say about it: `valid`
 * false (with the reason) outside (0, 50] or past six decimals (the engine's
 * precision; the quote route refuses finer), a warning above
 * `HIGH_SLIPPAGE_PERCENT`, nothing for an ordinary value.
 */
export function slippageNotice(percent: number): { readonly valid: boolean; readonly message: string | null } {
  if (!Number.isFinite(percent) || percent <= 0) return { valid: false, message: "Enter a tolerance above 0%." };
  if (percent > MAX_SLIPPAGE_PERCENT) {
    return { valid: false, message: `At most ${MAX_SLIPPAGE_PERCENT}%: past that, the minimum would protect next to nothing.` };
  }
  if (Math.round(percent * 1e6) / 1e6 !== percent) return { valid: false, message: "Use at most six decimals." };
  if (percent > HIGH_SLIPPAGE_PERCENT) {
    return {
      valid: true,
      message: `A ${percent}% tolerance lets the swap fill at up to ${percent}% less than quoted. Keep it only for a thin pool.`,
    };
  }
  return { valid: true, message: null };
}

/* -------------------------------------------------------------------------- *
 * Reading a quote
 * -------------------------------------------------------------------------- */

/** How the price impact reads: `unknown` without a figure, then by the shared thresholds. */
export type PriceImpactLevel = "unknown" | "normal" | "caution" | "warning";

/**
 * The level the page colours and words a price impact with
 * (`PRICE_IMPACT_CAUTION_PERCENT`, `PRICE_IMPACT_WARNING_PERCENT`). A
 * favourable (negative) impact reads `normal`; `null` reads `unknown`, never
 * a confident "low".
 */
export function priceImpactLevel(percent: number | null): PriceImpactLevel {
  if (percent === null || !Number.isFinite(percent)) return "unknown";
  if (percent >= PRICE_IMPACT_WARNING_PERCENT) return "warning";
  if (percent >= PRICE_IMPACT_CAUTION_PERCENT) return "caution";
  return "normal";
}

/**
 * "Minimum received", worded for what it is on the quote's path:
 *
 * - pool paths: `exact`, the number signed as `token_out_min_amount` (the
 *   chain refuses the whole transaction below it);
 * - contract path: a rule the contract enforces (`rule`), with `amount` the
 *   rule evaluated at today's price, an estimate (`exact` false);
 * - `amount` is `null` when the floor rounds to nothing.
 *
 * `estimate` is true whenever the figure is not a number in the signed
 * message (the contract's rule, or a `move-first` price).
 */
export function minimumReceived(
  quote: Pick<SwapQuotePrice, "minOut" | "minOutKind" | "slippagePercent" | "twapWindowSeconds" | "estimate">,
  to: AmountLabel,
): { readonly amount: string | null; readonly exact: boolean; readonly estimate: boolean; readonly rule: string | null } {
  const amount = quote.minOut ? tickerAmount(quote.minOut, to) : null;
  if (quote.minOutKind === "exact") return { amount, exact: true, estimate: quote.estimate, rule: null };
  const window = quote.twapWindowSeconds ?? null;
  const rule = window
    ? `The ${window}-second average price, less ${quote.slippagePercent}%. Below it the swap does not happen.`
    : `The average price, less ${quote.slippagePercent}%. Below it the swap does not happen.`;
  return { amount, exact: false, estimate: true, rule };
}

/**
 * Why `quote` is not the answer for this form state, or `null` when it is:
 * the same tolerance, the signing chain its path signs on, and the same two
 * rows (the From's denom on Osmosis, or the hop that brings it in; the To's
 * denom on Osmosis, or the delivery that lands exactly it). `useSwapQuote`
 * only hands out a quote for the current request; this makes the review
 * independent of that promise.
 */
export function quoteMismatch(
  quote: SwapQuoteOk,
  from: Pick<AssetOption, "chainId" | "denom">,
  to: Pick<AssetOption, "chainId" | "denom">,
  slippagePercent: number,
): string | null {
  const other = "The price on screen is for another swap than the one on the form. Wait for the new price.";
  if (quote.slippagePercent !== slippagePercent) {
    return "The price was made for another slippage tolerance. Wait for the new price.";
  }
  if (quote.signingChainId !== signingChainFor(quote.path, from.chainId)) return other;
  if (from.chainId === VENUE) {
    if (!sameDenom(quote.venueInputDenom, from.denom)) return other;
  } else if (quote.path === "contract" && quote.inbound?.sourceChainId !== from.chainId) {
    return other;
  }
  if (to.chainId === VENUE) {
    if (!sameDenom(quote.venueOutputDenom, to.denom)) return other;
  } else if (!quote.delivery || quote.delivery.destChainId !== to.chainId || quote.delivery.arrivalDenom !== to.denom) {
    return other;
  }
  return null;
}

/**
 * The quote request for a form state, and the fee it was netted of. The
 * amount typed (or Max) is what the user spends in all; the swap sells what is
 * left after the Zunia fee on the From's chain, so that is what is priced.
 * `null` when the form cannot be quoted (nothing typed, the same row on both
 * sides, a slippage out of range).
 */
export function quoteRequestFor(args: {
  readonly from: AssetOption | undefined;
  readonly to: AssetOption | undefined;
  /** Base units spent in all, the fee included. */
  readonly amountUnits: bigint | null;
  readonly slippagePercent: number;
}): { readonly request: SwapQuoteRequest; readonly fee: SwapFee } | null {
  const { from, to, amountUnits } = args;
  if (!from || !to || amountUnits === null || amountUnits <= BigInt(0) || from.key === to.key) return null;
  if (!slippageNotice(args.slippagePercent).valid) return null;
  const fee = swapFeeFor(from.chainId, amountUnits);
  if (fee.net <= BigInt(0)) return null;
  return {
    request: {
      fromChainId: from.chainId,
      fromDenom: from.denom,
      toChainId: to.chainId,
      toDenom: to.denom,
      amount: fee.net.toString(),
      slippagePercent: args.slippagePercent,
      ...expectedVenueDenoms(from, to),
    },
    fee,
  };
}

function sideOf(option: AssetOption): ReviewSide {
  return {
    chainId: option.chainId,
    chainName: option.chainName,
    denom: option.denom,
    ticker: option.ticker,
    proven: option.identity.proven,
    decimals: option.decimals,
    osmosisDenom: option.osmosisDenom,
  };
}

/** Why a form state cannot be frozen into a review, or the review. */
export function freezeReview(args: {
  readonly id: number;
  readonly from: AssetOption;
  readonly to: AssetOption;
  readonly amountUnits: bigint;
  readonly quote: SwapQuoteOk;
  readonly slippagePercent: number;
  /** This wallet's address on the signing chain (`quote.signingChainId`). */
  readonly signer: string;
  /** This wallet's address on the To's chain. */
  readonly recipient: string;
  /** This wallet's address on Osmosis; required for the contract path. */
  readonly recoveryAddress: string | null;
  readonly now?: number;
}): { readonly review: SwapReview } | { readonly problem: string } {
  const { quote } = args;
  if (quote.path === "move-first") {
    return { problem: "This pair moves to Osmosis first: send the tokens there, then swap." };
  }
  if (quote.estimate) return { problem: "This price is an estimate and cannot be signed." };
  if (quote.path === "contract" && !args.recoveryAddress) {
    return { problem: "A contract swap needs your Osmosis address as its recovery address; connect Osmosis in your wallet." };
  }
  const fee = swapFeeFor(quote.signingChainId, args.amountUnits);
  if (fee.net.toString() !== quote.amountIn) {
    return { problem: "The price is for another amount than the one on the form. Wait for the new price." };
  }
  const mismatch = quoteMismatch(quote, args.from, args.to, args.slippagePercent);
  if (mismatch) return { problem: mismatch };
  return {
    review: {
      id: args.id,
      path: quote.path as SignedSwapPath,
      from: sideOf(args.from),
      to: sideOf(args.to),
      amountUnits: args.amountUnits.toString(),
      fee: feeToWire(fee),
      quote,
      slippagePercent: args.slippagePercent,
      signer: args.signer,
      recipient: args.recipient,
      recoveryAddress: args.recoveryAddress,
      frozenAt: args.now ?? Date.now(),
    },
  };
}

/** What the form would sign right now, to check a review against. */
export interface LiveSwap {
  readonly fromKey: string | null;
  readonly toKey: string | null;
  /** What the form spends in all, the Zunia fee included. */
  readonly amountUnits: bigint | null;
  readonly slippagePercent: number;
  /** The path the form's latest quote takes; `null` while it has none. */
  readonly path: SwapPath | null;
}

/**
 * Why a review no longer stands, or `null` while it does, in what moved. A new
 * price does not move it: the review keeps the price its messages were built
 * from, and refreshing the price builds a new review.
 */
export function reviewDrift(review: SwapReview, live: LiveSwap): string | null {
  if (live.fromKey !== `${review.from.chainId}:${review.from.denom}`) {
    return `The swap form no longer sells ${review.from.ticker} on ${review.from.chainName}.`;
  }
  if (live.toKey !== `${review.to.chainId}:${review.to.denom}`) {
    return `The swap form no longer buys ${review.to.ticker} on ${review.to.chainName}.`;
  }
  if (live.amountUnits === null || live.amountUnits.toString() !== review.amountUnits) {
    return `The amount on the swap form is no longer ${tickerAmount(review.amountUnits, review.from)}.`;
  }
  const fee = swapFeeFor(review.quote.signingChainId, live.amountUnits);
  const reviewed = { bps: review.fee.bps, fee: BigInt(review.fee.fee), net: BigInt(review.fee.net), recipient: review.fee.recipient };
  if (!sameSwapFee(fee, reviewed)) return "The Zunia fee on the swap form is no longer the one you reviewed.";
  if (live.slippagePercent !== review.slippagePercent) return "The slippage tolerance changed after this review.";
  if (live.path !== null && live.path !== review.path) return "Zunia now swaps this pair another way. Review it again.";
  return null;
}

/**
 * Why the reviewed swap cannot be signed right now: the button's short label
 * and the sentence behind it, or `null` when it can. Checked again at the
 * moment of signing, not only when the button is drawn.
 */
export function signBlock(args: {
  /** The first of `checkSwapTx`'s problems, when there is one. */
  readonly problem: string | null;
  readonly drift: string | null;
  readonly quote: Pick<SwapQuoteOk, "expiresAt">;
  readonly refreshing: boolean;
  readonly now: number;
  /** Not enough left for the network fee (the chain takes it first). */
  readonly feeShort: boolean;
}): { readonly label: string; readonly reason: string } | null {
  if (args.problem) return { label: "Cannot sign", reason: args.problem };
  if (args.drift) return { label: "Out of date", reason: `${args.drift} Go back and review the swap again.` };
  if (args.refreshing) return { label: "Updating the price…", reason: "The price is being updated." };
  if (priceExpired(args.quote, args.now)) return { label: "Price expired", reason: PRICE_EXPIRED };
  if (args.feeShort) {
    return { label: "Need fee room", reason: "Not enough is left for the network fee. Lower the amount or the gas speed." };
  }
  return null;
}

/** The form's fee line: `Zunia fee` and `0.5% · 0.05 OSMO`. `null` when no fee applies. */
export function swapFeeLine(
  fee: SwapFee | null,
  from: Pick<AssetOption, "ticker" | "decimals">,
): { readonly label: string; readonly value: string } | null {
  if (!fee || fee.fee <= BigInt(0)) return null;
  return { label: "Zunia fee", value: `${feeRateText(fee.bps)} · ${tickerAmount(fee.fee, from)}` };
}

/**
 * What becomes of the fee (and a delivery) if the swap does not happen, by
 * how the transaction reaches the venue. One transaction on Osmosis undoes
 * everything together; a transfer pays its fee on its own chain when sent.
 */
export function swapFeeOutcome(path: SignedSwapPath, fromChainId: string, bps: number): string {
  if (path === "pool") return "The swap and the fee are one transaction: if the swap fails, no fee is taken.";
  if (path === "pool-deliver") {
    return "The swap, the fee and the transfer are one transaction: if the swap would pay less than the minimum, none of them happens.";
  }
  if (fromChainId === VENUE) return "The swap and the fee are one transaction: if the swap fails, no fee is taken.";
  const rate = bps > 0 ? ` ${feeRateText(bps)}` : "";
  return `If the swap fails on Osmosis, the amount swapped comes back to you, but the${rate} Zunia fee does not.`;
}
