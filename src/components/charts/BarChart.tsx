"use client";

import { scaleLinear } from "d3-scale";
import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { tickContext, type TickFormatter } from "./cartesian";
import { ChartTable } from "./ChartTable";
import { ChartTooltip, type TooltipRow } from "./ChartTooltip";
import { formatValue } from "./format";
import {
  ChartEmpty,
  ChartSkeleton,
  isKeyboardFocus,
  LiveRegion,
  XAxis,
  YAxis,
  type XLabel,
} from "./internal";
import { Legend, type LegendItem } from "./Legend";
import {
  columnPath,
  crisp,
  estimateTextWidth,
  fitLabel,
  placeLabels,
  PLOT_TOP_PAD,
  round,
  stepIndex,
  thinningStep,
  X_AXIS_BAND,
  Y_LABEL_GAP,
} from "./layout";
import { colorFor, stableColorMap, VIZ_ACCENT } from "./palette";
import {
  DAY_MS,
  niceTicks,
  pointDateFormatter,
  prefersUtc,
  timeTickFormatter,
  typicalStep,
  type TimeZoneMode,
} from "./ticks";
import { useChartSize } from "./useChartSize";

export interface BarSeries {
  /** Stable entity id: it picks the colour, so it must not change when the view is filtered. */
  id: string;
  label: string;
  color?: string;
}

export interface BarDatum {
  /**
   * Epoch ms for time buckets, or a category key. Buckets are drawn as
   * evenly spaced slots in the order given: pass every bucket of the range,
   * empty ones as zeros, or a gap in time will not show.
   */
  x: number | string;
  /** Display name for a category (defaults to the key); time buckets format their date. */
  label?: string;
  /** Value per series id. Missing ids count as zero. */
  values: Readonly<Record<string, number>>;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  series: readonly BarSeries[];
  /** Stacked (part of a total per bar) or grouped (side by side). */
  layout?: "stacked" | "grouped";
  /** Defaults to "time" when the first x is a number. */
  xType?: "time" | "category";
  /**
   * Colour map from the full entity list (`stableColorMap`). Without it,
   * slots follow the order of `series`, and a lone series wears the accent.
   */
  colors?: ReadonlyMap<string, string>;
  /** Plot + x-axis band, px. The legend sits above and adds to it. */
  height?: number;
  title?: string;
  ariaLabel?: string;
  yAxis?: "left" | "right";
  legend?: "auto" | "none";
  valueFormatter?: (value: number) => string;
  tickFormatter?: TickFormatter;
  /** X tick label. Defaults to "Oct 7" for time buckets and the label for categories. */
  xFormatter?: (x: number | string) => string;
  /** Tooltip title for time buckets. */
  dateFormatter?: (t: number) => string;
  /**
   * Clock the buckets were cut on. Daily buckets from an API are usually UTC
   * midnights, which the viewer's local clock would label as the day before
   * west of Greenwich; `auto` (default) spots them and labels them in UTC.
   */
  timeZone?: TimeZoneMode;
  pending?: boolean;
  loading?: boolean;
  empty?: ReactNode;
  view?: "chart" | "table";
  className?: string;
}

/** `seriesId` is null on an empty bucket: hovering it still reads out "Total 0". */
type Active = { index: number; seriesId: string | null; source: "pointer" | "keyboard" };

interface Segment {
  seriesId: string;
  value: number;
  /** Value-space extent. */
  v0: number;
  v1: number;
  /** Pixel geometry. */
  x: number;
  width: number;
  top: number;
  bottom: number;
  path: string | null;
}

interface Column {
  index: number;
  center: number;
  total: number;
  segments: Segment[];
}

const MAX_BAR = 24;
const GAP = 2;
const VALUE_BAND = 14;

/**
 * Vertical bars over time buckets or categories, stacked or grouped. Bars are
 * at most 24px wide whatever the slot (the rest is air), grow from one
 * baseline with a 4px rounded data end, and touching fills are separated by a
 * 2px surface gap. The mark is the hit target: hovering or arrowing onto a
 * segment shows its value on the bar and every series of that bar in the
 * tooltip.
 */
