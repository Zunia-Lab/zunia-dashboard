/**
 * Geometry shared by the cartesian charts: label sizing, axis gutters, label
 * placement, rounded bar paths and keyboard stepping. Pure, so the decisions
 * that keep labels from colliding are tested without a browser
 * (see __tests__/layout.test.ts).
 */

/** Tick and axis text size, px. */
export const TICK_FONT = 11;
/** Height of the x-axis band under the plot: label plus breathing room. */
export const X_AXIS_BAND = 26;
/** Room above the plot so the top end-dot and crosshair dot are never cut. */
export const PLOT_TOP_PAD = 8;
/** Gap between the plot and its y labels. */
export const Y_LABEL_GAP = 10;
/** End and active dots: r = 4 fill inside a 2px surface ring. */
export const DOT_RADIUS = 4;
export const DOT_RING = 2;
/**
 * Dashes of an estimated series (a figure derived rather than read). With the
 * 2px line's round caps a "3 5" pattern draws 5px dashes and 3px gaps.
 */
export const ESTIMATE_DASH = "3 5";

/** The same dash as a CSS background, for line keys in legends and tooltips. */
export function dashedKey(color: string): string {
  return `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`;
}

/**
 * Width of a label in the UI sans (Space Grotesk), without a DOM to measure
 * in. Digits are tabular (0.6em); the average glyph runs a little under that,
 * so this errs wide: a gutter one character too roomy is invisible, a
 * clipped label is not.
 */
export function estimateTextWidth(text: string, fontSize = TICK_FONT): number {
  let em = 0;
  for (const ch of text) {
    if (ch === " " || ch === "." || ch === "," || ch === ":") em += 0.32;
    else if (/[A-Z%$]/.test(ch)) em += 0.68;
    else em += 0.6;
  }
  return Math.ceil(em * fontSize);
}

export type TextAnchor = "start" | "middle" | "end";

export interface PlacedLabel<T> {
  item: T;
  x: number;
  anchor: TextAnchor;
}

/**
 * Places labels centred on their positions, pulls the first and last inside
 * [minX, maxX] by re-anchoring them, and drops any that would overlap the
 * one before. Measured, never clipped.
 */
export function placeLabels<T>(
  items: ReadonlyArray<{ item: T; x: number; label: string }>,
  minX: number,
  maxX: number,
  fontSize = TICK_FONT,
  gap = 12,
): PlacedLabel<T>[] {
  const out: PlacedLabel<T>[] = [];
  let lastRight = -Infinity;
  for (const { item, x, label } of items) {
    const w = estimateTextWidth(label, fontSize);
    let anchor: TextAnchor = "middle";
    let left = x - w / 2;
    if (left < minX) {
      anchor = "start";
      left = x;
    } else if (x + w / 2 > maxX) {
      anchor = "end";
      left = x - w;
    }
    if (left < minX || left + w > maxX) continue;
    if (left < lastRight + gap) continue;
    out.push({ item, x, anchor });
    lastRight = left + w;
  }
  return out;
}

/** How many x labels fit across a plot, between `min` and `max`. */
export function labelBudget(plotWidth: number, slot = 88, min = 2, max = 6): number {
  return Math.max(min, Math.min(max, Math.floor(plotWidth / slot)));
}

/**
 * Every k-th category label, anchored on the last one (the most recent bar is
 * the one people look for), with k chosen so the widest label fits its slot.
 * The gap is wider than `placeLabels`' own, so thinning alone keeps labels
 * apart and placement never has to drop one (which would leave an uneven
 * rhythm).
 */
export function thinningStep(count: number, step: number, widestLabel: number, gap = 18): number {
  if (count <= 1 || step <= 0) return 1;
  return Math.max(1, Math.ceil((widestLabel + gap) / step));
}

/**
 * The label shortened with an ellipsis until it fits `maxWidth`, or null when
 * fewer than three characters would survive (thin the labels instead: "Os…"
 * names nothing).
 */
export function fitLabel(text: string, maxWidth: number, fontSize = TICK_FONT): string | null {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  for (let n = text.length - 1; n >= 3; n--) {
    const candidate = `${text.slice(0, n).trimEnd()}\u2026`;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) return candidate;
  }
  return null;
}

