/**
 * The Markets page's arithmetic: the top strip, the 24 h breadth histogram,
 * tabs, search and rank.
 *
 * Pure (types and arithmetic only) so `node --test` covers it. Rules:
 *
 * - **Sums say what they add.** The market cap sum covers only assets with a
 *   Cosmos-native cap (USDC.n and allBTC carry none: their CoinGecko figure
 *   is the outside asset's), so it is a Cosmos figure. Volumes are summed per
 *   asset, where a swap counts for both of its tokens; the UI says so.
 * - **Movers need a market.** Gainers, losers, best and worst only rank
 *   assets with at least `MOVER_FLOOR` of Osmosis liquidity (or, off Osmosis,
 *   of 24 h volume): a pool with $900 in it can move 50% on one swap.
 * - **Derived is labelled.** The cap-weighted 24 h change assumes supplies
 *   did not change over the day; the UI marks it as an estimate.
 */

import type { MarketAsset } from "@/lib/token/wire";

/** Liquidity (or volume, off Osmosis) an asset needs to rank as a mover. */
export const MOVER_FLOOR = 10_000;

/** A mover worth reporting: enough market behind its price. */
export function hasMarketDepth(asset: Pick<MarketAsset, "liquidity" | "volume24h">, floor = MOVER_FLOOR): boolean {
  return (asset.liquidity ?? asset.volume24h ?? 0) >= floor;
}

export interface MarketSummary {
  /** Σ market cap of assets that have a Cosmos-native one. */
  capSum: number;
  capCount: number;
  /** Cap-weighted 24 h change of those assets, percent (estimate: supplies held constant). */
  cap24hPct: number | null;
  /** Σ Osmosis pool liquidity. */
  liquiditySum: number;
  liquidityCount: number;
  /** Σ per-asset 24 h volume (a swap counts for both tokens). */
  volumeSum: number;
  up: number;
  down: number;
  flat: number;
  /** Assets without a 24 h change. */
  unknown: number;
  best: MarketAsset | null;
  worst: MarketAsset | null;
}

/**
 * The previous value of a figure that is `now` after a `pct` percent change;
 * null when the change is −100% or worse (nothing to divide by).
 */
function before(now: number, pct: number): number | null {
  const factor = 1 + pct / 100;
  return factor > 0 ? now / factor : null;
}

export function marketSummary(assets: readonly MarketAsset[], floor = MOVER_FLOOR): MarketSummary {
  let capSum = 0;
  let capCount = 0;
  let capNow = 0;
  let capThen = 0;
  let liquiditySum = 0;
  let liquidityCount = 0;
  let volumeSum = 0;
  let up = 0;
  let down = 0;
  let flat = 0;
  let unknown = 0;
  let best: MarketAsset | null = null;
  let worst: MarketAsset | null = null;
  for (const asset of assets) {
    if (asset.marketCap !== null && asset.marketCap > 0) {
      capSum += asset.marketCap;
      capCount += 1;
      if (asset.change24h !== null) {
        const then = before(asset.marketCap, asset.change24h);
        if (then !== null) {
          capNow += asset.marketCap;
          capThen += then;
        }
      }
    }
    if (asset.liquidity !== null) {
      liquiditySum += asset.liquidity;
      liquidityCount += 1;
    }
    if (asset.volume24h !== null) volumeSum += asset.volume24h;
    const change = asset.change24h;
    if (change === null) unknown += 1;
    else if (change > 0) up += 1;
    else if (change < 0) down += 1;
    else flat += 1;
    if (change === null || !hasMarketDepth(asset, floor)) continue;
    if (!best || change > (best.change24h ?? -Infinity)) best = asset;
    if (!worst || change < (worst.change24h ?? Infinity)) worst = asset;
  }
  return {
    capSum,
    capCount,
    cap24hPct: capThen > 0 ? (capNow / capThen - 1) * 100 : null,
    liquiditySum,
    liquidityCount,
    volumeSum,
    up,
    down,
    flat,
    unknown,
    best: best && (best.change24h ?? 0) > 0 ? best : null,
    worst: worst && (worst.change24h ?? 0) < 0 ? worst : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Breadth histogram                                                           */
/* -------------------------------------------------------------------------- */

export interface ChangeBucket {
  /** Stable key, also the category x. */
  id: string;
  /** Axis label. */
  label: string;
  /** Lower bound (inclusive) and upper bound (exclusive), percent; null = open. */
  from: number | null;
  to: number | null;
  /** Which way the bucket points: colours it and splits the stack. */
  side: "down" | "flat" | "up";
  count: number;
}

const EDGES: readonly { id: string; label: string; from: number | null; to: number | null; side: ChangeBucket["side"] }[] = [
  { id: "lt-10", label: "≤ −10%", from: null, to: -10, side: "down" },
  { id: "-10", label: "−10…−5", from: -10, to: -5, side: "down" },
  { id: "-5", label: "−5…−2", from: -5, to: -2, side: "down" },
  { id: "-2", label: "−2…0", from: -2, to: 0, side: "down" },
  { id: "0", label: "0", from: 0, to: 0, side: "flat" },
  { id: "2", label: "0…2", from: 0, to: 2, side: "up" },
  { id: "5", label: "2…5", from: 2, to: 5, side: "up" },
  { id: "10", label: "5…10", from: 5, to: 10, side: "up" },
  { id: "gt-10", label: "≥ 10%", from: 10, to: null, side: "up" },
];

/**
 * How many assets moved how much over 24 h, in nine buckets from "fell 10%
 * or more" to "rose 10% or more", with exactly unchanged on its own. A
 * change on a bucket edge belongs to the bucket further from zero (−5 is in
 * "−10…−5", +5 in "5…10").
 */
export function changeBuckets(assets: readonly Pick<MarketAsset, "change24h">[]): ChangeBucket[] {
  const buckets = EDGES.map((edge) => ({ ...edge, count: 0 }));
  for (const asset of assets) {
    const change = asset.change24h;
    if (change === null || !Number.isFinite(change)) continue;
    let index: number;
    if (change === 0) index = 4;
    else if (change < 0) index = change <= -10 ? 0 : change <= -5 ? 1 : change <= -2 ? 2 : 3;
    else index = change >= 10 ? 8 : change >= 5 ? 7 : change >= 2 ? 6 : 5;
    buckets[index].count += 1;
  }
  return buckets;
}

/* -------------------------------------------------------------------------- */
/* Tabs, search, rank                                                          */
/* -------------------------------------------------------------------------- */

export type MarketTab = "all" | "watchlist" | "gainers" | "losers";

/** Rows of a tab. Gainers / losers are ranked by 24 h change among assets with market depth. */
export function tabRows(assets: readonly MarketAsset[], tab: MarketTab, watchlist: ReadonlySet<string>, floor = MOVER_FLOOR): MarketAsset[] {
  switch (tab) {
    case "all":
      return [...assets];
    case "watchlist":
      return assets.filter((asset) => watchlist.has(asset.key));
    case "gainers":
      return assets
        .filter((asset) => asset.change24h !== null && asset.change24h > 0 && hasMarketDepth(asset, floor))
        .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
    case "losers":
      return assets
        .filter((asset) => asset.change24h !== null && asset.change24h < 0 && hasMarketDepth(asset, floor))
        .sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0));
  }
}

