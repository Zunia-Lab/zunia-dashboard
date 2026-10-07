"use client";

/**
 * Pieces every chart in the kit is assembled from: ids for SVG defs, the
 * axis furniture, the first-load skeleton, the empty state and the live
 * region that reads keyboard exploration aloud. Not exported from the kit.
 */

import { useId, type ReactNode } from "react";
import { crisp, round, TICK_FONT, type TextAnchor } from "./layout";

/** A per-instance id that is safe inside `url(#…)` references. */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export interface YTick {
  value: number;
  y: number;
  label: string;
}

/**
 * Horizontal hairline gridlines across the plot and their labels in the
 * gutter. Solid, one step off the surface, crisp on whole device pixels:
 * the grid is there to be read against, not looked at.
 */
export function YAxis({
  ticks,
  left,
  right,
  side,
  labelX,
}: {
  ticks: readonly YTick[];
  left: number;
  right: number;
  side: "left" | "right" | "none";
  labelX: number;
}) {
  return (
    <g>
      {ticks.map((tick) => (
        <line
          key={`g${tick.value}`}
          x1={round(left)}
          x2={round(right)}
          y1={crisp(tick.y)}
          y2={crisp(tick.y)}
          style={{ stroke: "var(--viz-grid)" }}
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
      {side === "none"
        ? null
        : ticks.map((tick) => (
            <text
              key={`l${tick.value}`}
              className="viz-tick"
              x={round(labelX)}
              y={round(tick.y)}
              dy="0.34em"
              textAnchor={side === "right" ? "end" : "start"}
            >
              {tick.label}
            </text>
          ))}
    </g>
  );
}

export interface XLabel {
  key: string | number;
  x: number;
  label: string;
  anchor: TextAnchor;
}

/** The x labels under the plot. Placement (and dropping) happened upstream. */
export function XAxis({ labels, y }: { labels: readonly XLabel[]; y: number }) {
  return (
    <g>
      {labels.map((l) => (
        <text
          key={l.key}
          className="viz-tick"
          x={round(l.x)}
          y={round(y)}
          textAnchor={l.anchor}
          style={{ fontSize: TICK_FONT }}
        >
          {l.label}
        </text>
      ))}
    </g>
  );
}

/** A dot with a 2px ring in the surface colour, legible where it crosses a line. */
export function RingDot({
  cx,
  cy,
  color,
  r = 4,
  ring = 2,
}: {
  cx: number;
  cy: number;
  color: string;
  r?: number;
  ring?: number;
}) {
  // The stroke straddles the circle's edge: drawing it at r + ring/2 leaves
  // exactly r of fill inside a ring of exactly `ring`.
  return (
    <circle
      cx={round(cx)}
      cy={round(cy)}
      r={r + ring / 2}
      strokeWidth={ring}
      style={{ fill: color, stroke: "var(--viz-surface)" }}
    />
  );
}

export type SkeletonKind = "line" | "bars" | "donut" | "list" | "bar";

/**
 * First-load placeholder in the shape of the chart that will replace it, at
 * the same size, so nothing moves when data lands. Refetches never show this:
 * they keep the previous frame dimmed (`pending`).
 */
const LIST_SKELETON_WIDTHS = [0.86, 0.64, 0.5, 0.38, 0.24];

export function ChartSkeleton({
  kind,
  height,
  thickness = 18,
  rows = 5,
}: {
  kind: SkeletonKind;
  height: number;
  /** Ring width of the donut kind. */
  thickness?: number;
  /** Row count of the list kind. */
  rows?: number;
}) {
  return (
    <div className="viz-skeleton" aria-hidden="true">
      {kind === "line" ? (
        <svg width="100%" height={height} preserveAspectRatio="none" viewBox={`0 0 400 ${height}`}>
          {[0.2, 0.45, 0.7].map((f) => (
            <line
              key={f}
              x1={0}
              x2={400}
              y1={crisp(f * height)}
              y2={crisp(f * height)}
              style={{ stroke: "var(--viz-grid)" }}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={
              `M0,${height * 0.68} C60,${height * 0.6} 90,${height * 0.42} 150,${height * 0.47} ` +
              `S250,${height * 0.62} 300,${height * 0.38} S370,${height * 0.24} 400,${height * 0.3}`
            }
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--viz-skeleton)" }}
          />
        </svg>
      ) : null}
      {kind === "bars" ? (
        <div style={{ display: "flex", alignItems: "flex-end", gap: "6%", height: "100%", padding: "8% 4% 28px" }}>
          {[0.42, 0.66, 0.5, 0.82, 0.58, 0.74, 0.46, 0.9].map((h, i) => (
            <div
              key={i}
              className="viz-skeleton__block"
              style={{ flex: 1, maxWidth: 24, height: `${h * 100}%`, borderRadius: "4px 4px 0 0" }}
            />
          ))}
        </div>
      ) : null}
      {kind === "donut" ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
          <div
            style={{
              width: Math.min(height, 180),
              height: Math.min(height, 180),
              borderRadius: "50%",
              border: `${thickness}px solid var(--viz-skeleton)`,
            }}
          />
        </div>
      ) : null}
      {kind === "list" ? (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", height: "100%" }}>
          {Array.from({ length: rows }, (_, i) => LIST_SKELETON_WIDTHS[i % LIST_SKELETON_WIDTHS.length]).map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="viz-skeleton__block" style={{ width: 72, height: 10, borderRadius: 4 }} />
              <div className="viz-skeleton__block" style={{ width: `${w * 70}%`, height: 10, borderRadius: "0 4px 4px 0" }} />
            </div>
          ))}
        </div>
      ) : null}
      {kind === "bar" ? (
        <div className="viz-skeleton__block" style={{ height: "100%", borderRadius: 4 }} />
      ) : null}
    </div>
  );
}

const LEGEND_SKELETON_WIDTHS = [46, 38, 30, 34, 26];

/**
 * Legend-list rows for a first-load skeleton (donut, allocation bar): the
 * same 30px rows as `LegendList`, so the card does not grow when data lands.
 */
export function LegendSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="viz-legend-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="viz-legend-skeleton__row">
          <span className="viz-skeleton__block" style={{ width: 10, height: 10, borderRadius: 3 }} />
          <span
            className="viz-skeleton__block"
            style={{ width: `${LEGEND_SKELETON_WIDTHS[i % LEGEND_SKELETON_WIDTHS.length]}%`, height: 10, borderRadius: 4 }}
          />
          <span className="viz-skeleton__block" style={{ width: 48, height: 10, borderRadius: 4, marginLeft: "auto" }} />
        </div>
      ))}
    </div>
  );
}

/** Compact inline empty state, centred in the space the chart would take. */
export function ChartEmpty({ children }: { children?: ReactNode }) {
  return <div className="viz-empty">{children ?? "No data for this range"}</div>;
}

/**
 * Announces what keyboard exploration lands on. Pointer hover stays silent:
 * a screen-reader user moving a mouse does not need every pixel read out.
 */
export function LiveRegion({ text }: { text: string }) {
  return (
    <div className="viz-sr" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

/** Whether focus arrived by keyboard (the only time focus should open a tooltip). */
export function isKeyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}
