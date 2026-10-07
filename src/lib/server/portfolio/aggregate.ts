/**
 * From per-chain holdings, identities and prices to the portfolio answer.
 * Pure: every figure on Overview is computed here, and tested.
 *
 * Rules (the extension's `computePortfolio`, zunia-extension lib/portfolio.ts
 * @ 1453e7a, made per asset):
 *
 * - **An asset is one denom on one chain**, with four buckets in base units:
 *   liquid (bank), staked (delegations), rewards (claimable, truncated to
 *   whole base units), unbonding (entries still maturing).
 * - **Unpriced is counted, never valued at 0.** Its `value` is null and it is
 *   left out of every sum; `unpricedAssetCount` says how many. A portfolio
 *   where nothing could be priced has `value: null`, not `$0`.
 * - **The 24 h change is exact for constant holdings.** An asset worth `v` now
 *   whose price moved `c` % was worth `v / (1 + c/100)` a day ago, so its
 *   change is `v·c / (100 + c)`; the percentage is the sum of those over the
 *   sum of the day-ago values. A value-weighted average of percentages (the
 *   extension's shortcut) overstates gains and understates losses. The 7 d
 *   change is the same sum over the 7 d price changes. Both cover only the
 *   assets whose source gives that change, and are null when none does.
 * - **A failed chain is reported, not zeroed.** It keeps its row with status
 *   "error" and null figures; the totals cover what was read. A chain whose
 *   holdings could not be priced at all has null figures too, not $0.
 */

import type { FiatCurrency, SpotPrice, TokenIdentity } from "@/lib/token/types";
import type {
  CurrencyFallback,
  PortfolioAsset,
  PortfolioChain,
  PortfolioResponse,
  UnpricedReason,
  UpstreamIssue,
} from "@/lib/token/wire";
import type { Coin } from "./parse";

export interface ChainHoldings {
  /** Non-zero bank balances. */
  liquid: Coin[];
  /** Delegated amounts, summed per denom. */
  staked: Coin[];
  /** Claimable rewards, truncated, per denom. */
  rewards: Coin[];
  /** Unbonding entries, summed per denom. */
  unbonding: Coin[];
  /** Secondary reads that failed while the bank read worked. */
  issues: UpstreamIssue[];
}

export interface ChainInput {
  chainId: string;
  chainName: string;
  iconUrl: string | null;
  /** The chain's staking ticker ("ATOM"). */
  nativeSymbol: string;
  address: string;
  /** Null when the chain could not be read. */
  holdings: ChainHoldings | null;
  error?: string;
}

export interface AggregateInput {
  currency: FiatCurrency;
  currencyFallback?: CurrencyFallback;
  chains: readonly ChainInput[];
  /** The identity of a denom held on a chain (already resolved). */
  identify: (chainId: string, denom: string) => TokenIdentity;
  /** By identity key (= price-subject key), in `currency`. */
  prices: ReadonlyMap<string, SpotPrice>;
  /** By identity key, why there is no price. */
  unpriced: ReadonlyMap<string, UnpricedReason>;
  errors: readonly UpstreamIssue[];
  now: number;
}

const ZERO = BigInt(0);

function big(amount: string): bigint {
  return /^\d+$/.test(amount) ? BigInt(amount) : ZERO;
}

/** Base units to a float for display maths (never for signing). */
export function toWhole(amount: bigint | string, decimals: number): number {
  const value = typeof amount === "bigint" ? amount : big(amount);
  if (value === ZERO) return 0;
  const negative = value < ZERO;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : "0";
  const n = Number(`${whole}.${fraction}`);
  return negative ? -n : n;
}

/**
 * The value change over a window of an asset worth `value` now whose price
 * moved `changePct` % over it (24 h, or 7 d with the 7 d change).
 */
export function change24hAbsOf(value: number, changePct: number | null | undefined): number | null {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct) || changePct <= -100) return null;
  return (value * changePct) / (100 + changePct);
}

interface Buckets {
  liquid: bigint;
  staked: bigint;
  rewards: bigint;
  unbonding: bigint;
}

