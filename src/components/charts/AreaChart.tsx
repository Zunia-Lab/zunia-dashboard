"use client";

import { area, curveMonotoneX, line } from "d3-shape";
import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { buildTimeFrame, type TickFormatter, type YDomain } from "./cartesian";
import { ChartTable } from "./ChartTable";
import { ChartTooltip } from "./ChartTooltip";
import { formatSignedPercent, formatValue } from "./format";
import {
  ChartEmpty,
  ChartSkeleton,
  isKeyboardFocus,
  LiveRegion,
  RingDot,
  useSvgId,
  XAxis,
  YAxis,
} from "./internal";
import { crisp, ESTIMATE_DASH, estimateTextWidth, placeLineLabel, round, stepIndex } from "./layout";
import { VIZ_ACCENT, VIZ_ACCENT_2 } from "./palette";
import { cleanSeries, relativeChange, valueExtent, type TimePoint } from "./series";
import { nearestIndex, pointDateFormatter, prefersUtc, typicalStep, type TimeZoneMode } from "./ticks";
import { useChartSize } from "./useChartSize";

export interface AreaChartProps {
  /**
   * One time series, epoch-ms timestamps. Unsorted, duplicate or non-finite
   * samples are cleaned; a single sample is drawn as a dot.
   */
  data: readonly TimePoint[];
  /** Total height in px, x-axis band included (the card never scrolls inside). */
  height?: number;
  /** What the series is ("Net worth"): the tooltip row and the aria summary use it. */
  label?: string;
  /** Replaces the generated aria summary. */
  ariaLabel?: string;
  /** Line colour. Defaults to the brand accent: one series is never slot 1. */
  color?: string;
  /** Stroke with the brand ramp (accent → accent-2) instead of a flat colour. The hero chart. */
  gradient?: boolean;
  /** The ~14% wash under the line, fading to nothing at the bottom. */
  wash?: boolean;
  /**
   * The series is derived, not read (today's holdings at past prices): the
   * line is dashed, the tooltip and summary say "est.". Explain what it is
   * in the card caption.
   */
  estimate?: boolean;
  /** A reference hairline, e.g. the value at the start of the range. */
  baseline?: number | null;
  baselineLabel?: string;
  /** No axes or gutters, for KPI cards. Crosshair and tooltip stay. */
  compact?: boolean;
  yAxis?: "right" | "left";
  yDomain?: YDomain;
  valueFormatter?: (value: number) => string;
  tickFormatter?: TickFormatter;
  /** Tooltip date line. Defaults to the data's resolution ("Oct 7, 2:00 PM" or "Oct 7, 2026"). */
  dateFormatter?: (t: number) => string;
  xTickFormatter?: (t: number) => string;
  /** Clock for ticks and dates. `auto`: UTC for daily samples cut at UTC midnight, else local. */
  timeZone?: TimeZoneMode;
  /** Refetch in flight: keep this frame, dimmed to 60%. */
  pending?: boolean;
  /** First load, nothing to show yet: skeleton. */
  loading?: boolean;
  /** Shown when there is no finite point. */
  empty?: ReactNode;
  /** The table twin, same footprint. */
  view?: "chart" | "table";
  /** Hovered or keyboard-selected point (the hero figure can follow it); null on leave. */
  onActiveChange?: (point: TimePoint | null) => void;
  className?: string;
}

type Active = { index: number; source: "pointer" | "keyboard" };

const WASH_TOP = 0.14;
const GRADIENT_KEY = "linear-gradient(90deg, var(--viz-accent), var(--viz-accent-2))";

/**
 * Single-series time chart: a 2px line over a fading wash, right-hand y axis
 * with three to five round ticks, calendar-aligned x labels, and a crosshair
 * that snaps to the nearest sample. Arrow keys walk the same crosshair.
 */
