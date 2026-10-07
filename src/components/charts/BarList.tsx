"use client";

import {
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ChartTooltip } from "./ChartTooltip";
import { formatShare, formatValue } from "./format";
import { ChartEmpty, ChartSkeleton } from "./internal";
import { stepIndex } from "./layout";
import { colorFor, VIZ_ACCENT } from "./palette";

export interface BarListItem {
  /** Stable entity id (colour lookups, React keys). */
  id: string;
  label: string;
  value: number;
  /** Icon slot left of the label: a chain logo, a token glyph. Decorative. */
  icon?: ReactNode;
  /** One line of context for the tooltip ("42 transactions"). */
  detail?: string;
  /** Overrides any other colour rule for this row. */
  color?: string;
}

export interface BarListProps {
  items: readonly BarListItem[];
  valueFormatter?: (value: number) => string;
  /**
   * Colour of every bar. A ranking is one series, so it is one colour: the
   * brand accent, as for every single-series chart (spec §4).
   */
  color?: string;
  /** Colour by entity instead, when the list sits beside charts that use the same map. */
  colorBy?: ReadonlyMap<string, string> | ((item: BarListItem) => string);
  /** Value at full bar length. Defaults to the largest value (or the reference, if larger). */
  max?: number;
  /** A vertical reference line across every row, e.g. the median. */
  reference?: { value: number; label: string };
  /** Largest first (default). Off keeps the given order. */
  sort?: boolean;
  /** Show at most this many rows. */
  limit?: number;
  /** Tooltip shows each row's share of the list total. Off for rates (APR), on for sums (fees). */
  showShare?: boolean;
  title?: string;
  ariaLabel?: string;
  loading?: boolean;
  pending?: boolean;
  empty?: ReactNode;
  className?: string;
}

type Active = { id: string; x: number; y: number };

const ROW_H = 34;

/**
 * Horizontal labelled bars for rankings: label (and icon) left, bar, value
 * right, every value printed so nothing hides behind a hover. Rows are
 * keyboard-focusable and carry a tooltip with the share and any detail.
 */
