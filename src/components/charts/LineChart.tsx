"use client";

import { curveMonotoneX, line } from "d3-shape";
import { useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { buildTimeFrame, type TickFormatter, type YDomain } from "./cartesian";
import { ChartTable } from "./ChartTable";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import { formatValue } from "./format";
import {
  ChartEmpty,
  ChartSkeleton,
  isKeyboardFocus,
  LiveRegion,
  RingDot,
  XAxis,
  YAxis,
} from "./internal";
import { Legend, type LegendItem } from "./Legend";
import { crisp, ESTIMATE_DASH, estimateTextWidth, round, stepIndex } from "./layout";
import { colorFor, stableColorMap, VIZ_ACCENT } from "./palette";
import { cleanSeries, rebaseToIndex, type TimePoint } from "./series";
import { nearestIndex, pointDateFormatter, prefersUtc, typicalStep, type TimeZoneMode } from "./ticks";
import { useChartSize } from "./useChartSize";

export interface LineSeries {
  /** Stable entity id: it picks the colour, so it must not change when the view is filtered. */
  id: string;
  label: string;
  /** Overrides the stable map for this series. */
  color?: string;
  /** Derived, not read: the line, its legend key and tooltip key are dashed, and its label says "est.". */
  estimate?: boolean;
  points: readonly TimePoint[];
}

export interface LineChartProps {
  series: readonly LineSeries[];
  /**
   * Colour map built from the full, unfiltered entity list (`stableColorMap`).
   * Without it, slots follow the order of `series`, and a lone series wears
   * the brand accent.
   */
  colors?: ReadonlyMap<string, string>;
  /**
   * Rebase every series to 100 at the first common point and label the axis
   * "Indexed (start = 100)". The way to compare prices four orders of
   * magnitude apart on one axis; never add a second y-axis instead.
   */
  indexed?: boolean;
  /** Plot + x-axis band, px. The legend sits above and adds to it. */
  height?: number;
  /** Names the chart in the aria summary ("ATOM, OSMO and TIA price"). */
  title?: string;
  ariaLabel?: string;
  yAxis?: "left" | "right";
  yDomain?: YDomain;
  /** Two or more series always get a legend unless the card renders its own. */
  legend?: "auto" | "none";
  /** Series name and last value at the line ends, when four or fewer lines end apart. */
  endLabels?: "auto" | "none";
  valueFormatter?: (value: number) => string;
  tickFormatter?: TickFormatter;
  dateFormatter?: (t: number) => string;
  xTickFormatter?: (t: number) => string;
  /** Clock for ticks and dates. `auto`: UTC for daily samples cut at UTC midnight, else local. */
  timeZone?: TimeZoneMode;
  pending?: boolean;
  loading?: boolean;
  /** Shown when no series has a finite point. */
  empty?: ReactNode;
  view?: "chart" | "table";
  /** Timestamp under the crosshair, or null. */
  onActiveChange?: (t: number | null) => void;
  className?: string;
}

type Active = { index: number; source: "pointer" | "keyboard" };

interface Plotted {
  id: string;
  label: string;
  color: string;
  estimate: boolean;
  points: readonly TimePoint[];
  ts: number[];
  tolerance: number;
}

const END_FONT = 11.5;
const END_GAP = 10;
const END_MIN_SPACING = 15;
const INDEX_BASE = 100;
const CAPTION_BAND = 16;

/** The sample of `s` at `t`, if it has one close enough to count. */
function valueAt(s: Plotted, t: number): TimePoint | null {
  const j = nearestIndex(s.ts, t);
  if (j < 0) return null;
  const p = s.points[j];
  return Math.abs(p.t - t) <= s.tolerance ? p : null;
}

/**
 * Multi-series time chart. Every series shares one y-axis: different units
 * are compared through `indexed`, never a second scale. Legend above for two
 * or more series, end labels when the lines end far enough apart to carry
 * them, one tooltip listing every series at the crosshair, largest first.
 */
export function LineChart({
  series,
  colors,
  indexed = false,
  height = 260,
  title,
  ariaLabel,
  yAxis = "left",
  yDomain = "auto",
  legend = "auto",
  endLabels = "auto",
  valueFormatter,
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
}: LineChartProps) {
  const [frameRef, { width }] = useChartSize<HTMLDivElement>();
  const [active, setActive] = useState<Active | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const colorMap = useMemo(() => colors ?? stableColorMap(series.map((s) => s.id)), [colors, series]);
  // One series is a single-series chart: the brand, not slot 1 (spec §4).
  // With a caller's map the entity keeps its own colour, as everywhere else.
  const colorOf = useCallback(
    (s: LineSeries) => s.color ?? (!colors && series.length === 1 ? VIZ_ACCENT : colorFor(s.id, undefined, colorMap)),
    [colors, series.length, colorMap],
  );
  const fmt = useMemo(
    () => valueFormatter ?? (indexed ? (v: number) => v.toFixed(1) : formatValue),
    [valueFormatter, indexed],
  );

  const { plotted, skipped } = useMemo(() => {
    const cleaned = series.map((s) => ({ ...s, points: cleanSeries(s.points) }));
    const source = indexed ? rebaseToIndex(cleaned) : null;
    const usable = source ? source.series : cleaned.filter((s) => s.points.length > 0);
    const plotted: Plotted[] = usable.map((s) => {
      const ts = s.points.map((p) => p.t);
      return {
        id: s.id,
        label: s.estimate ? `${s.label} (est.)` : s.label,
        color: colorOf(s),
        estimate: s.estimate === true,
        points: s.points,
        ts,
        tolerance: Math.max(1, typicalStep(ts) * 0.75),
      };
    });
    const skipped = source ? source.skipped.map((s) => s.id) : cleaned.filter((s) => s.points.length === 0).map((s) => s.id);
    return { plotted, skipped };
  }, [series, indexed, colorOf]);

  const allTs = useMemo(() => {
    const set = new Set<number>();
    for (const s of plotted) for (const t of s.ts) set.add(t);
    return [...set].sort((a, b) => a - b);
  }, [plotted]);

  const isEmpty = allTs.length === 0;
  const utc = useMemo(() => prefersUtc(allTs, timeZone), [allTs, timeZone]);
  const formatDate = useMemo(
    () => dateFormatter ?? pointDateFormatter(typicalStep(allTs), { utc }),
    [dateFormatter, allTs, utc],
  );

  const geometry = useMemo(() => {
    if (isEmpty || width <= 0) return null;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of plotted) {
      for (const p of s.points) {
        if (p.v < yMin) yMin = p.v;
        if (p.v > yMax) yMax = p.v;
      }
    }
    if (indexed) {
      yMin = Math.min(yMin, INDEX_BASE);
      yMax = Math.max(yMax, INDEX_BASE);
    }
    const base = {
      width,
      height,
      tStart: allTs[0],
      tEnd: allTs[allTs.length - 1],
      yMin,
      yMax,
      yDomain,
      yAxis,
      topBand: indexed ? CAPTION_BAND : 0,
      tickFormatter,
      xTickFormatter,
      utc,
    } as const;

    // End labels need their own room right of the plot; try with it, and
    // fall back to legend-only when the lines end too close together.
    const ends = plotted.map((s) => {
      const last = s.points[s.points.length - 1];
      const value = fmt(last.v);
      return {
        id: s.id,
        name: s.label,
        value,
        last,
        width: estimateTextWidth(s.label, END_FONT) + 6 + estimateTextWidth(value, END_FONT),
      };
    });
    const wantEnds = endLabels === "auto" && plotted.length <= 4 && plotted.length > 0 && width >= 360;
    let frame = buildTimeFrame({
      ...base,
      yAxis: wantEnds && yAxis === "right" ? "left" : yAxis,
      rightReserve: wantEnds ? Math.max(...ends.map((e) => e.width)) + END_GAP + 4 : 0,
    });
    let labels: Array<(typeof ends)[number] & { y: number }> = [];
    if (wantEnds) {
      const { top, bottom } = frame.plot;
      labels = ends
        .map((e) => ({ ...e, y: Math.min(bottom - 4, Math.max(top + 4, frame.y(e.last.v))) }))
        .sort((a, b) => a.y - b.y);
      const clash = labels.some((l, i) => i > 0 && l.y - labels[i - 1].y < END_MIN_SPACING);
      const plotRoom = frame.plot.right - frame.plot.left;
      if (clash || plotRoom < 160) {
        labels = [];
        frame = buildTimeFrame(base);
      }
    }

    const lineGen = line<TimePoint>()
      .x((p) => frame.x(p.t))
      .y((p) => frame.y(p.v))
      .curve(curveMonotoneX)
      .digits(2);
    const paths = plotted.map((s) => ({ s, d: lineGen(s.points as TimePoint[]) ?? "" }));
    return { ...frame, paths, labels };
  }, [isEmpty, width, plotted, indexed, height, allTs, yDomain, yAxis, tickFormatter, xTickFormatter, fmt, endLabels, utc]);

  const activeIndex = active && active.index < allTs.length ? active.index : null;
  const activeT = activeIndex === null ? null : allTs[activeIndex];

  const update = (next: Active | null) => {
    if (next?.index === active?.index && next?.source === active?.source) return;
    setActive(next);
    onActiveChange?.(next ? allTs[next.index] : null);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!geometry) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = nearestIndex(allTs, geometry.x.invert(e.clientX - rect.left));
    if (i >= 0) update({ index: i, source: "pointer" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = stepIndex(e.key, activeIndex, allTs.length);
    if (next === undefined) return;
    e.preventDefault();
    update(next === null ? null : { index: next, source: "keyboard" });
  };

  const readout = useMemo(() => {
    if (activeT === null) return [];
    // Largest first; series with no sample here go last, in their own order.
    return plotted
      .map((s) => ({ s, p: valueAt(s, activeT) }))
      .sort((a, b) => (a.p && b.p ? b.p.v - a.p.v : a.p ? -1 : b.p ? 1 : 0));
  }, [activeT, plotted]);

  const summary = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    const subject = title ?? (indexed ? "Indexed performance" : "Line chart");
    if (isEmpty || width <= 0) return subject;
    const ends = plotted
      .map((s) => ({ s, last: s.points[s.points.length - 1] }))
      .sort((a, b) => b.last.v - a.last.v)
      .map(({ s, last }) => `${s.label} ${fmt(last.v)}`)
      .join(", ");
    const span =
      allTs.length === 1
        ? ` on ${formatDate(allTs[0])}`
        : `, ${formatDate(allTs[0])} to ${formatDate(allTs[allTs.length - 1])}`;
    return `${subject}${span}${indexed ? ", indexed to 100 at the start" : ""}. Latest: ${ends}.`;
  }, [ariaLabel, title, indexed, isEmpty, width, plotted, fmt, formatDate, allTs]);

  const legendItems: LegendItem[] = series.map((s) => ({
    id: s.id,
    label: skipped.includes(s.id) ? `${s.label} (no data)` : s.estimate ? `${s.label} (est.)` : s.label,
    color: colorOf(s),
    kind: "line",
    dashed: s.estimate === true,
  }));
  // The series are known before their data: the legend shows through the
  // first load, so the card does not grow when the data lands. An empty
  // chart has nothing to key.
  const showLegend = legend === "auto" && series.length >= 2 && (loading || !isEmpty);

  let body: ReactNode = null;
  if (loading) {
    body = <ChartSkeleton kind="line" height={height} />;
  } else if (isEmpty) {
    body = <ChartEmpty>{empty}</ChartEmpty>;
  } else if (view === "table") {
    body = (
      <ChartTable
        className="viz-dim"
        caption={summary}
        height={height}
        columns={[
          { key: "date", label: "Date" },
          ...plotted.map((s) => ({ key: s.id, label: s.label, align: "right" as const })),
        ]}
        rows={allTs
          .map((t) => {
            const cells: Record<string, string> = { date: formatDate(t) };
            for (const s of plotted) {
              const p = valueAt(s, t);
              cells[s.id] = p && p.t === t ? fmt(p.v) : "—";
            }
            return { key: t, cells };
          })
          .reverse()}
      />
    );
  } else if (geometry) {
    const { x, y, plot } = geometry;
    const rows: TooltipRow[] = readout.map(({ s, p }) => ({
      id: s.id,
      value: p ? fmt(p.v) : "—",
      label: s.label,
      color: s.color,
      dashed: s.estimate,
    }));
    const topPoint = readout.find((r) => r.p)?.p ?? null;
    const baseY = indexed ? y(INDEX_BASE) : null;
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
              update({ index: allTs.length - 1, source: "keyboard" });
            }
          }}
          onBlur={() => update(null)}
        >
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            <YAxis
              ticks={geometry.yTicks}
              left={plot.left}
              right={plot.right}
              side={geometry.labels.length > 0 && yAxis === "right" ? "left" : yAxis}
              labelX={geometry.yLabelX}
            />
            {indexed ? (
              <text className="viz-axis-caption" x={0} y={11}>
                Indexed (start = 100)
              </text>
            ) : null}
            {baseY !== null ? (
              <line
                x1={round(plot.left)}
                x2={round(plot.right)}
                y1={crisp(baseY)}
                y2={crisp(baseY)}
                strokeWidth={1}
                shapeRendering="crispEdges"
                style={{ stroke: "var(--viz-axis)" }}
              />
            ) : null}

            {geometry.paths.map(({ s, d }) => {
              const last = s.points[s.points.length - 1];
              return (
                <g key={s.id} className="viz-series" data-muted={focusId && focusId !== s.id ? true : undefined}>
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={s.estimate ? ESTIMATE_DASH : undefined}
                    style={{ stroke: s.color }}
                  />
                  {/* End dots ride with end labels; a lone sample is only visible as one. */}
                  {geometry.labels.length > 0 || s.points.length === 1 ? (
                    <RingDot cx={x(last.t)} cy={y(last.v)} color={s.color} />
                  ) : null}
                </g>
              );
            })}

            {geometry.labels.map((l) => (
              <text
                key={l.id}
                className="viz-end-label viz-series"
                x={round(plot.right + END_GAP)}
                y={round(l.y)}
                dy="0.34em"
                data-muted={focusId && focusId !== l.id ? true : undefined}
              >
                <tspan className="viz-end-label__name">{l.name}</tspan>
                <tspan className="viz-end-label__value" dx={6}>
                  {l.value}
                </tspan>
              </text>
            ))}

            {activeT !== null ? (
              <g>
                <line
                  x1={crisp(x(activeT))}
                  x2={crisp(x(activeT))}
                  y1={round(plot.top)}
                  y2={round(plot.bottom)}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                  style={{ stroke: "var(--viz-axis)" }}
                />
                {readout.map(({ s, p }) =>
                  p ? <RingDot key={s.id} cx={x(p.t)} cy={y(p.v)} color={s.color} /> : null,
                )}
              </g>
            ) : null}

            <XAxis labels={geometry.xLabels} y={geometry.xLabelY} />
          </svg>
        </div>
        <ChartTooltip
          anchor={activeT !== null ? { x: x(activeT), y: topPoint ? y(topPoint.v) : plot.top } : null}
          bounds={{ width, height }}
          title={activeT !== null ? formatDate(activeT) : null}
          rows={rows}
        />
        <LiveRegion
          text={
            activeT !== null && active?.source === "keyboard"
              ? `${formatDate(activeT)}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`
              : ""
          }
        />
      </>
    );
  }

  return (
    <div className={className ? `viz-chart ${className}` : "viz-chart"} data-pending={pending || undefined}>
      {showLegend ? (
        <Legend items={legendItems} activeId={focusId} onActiveChange={setFocusId} />
      ) : null}
      <div
        ref={frameRef}
        className="viz-frame"
        style={{ height }}
        aria-busy={pending || loading || undefined}
      >
        {body}
      </div>
    </div>
  );
}
