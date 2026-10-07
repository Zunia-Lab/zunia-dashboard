"use client";

import { useRef, type ReactNode } from "react";
import { dashedKey } from "./layout";
import { useIsomorphicLayoutEffect } from "./useChartSize";

export interface TooltipRow {
  id: string;
  /** The number, already formatted. It leads: the reader has the series and wants the value. */
  value: ReactNode;
  label: ReactNode;
  /**
   * Any CSS background: a series colour, or a gradient for a ramp-stroked
   * line. Every row is keyed with a short line in this colour, whatever the
   * mark: at tooltip density a filled box is data ink doing a label's job.
   */
  color: string;
  /** An estimated series: the key is dashed like its line. */
  dashed?: boolean;
  /** The row the pointer is on (bars, slices): its label gets a step more ink. */
  active?: boolean;
}

export interface ChartTooltipProps {
  /**
   * Anchor in the container's pixel space; `null` renders nothing. A point
   * (crosshair) or a mark's box: `x`–`x2` its horizontal extent, `y`–`y2` its
   * vertical one, so the tooltip sits beside or above the whole mark and
   * never covers the thing being read.
   */
  anchor: { x: number; y: number; x2?: number; y2?: number } | null;
  /**
   * Size of the positioned container the tooltip must stay inside. `minTop`
   * lets a tooltip that sits over its anchor rise past the container's top
   * edge (a thin bar or a KPI trend has no room inside itself).
   */
  bounds: { width: number; height: number; minTop?: number };
  title?: ReactNode;
  rows?: readonly TooltipRow[];
  footer?: ReactNode;
  /**
   * `side` sits beside the anchor and flips to the other side at the edge
   * (crosshairs, columns, list rows); `above` sits over the anchor and drops
   * below the mark when there is no room (thin horizontal bars).
   */
  placement?: "side" | "above";
}

const GAP = 12;
const EDGE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The kit's one tooltip. It lives inside the chart's own positioned container
 * (no portal), so it scrolls with the card and never escapes to the page.
 * Position is computed from its measured size after every render and written
 * straight to `transform`: it follows the pointer without a second React pass.
 *
 * It is a visual aid only (`aria-hidden`): every value it shows is also in the
 * live region for keyboard users and in the chart's table view.
 */
export function ChartTooltip({
  anchor,
  bounds,
  title,
  rows,
  footer,
  placement = "side",
}: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxLeft = Math.max(EDGE, bounds.width - w - EDGE);
    const maxTop = Math.max(EDGE, bounds.height - h - EDGE);
    let left: number;
    let top: number;
    if (placement === "side") {
      const midY = anchor.y2 === undefined ? anchor.y : (anchor.y + anchor.y2) / 2;
      left = (anchor.x2 ?? anchor.x) + GAP;
      if (left + w > bounds.width - EDGE) left = anchor.x - GAP - w;
      if (left >= EDGE) {
        top = h + 2 * EDGE > bounds.height ? 0 : clamp(midY - h / 2, EDGE, maxTop);
      } else {
        // Too narrow to sit beside the anchor (a phone, a KPI card): centre
        // on it and step over it, or under it near the top, rather than
        // cover the very point being read.
        left = clamp(anchor.x - w / 2, EDGE, maxLeft);
        const above = anchor.y - GAP - h;
        top = above >= (bounds.minTop ?? EDGE) ? above : (anchor.y2 ?? anchor.y) + GAP;
      }
    } else {
      const midX = anchor.x2 === undefined ? anchor.x : (anchor.x + anchor.x2) / 2;
      left = clamp(midX - w / 2, EDGE, maxLeft);
      top = anchor.y - GAP - h;
      if (top < (bounds.minTop ?? EDGE)) top = (anchor.y2 ?? anchor.y) + GAP;
    }
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    el.style.visibility = "visible";
  });

  if (!anchor) return null;
  return (
    <div ref={ref} className="viz-tooltip" style={{ visibility: "hidden" }} aria-hidden="true">
      {title ? <div className="viz-tooltip__title">{title}</div> : null}
      {rows && rows.length > 0 ? (
        <div className="viz-tooltip__rows">
          {rows.map((row) => (
            <div key={row.id} className="viz-tooltip__row" data-active={row.active || undefined} style={{ display: "contents" }}>
              <span className="viz-tooltip__key" style={{ background: row.dashed ? dashedKey(row.color) : row.color }} />
              <span className="viz-tooltip__value">{row.value}</span>
              <span className="viz-tooltip__label">{row.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {footer ? <div className="viz-tooltip__footer">{footer}</div> : null}
    </div>
  );
}