export function BarList({
  items,
  valueFormatter = formatValue,
  color = VIZ_ACCENT,
  colorBy,
  max,
  reference,
  sort = true,
  limit,
  showShare = true,
  title,
  ariaLabel,
  loading = false,
  pending = false,
  empty,
  className,
}: BarListProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  // One tab stop for the whole list (the row last focused); arrows move
  // between rows, so a ten-row ranking is not ten presses of Tab.
  const [focusIndex, setFocusIndex] = useState(0);

  const rows = useMemo(() => {
    const finite = items.filter((i) => Number.isFinite(i.value));
    const ordered = sort ? [...finite].sort((a, b) => b.value - a.value) : finite;
    return limit ? ordered.slice(0, limit) : ordered;
  }, [items, sort, limit]);

  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const scaleMax = Math.max(
    max ?? 0,
    ...rows.map((r) => r.value),
    reference && Number.isFinite(reference.value) ? reference.value : 0,
  );
  const pct = (v: number) => (scaleMax > 0 ? Math.max(0, Math.min(100, (v / scaleMax) * 100)) : 0);
  const colorOf = (item: BarListItem) => {
    if (item.color) return item.color;
    if (typeof colorBy === "function") return colorBy(item);
    if (colorBy) return colorFor(item.id, undefined, colorBy);
    return color;
  };

  const show = (el: HTMLElement, item: BarListItem) => {
    const root = rootRef.current;
    const track = el.querySelector<HTMLElement>(".viz-barlist__track");
    if (!root || !track) return;
    const r = root.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    const row = el.getBoundingClientRect();
    setBounds({ width: r.width, height: r.height });
    setActive({
      id: item.id,
      x: t.left - r.left + (t.width * pct(item.value)) / 100,
      y: row.top - r.top + row.height / 2,
    });
  };

  const summary =
    ariaLabel ??
    (rows.length
      ? `${title ?? "Ranking"}: ` +
        rows
          .slice(0, 5)
          .map((r) => `${r.label} ${valueFormatter(r.value)}`)
          .join(", ") +
        (rows.length > 5 ? `, and ${rows.length - 5} more` : "") +
        (reference ? `. ${reference.label}.` : ".")
      : (title ?? "Ranking"));

  if (loading) {
    return (
      <div
        className={className ? `viz-barlist ${className}` : "viz-barlist"}
        style={{ height: (limit ?? 5) * ROW_H }}
        aria-busy="true"
      >
        <ChartSkeleton kind="list" height={(limit ?? 5) * ROW_H} rows={limit ?? 5} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className={className ? `viz-barlist ${className}` : "viz-barlist"} style={{ height: 3 * ROW_H }}>
        <ChartEmpty>{empty}</ChartEmpty>
      </div>
    );
  }

  const activeItem = active ? rows.find((r) => r.id === active.id) ?? null : null;
  const refPct = reference ? pct(reference.value) : null;
  const tabStop = Math.min(focusIndex, rows.length - 1);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const key = e.key === "ArrowDown" ? "ArrowRight" : e.key === "ArrowUp" ? "ArrowLeft" : e.key;
    if (key === "ArrowRight" || key === "ArrowLeft" || key === "Home" || key === "End" || key === "Escape") {
      const next = stepIndex(key, tabStop, rows.length);
      if (next === undefined) return;
      e.preventDefault();
      if (next === null) {
        setActive(null);
        return;
      }
      listRef.current?.querySelectorAll<HTMLLIElement>(".viz-barlist__row")[next]?.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      className={className ? `viz-barlist ${className}` : "viz-barlist"}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
    >
      <ul ref={listRef} className="viz-barlist__list viz-dim" aria-label={summary} onKeyDown={onKeyDown}>
        {reference && refPct !== null ? (
          <li className="viz-barlist__head" aria-hidden="true">
            <span />
            <span className="viz-barlist__track">
              <span
                className="viz-barlist__ref-label"
                style={{ left: `${refPct}%`, transform: `translateX(-${refPct}%)` }}
              >
                {reference.label}
              </span>
            </span>
            <span />
          </li>
        ) : null}
        {rows.map((item, index) => {
          const p = pct(item.value);
          return (
            <li
              key={item.id}
              className="viz-barlist__row"
              tabIndex={index === tabStop ? 0 : -1}
              data-active={active?.id === item.id || undefined}
              onPointerEnter={(e: PointerEvent<HTMLLIElement>) => show(e.currentTarget, item)}
              onPointerLeave={() => setActive((a) => (a?.id === item.id ? null : a))}
              onFocus={(e: FocusEvent<HTMLLIElement>) => {
                setFocusIndex(index);
                show(e.currentTarget, item);
              }}
              onBlur={() => setActive((a) => (a?.id === item.id ? null : a))}
            >
              <span className="viz-barlist__label">
                {item.icon ? (
                  <span className="viz-barlist__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                ) : null}
                <span className="viz-barlist__label-text">{item.label}</span>
              </span>
              <span className="viz-barlist__track">
                <span
                  className="viz-barlist__bar"
                  style={{
                    width: item.value > 0 ? `max(2px, ${p}%)` : 0,
                    background: colorOf(item),
                  }}
                />
                {refPct !== null ? <span className="viz-barlist__ref" style={{ left: `${refPct}%` }} /> : null}
              </span>
              <span className="viz-barlist__value">{valueFormatter(item.value)}</span>
            </li>
          );
        })}
      </ul>
      <ChartTooltip
        anchor={activeItem && active ? { x: active.x, y: active.y } : null}
        bounds={bounds}
        title={activeItem?.label}
        rows={
          activeItem
            ? [
                {
                  id: activeItem.id,
                  value: valueFormatter(activeItem.value),
                  label:
                    showShare && total > 0
                      ? `${formatShare(Math.max(0, activeItem.value) / total)} of total`
                      : (title ?? ""),
                  color: colorOf(activeItem),
                },
              ]
            : undefined
        }
        footer={
          activeItem
            ? [
                activeItem.detail,
                reference ? `${reference.label}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || null
            : null
        }
      />
    </div>
  );
}
