/**
 * Data shaping for the chart kit: cleaning time series, rebasing them to a
 * common index, folding long tails into "Other". Pure, tested in
 * __tests__/series.test.ts.
 */

import { colorFor, OTHER_ID, stableColorMap, VIZ_OTHER } from "./palette";
import { lowerBound } from "./ticks";

/** One sample of a time series. `t` is epoch milliseconds. */
export interface TimePoint {
  t: number;
  v: number;
}

/** One slice of a whole (donut segment, allocation bar segment). */
export interface PartDatum {
  id: string;
  label: string;
  value: number;
  color?: string;
}

/**
 * Finite points in ascending time, one per timestamp (the last sample wins).
 * Returns the input untouched when it is already clean, which is the common
 * case, so charts can call this on every render without copying.
 */
export function cleanSeries(points: readonly TimePoint[]): readonly TimePoint[] {
  let clean = true;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) {
      clean = false;
      break;
    }
    if (i > 0 && p.t <= points[i - 1].t) {
      clean = false;
      break;
    }
  }
  if (clean) return points;

  const byTime = new Map<number, number>();
  for (const p of points) {
    if (Number.isFinite(p.t) && Number.isFinite(p.v)) byTime.set(p.t, p.v);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, v }));
}

/** [min, max] of the values, or null when there are none. */
export function valueExtent(points: readonly TimePoint[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  return min <= max ? [min, max] : null;
}

/** Relative change from `from` to `to` (0.124 for +12.4%), or null from zero. */
export function relativeChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return (to - from) / Math.abs(from);
}

export interface IndexedSeries<S> {
  /** Series that could be indexed, with points from the common start on. */
  series: Array<S & { points: TimePoint[]; baseValue: number }>;
  /** The first timestamp every indexed series has reached, or null. */
  start: number | null;
  /**
   * Series that could not be indexed: no points, nothing at or after the
   * common start, or a base that is zero or negative (dividing by it would
   * flip or explode the line). Callers say so rather than drop them silently.
   */
  skipped: S[];
}

/**
 * Rebases every series to `base` (100) at the first common point, so assets
 * with prices four orders of magnitude apart share one honest axis: "how did
 * each move since the start", never two y-scales. The common start is the
 * latest first sample across the series; each series is divided by its own
 * first sample at or after it, and earlier samples are dropped.
 */
export function rebaseToIndex<S extends { points: readonly TimePoint[] }>(
  series: readonly S[],
  base = 100,
): IndexedSeries<S> {
  const cleaned = series.map((s) => ({ s, points: cleanSeries(s.points) }));
  const starts = cleaned.filter((c) => c.points.length > 0).map((c) => c.points[0].t);
  if (starts.length === 0) return { series: [], start: null, skipped: [...series] };
  const start = Math.max(...starts);

  const out: IndexedSeries<S>["series"] = [];
  const skipped: S[] = [];
  for (const { s, points } of cleaned) {
    const ts = points.map((p) => p.t);
    const i = lowerBound(ts, start);
    const first = points[i];
    if (!first || !(first.v > 0)) {
      skipped.push(s);
      continue;
    }
    const baseValue = first.v;
    out.push({
      ...s,
      baseValue,
      points: points.slice(i).map((p) => ({ t: p.t, v: (p.v / baseValue) * base })),
    });
  }
  return { series: out, start, skipped };
}

export interface FoldedParts<T extends PartDatum> {
  /** Largest first, then "Other" last when anything was folded. */
  parts: PartDatum[];
  /** What went into "Other", largest first (for its tooltip). */
  folded: T[];
  /** Sum of every positive value, folded or not. */
  total: number;
}

/**
 * Keeps the `max` largest slices (five by default: spec §8) and folds the
 * rest into one "Other" slice, so a donut never asks the reader to tell
 * eleven hues apart. A single leftover is shown as itself (an "Other" of one
 * hides a name for no gain). Zero, negative and non-finite values cannot be
 * drawn as a share and are left out of the parts and the total.
 */
export function foldOther<T extends PartDatum>(
  items: readonly T[],
  max = 5,
  otherLabel = "Other",
): FoldedParts<T> {
  const positive = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.item.value - a.item.value || a.index - b.index)
    .map(({ item }) => item);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  const keep = Math.max(1, Math.floor(max));
  if (positive.length <= keep + 1) return { parts: positive, folded: [], total };

  const head = positive.slice(0, keep);
  const folded = positive.slice(keep);
  const other: PartDatum = {
    id: OTHER_ID,
    label: otherLabel,
    value: folded.reduce((sum, item) => sum + item.value, 0),
  };
  return { parts: [...head, other], folded, total };
}

/**
 * Moves the named parts that have no hue of their own into "Other", so a
 * part-to-whole chart never shows a named grey mark beside the grey "Other"
 * (or two named greys side by side). It happens when the page's colour map,
 * built from the full entity list, has no slot left for an entity that made
 * the cut. A single hue-less part with no "Other" to join stays itself: one
 * grey, named in the legend, is not ambiguous. Nor is everything merged away
 * when nothing has a hue (a map from the wrong ids): the parts stay as given.
 */
export function mergeHuelessParts<T extends PartDatum>(
  folded: FoldedParts<T>,
  hasHue: (part: PartDatum) => boolean,
  otherLabel = "Other",
): FoldedParts<T> {
  const other = folded.parts.find((p) => p.id === OTHER_ID);
  const named = folded.parts.filter((p) => p.id !== OTHER_ID) as T[];
  const keep = named.filter(hasHue);
  const hueless = named.filter((p) => !hasHue(p));
  if (hueless.length === 0 || keep.length === 0 || (hueless.length === 1 && !other)) return folded;
  const merged = [...folded.folded, ...hueless].sort((a, b) => b.value - a.value);
  return {
    parts: [
      ...keep,
      { id: OTHER_ID, label: other?.label ?? otherLabel, value: merged.reduce((sum, p) => sum + p.value, 0) },
    ],
    folded: merged,
    total: folded.total,
  };
}

/**
 * Everything a part-to-whole chart (donut, allocation bar) draws: the folded
 * parts and the colour of each. Slots come from `colors`, the page's map from
 * the full entity list, so an entity wears the same hue in every chart; or,
 * without one, from the parts themselves, largest first. "Other" is grey.
 */
export function colouredParts<T extends PartDatum>(
  data: readonly T[],
  maxSegments: number,
  otherLabel: string,
  colors?: ReadonlyMap<string, string>,
): FoldedParts<T> & { colorOf: (part: PartDatum) => string } {
  const folded = foldOther(data, maxSegments, otherLabel);
  const map = colors ?? stableColorMap(folded.parts.filter((p) => p.id !== OTHER_ID).map((p) => p.id));
  const colorOf = (part: PartDatum) => colorFor(part.id, part.color, map);
  const merged = mergeHuelessParts(folded, (part) => colorOf(part) !== VIZ_OTHER, otherLabel);
  return { ...merged, colorOf };
}