export function BarChart({
  data,
  series,
  layout = "stacked",
  xType,
  colors,
  height = 240,
  title,
  ariaLabel,
  yAxis = "left",
  legend = "auto",
  valueFormatter = formatValue,
  tickFormatter,
  xFormatter,
  dateFormatter,
  timeZone = "auto",
  pending = false,
  loading = false,
  empty,
  view = "chart",
  className,
}: BarChartProps) {
  const [frameRef, { width }] = useChartSize<HTMLDivElement>();
  const [active, setActive] = useState<Active | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const isTime = (xType ?? (typeof data[0]?.x === "number" ? "time" : "category")) === "time";
  // One lookup per series, not per segment: a year of daily stacks is
  // thousands of marks. A lone series is a single-series chart: the brand,
  // not slot 1 (spec §4).
  const seriesColors = useMemo(() => {
    const map = colors ?? stableColorMap(series.map((s) => s.id));
    const single = !colors && series.length === 1;
    return new Map(
      series.map((s) => [s.id, s.color ?? (single ? VIZ_ACCENT : colorFor(s.id, undefined, map))] as const),
    );
  }, [colors, series]);
  const colorOf = (id: string) => seriesColors.get(id) ?? colorFor(id, undefined, colors);

  const bucketTs = useMemo(() => (isTime ? data.map((d) => Number(d.x)) : []), [isTime, data]);
  const utc = useMemo(() => isTime && prefersUtc(bucketTs, timeZone), [isTime, bucketTs, timeZone]);
  const bucketMs = useMemo(() => typicalStep(bucketTs), [bucketTs]);
  const formatDate = useMemo(() => {
    if (dateFormatter) return dateFormatter;
    if (!isTime) return null;
    return pointDateFormatter(bucketMs, { utc });
  }, [dateFormatter, isTime, bucketMs, utc]);

  const nameOf = (d: BarDatum): string =>
    d.label ?? (isTime ? (formatDate ? formatDate(Number(d.x)) : String(d.x)) : String(d.x));

  const isEmpty =
    data.length === 0 ||
    series.length === 0 ||
    !data.some((d) => series.some((s) => Number.isFinite(d.values[s.id]) && d.values[s.id] !== 0));

  const geometry = useMemo(() => {
    if (isEmpty || width <= 0) return null;
    const stacked = layout === "stacked";

    // Value extents: stacks split into a positive and a negative pile.
    let vMin = 0;
    let vMax = 0;
    for (const d of data) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = d.values[s.id];
        if (!Number.isFinite(v)) continue;
        if (stacked) {
          if (v > 0) pos += v;
          else neg += v;
        } else {
          pos = Math.max(pos, v);
          neg = Math.min(neg, v);
        }
      }
      vMax = Math.max(vMax, pos);
      vMin = Math.min(vMin, neg);
    }
    const yt = niceTicks(vMin, vMax === vMin ? vMin + 1 : vMax, { nice: true });
    const context = tickContext(yt.ticks, yt.step);
    const yLabels = yt.ticks.map((v) => (tickFormatter ? tickFormatter(v, context) : context.format(v)));
    const gutter = Math.max(0, ...yLabels.map((l) => estimateTextWidth(l))) + Y_LABEL_GAP;

    const left = yAxis === "left" ? gutter : 0;
    const right = yAxis === "left" ? width : width - gutter;
    const top = PLOT_TOP_PAD + VALUE_BAND;
    const bottom = height - X_AXIS_BAND;
    const y = scaleLinear().domain(yt.domain).range([bottom, top]);
    const zero = y(0);

    const n = data.length;
    const step = (right - left) / n;
    const air = Math.max(GAP, step * 0.28);
    const visible = series.filter((s) => data.some((d) => Number.isFinite(d.values[s.id]) && d.values[s.id] !== 0));
    const k = Math.max(1, visible.length);

    const columns: Column[] = data.map((d, index) => {
      const center = left + step * (index + 0.5);
      const segments: Segment[] = [];
      let total = 0;
      if (stacked) {
        const barW = Math.min(MAX_BAR, Math.max(1, step - air));
        const x = center - barW / 2;
        let pos = 0;
        let neg = 0;
        const posSegs: Segment[] = [];
        const negSegs: Segment[] = [];
        for (const s of series) {
          const v = d.values[s.id];
          if (!Number.isFinite(v) || v === 0) continue;
          total += v;
          const v0 = v > 0 ? pos : neg;
          const v1 = v0 + v;
          if (v > 0) pos = v1;
          else neg = v1;
          const seg: Segment = { seriesId: s.id, value: v, v0, v1, x, width: barW, top: 0, bottom: 0, path: null };
          (v > 0 ? posSegs : negSegs).push(seg);
        }
        // Each pile: the outermost segment carries the rounded data end; every
        // segment after the first gives up 2px at its base for the surface gap.
        for (const pile of [posSegs, negSegs]) {
          pile.forEach((seg, i) => {
            const up = seg.v1 > seg.v0;
            const base = y(seg.v0) + (i === 0 ? 0 : up ? -GAP : GAP);
            const end = y(seg.v1);
            seg.top = Math.min(base, end);
            seg.bottom = Math.max(base, end);
            const visibleHeight = up ? base - end : end - base;
            seg.path = visibleHeight > 0.5 ? columnPath(x, barW, base, end, i === pile.length - 1 ? 4 : 0) : null;
            segments.push(seg);
          });
        }
      } else {
        const groupMax = k * MAX_BAR + (k - 1) * GAP;
        const groupW = Math.min(groupMax, Math.max(k, step - air));
        const barW = (groupW - (k - 1) * GAP) / k;
        visible.forEach((s, j) => {
          const v = d.values[s.id];
          if (!Number.isFinite(v) || v === 0) return;
          total += v;
          const x = center - groupW / 2 + j * (barW + GAP);
          const end = y(v);
          segments.push({
            seriesId: s.id,
            value: v,
            v0: 0,
            v1: v,
            x,
            width: barW,
            top: Math.min(zero, end),
            bottom: Math.max(zero, end),
            path: Math.abs(zero - end) > 0.5 ? columnPath(x, barW, zero, end, 4) : null,
          });
        });
      }
      return { index, center, total, segments };
    });

    // X labels. Dates thin out (every k-th, anchored on the newest): the
    // rhythm says which bar is which. Categories have no rhythm, so they are
    // shortened to fit their own slot first and only thinned when even three
    // letters would not fit.
    // A bucket is labelled at its own grain: hours, days, or months.
    const bucketLabel = timeTickFormatter(bucketMs < DAY_MS ? "hour" : bucketMs >= 28 * DAY_MS ? "month" : "day", { utc });
    let names = data.map((d) =>
      xFormatter ? xFormatter(d.x) : isTime ? bucketLabel(Number(d.x)) : (d.label ?? String(d.x)),
    );
    let widest = Math.max(0, ...names.map((l) => estimateTextWidth(l)));
    if (!isTime && widest + 12 > step) {
      const fitted = names.map((l) => fitLabel(l, step - 12));
      if (fitted.every((l): l is string => l !== null)) {
        names = fitted;
        widest = Math.max(0, ...names.map((l) => estimateTextWidth(l)));
      }
    }
    const every = !isTime && widest + 12 <= step ? 1 : thinningStep(n, step, widest);
    const xLabels: XLabel[] = placeLabels(
      columns
        .filter((c) => (n - 1 - c.index) % every === 0)
        .map((c) => ({ item: c.index, x: c.center, label: names[c.index] })),
      0,
      width,
    ).map((p) => ({ key: p.item, x: p.x, label: names[p.item], anchor: p.anchor }));

    return {
      zero,
      plot: { left, right, top, bottom },
      step,
      columns,
      yTicks: yt.ticks.map((value, i) => ({ value, y: y(value), label: yLabels[i] })),
      yLabelX: yAxis === "left" ? 0 : width,
      xLabels,
    };
  }, [isEmpty, width, layout, data, series, tickFormatter, yAxis, height, xFormatter, isTime, bucketMs, utc]);

  const activeColumn =
    geometry && active && active.index < geometry.columns.length ? geometry.columns[active.index] : null;
  const activeSeg = activeColumn?.segments.find((s) => s.seriesId === active?.seriesId) ?? null;

  const update = (next: Active | null) => {
    if (
      next?.index === active?.index &&
      next?.seriesId === active?.seriesId &&
      next?.source === active?.source
    ) {
      return;
    }
    setActive(next);
  };

  const pick = (column: Column, py: number, px: number): Segment | null => {
    if (column.segments.length === 0) return null;
    if (layout === "grouped") {
      let best = column.segments[0];
      for (const s of column.segments) {
        if (Math.abs(s.x + s.width / 2 - px) < Math.abs(best.x + best.width / 2 - px)) best = s;
      }
      return best;
    }
    let best = column.segments[0];
    let bestDist = Infinity;
    for (const s of column.segments) {
      const dist = py < s.top ? s.top - py : py > s.bottom ? py - s.bottom : 0;
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    return best;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!geometry) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { plot, step, columns } = geometry;
    const i = Math.min(columns.length - 1, Math.max(0, Math.floor((px - plot.left) / step)));
    const seg = pick(columns[i], py, px);
    update({ index: i, seriesId: seg?.seriesId ?? null, source: "pointer" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!geometry) return;
    const { columns } = geometry;
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && activeColumn && activeColumn.segments.length > 0) {
      e.preventDefault();
      // Up walks towards the top of the stack (or right in a group).
      const order = layout === "stacked" ? [...activeColumn.segments].sort((a, b) => b.top - a.top) : activeColumn.segments;
      const at = order.findIndex((s) => s.seriesId === active?.seriesId);
      const next = Math.min(order.length - 1, Math.max(0, at + (e.key === "ArrowUp" ? 1 : -1)));
      update({ index: activeColumn.index, seriesId: order[next].seriesId, source: "keyboard" });
      return;
    }
    let index = stepIndex(e.key, active ? active.index : null, columns.length);
    if (index === undefined) return;
    e.preventDefault();
    if (index === null) {
      update(null);
      return;
    }
    // Skip empty buckets so the selection always lands on a mark.
    const dir = e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "End" ? -1 : 1;
    while (index >= 0 && index < columns.length && columns[index].segments.length === 0) index += dir;
    if (index < 0 || index >= columns.length) return;
    const segs = columns[index].segments;
    const keep = segs.find((s) => s.seriesId === active?.seriesId);
    update({ index, seriesId: (keep ?? segs[segs.length - 1]).seriesId, source: "keyboard" });
  };

  const tableRows = () =>
    (isTime ? [...data].reverse() : data).map((d) => {
      const cells: Record<string, string> = { x: nameOf(d) };
      let total = 0;
      for (const s of series) {
        const v = d.values[s.id];
        cells[s.id] = Number.isFinite(v) ? valueFormatter(v) : "—";
        if (Number.isFinite(v)) total += v;
      }
      cells.__total = valueFormatter(total);
      return { key: String(d.x), cells };
    });

  const summary = useMemo(() => {
    if (ariaLabel) return ariaLabel;
    const subject = title ?? "Bar chart";
    if (isEmpty || width <= 0) return subject;
    let best = data[0];
    let bestTotal = -Infinity;
    let sum = 0;
    for (const d of data) {
      const total = series.reduce((acc, s) => acc + (Number.isFinite(d.values[s.id]) ? d.values[s.id] : 0), 0);
      sum += total;
      if (total > bestTotal) {
        bestTotal = total;
        best = d;
      }
    }
    const what = isTime ? "periods" : "categories";
    const bestName =
      best.label ?? (isTime ? (formatDate ? formatDate(Number(best.x)) : String(best.x)) : String(best.x));
    return (
      `${subject}: ${data.length} ${what}, ${series.map((s) => s.label).join(", ")}. ` +
      `Highest ${bestName} at ${valueFormatter(bestTotal)}; total ${valueFormatter(sum)}.`
    );
  }, [ariaLabel, title, isEmpty, width, data, series, isTime, formatDate, valueFormatter]);

  const legendItems: LegendItem[] = series.map((s) => ({
    id: s.id,
    label: s.label,
    color: colorOf(s.id),
    kind: "rect",
  }));
  // The series are known before their data: the legend shows through the
  // first load, so the card does not grow when the data lands. An empty
  // chart has nothing to key.
  const showLegend = legend === "auto" && series.length >= 2 && (loading || !isEmpty);
  const stackedMulti = layout === "stacked" && series.length >= 2;

  let body: ReactNode = null;
  if (loading) {
    body = <ChartSkeleton kind="bars" height={height} />;
  } else if (isEmpty) {
    body = <ChartEmpty>{empty}</ChartEmpty>;
  } else if (view === "table") {
    body = (
      <ChartTable
        className="viz-dim"
        caption={summary}
        height={height}
        columns={[
          { key: "x", label: isTime ? "Date" : "Category" },
          ...series.map((s) => ({ key: s.id, label: s.label, align: "right" as const })),
          ...(stackedMulti ? [{ key: "__total", label: "Total", align: "right" as const }] : []),
        ]}
        rows={tableRows()}
      />
    );
  } else if (geometry) {
    const { plot, columns } = geometry;
    // Rows in the order the eye meets them: top of the stack first.
    const ordered = activeColumn
      ? layout === "stacked"
        ? [...activeColumn.segments].sort((a, b) => a.top - b.top)
        : activeColumn.segments
      : [];
    const tooltipRows: TooltipRow[] = ordered.map((s) => ({
      id: s.seriesId,
      value: valueFormatter(s.value),
      label: series.find((q) => q.id === s.seriesId)?.label ?? s.seriesId,
      color: colorOf(s.seriesId),
      active: s.seriesId === activeSeg?.seriesId,
    }));
    // The hovered bar's value at its tip: the stack's total, or the one
    // column. It clears every mark of the group, not just its own, so it is
    // never printed over a taller neighbour; a negative tip is labelled below.
    let valueLabel: { x: number; y: number; text: string } | null = null;
    if (activeColumn && activeSeg) {
      const stacked = layout === "stacked";
      const value = stacked ? activeColumn.total : activeSeg.value;
      const x = stacked ? activeColumn.center : activeSeg.x + activeSeg.width / 2;
      const segs = activeColumn.segments;
      valueLabel =
        value >= 0
          ? { x, y: Math.max(plot.top - 4, Math.min(...segs.map((s) => s.top)) - 6), text: valueFormatter(value) }
          : { x, y: Math.min(plot.bottom - 2, Math.max(...segs.map((s) => s.bottom)) + 14), text: valueFormatter(value) };
    }
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
              for (let i = columns.length - 1; i >= 0; i--) {
                const segs = columns[i].segments;
                if (segs.length) {
                  update({ index: i, seriesId: segs[segs.length - 1].seriesId, source: "keyboard" });
                  break;
                }
              }
            }
          }}
          onBlur={() => update(null)}
        >
          <svg width={width} height={height} aria-hidden="true" focusable="false">
            <YAxis
              ticks={geometry.yTicks}
              left={plot.left}
              right={plot.right}
              side={yAxis}
              labelX={geometry.yLabelX}
            />
            {activeColumn ? (
              <rect
                x={round(activeColumn.center - geometry.step / 2 + 1)}
                y={round(plot.top - VALUE_BAND)}
                width={round(Math.max(0, geometry.step - 2))}
                height={round(plot.bottom - plot.top + VALUE_BAND)}
                rx={6}
                style={{ fill: "var(--viz-hover)" }}
              />
            ) : null}
            {columns.map((c) =>
              c.segments.map((s) =>
                s.path ? (
                  <path
                    key={`${c.index}-${s.seriesId}`}
                    d={s.path}
                    className="viz-mark"
                    data-active={activeSeg === s || undefined}
                    data-muted={focusId && focusId !== s.seriesId ? true : undefined}
                    style={{ fill: colorOf(s.seriesId) }}
                  />
                ) : null,
              ),
            )}
            <line
              x1={round(plot.left)}
              x2={round(plot.right)}
              y1={crisp(geometry.zero)}
              y2={crisp(geometry.zero)}
              strokeWidth={1}
              shapeRendering="crispEdges"
              style={{ stroke: "var(--viz-baseline)" }}
            />
            {valueLabel ? (
              <text className="viz-bar-label" x={round(valueLabel.x)} y={round(valueLabel.y)} textAnchor="middle">
                {valueLabel.text}
              </text>
            ) : null}
            <XAxis labels={geometry.xLabels} y={plot.bottom + 18} />
          </svg>
        </div>
        <ChartTooltip
          anchor={
            activeSeg
              ? { x: activeSeg.x, x2: activeSeg.x + activeSeg.width, y: activeSeg.top, y2: activeSeg.bottom }
              : activeColumn
                ? { x: activeColumn.center, y: geometry.zero }
                : null
          }
          bounds={{ width, height }}
          title={activeColumn ? nameOf(data[activeColumn.index]) : null}
          rows={tooltipRows}
          footer={
            activeColumn && (activeColumn.segments.length === 0 || (stackedMulti && activeColumn.segments.length > 1))
              ? `Total ${valueFormatter(activeColumn.total)}`
              : null
          }
        />
        <LiveRegion
          text={
            activeColumn && active?.source === "keyboard"
              ? `${nameOf(data[activeColumn.index])}: ${tooltipRows.map((r) => `${r.label} ${r.value}`).join(", ")}`
              : ""
          }
        />
      </>
    );
  }

  return (
    <div className={className ? `viz-chart ${className}` : "viz-chart"} data-pending={pending || undefined}>
      {showLegend ? <Legend items={legendItems} activeId={focusId} onActiveChange={setFocusId} /> : null}
      <div ref={frameRef} className="viz-frame" style={{ height }} aria-busy={pending || loading || undefined}>
        {body}
      </div>
    </div>
  );
}