function bucketsByDenom(holdings: ChainHoldings): Map<string, Buckets> {
  const out = new Map<string, Buckets>();
  const add = (coins: readonly Coin[], field: keyof Buckets) => {
    for (const coin of coins) {
      const entry = out.get(coin.denom) ?? { liquid: ZERO, staked: ZERO, rewards: ZERO, unbonding: ZERO };
      entry[field] += big(coin.amount);
      out.set(coin.denom, entry);
    }
  };
  add(holdings.liquid, "liquid");
  add(holdings.staked, "staked");
  add(holdings.rewards, "rewards");
  add(holdings.unbonding, "unbonding");
  return out;
}

/** Σ of value changes over one window, and Σ of the values they started from. */
interface ChangeTally {
  change: number;
  base: number;
  known: boolean;
}

interface Tally {
  value: number;
  liquid: number;
  staked: number;
  rewards: number;
  unbonding: number;
  day: ChangeTally;
  week: ChangeTally;
  priced: number;
  assets: number;
}

function emptyTally(): Tally {
  return {
    value: 0,
    liquid: 0,
    staked: 0,
    rewards: 0,
    unbonding: 0,
    day: { change: 0, base: 0, known: false },
    week: { change: 0, base: 0, known: false },
    priced: 0,
    assets: 0,
  };
}

function addChange(tally: ChangeTally, value: number, change: number | null): void {
  if (change === null) return;
  tally.change += change;
  tally.base += value - change;
  tally.known = true;
}

function mergeChange(into: ChangeTally, from: ChangeTally): void {
  into.change += from.change;
  into.base += from.base;
  into.known ||= from.known;
}

/** The change in percent of what the same holdings were worth at the window's start. */
function changePct(tally: ChangeTally): number | null {
  return tally.known && tally.base > 0 ? (tally.change / tally.base) * 100 : null;
}

function compareAssets(a: PortfolioAsset, b: PortfolioAsset): number {
  if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
  if (a.value !== null && b.value === null) return -1;
  if (a.value === null && b.value !== null) return 1;
  const ticker = a.identity.ticker.localeCompare(b.identity.ticker);
  return ticker !== 0 ? ticker : a.chainId.localeCompare(b.chainId);
}

