/**
 * The numbers behind the Chains page's yield map: real yield against the
 * share of supply staked, for the chains in the table that have both.
 *
 * Why these two axes: under x/mint the staking APR is issuance divided among
 * stakers, so a chain where few holders stake pays a high real yield (and is
 * cheaper to attack), while a chain where most of the supply is staked pays
 * close to its inflation. Plotting one against the other explains the
 * outliers the table and the leader tiles show (FirmaChain's +81 % with 16 %
 * staked) instead of leaving them as a headline.
 *
 * Pure (`__tests__/yield-map.test.ts`); units leave here as percent units.
 */

import type { ChainStats } from "@/lib/chain/types";

export interface MapPoint {
  chainId: string;
  name: string;
  /** Share of supply staked, percent (0–100). */
  staked: number;
  /** Real yield (APR − inflation), percent. */
  realYield: number;
  /** Actual APR and inflation, percent, for the tooltip. */
  apr: number | null;
  inflation: number | null;
  followed: boolean;
}

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** Chains with both a real yield and a staked share, in the order given. */
export function yieldMapPoints(stats: readonly ChainStats[], isFollowed: (chainId: string) => boolean): MapPoint[] {
  const points: MapPoint[] = [];
  for (const chain of stats) {
    if (!finite(chain.realYield) || !finite(chain.bondedRatio) || chain.bondedRatio <= 0) continue;
    points.push({
      chainId: chain.chainId,
      name: chain.chainName,
      staked: Math.min(100, chain.bondedRatio * 100),
      realYield: chain.realYield * 100,
      apr: finite(chain.apr.actual) ? chain.apr.actual * 100 : null,
      inflation: finite(chain.inflation.actual) ? chain.inflation.actual * 100 : null,
      followed: isFollowed(chain.chainId),
    });
  }
  return points;
}

export function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** The q-quantile (0..1) by linear interpolation; null for no values. */
export function quantile(values: readonly number[], q: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const a = sorted[lower] as number;
  const b = sorted[upper] as number;
  return a + (b - a) * (position - lower);
}

/**
 * The highest real yield the map's axis needs to show. One outlier
 * (FirmaChain at +81 % beside a pack under +56 %) would otherwise squash
 * every other chain into the bottom of the plot. The top is the 90th
 * percentile × 1.25 (at least +10 %), so a value only goes off the scale
 * when it stands well clear of the rest; the chart pins off-scale points to
 * its top edge and prints their real figure (the honest way to clip). With
 * fewer than five points, or no outlier, the top is simply the highest value.
 */
export function yieldAxisTop(values: readonly number[]): number {
  const known = values.filter(Number.isFinite);
  if (known.length === 0) return 10;
  const max = Math.max(...known);
  if (known.length < 5) return Math.max(10, max);
  const cap = Math.max(10, (quantile(known, 0.9) as number) * 1.25);
  return max <= cap ? Math.max(10, max) : cap;
}

/**
 * Spearman's rank correlation between two equal-length series (ties get
 * their average rank); null under five pairs, where it means nothing.
 */
export function rankCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const rx = ranks(xs.slice(0, n));
  const ry = ranks(ys.slice(0, n));
  const mean = (n + 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (rx[i] as number) - mean;
    const dy = (ry[i] as number) - mean;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] as { value: number }).value === (order[i] as { value: number }).value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[(order[k] as { index: number }).index] = rank;
    i = j + 1;
  }
  return out;
}

export interface MapReading {
  count: number;
  median: number | null;
  /** Chains whose stakers lose share of supply (real yield below zero), worst first. */
  diluting: MapPoint[];
  /**
   * How real yield moves with the staked share, from the rank correlation:
   * "inverse" when chains with less staked clearly pay more (ρ ≤ −0.4),
   * "same" when they clearly pay less (ρ ≥ 0.4), else "none"; null when
   * there are too few chains to say.
   */
  link: "inverse" | "same" | "none" | null;
  rho: number | null;
}

/** What the map says in words: the median, who dilutes stakers, how the axes relate. */
export function readMap(points: readonly MapPoint[]): MapReading {
  const rho = rankCorrelation(
    points.map((p) => p.staked),
    points.map((p) => p.realYield),
  );
  return {
    count: points.length,
    median: median(points.map((p) => p.realYield)),
    diluting: points.filter((p) => p.realYield < 0).sort((a, b) => a.realYield - b.realYield),
    link: rho === null ? null : rho <= -0.4 ? "inverse" : rho >= 0.4 ? "same" : "none",
    rho,
  };
}
