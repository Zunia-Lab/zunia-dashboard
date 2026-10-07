/**
 * Time grids and series arithmetic for price history and the portfolio's
 * "value of today's holdings" curve. Pure, so the honesty rules are tested:
 *
 * - a series is sampled on a common grid by **forward fill** (the last known
 *   price stands until the next one), never by interpolation, which would
 *   invent prices between two real ones;
 * - before an asset's first known price there is no price. When it has to be
 *   summed with others, the first known price is held flat backwards and the
 *   asset is reported as `partial` with the date its history starts, so the UI
 *   can say "allUSDC history starts 2026-08-18";
 * - an asset with no price in the window at all is left out and reported, not
 *   counted at zero.
 */

import type { PricePoint, PriceRange } from "@/lib/token/types";

export type Resolution = "hour" | "day";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export interface RangeSpec {
  range: PriceRange;
  resolution: Resolution;
  stepMs: number;
  spanMs: number;
}

export const PRICE_RANGES: readonly PriceRange[] = ["1D", "7D", "30D", "90D", "1Y"];

/** Hourly up to a week, daily beyond (spec: "hourly ≤7D, daily otherwise"). */
export function rangeSpec(range: PriceRange): RangeSpec {
  switch (range) {
    case "1D":
      return { range, resolution: "hour", stepMs: HOUR_MS, spanMs: DAY_MS };
    case "7D":
      return { range, resolution: "hour", stepMs: HOUR_MS, spanMs: 7 * DAY_MS };
    case "30D":
      return { range, resolution: "day", stepMs: DAY_MS, spanMs: 30 * DAY_MS };
    case "90D":
      return { range, resolution: "day", stepMs: DAY_MS, spanMs: 90 * DAY_MS };
    case "1Y":
      return { range, resolution: "day", stepMs: DAY_MS, spanMs: 365 * DAY_MS };
  }
}

/**
 * Step-aligned (UTC) timestamps from `now − span` to the last boundary at or
 * before `now`.
 *
 * For 1D the window is the last 24 hours themselves: it starts at the first
 * hourly boundary *inside* them, not a full 24 h before the last boundary.
 * Flooring both ends made the "24H" curve span up to 24 h 59 min, so its
 * change was measured from a different hour than the hero's own 24h figure
 * (Numia's 24h change is taken from the first hourly close inside the last 24
 * hours: −5.93% for ATOM against the curve's −5.26% an hour earlier). Longer
 * ranges keep whole steps; an hour either way does not move a 7-day change.
 */
export function gridFor(spec: RangeSpec, now: number): number[] {
  const end = Math.floor(now / spec.stepMs) * spec.stepMs;
  const start =
    spec.range === "1D" ? Math.ceil((now - spec.spanMs) / spec.stepMs) * spec.stepMs : end - spec.spanMs;
  const grid: number[] = [];
  for (let t = start; t <= end; t += spec.stepMs) grid.push(t);
  return grid;
}

/**
 * The price in force at each grid time: the last point at or before it.
 * `null` before the first point. `points` must be sorted oldest first.
 */
export function sampleForwardFill(points: readonly PricePoint[], grid: readonly number[]): (number | null)[] {
  const out: (number | null)[] = [];
  let index = -1;
  for (const t of grid) {
    while (index + 1 < points.length && (points[index + 1]?.t ?? Infinity) <= t) index += 1;
    out.push(index >= 0 ? (points[index]?.v ?? null) : null);
  }
  return out;
}

/**
 * One asset's price on the grid, for a chart of that asset alone: leading
 * times without a price are dropped (the chart starts where the data does).
 */
export function resampleOnGrid(points: readonly PricePoint[], grid: readonly number[]): PricePoint[] {
  const sampled = sampleForwardFill(points, grid);
  const out: PricePoint[] = [];
  grid.forEach((t, index) => {
    const v = sampled[index];
    if (v !== null && v !== undefined) out.push({ t, v });
  });
  return out;
}

export interface HoldingSeries {
  /** Asset key, reported back in `partial` / `skipped`. */
  key: string;
  /** Whole units held today. */
  units: number;
  /** Price history, oldest first, in the output currency. */
  points: readonly PricePoint[];
}

export interface CombinedSeries {
  points: PricePoint[];
  /** Assets whose history starts inside the window: held flat at their first price before that. */
  partial: { key: string; from: number }[];
  /** Assets with no price anywhere in the window: not in the sum. */
  skipped: string[];
}

/**
 * Σ units × price(t) on the grid. Forward fill inside each series; a series
 * that starts late is back-filled flat from its first price and reported in
 * `partial`; a series with nothing in the window is skipped and reported.
 */
export function combineHoldings(series: readonly HoldingSeries[], grid: readonly number[]): CombinedSeries {
  const totals = grid.map(() => 0);
  const partial: { key: string; from: number }[] = [];
  const skipped: string[] = [];
  let used = 0;
  for (const item of series) {
    if (!(item.units > 0)) continue;
    const sampled = sampleForwardFill(item.points, grid);
    const firstIndex = sampled.findIndex((v) => v !== null);
    if (firstIndex === -1) {
      skipped.push(item.key);
      continue;
    }
    const first = sampled[firstIndex] as number;
    if (firstIndex > 0) partial.push({ key: item.key, from: grid[firstIndex] as number });
    sampled.forEach((v, index) => {
      totals[index] = (totals[index] ?? 0) + item.units * (v ?? first);
    });
    used += 1;
  }
  return {
    points: used === 0 ? [] : grid.map((t, index) => ({ t, v: totals[index] ?? 0 })),
    partial,
    skipped,
  };
}

/**
 * The grid series plus the newest real price when it is later than the last
 * grid boundary (the bar still forming, or CoinGecko's latest sample), so a
 * chart ends on the price of now rather than on the last full hour or day.
 * Nothing is added to an empty series: no data stays no data.
 */
export function withLatest(
  sampled: readonly PricePoint[],
  raw: readonly PricePoint[],
  grid: readonly number[],
  now: number,
): PricePoint[] {
  const out = [...sampled];
  const gridEnd = grid[grid.length - 1];
  const latest = raw.filter((point) => point.t <= now).at(-1);
  if (out.length > 0 && latest && gridEnd !== undefined && latest.t > gridEnd) out.push(latest);
  return out;
}

/** Rounds to `digits` significant digits, to keep payloads small without changing what a chart shows. */
export function roundSignificant(value: number, digits = 6): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  return Number(value.toPrecision(digits));
}