export function buildPortfolio(input: AggregateInput): PortfolioResponse {
  const errors: UpstreamIssue[] = [...input.errors];
  const assets: PortfolioAsset[] = [];
  const chains: PortfolioChain[] = [];
  const total = emptyTally();
  let chainCount = 0;

  for (const chain of input.chains) {
    if (!chain.holdings) {
      errors.push({ chainId: chain.chainId, scope: "chain", message: chain.error ?? "Chain unreachable" });
      chains.push({
        chainId: chain.chainId,
        chainName: chain.chainName,
        iconUrl: chain.iconUrl,
        address: chain.address,
        status: "error",
        error: chain.error ?? "Chain unreachable",
        value: null,
        liquid: null,
        staked: null,
        rewards: null,
        unbonding: null,
        change24hAbs: null,
        assetCount: 0,
        nativeSymbol: chain.nativeSymbol,
      });
      continue;
    }
    for (const issue of chain.holdings.issues) errors.push({ ...issue, chainId: chain.chainId });

    const tally = emptyTally();
    for (const [denom, buckets] of bucketsByDenom(chain.holdings)) {
      const sum = buckets.liquid + buckets.staked + buckets.rewards + buckets.unbonding;
      if (sum <= ZERO) continue;
      const identity = input.identify(chain.chainId, denom);
      const decimals = identity.decimals;
      const price = decimals === null ? null : (input.prices.get(identity.key) ?? null);
      const units = decimals === null ? null : toWhole(sum, decimals);
      const value = price && units !== null ? units * price.price : null;
      const change = value !== null ? change24hAbsOf(value, price?.change24h) : null;
      const asset: PortfolioAsset = {
        identity,
        chainId: chain.chainId,
        amounts: {
          liquid: buckets.liquid.toString(),
          staked: buckets.staked.toString(),
          rewards: buckets.rewards.toString(),
          unbonding: buckets.unbonding.toString(),
        },
        total: units,
        price,
        value,
        change24hAbs: change,
      };
      if (value === null) {
        asset.unpriced =
          decimals === null ? "decimals-unknown" : (input.unpriced.get(identity.key) ?? "no-market");
      }
      assets.push(asset);
      tally.assets += 1;
      if (value === null || price === null || decimals === null) continue;
      tally.priced += 1;
      tally.value += value;
      tally.liquid += toWhole(buckets.liquid, decimals) * price.price;
      tally.staked += toWhole(buckets.staked, decimals) * price.price;
      tally.rewards += toWhole(buckets.rewards, decimals) * price.price;
      tally.unbonding += toWhole(buckets.unbonding, decimals) * price.price;
      addChange(tally.day, value, change);
      addChange(tally.week, value, change24hAbsOf(value, price.change7d));
    }

    if (tally.assets > 0) chainCount += 1;
    // Held but nothing priceable: every figure is unknown, not zero.
    const unknown = tally.assets > 0 && tally.priced === 0;
    chains.push({
      chainId: chain.chainId,
      chainName: chain.chainName,
      iconUrl: chain.iconUrl,
      address: chain.address,
      status: "ok",
      value: unknown ? null : tally.value,
      liquid: unknown ? null : tally.liquid,
      staked: unknown ? null : tally.staked,
      rewards: unknown ? null : tally.rewards,
      unbonding: unknown ? null : tally.unbonding,
      change24hAbs: tally.day.known ? tally.day.change : null,
      assetCount: tally.assets,
      nativeSymbol: chain.nativeSymbol,
    });

    total.value += tally.value;
    total.liquid += tally.liquid;
    total.staked += tally.staked;
    total.rewards += tally.rewards;
    total.unbonding += tally.unbonding;
    mergeChange(total.day, tally.day);
    mergeChange(total.week, tally.week);
    total.priced += tally.priced;
    total.assets += tally.assets;
  }

  assets.sort(compareAssets);
  // Most valuable chain first; failed chains last, in request order.
  chains.sort((a, b) => {
    if (a.status !== b.status) return a.status === "ok" ? -1 : 1;
    return (b.value ?? -1) - (a.value ?? -1);
  });

  const response: PortfolioResponse = {
    currency: input.currency,
    updatedAt: input.now,
    totals: {
      value: total.assets > 0 && total.priced === 0 ? null : total.value,
      liquid: total.liquid,
      staked: total.staked,
      rewards: total.rewards,
      unbonding: total.unbonding,
      change24hAbs: total.day.known ? total.day.change : null,
      change24hPct: changePct(total.day),
      change7dAbs: total.week.known ? total.week.change : null,
      change7dPct: changePct(total.week),
      pricedValue: total.value,
      unpricedAssetCount: total.assets - total.priced,
      assetCount: total.assets,
      chainCount,
    },
    chains,
    assets,
  };
  if (input.currencyFallback) response.currencyFallback = input.currencyFallback;
  if (errors.length > 0) response.errors = errors;
  return response;
}

/** One asset across every chain that holds it, for the history curve. */
export interface HoldingGroup {
  identity: TokenIdentity;
  /** Whole units across every chain that holds the asset. */
  units: number;
  /** Today's value, in the portfolio's currency. */
  value: number;
  /** Spot price, in the portfolio's currency. */
  spot: number;
}

/**
 * Priced holdings grouped by asset key, most valuable first: the same asset
 * on two chains (ATOM on the Hub and on Osmosis) is one series of summed
 * units. Unpriced holdings are not in it; the curve names what it leaves out.
 */
export function groupHoldings(assets: readonly PortfolioAsset[]): HoldingGroup[] {
  const groups = new Map<string, HoldingGroup>();
  for (const asset of assets) {
    if (asset.value === null || asset.total === null || !asset.price) continue;
    const group = groups.get(asset.identity.key) ?? {
      identity: asset.identity,
      units: 0,
      value: 0,
      spot: asset.price.price,
    };
    group.units += asset.total;
    group.value += asset.value;
    groups.set(asset.identity.key, group);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}