/** Whether the polyline through (xs, ys) passes through the box [x1, x2] × [y1, y2]. */
export function lineCrossesBox(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  x1: number,
  x2: number,
  y1: number,
  y2: number,
): boolean {
  const n = Math.min(xs.length, ys.length);
  if (n === 1) return xs[0] >= x1 && xs[0] <= x2 && ys[0] >= y1 && ys[0] <= y2;
  for (let i = 0; i < n - 1; i++) {
    const ax = xs[i];
    const bx = xs[i + 1];
    if (bx < x1 || ax > x2) continue;
    // Clip the segment to the box's x-range, then compare y-ranges.
    const at = (x: number) => (bx === ax ? ys[i] : ys[i] + ((ys[i + 1] - ys[i]) * (x - ax)) / (bx - ax));
    const ya = at(Math.max(ax, x1));
    const yb = at(Math.min(bx, x2));
    if (Math.max(ya, yb) >= y1 && Math.min(ya, yb) <= y2) return true;
  }
  return false;
}

export interface LabelSpot {
  x: number;
  y: number;
  anchor: TextAnchor;
}

/**
 * Where the label of a horizontal reference line can sit without touching the
 * data: at either end of the line, above or below it, tried in order of
 * preference (the right end first, on the side the line is not). Null when
 * every spot is taken: the hairline then goes unlabelled rather than
 * overprinted.
 */
export function placeLineLabel(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  lineY: number,
  plot: { left: number; right: number; top: number; bottom: number },
  labelWidth: number,
  fontSize = TICK_FONT,
): LabelSpot | null {
  const inset = 12;
  const cap = Math.ceil(fontSize * 0.75);
  const spans = [
    { anchor: "end" as const, x1: plot.right - inset - labelWidth, x2: plot.right - inset },
    { anchor: "start" as const, x1: plot.left + inset, x2: plot.left + inset + labelWidth },
  ];
  for (const span of spans) {
    if (span.x1 < plot.left || span.x2 > plot.right) continue;
    // Prefer the side the data is not on, judged over the label's own span.
    let sum = 0;
    let count = 0;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] >= span.x1 && xs[i] <= span.x2) {
        sum += ys[i];
        count++;
      }
    }
    const dataAbove = count > 0 ? sum / count < lineY : true;
    const sides = dataAbove ? [false, true] : [true, false];
    for (const above of sides) {
      const baseline = above ? lineY - 6 : lineY + 6 + cap;
      const top = baseline - cap - 2;
      const bottom = baseline + 3;
      if (top < plot.top || bottom > plot.bottom) continue;
      if (lineCrossesBox(xs, ys, span.x1 - 3, span.x2 + 3, top, bottom)) continue;
      return { x: span.anchor === "end" ? span.x2 : span.x1, y: baseline, anchor: span.anchor };
    }
  }
  return null;
}

/**
 * A column with a 4px rounded data end and a square base. `yBase` is the
 * baseline (zero) side, `yEnd` the value side; columns growing down (negative
 * values) round their bottom instead. The radius shrinks for thin or short
 * bars so the corners never cross.
 */
export function columnPath(x: number, width: number, yBase: number, yEnd: number, radius = 4): string {
  const h = Math.abs(yBase - yEnd);
  const r = Math.max(0, Math.min(radius, width / 2, h));
  const x0 = round(x);
  const x1 = round(x + width);
  const b = round(yBase);
  const e = round(yEnd);
  if (r === 0) return `M${x0},${b}V${e}H${x1}V${b}Z`;
  const up = yEnd <= yBase;
  const inner = round(up ? yEnd + r : yEnd - r);
  const sweep = up ? 1 : 0;
  return (
    `M${x0},${b}V${inner}` +
    `A${round(r)},${round(r)} 0 0 ${sweep} ${round(x + r)},${e}` +
    `H${round(x + width - r)}` +
    `A${round(r)},${round(r)} 0 0 ${sweep} ${x1},${inner}` +
    `V${b}Z`
  );
}

/** Two decimals is sub-pixel at any zoom and keeps path strings short. */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A crisp 1px hairline: centred on a half pixel so it covers one device row. */
export function crisp(n: number): number {
  return Math.round(n) + 0.5;
}

/**
 * Where an arrow key moves a selection among `count` items. Returns the new
 * index, `null` to clear (Escape), or `undefined` when the key is not ours
 * (so the browser keeps Tab, scrolling and the rest).
 */
export function stepIndex(
  key: string,
  current: number | null,
  count: number,
  page = Math.max(1, Math.round(count / 10)),
): number | null | undefined {
  if (count <= 0) return undefined;
  const last = count - 1;
  switch (key) {
    case "ArrowLeft":
      return current === null ? last : Math.max(0, current - 1);
    case "ArrowRight":
      return current === null ? last : Math.min(last, current + 1);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageUp":
      return Math.max(0, (current ?? last) - page);
    case "PageDown":
      return Math.min(last, (current ?? last) + page);
    case "Escape":
      return current === null ? undefined : null;
    default:
      return undefined;
  }
}