export function AreaChart({
  data,
  height = 240,
  label = "Value",
  ariaLabel,
  color,
  gradient = false,
  wash = true,
  estimate = false,
  baseline = null,
  baselineLabel,
  compact = false,
  yAxis = "right",
  yDomain = "auto",
  valueFormatter = formatValue,
  tickFormatter,
  dateFormatter,
  xTickFormatter,
  timeZone = "auto",
  pending = false,
  loading = false,
  empty,
  view = "chart",
  onActiveChange,
  className,
}: AreaChartProps) {
  const points = useMemo(() => cleanSeries(data), [data]);
  const [frameRef, { width }] = useChartSize<HTMLDivElement>();
  const id = useSvgId("area");
  const [active, setActive] = useState<Active | null>(null);

  const isEmpty = points.length === 0;
  const stroke = color ?? VIZ_ACCENT;
  const hasBaseline = baseline !== null && Number.isFinite(baseline);

  const ts = useMemo(() => points.map((p) => p.t), [points]);
  const utc = useMemo(() => prefersUtc(ts, timeZone), [ts, timeZone]);
  const formatDate = useMemo(
    () => dateFormatter ?? pointDateFormatter(typicalStep(ts), { utc }),
    [dateFormatter, ts, utc],
  );

  const geometry = useMemo(() => {
    if (isEmpty || width <= 0) return null;
    const extent = valueExtent(points) ?? [0, 1];
    const yMin = hasBaseline ? Math.min(extent[0], baseline as number) : extent[0];
    const yMax = hasBaseline ? Math.max(extent[1], baseline as number) : extent[1];
    const frame = buildTimeFrame({
      width,
      height,
      tStart: points[0].t,
      tEnd: points[points.length - 1].t,
      yMin,
      yMax,
      yDomain,
      yAxis,
      compact,
      tickFormatter,
      xTickFormatter,
      utc,
    });
    const { x, y, plot } = frame;
    const linePath =
      line<TimePoint>()
        .x((p) => x(p.t))
        .y((p) => y(p.v))
        .curve(curveMonotoneX)
        .digits(2)(points as TimePoint[]) ?? "";
    // The wash fills down to zero when zero is on the plot (a balance that
    // went negative, a P&L), so the shaded side reads as the sign; otherwise
    // to the plot floor, as a fade that only carries the shape.
    const [d0, d1] = y.domain();
    const washFloor = d0 <= 0 && d1 >= 0 ? y(0) : plot.bottom;
    const areaPath =
      area<TimePoint>()
        .x((p) => x(p.t))
        .y0(washFloor)
        .y1((p) => y(p.v))
        .curve(curveMonotoneX)
        .digits(2)(points as TimePoint[]) ?? "";
    // A start-value baseline begins on the line by definition, so its label
    // is placed where the data is not (or left off when the data is
    // everywhere): measured, never overprinted.
    const label =
      hasBaseline && baselineLabel && !compact
        ? placeLineLabel(
            points.map((p) => x(p.t)),
            points.map((p) => y(p.v)),
            y(baseline as number),
            frame.plot,
            estimateTextWidth(baselineLabel),
          )
        : null;
    return { ...frame, linePath, areaPath, label };
  }, [
    isEmpty,
    width,
    points,
    hasBaseline,
    baseline,
    height,
    yDomain,
    yAxis,
    compact,
    tickFormatter,
    xTickFormatter,
    baselineLabel,
    utc,
  ]);

  const activeIndex = active && active.index < points.length ? active.index : null;
  const activePoint = activeIndex === null ? null : points[activeIndex];

  const update = (next: Active | null) => {
    if (next?.index === active?.index && next?.source === active?.source) return;
    setActive(next);
    onActiveChange?.(next ? points[next.index] : null);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!geometry) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = nearestIndex(ts, geometry.x.invert(e.clientX - rect.left));
    if (i >= 0) update({ index: i, source: "pointer" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepIndex(e.key, activeIndex, points.length);
    if (next === undefined) return;
    e.preventDefault();
    update(next === null ? null : { index: next, source: "keyboard" });
  };

  const summary = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    const subject = estimate ? `${label} (estimate)` : label;
    // Dates only once measured: server and browser may sit in different time zones.
    if (isEmpty || width <= 0) return subject;
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length === 1) return `${subject} on ${formatDate(last.t)}: ${valueFormatter(last.v)}.`;
    const [min, max] = valueExtent(points) ?? [first.v, last.v];
    const change = relativeChange(first.v, last.v);
    return (
      `${subject}, ${formatDate(first.t)} to ${formatDate(last.t)}: ` +
      `${valueFormatter(last.v)}` +
      (change === null ? "" : `, ${formatSignedPercent(change)} over the range`) +
      `. High ${valueFormatter(max)}, low ${valueFormatter(min)}.`
    );
  }, [ariaLabel, estimate, isEmpty, width, label, points, formatDate, valueFormatter]);

  // A dashed key takes one colour: the ramp's start stands for the ramp.
  const keyColor = gradient ? (estimate ? VIZ_ACCENT : GRADIENT_KEY) : stroke;
  const rowLabel = estimate ? `${label} (est.)` : label;
  const pointColor = (t: number) => {
    if (!gradient || !geometry) return stroke;
    const { plot } = geometry;
    const f = (geometry.x(t) - plot.left) / Math.max(1, plot.right - plot.left);
    const pct = Math.round(Math.min(1, Math.max(0, f)) * 100);
    return `color-mix(in srgb, ${VIZ_ACCENT_2} ${pct}%, ${VIZ_ACCENT})`;
  };

  let body: ReactNode = null;
  if (loading) {
    body = <ChartSkeleton kind="line" height={height} />;
  } else if (isEmpty) {
    body = <ChartEmpty>{empty}</ChartEmpty>;
  } else if (view === "table") {
    body = (
      <ChartTable
        className="viz-dim"
        caption={label}
        height={height}
        columns={[
          { key: "date", label: "Date" },
          { key: "value", label: rowLabel, align: "right" },
        ]}
        rows={points
          .map((p) => ({
            key: p.t,
            cells: { date: formatDate(p.t), value: valueFormatter(p.v) },
          }))
          .reverse()}
      />
    );
  } else if (geometry) {
    const { x, y, plot } = geometry;
    const last = points[points.length - 1];
    const strokePaint = gradient ? `url(#${id}-stroke)` : stroke;
    const baseY = hasBaseline ? y(baseline as number) : null;
    body = (
      <>
        <div
          className="viz-plot viz-dim"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={() => {
            if (active?.source === "pointer") update(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            if (!active && isKeyboardFocus(e.currentTarget)) {
              update({ index: points.length - 1, source: "keyboard" });
            }
          }}
          onBlur={() => update(null)}
        >
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            <defs>
              <linearGradient
                id={`${id}-stroke`}
                gradientUnits="userSpaceOnUse"
                x1={plot.left}
                x2={plot.right}
                y1={0}
                y2={0}
              >
                <stop offset="0" style={{ stopColor: VIZ_ACCENT }} />
                <stop offset="1" style={{ stopColor: VIZ_ACCENT_2 }} />
              </linearGradient>
              <linearGradient
                id={`${id}-fade`}
                gradientUnits="userSpaceOnUse"
                x1={0}
                x2={0}
                y1={plot.top}
                y2={plot.bottom}
              >
                <stop offset="0" stopColor="#fff" stopOpacity={1} />
                <stop offset="1" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
                <rect x={0} y={0} width={width} height={height} fill={`url(#${id}-fade)`} />
              </mask>
            </defs>

            {compact ? null : (
              <YAxis
                ticks={geometry.yTicks}
                left={plot.left}
                right={plot.right}
                side={yAxis}
                labelX={geometry.yLabelX}
              />
            )}

            {baseY !== null ? (
              <g>
                <line
                  x1={round(plot.left)}
                  x2={round(plot.right)}
                  y1={crisp(baseY)}
                  y2={crisp(baseY)}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                  style={{ stroke: "var(--viz-axis)" }}
                />
                {geometry.label ? (
                  <text
                    className="viz-tick"
                    x={round(geometry.label.x)}
                    y={round(geometry.label.y)}
                    textAnchor={geometry.label.anchor}
                  >
                    {baselineLabel}
                  </text>
                ) : null}
              </g>
            ) : null}

            {wash ? (
              <path
                d={geometry.areaPath}
                mask={`url(#${id}-mask)`}
                style={{ fill: strokePaint, fillOpacity: WASH_TOP }}
              />
            ) : null}
            <path
              d={geometry.linePath}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={estimate ? ESTIMATE_DASH : undefined}
              style={{ stroke: strokePaint }}
            />

            {activePoint ? (
              <line
                x1={crisp(x(activePoint.t))}
                x2={crisp(x(activePoint.t))}
                y1={round(plot.top)}
                y2={round(plot.bottom)}
                strokeWidth={1}
                shapeRendering="crispEdges"
                style={{ stroke: "var(--viz-axis)" }}
              />
            ) : null}

            <RingDot cx={x(last.t)} cy={y(last.v)} color={gradient ? VIZ_ACCENT_2 : stroke} />
            {activePoint && activeIndex !== points.length - 1 ? (
              <RingDot cx={x(activePoint.t)} cy={y(activePoint.v)} color={pointColor(activePoint.t)} />
            ) : null}

            {compact ? null : <XAxis labels={geometry.xLabels} y={geometry.xLabelY} />}
          </svg>
        </div>
        <ChartTooltip
          anchor={activePoint ? { x: x(activePoint.t), y: y(activePoint.v) } : null}
          // A compact trend is shorter than its tooltip: let it rise over the
          // card's own header rather than cover the hovered point.
          bounds={{ width, height, minTop: compact ? -height - 48 : undefined }}
          title={activePoint ? formatDate(activePoint.t) : null}
          rows={
            activePoint
              ? [{ id: "v", value: valueFormatter(activePoint.v), label: rowLabel, color: keyColor, dashed: estimate }]
              : undefined
          }
        />
        <LiveRegion
          text={
            activePoint && active?.source === "keyboard"
              ? `${formatDate(activePoint.t)}: ${valueFormatter(activePoint.v)}`
              : ""
          }
        />
      </>
    );
  }

  return (
    <div
      ref={frameRef}
      className={className ? `viz-frame ${className}` : "viz-frame"}
      style={{ height }}
      data-pending={pending || undefined}
      aria-busy={pending || loading || undefined}
    >
      {body}
    </div>
  );
}
