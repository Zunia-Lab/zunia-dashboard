"use client";

import type { ReactNode } from "react";
import { formatShare, formatValue } from "./format";
import { dashedKey } from "./layout";

export type SwatchKind = "line" | "rect" | "dot";

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  /** Mirrors the mark: a line key for lines, a square for bars, areas and slices. */
  kind?: SwatchKind;
  /** An estimated series: its line key is dashed like its line. */
  dashed?: boolean;
}

/** The mark-shaped key beside a label. The colour is on the swatch, never the text. */
export function Swatch({ color, kind = "rect", dashed = false }: { color: string; kind?: SwatchKind; dashed?: boolean }) {
  return (
    <span
      className="viz-swatch"
      data-kind={kind}
      style={{ background: dashed ? dashedKey(color) : color }}
      aria-hidden="true"
    />
  );
}

export interface LegendProps {
  items: readonly LegendItem[];
  /** Highlighted entity (the chart dims the rest); hovering an item reports it. */
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  className?: string;
}

/**
 * The identity key for two or more series. Charts render it themselves for
 * multi-series data and leave it out for one series (the card title names a
 * single series; a one-swatch box would only repeat it). Hovering an entry
 * highlights that series in the chart.
 */
export function Legend({ items, activeId, onActiveChange, className }: LegendProps) {
  return (
    <ul className={className ? `viz-legend ${className}` : "viz-legend"}>
      {items.map((item) => (
        <li
          key={item.id}
          className="viz-legend__item"
          data-muted={activeId && activeId !== item.id ? true : undefined}
          onPointerEnter={onActiveChange ? () => onActiveChange(item.id) : undefined}
          onPointerLeave={onActiveChange ? () => onActiveChange(null) : undefined}
        >
          <Swatch color={item.color} kind={item.kind} dashed={item.dashed} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export interface LegendListItem {
  id: string;
  label: string;
  value: number;
  color: string;
  /** Native hover text for the row, e.g. the names folded into "Other". */
  hint?: string;
}

export interface LegendListProps {
  items: readonly LegendListItem[];
  /** Denominator for the share column; defaults to the sum of the items. */
  total?: number;
  valueFormatter?: (value: number) => string;
  /** Hide the share column when the values are not parts of one whole. */
  showShare?: boolean;
  kind?: SwatchKind;
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  /** Rendered after the last row (e.g. "3 assets without a price are not counted"). */
  footer?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/**
 * Legend with numbers: swatch, name, value and share, one row per entity.
 * This is the relief channel for part-to-whole charts. The values are
 * readable here without hovering anything, which is what makes the light
 * palette's sub-3:1 slots legal, so allocation charts always ship it.
 */
export function LegendList({
  items,
  total,
  valueFormatter = formatValue,
  showShare = true,
  kind = "rect",
  activeId,
  onActiveChange,
  footer,
  className,
  ariaLabel,
}: LegendListProps) {
  const sum = total ?? items.reduce((s, item) => s + (item.value > 0 ? item.value : 0), 0);
  return (
    <div className={className ? `viz-legend-block ${className}` : "viz-legend-block"}>
      <ul className="viz-legend-list" aria-label={ariaLabel}>
        {items.map((item) => (
          <li
            key={item.id}
            className="viz-legend-list__row"
            data-active={activeId === item.id || undefined}
            data-muted={activeId && activeId !== item.id ? true : undefined}
            title={item.hint}
            onPointerEnter={onActiveChange ? () => onActiveChange(item.id) : undefined}
            onPointerLeave={onActiveChange ? () => onActiveChange(null) : undefined}
          >
            <Swatch color={item.color} kind={kind} />
            <span className="viz-legend-list__label">{item.label}</span>
            <span className="viz-legend-list__value">{valueFormatter(item.value)}</span>
            {showShare ? (
              <span className="viz-legend-list__pct">
                {sum > 0 ? formatShare(item.value / sum) : "—"}
              </span>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
      {footer ? <div className="viz-legend-block__footer">{footer}</div> : null}
    </div>
  );
}
