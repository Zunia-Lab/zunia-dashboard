/**
 * The frame shared by the time-series charts (AreaChart, LineChart): plot box,
 * scales, y ticks with their gutter, and placed x labels. Computed in one pure
 * pass from the container size so every chart lays out the same way and no
 * label is ever positioned by guesswork in JSX.
 */

import { scaleLinear, type ScaleLinear } from "d3-scale";
import { affixUnit, makeTickFormat } from "./format";
import type { XLabel, YTick } from "./internal";
import {
  DOT_RADIUS,
  DOT_RING,
  estimateTextWidth,
  labelBudget,
  placeLabels,
  PLOT_TOP_PAD,
  X_AXIS_BAND,
  Y_LABEL_GAP,
} from "./layout";
import { niceTicks, timeTickFormatter, timeTicks, type LinearTicks } from "./ticks";

export interface TickContext {
  /** Distance between ticks. */
  step: number;
  ticks: readonly number[];
  /** The kit's own label for this tick (unit and decimals already chosen for the axis). */
  format: (value: number) => string;
  /** The kit's label with a unit around the digits, outside the sign: `affix(-50, "$")` is "−$50". */
  affix: (value: number, prefix: string, suffix?: string) => string;
}

/**
 * Formats a y tick. Ignore the context for a fixed format, or build on the
 * kit's, which keeps the axis-wide unit and decimals:
 * `(v, { affix }) => affix(v, "$")` or `(v, { affix }) => affix(v, "", "%")`.
 */
export type TickFormatter = (value: number, context: TickContext) => string;

/** The context a `TickFormatter` receives for one axis. */
export function tickContext(ticks: readonly number[], step: number): TickContext {
  const format = makeTickFormat(ticks, step);
  return { step, ticks, format, affix: (value, prefix, suffix) => affixUnit(format(value), prefix, suffix) };
}

export type YDomain = "auto" | "zero" | readonly [number, number];

export interface TimeFrameInput {
  width: number;
  height: number;
  tStart: number;
  tEnd: number;
  /** Extent of everything that must be visible: data, baselines, reference values. */
  yMin: number;
  yMax: number;
  yDomain?: YDomain;
  yAxis: "left" | "right" | "none";
  /** No axes, no gutters: a card-sized trend. */
  compact?: boolean;
  /** Extra room above the plot (an axis caption). */
  topBand?: number;
  /** Room to keep free right of the plot (end labels). */
  rightReserve?: number;
  tickFormatter?: TickFormatter;
  xTickFormatter?: (t: number) => string;
  /** Tick on UTC boundaries and label in UTC (see `prefersUtc`). */
  utc?: boolean;
}

export interface TimeFrame {
  x: ScaleLinear<number, number>;
  y: ScaleLinear<number, number>;
  plot: { left: number; right: number; top: number; bottom: number };
  yTicks: YTick[];
  /** Where y labels anchor: the container's right edge or its left edge. */
  yLabelX: number;
  xLabels: XLabel[];
  /** Baseline of the x labels. */
  xLabelY: number;
}

const DOT_ROOM = DOT_RADIUS + DOT_RING;

function yTicksFor(lo: number, hi: number, yDomain: YDomain = "auto"): LinearTicks {
  if (typeof yDomain === "object") {
    const t = niceTicks(yDomain[0], yDomain[1]);
    return { ...t, domain: [yDomain[0], yDomain[1]] };
  }
  if (yDomain === "zero") {
    return niceTicks(Math.min(0, lo), Math.max(0, hi), { nice: true });
  }
  // Pad the data range so the line never grazes the plot edge, but never
  // invent negative room under data that cannot go below zero.
  const span = hi - lo;
  const pad = span > 0 ? span * 0.1 : Math.abs(hi) * 0.05 || 1;
  const a = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  return niceTicks(a, hi + pad);
}

export function buildTimeFrame(input: TimeFrameInput): TimeFrame {
  const { width, height, compact = false } = input;
  const { domain, ticks, step } = yTicksFor(input.yMin, input.yMax, input.yDomain);
  const context = tickContext(ticks, step);
  const labels = ticks.map((v) => (input.tickFormatter ? input.tickFormatter(v, context) : context.format(v)));

  const showY = !compact && input.yAxis !== "none";
  const gutter = showY ? Math.max(0, ...labels.map((l) => estimateTextWidth(l))) + Y_LABEL_GAP : 0;
  const reserve = Math.max(DOT_ROOM, input.rightReserve ?? 0);

  let left: number;
  let right: number;
  if (compact) {
    left = 0;
    right = width - DOT_ROOM;
  } else if (input.yAxis === "right") {
    left = 0;
    right = width - gutter;
  } else if (input.yAxis === "left") {
    left = gutter;
    right = width - reserve;
  } else {
    left = 0;
    right = width - reserve;
  }
  right = Math.max(left + 1, right);
  const top = compact ? DOT_ROOM : PLOT_TOP_PAD + (input.topBand ?? 0);
  const bottom = Math.max(top + 1, compact ? height - DOT_ROOM : height - X_AXIS_BAND);

  const x = scaleLinear().domain([input.tStart, input.tEnd]).range([left, right]);
  const y = scaleLinear().domain(domain).range([bottom, top]);

  const yTicks: YTick[] = ticks.map((value, i) => ({ value, y: y(value), label: labels[i] }));

  // A single sample has no time span: d3 puts it mid-plot, and the axis
  // names its day under it.
  let xLabels: XLabel[] = [];
  if (!compact) {
    const time = { utc: input.utc };
    const tt = timeTicks(input.tStart, input.tEnd, labelBudget(right - left), time);
    const fmt = input.xTickFormatter ?? timeTickFormatter(tt.unit, time);
    xLabels = placeLabels(
      tt.ticks.map((t) => ({ item: { t, label: fmt(t) }, x: x(t), label: fmt(t) })),
      0,
      width,
    ).map((p) => ({ key: p.item.t, x: p.x, label: p.item.label, anchor: p.anchor }));
  }

  return {
    x,
    y,
    plot: { left, right, top, bottom },
    yTicks,
    yLabelX: input.yAxis === "right" ? width : 0,
    xLabels,
    xLabelY: bottom + 18,
  };
}