/** Symbol, name, key, home chain: case-insensitive substring. */
export function matchesMarketQuery(asset: Pick<MarketAsset, "symbol" | "name" | "key" | "chainId">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [asset.symbol, asset.name, asset.key, asset.chainId ?? ""].some((field) => field.toLowerCase().includes(q));
}

/**
 * Rank by Osmosis liquidity, the order the API sends; an asset with no
 * Osmosis pool (SAF on Coinstore) has no rank on that scale.
 */
export function liquidityRanks(assets: readonly Pick<MarketAsset, "key" | "liquidity">[]): Map<string, number | null> {
  const ranks = new Map<string, number | null>();
  let rank = 0;
  for (const asset of assets) {
    if (asset.liquidity === null) {
      ranks.set(asset.key, null);
      continue;
    }
    rank += 1;
    ranks.set(asset.key, rank);
  }
  return ranks;
}

/** An issuer or bridge tag (`USDC.n`, `ETH.axl`) and an Osmosis alloy prefix (`allBTC`). */
const ISSUER_TAG = /\.[a-z]+$/;
const ALLOY_PREFIX = /^all(?=[A-Z0-9])/;

/**
 * The wider asset a ticker names one form of: `USDC.n` → `USDC`,
 * `ETH.axl` → `ETH`, `allBTC` → `BTC`; null when the ticker is the asset
 * itself (`ATOM`, `milkTIA`).
 */
export function familyOf(symbol: string): string | null {
  if (ISSUER_TAG.test(symbol)) return symbol.replace(ISSUER_TAG, "") || null;
  if (ALLOY_PREFIX.test(symbol)) return symbol.replace(ALLOY_PREFIX, "") || null;
  return null;
}

export interface CapReasonInput {
  symbol: string;
  verified: boolean;
  /** The wider asset this token is one form of (`TokenIdentity.family`), when known. */
  family?: string | null;
  /** The market read failed: an absent cap is the outage, not a fact about the asset. */
  sourceFailed?: boolean;
}

/**
 * Why an asset shows no market cap. A form of a wider asset (Noble's USDC,
 * Axelar's ETH, an alloy) gets none on purpose: the family's cap counts every
 * form on every chain, so it would not describe this token. The wording
 * avoids "bridged": Noble issues its USDC natively.
 *
 * Those two reasons are identity policy and stay true during an outage; only
 * "no source reports one" is a claim about the sources, so a failed read says
 * the figure is unavailable instead.
 */
export function marketCapReason(asset: CapReasonInput): string {
  if (!asset.verified) return "Unverified token: no market cap is attributed to it";
  const family = asset.family && asset.family !== asset.symbol ? asset.family : familyOf(asset.symbol);
  if (family) {
    return `${asset.symbol} is one form of ${family}: a market cap for ${family} counts every form, so none is shown for this token alone`;
  }
  return asset.sourceFailed ? "Unavailable right now" : "No source reports a market cap for this asset";
}

/** The highest-liquidity assets and each one's share of the listed total, for the depth list. */
export function liquidityLeaders(assets: readonly MarketAsset[], limit = 8): { asset: MarketAsset; share: number }[] {
  const listed = assets.filter((asset) => asset.liquidity !== null && asset.liquidity > 0);
  const total = listed.reduce((sum, asset) => sum + (asset.liquidity ?? 0), 0);
  if (total <= 0) return [];
  return [...listed]
    .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))
    .slice(0, limit)
    .map((asset) => ({ asset, share: ((asset.liquidity ?? 0) / total) * 100 }));
}
