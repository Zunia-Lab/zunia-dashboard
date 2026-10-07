"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChartTooltip } from "./ChartTooltip";
import { formatShare, formatValue } from "./format";
import { ChartEmpty, ChartSkeleton, isKeyboardFocus, LegendSkeleton, LiveRegion } from "./internal";
import { Legend, LegendList } from "./Legend";
import { stepIndex } from "./layout";
import { OTHER_ID } from "./palette";
import { colouredParts, type PartDatum } from "./series";

export interface StackedBarProps {
  data: readonly PartDatum[];
  /** Named segments before the tail folds into "Other" (default 5, as the donut). */
  maxSegments?: number;
  otherLabel?: string;
  /**
   * Colour map from the full entity list (`stableColorMap`); by default slots
   * follow the segments, largest first. Segments the map has no hue for join
   * "Other" (a lone one with no "Other" stays, in grey).
   */
  colors?: ReadonlyMap<string, string>;
  /** Bar thickness, px (the hit area is always at least 28px tall). */
  thickness?: number;
  /**
   * A sliver never drops below this width, so it stays visible. Its hit area
   * is at least 24px wide whatever its width, laid over its neighbours.
   */
  minSegmentWidth?: number;
  /** `list` prints value and share per row (allocations); `inline` is a compact key. */
  legend?: "list" | "inline" | "none";
  legendFooter?: ReactNode;
  valueFormatter?: (value: number) => string;
  title?: string;
  ariaLabel?: string;
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  loading?: boolean;
  pending?: boolean;
  empty?: ReactNode;
  className?: string;
}

type Hover = { id: string; source: "pointer" | "keyboard" | "legend"; x: number; y: number; y2: number };

/**
 * A 100% horizontal allocation bar: one row of segments separated by 2px
 * surface gaps, largest first, with a legend list carrying the numbers. Tiny
 * shares keep a minimum width (flexbox gives the rest to everyone else in
 * proportion), so no holding disappears or becomes unhoverable.
 */
export function StackedBar({
  data,
  maxSegments = 5,
  otherLabel = "Other",
  colors,
  thickness = 12,
  minSegmentWidth = 6,
  legend = "list",
  legendFooter,
  valueFormatter = formatValue,
  title,
  ariaLabel,
  activeId,
  onActiveChange,
  loading = false,
  pending = false,
  empty,
  className,
}: StackedBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });

  const folded = useMemo(
    () => colouredParts(data, maxSegments, otherLabel, colors),
    [data, maxSegments, otherLabel, colors],
  );
  const { parts, total, colorOf } = folded;
  const highlighted = activeId !== undefined ? activeId : (hover?.id ?? null);

  const setActive = (next: Hover | null) => {
    setHover(next);
    onActiveChange?.(next?.id ?? null);
  };

  /** Anchor over the middle of a segment, in the root's pixel space. */
  const anchorFor = (id: string): { x: number; y: number; y2: number } => {
    const root = rootRef.current;
    const seg = barRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (!root || !seg) return { x: 0, y: 0, y2: 0 };
    const r = root.getBoundingClientRect();
    const s = seg.getBoundingClientRect();
    setBounds({ width: r.width, height: r.height });
    return { x: s.left - r.left + s.width / 2, y: s.top - r.top, y2: s.bottom - r.top };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = hover ? parts.findIndex((p) => p.id === hover.id) : -1;
    const next = stepIndex(e.key, current < 0 ? null : current, parts.length);
    if (next === undefined) return;
    e.preventDefault();
    if (next === null) setActive(null);
    else setActive({ id: parts[next].id, source: "keyboard", ...anchorFor(parts[next].id) });
  };

  const summary =
    ariaLabel ??
    (total > 0
      ? `${title ?? "Allocation"}: ` + parts.map((p) => `${p.label} ${formatShare(p.value / total)}`).join(", ") + "."
      : (title ?? "Allocation"));

  if (loading) {
    return (
      <div className={className ? `viz-stackbar ${className}` : "viz-stackbar"} aria-busy="true">
        <div style={{ position: "relative", height: thickness }}>
          <ChartSkeleton kind="bar" height={thickness} />
        </div>
        {legend === "none" ? null : <LegendSkeleton rows={legend === "inline" ? 1 : 4} />}
      </div>
    );
  }
  if (total <= 0) {
    return (
      <div className={className ? `viz-stackbar ${className}` : "viz-stackbar"} style={{ height: 64 }}>
        <ChartEmpty>{empty}</ChartEmpty>
      </div>
    );
  }

  const hoverPart = hover && hover.source !== "legend" ? (parts.find((p) => p.id === hover.id) ?? null) : null;
  const items = parts.map((p) => ({
    id: p.id,
    label: p.label,
    value: p.value,
    color: colorOf(p),
    hint: p.id === OTHER_ID ? folded.folded.map((f) => f.label).join(", ") : undefined,
  }));

  return (
    <div
      ref={rootRef}
      className={className ? `viz-stackbar ${className}` : "viz-stackbar"}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
    >
      <div
        ref={barRef}
        className="viz-stackbar__bar viz-dim"
        style={{ height: thickness }}
        role="img"
        aria-label={summary}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={(e) => {
          if (!hover && isKeyboardFocus(e.currentTarget)) {
            setActive({ id: parts[0].id, source: "keyboard", ...anchorFor(parts[0].id) });
          }
        }}
        onBlur={() => setActive(null)}
      >
        {parts.map((p, i) => (
          <div
            key={p.id}
            data-id={p.id}
            className="viz-stackbar__seg"
            data-active={highlighted === p.id || undefined}
            data-muted={highlighted && highlighted !== p.id ? true : undefined}
            style={{
              flexGrow: (p.value / total) * 100,
              minWidth: minSegmentWidth,
              background: colorOf(p),
              // Parts run largest first, so later ones are the slivers: they
              // stack on top, and their widened hit areas win over the edges
              // of the big neighbours they overlap.
              zIndex: i + 1,
            }}
            onPointerEnter={() => setActive({ id: p.id, source: "pointer", ...anchorFor(p.id) })}
            onPointerLeave={() => {
              if (hover?.source === "pointer") setActive(null);
            }}
          />
        ))}
      </div>
      {legend === "list" ? (
        <LegendList
          className="viz-dim"
          items={items}
          total={total}
          valueFormatter={valueFormatter}
          activeId={highlighted}
          onActiveChange={(id) => setActive(id ? { id, source: "legend", x: 0, y: 0, y2: 0 } : null)}
          footer={legendFooter}
          ariaLabel={title}
        />
      ) : null}
      {legend === "inline" ? (
        <Legend
          className="viz-dim"
          items={items.map((i) => ({ id: i.id, label: `${i.label} ${formatShare(i.value / total)}`, color: i.color }))}
          activeId={highlighted}
          onActiveChange={(id) => setActive(id ? { id, source: "legend", x: 0, y: 0, y2: 0 } : null)}
        />
      ) : null}
      <ChartTooltip
        anchor={hoverPart && hover ? { x: hover.x, y: hover.y, y2: hover.y2 } : null}
        bounds={{ ...bounds, minTop: -72 }}
        placement="above"
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
        footer={
          hoverPart?.id === OTHER_ID
            ? folded.folded
                .slice(0, 4)
                .map((f) => f.label)
                .join(", ") + (folded.folded.length > 4 ? ` and ${folded.folded.length - 4} more` : "")
            : null
        }
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
