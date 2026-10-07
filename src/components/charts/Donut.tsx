"use client";

import { arc, pie, type PieArcDatum } from "d3-shape";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChartTable } from "./ChartTable";
import { ChartTooltip } from "./ChartTooltip";
import { formatShare, formatValue } from "./format";
import { ChartEmpty, ChartSkeleton, isKeyboardFocus, LegendSkeleton, LiveRegion } from "./internal";
import { LegendList } from "./Legend";
import { stepIndex } from "./layout";
import { OTHER_ID } from "./palette";
import { colouredParts, type PartDatum } from "./series";
import { useChartSize } from "./useChartSize";

export interface DonutProps {
  data: readonly PartDatum[];
  /**
   * Named segments before the tail folds into "Other": default 5, so at most
   * six slices (spec §8). A single leftover is shown as itself.
   */
  maxSegments?: number;
  otherLabel?: string;
  /**
   * Colour map from the full entity list (`stableColorMap`, largest holding
   * first). By default slots follow the slices, largest first. Slices the map
   * has no hue for join "Other" (a lone one with no "Other" stays, in grey).
   */
  colors?: ReadonlyMap<string, string>;
  /** Diameter, px. */
  size?: number;
  /** Ring thickness, px. */
  thickness?: number;
  /** Centre slot: the headline value and what it is. */
  centerValue?: ReactNode;
  centerCaption?: ReactNode;
  /**
   * Where the hovered slice reads out. `center` (default) swaps the centre
   * slot for the slice's value, name and share: it never covers a slice and
   * fits the narrowest card. `float` is the kit's tooltip beside the ring,
   * for wide layouts with room on both sides.
   */
  tooltip?: "center" | "float";
  valueFormatter?: (value: number) => string;
  /**
   * The legend list with value and share (the relief channel: always on for
   * allocations). `auto` sits beside the ring when the container is 400px or
   * wider and below it otherwise.
   */
  legend?: "auto" | "side" | "below" | "none";
  /** Under the legend, e.g. "3 assets without a price are not counted". */
  legendFooter?: ReactNode;
  title?: string;
  ariaLabel?: string;
  /** Controlled highlight, to link the ring with a list rendered elsewhere. */
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  loading?: boolean;
  pending?: boolean;
  empty?: ReactNode;
  /** The table twin, in the chart's own footprint. */
  view?: "chart" | "table";
  className?: string;
}

type Hover = { id: string; source: "pointer" | "keyboard" | "legend"; ox: number; oy: number };

const GAP = 2;
const LIFT = 3;

/**
 * Part-to-whole at a glance: at most five named slices plus "Other", 2px
 * surface gaps, a centre slot, and a legend list that prints every value and
 * share so nothing depends on judging angles or matching colours.
 */
