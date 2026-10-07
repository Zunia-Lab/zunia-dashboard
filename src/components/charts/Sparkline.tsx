"use client";

import { scaleLinear } from "d3-scale";
import { curveMonotoneX, line, area } from "d3-shape";
import { useMemo } from "react";
import { formatSignedPercent, formatValue } from "./format";
import { useSvgId } from "./internal";
import { round } from "./layout";
import { VIZ_ACCENT, VIZ_NEG, VIZ_NEUTRAL, VIZ_POS } from "./palette";
import { cleanSeries, relativeChange, valueExtent, type TimePoint } from "./series";
import { useChartSize } from "./useChartSize";

export interface SparklineProps {
  /** Time points, or bare values evenly spaced. */
  data: readonly TimePoint[] | readonly number[];
  /** Fixed width, px. Omit to fill the container (measured after mount). */
  width?: number;
  height?: number;
  /**
   * `trend` paints the line with the status pair (up = positive token, down =
   * negative, flat = neutral), for price-like rows where direction is the
   * message. `neutral` is a quiet grey for shape only; `accent` is the brand.
   */
  tone?: "trend" | "neutral" | "accent";
  /** Explicit colour; wins over `tone`. */
  color?: string;
  /** The fading wash under the line. */
  wash?: boolean;
  /** Marks the latest value. */
  dot?: boolean;
  /** What the line is, for the aria summary ("ATOM, 7 days"). */
  label?: string;
  ariaLabel?: string;
  valueFormatter?: (value: number) => string;
  strokeWidth?: number;
  className?: string;
}

/** Sized for a 28px row mark: r = 4 would cover a third of the height. */
const DOT_R = 3;
const DOT_RING = 1.5;
/** The kit's area wash (spec: about 10 to 14%), fading to nothing. */
const WASH_TOP = 0.14;

/**
 * A word-sized trend: no axes, no interaction, one line (2px) with an
 * optional wash and a dot on the latest value. It is labelled for screen
 * readers with its first and last values and the change between them, the
 * whole of what it says.
 */
export function Sparkline({
  data,
  width,
  height = 28,
  tone = "neutral",
  color,
  wash = false,
  dot = true,
  label,
  ariaLabel,
  valueFormatter = formatValue,
  strokeWidth = 2,
  className,
}: SparklineProps) {
  const [ref, size] = useChartSize<HTMLSpanElement>(width ?? 0, width === undefined);
  const w = width ?? size.width;
  const id = useSvgId("spark");

  const points = useMemo<readonly TimePoint[]>(() => {
    const raw = data as ReadonlyArray<TimePoint | number>;
    return cleanSeries(raw.map((d, i) => (typeof d === "number" ? { t: i, v: d } : d)));
  }, [data]);

  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? relativeChange(first.v, last.v) : null;
  // A flat range has no direction to colour: it stays neutral.
  const direction = first && last ? Math.sign(last.v - first.v) : 0;
  const stroke =
    color ??
    (tone === "trend"
      ? direction < 0
        ? VIZ_NEG
        : direction > 0
          ? VIZ_POS
          : VIZ_NEUTRAL
      : tone === "accent"
        ? VIZ_ACCENT
        : VIZ_NEUTRAL);

  const shape = useMemo(() => {
    if (points.length < 2 || w <= 0) return null;
    const pad = dot ? DOT_R + DOT_RING : strokeWidth;
    const [lo, hi] = valueExtent(points) ?? [0, 1];
    const x = scaleLinear()
      .domain([points[0].t, points[points.length - 1].t])
      .range([strokeWidth / 2, w - pad]);
    const y = scaleLinear()
      .domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi])
      .range([height - pad, pad]);
    const d =
      line<TimePoint>()
        .x((p) => x(p.t))
        .y((p) => y(p.v))
        .curve(curveMonotoneX)
        .digits(1)(points as TimePoint[]) ?? "";
    const fill =
      area<TimePoint>()
        .x((p) => x(p.t))
        .y0(height)
        .y1((p) => y(p.v))
        .curve(curveMonotoneX)
        .digits(1)(points as TimePoint[]) ?? "";
    const end = points[points.length - 1];
    return { d, fill, endX: x(end.t), endY: y(end.v) };
  }, [points, w, height, dot, strokeWidth]);

  const summary =
    ariaLabel ??
    (points.length > 1
      ? `${label ?? "Trend"}: from ${valueFormatter(first.v)} to ${valueFormatter(last.v)}` +
        (change === null ? "" : ` (${formatSignedPercent(change)})`)
      : `${label ?? "Trend"}: ${last ? `one sample, ${valueFormatter(last.v)}` : "no data"}`);

  return (
    <span
      ref={ref}
      className={className ? `viz-spark ${className}` : "viz-spark"}
      style={{ width: width ?? "100%", height }}
      role="img"
      aria-label={summary}
    >
      {shape ? (
        <svg width={w} height={height} aria-hidden="true" focusable="false">
          {wash ? (
            <>
              <defs>
                <linearGradient id={`${id}-wash`} x1={0} x2={0} y1={0} y2={1}>
                  <stop offset="0" style={{ stopColor: stroke, stopOpacity: WASH_TOP }} />
                  <stop offset="1" style={{ stopColor: stroke, stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <path d={shape.fill} fill={`url(#${id}-wash)`} />
            </>
          ) : null}
          <path
            d={shape.d}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ stroke }}
          />
          {dot ? (
            <circle
              cx={round(shape.endX)}
              cy={round(shape.endY)}
              r={DOT_R + DOT_RING / 2}
              strokeWidth={DOT_RING}
              style={{ fill: stroke, stroke: "var(--viz-surface)" }}
            />
          ) : null}
        </svg>
      ) : null}
    </span>
  );
}
