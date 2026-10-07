/**
 * What a price series says over its range: change, high and low, realised
 * volatility and the deepest drawdown. Pure, so it is tested.
 *
 * Volatility is the standard deviation of log returns between consecutive
 * samples, annualised by the samples per year of the series' resolution
 * (hourly: 8,760; daily: 365). Only steps of a regular length count: the
 * series ends with a "now" point a few hours after the last daily close,
 * and that partial step would read as a jump.
 */

import type { PricePoint } from "@/lib/token/types";

export interface RangeStats {
  first: PricePoint;
  last: PricePoint;
  /** Percent from the first to the last point; null when the first is zero. */
  change: number | null;
  high: PricePoint;
  low: PricePoint;
  /** Annualised, percent; null with fewer than 3 regular steps. */
  volatility: number | null;
  /** Deepest fall from a running peak, percent (≤ 0); null with fewer than 2 points. */
  maxDrawdown: number | null;
}

const PERIODS_PER_YEAR = { hour: 24 * 365, day: 365 } as const;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function rangeStats(input: readonly PricePoint[], resolution: "hour" | "day"): RangeStats | null {
  const points = input.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0).sort((a, b) => a.t - b.t);
  if (points.length === 0) return null;
  const first = points[0] as PricePoint;
  const last = points[points.length - 1] as PricePoint;
  let high = first;
  let low = first;
  let peak = first.v;
  let drawdown = 0;
  for (const point of points) {
    if (point.v > high.v) high = point;
    if (point.v < low.v) low = point;
    if (point.v > peak) peak = point.v;
    drawdown = Math.min(drawdown, point.v / peak - 1);
  }

  let volatility: number | null = null;
  if (points.length >= 3) {
    const gaps = points.slice(1).map((p, i) => p.t - (points[i] as PricePoint).t);
    const typical = median(gaps);
    const returns: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const gap = gaps[i - 1] as number;
      if (gap < typical * 0.5 || gap > typical * 1.5) continue;
      returns.push(Math.log((points[i] as PricePoint).v / (points[i - 1] as PricePoint).v));
    }
    if (returns.length >= 2) {
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
      volatility = Math.sqrt(variance) * Math.sqrt(PERIODS_PER_YEAR[resolution]) * 100;
    }
  }

  return {
    first,
    last,
    change: first.v > 0 ? (last.v / first.v - 1) * 100 : null,
    high,
    low,
    volatility,
    maxDrawdown: points.length >= 2 ? drawdown * 100 : null,
  };
}

/**
 * Below this relative span (high − low over the middle) a series is "quiet":
 * a stablecoin, or a coin on a calm day.
 */
export const QUIET_SPAN = 0.02;

/**
 * The y range of a price chart. A quiet series is drawn inside a fixed
 * window of ±1% around its middle: stretched to the full plot height, the
 * $0.00004 wobble of a dollar stablecoin would look like a crash. Anything
 * that moves more keeps the chart's own padded range ("auto").
 */
export function priceDomain(points: readonly PricePoint[]): "auto" | [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.v)) continue;
    if (point.v < lo) lo = point.v;
    if (point.v > hi) hi = point.v;
  }
  if (!Number.isFinite(lo) || lo <= 0) return "auto";
  const mid = (lo + hi) / 2;
  if ((hi - lo) / mid >= QUIET_SPAN) return "auto";
  return [mid * (1 - QUIET_SPAN / 2), mid * (1 + QUIET_SPAN / 2)];
}

/**
 * A drawdown for display: "−18.6%", "<0.1%" for a fall too small to show at
 * one decimal (never "−<0.1%"), "0%" when the price never fell.
 */
export function drawdownText(pct: number | null, format: (value: number) => string): string | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (pct === 0) return "0%";
  if (pct > -0.05) return "<0.1%";
  return format(pct);
}