export function Donut({
  data,
  maxSegments = 5,
  otherLabel = "Other",
  colors,
  size = 176,
  thickness = 18,
  centerValue,
  centerCaption,
  tooltip = "center",
  valueFormatter = formatValue,
  legend = "auto",
  legendFooter,
  title,
  ariaLabel,
  activeId,
  onActiveChange,
  loading = false,
  pending = false,
  empty,
  view = "chart",
  className,
}: DonutProps) {
  const [rootRef, rootSize] = useChartSize<HTMLDivElement>();
  const figureRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const folded = useMemo(
    () => colouredParts(data, maxSegments, otherLabel, colors),
    [data, maxSegments, otherLabel, colors],
  );
  const { parts, total, colorOf } = folded;

  const r = size / 2 - LIFT;
  const inner = Math.max(0, r - thickness);
  const arcs = useMemo(
    () =>
      pie<PartDatum>()
        .value((d) => d.value)
        .sort(null)(parts as PartDatum[]),
    [parts],
  );
  const shape = useMemo(() => {
    const pad = parts.length > 1 ? GAP / r : 0;
    // padRadius × padAngle is the gap's linear width: a constant 2px between
    // slices, parallel-sided, at every radius.
    const slice = (outer: number) =>
      arc<PieArcDatum<PartDatum>>().innerRadius(inner).outerRadius(outer).padAngle(pad).padRadius(r).cornerRadius(2);
    const base = slice(r);
    const lifted = slice(r + LIFT);
    // An 18px ring is a thin target: each slice's hit area reaches 4px past
    // both edges (26px+), with no gap, so the pointer never falls between.
    const hit = arc<PieArcDatum<PartDatum>>().innerRadius(Math.max(0, inner - 4)).outerRadius(r + LIFT);
    return { base, lifted, hit };
  }, [parts.length, r, inner]);

  const highlighted = activeId !== undefined ? activeId : (hover?.id ?? null);

  const setActive = (next: Hover | null) => {
    setHover(next);
    onActiveChange?.(next?.id ?? null);
  };

  const offsetOf = () => {
    const fig = figureRef.current;
    return { ox: fig?.offsetLeft ?? 0, oy: fig?.offsetTop ?? 0 };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = e.key === "ArrowDown" ? "ArrowRight" : e.key === "ArrowUp" ? "ArrowLeft" : e.key;
    const current = hover ? parts.findIndex((p) => p.id === hover.id) : -1;
    const next = stepIndex(key, current < 0 ? null : current, parts.length);
    if (next === undefined) return;
    e.preventDefault();
    setActive(next === null ? null : { id: parts[next].id, source: "keyboard", ...offsetOf() });
  };

  const summary =
    ariaLabel ??
    (total > 0
      ? `${title ?? "Allocation"}: ` +
        parts.map((p) => `${p.label} ${formatShare(p.value / total)}`).join(", ") +
        "."
      : (title ?? "Allocation"));

  const hoverArc = hover && hover.source !== "legend" ? arcs.find((a) => a.data.id === hover.id) : null;
  const hoverPart = hoverArc?.data ?? null;
  const readout = tooltip === "center" && highlighted ? (parts.find((p) => p.id === highlighted) ?? null) : null;
  // Beside the whole ring, level with the hovered slice's outer edge: the
  // tooltip never sits on the slice it describes.
  let tooltipAnchor: { x: number; x2: number; y: number } | null = null;
  if (tooltip === "float" && hoverArc && hover) {
    const mid = (hoverArc.startAngle + hoverArc.endAngle) / 2;
    tooltipAnchor = { x: hover.ox, x2: hover.ox + size, y: hover.oy + size / 2 - Math.cos(mid) * r };
  }
  const foldedNames =
    hoverPart?.id === OTHER_ID
      ? folded.folded
          .slice(0, 4)
          .map((f) => f.label)
          .join(", ") + (folded.folded.length > 4 ? ` and ${folded.folded.length - 4} more` : "")
      : null;

  const legendItems = parts.map((p) => ({
    id: p.id,
    label: p.label,
    value: p.value,
    color: colorOf(p),
    hint: p.id === OTHER_ID ? folded.folded.map((f) => f.label).join(", ") : undefined,
  }));

  if (loading) {
    // The ring and its legend rows, laid out like the real thing, so the card
    // keeps its height when the data lands.
    return (
      <div className={className ? `viz-donut ${className}` : "viz-donut"} aria-busy="true">
        <div className="viz-donut__layout" data-legend={legend}>
          <div className="viz-donut__figure" style={{ width: size, height: size }}>
            <ChartSkeleton kind="donut" height={size} thickness={thickness} />
          </div>
          {legend === "none" ? null : <LegendSkeleton />}
        </div>
      </div>
    );
  }

  if (total <= 0) {
    return (
      <div className={className ? `viz-donut ${className}` : "viz-donut"} style={{ position: "relative", height: size }}>
        <ChartEmpty>{empty}</ChartEmpty>
      </div>
    );
  }

  const table = view === "table";

  return (
    <div
      ref={rootRef}
      className={className ? `viz-donut ${className}` : "viz-donut"}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      style={{ position: "relative" }}
    >
      {/* The table twin lies over the chart, which keeps its box (hidden, so
          it is out of the accessibility tree and the tab order): switching
          views never moves the card. */}
      {table ? (
        <ChartTable
          className="viz-dim viz-donut__table"
          caption={summary}
          columns={[
            { key: "label", label: title ?? "Segment" },
            { key: "value", label: "Value", align: "right" },
            { key: "share", label: "Share", align: "right" },
          ]}
          rows={parts.map((p) => ({
            key: p.id,
            cells: { label: p.label, value: valueFormatter(p.value), share: formatShare(p.value / total) },
          }))}
        />
      ) : null}
      <div
        className="viz-donut__layout"
        data-legend={legend}
        style={table ? { visibility: "hidden" } : undefined}
      >
        <div ref={figureRef} className="viz-donut__figure viz-dim" style={{ width: size, height: size }}>
          <div
            className="viz-plot"
            role="img"
            aria-label={summary}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={(e) => {
              if (!hover && isKeyboardFocus(e.currentTarget)) {
                setActive({ id: parts[0].id, source: "keyboard", ...offsetOf() });
              }
            }}
            onBlur={() => setActive(null)}
            style={{ borderRadius: "50%" }}
          >
            <svg width={size} height={size} aria-hidden="true" focusable="false">
              <g transform={`translate(${size / 2},${size / 2})`}>
                {arcs.map((a) => {
                  const isActive = highlighted === a.data.id;
                  return (
                    <path
                      key={a.data.id}
                      d={(isActive ? shape.lifted : shape.base)(a) ?? ""}
                      className="viz-mark"
                      data-active={isActive || undefined}
                      data-muted={highlighted && !isActive ? true : undefined}
                      style={{ fill: colorOf(a.data), pointerEvents: "none" }}
                    />
                  );
                })}
                {arcs.map((a) => (
                  <path
                    key={`hit-${a.data.id}`}
                    d={shape.hit(a) ?? ""}
                    fill="transparent"
                    onPointerEnter={() => setActive({ id: a.data.id, source: "pointer", ...offsetOf() })}
                    onPointerLeave={() => {
                      if (hover?.source === "pointer") setActive(null);
                    }}
                  />
                ))}
              </g>
            </svg>
          </div>
          {readout ? (
            <div className="viz-donut__center" aria-hidden="true">
              <div className="viz-donut__center-value">{valueFormatter(readout.value)}</div>
              <div className="viz-donut__center-caption" style={{ color: "var(--z-fg-muted)" }}>
                {readout.label}
              </div>
              <div className="viz-donut__center-caption">{formatShare(readout.value / total)}</div>
            </div>
          ) : centerValue !== undefined || centerCaption !== undefined ? (
            <div className="viz-donut__center" aria-hidden="true">
              {centerValue !== undefined ? <div className="viz-donut__center-value">{centerValue}</div> : null}
              {centerCaption !== undefined ? <div className="viz-donut__center-caption">{centerCaption}</div> : null}
            </div>
          ) : null}
        </div>
        {legend === "none" ? null : (
          <LegendList
            className="viz-dim"
            items={legendItems}
            total={total}
            valueFormatter={valueFormatter}
            activeId={highlighted}
            onActiveChange={(id) =>
              setActive(id ? { id, source: "legend", ox: 0, oy: 0 } : null)
            }
            footer={legendFooter}
            ariaLabel={title}
          />
        )}
      </div>
      <ChartTooltip
        anchor={tooltipAnchor}
        bounds={{ width: rootSize.width, height: Math.max(rootSize.height, size) }}
        title={hoverPart?.label}
        rows={
          hoverPart
            ? [
                {
                  id: hoverPart.id,
                  value: valueFormatter(hoverPart.value),
                  label: formatShare(hoverPart.value / total),
                  color: colorOf(hoverPart),
                },
              ]
            : undefined
        }
        footer={foldedNames}
      />
      <LiveRegion
        text={
          hoverPart && hover?.source === "keyboard"
            ? `${hoverPart.label}: ${valueFormatter(hoverPart.value)}, ${formatShare(hoverPart.value / total)}`
            : ""
        }
      />
    </div>
  );
}
