"use client";

/**
 * The Chains page's analysis card: every chain in the table placed by its
 * real yield (up) against the share of its supply that is staked (right),
 * with the user's followed chains in the accent and named, and three plain
 * readings beside it (the median, who dilutes even its stakers, and whether
 * less stake goes with more yield here).
 *
 * The kit has no scatter chart, so this one is drawn in place with the
 * kit's furniture (`viz-*` classes, ChartTooltip, Legend, tick helper):
 * same ticks, grid, tooltip and keyboard model as its other charts. Its
 * table view is the Chains table right under it, which holds every figure.
 *
 * - An outlier above the bulk is pinned to the top edge as a triangle with
 *   its real figure printed (`yieldAxisTop`), never silently cut.
 * - Below zero is washed in the negative tone: there even stakers lose share
 *   of supply (a status colour that means something, not decoration).
 * - Pointer: the nearest chain within reach gets the tooltip; a click opens
 *   its page. Keyboard: the plot is one tab stop, arrows walk the chains by
 *   staked share, Enter opens one, Escape leaves; a live region reads each.
 */

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartTooltip, Legend, VIZ_ACCENT, VIZ_OTHER, niceTicks, useChartSize, type LegendItem } from "@/components/charts";
import { Card, CardHeader, Skeleton } from "@/components/ui";
import type { ChainStats } from "@/lib/chain/types";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { readMap, yieldAxisTop, yieldMapPoints, type MapPoint, type MapReading } from "./yield-map";

const HEIGHT = 272;
const MARGIN = { top: 26, right: 16, bottom: 38, left: 48 };
const X_TICKS = [0, 25, 50, 75, 100];
/** How close (px) the pointer must be to a dot to pick it. */
const REACH = 26;
const LABEL_FONT = 11.5;
/** Rough advance of an 11.5px Space Grotesk glyph, for label collisions. */
const GLYPH = 6.3;

interface YieldMapProps {
  /** Stats of the chains in the table (loaded rows). */
  stats: readonly ChainStats[];
  isFollowed: (chainId: string) => boolean;
  loading: boolean;
  refreshing?: boolean;
  className?: string;
}

/** Signed percent as the Chains table prints it (two decimals: −0.03 %, not "−<0.1 %"). */
const signed = (v: number) => formatPercent(v, { signed: true });
/** Axis ticks are round numbers: "+40%", "0%", "−20%". */
const tickLabel = (v: number) => (v === 0 ? "0%" : formatPercent(v, { signed: true, digits: 0 }));

export function YieldMap({ stats, isFollowed, loading, refreshing, className }: YieldMapProps) {
  const points = useMemo(() => yieldMapPoints(stats, isFollowed), [stats, isFollowed]);
  const reading = useMemo(() => readMap(points), [points]);
  const enough = points.length >= 3;

  return (
    <Card className={className}>
      <CardHeader
        title="Yield map"
        icon="trendingUp"
        subtitle="Real yield against the share of supply staked, for the chains in the table"
        info="Real yield is the block-time corrected staking APR (before validator commission) minus actual inflation. Staked share is bonded tokens ÷ total supply. Issuance is split among stakers, so where few stake each earns more, and less stake secures the chain."
        refreshing={refreshing}
      />
      {loading && !enough ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_248px]">
          <Skeleton className="rounded-[var(--d-radius-inner)]" height={HEIGHT} />
          <div className="grid gap-4 max-lg:hidden">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-3 w-36" />
              </div>
            ))}
          </div>
        </div>
      ) : !enough ? (
        <p className="py-6 text-center text-[13px] text-fg-dim">
          The map needs three chains with both a real yield and a staked share; the table below has fewer right now.
        </p>
      ) : (
        <div className="grid gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_248px]">
          <Scatter points={points} />
          <Reading reading={reading} />
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ plot */

interface Placed {
  point: MapPoint;
  x: number;
  y: number;
  /** Above the axis top: drawn as a triangle on the edge. */
  off: boolean;
}

interface LabelBox {
  id: string;
  x: number;
  y: number;
  anchor: "start" | "end";
  text: string;
}

function Scatter({ points }: { points: readonly MapPoint[] }) {
  const router = useRouter();
  const [frame, size] = useChartSize<HTMLDivElement>();
  const [active, setActive] = useState<{ id: string; source: "mouse" | "touch" | "keyboard" } | null>(null);
  const width = size.width;

  const geometry = useMemo(() => {
    // Not until the frame is wider than the margins: on phones the first
    // measurement can be a few pixels (24 px seen at 390), which made the
    // plot width negative and Chrome log `<rect> attribute width: A negative
    // value is not valid`. Nothing is drawn until a usable width arrives.
    if (width <= MARGIN.left + MARGIN.right) return null;
    const plotLeft = MARGIN.left;
    const plotRight = width - MARGIN.right;
    const plotTop = MARGIN.top;
    const plotBottom = HEIGHT - MARGIN.bottom;
    const yields = points.map((p) => p.realYield);
    const lowest = Math.min(...yields);
    // The data's own range with a little air, ticks inside it: snapping the
    // domain out to round ticks gave −50…+100 % and left half the plot empty.
    const d0 = Math.min(-5, lowest - 2);
    const d1 = yieldAxisTop(yields) + 2;
    const axis = niceTicks(d0, d1, { target: 4, maxTicks: 5 });
    const x = (v: number) => plotLeft + (Math.min(100, Math.max(0, v)) / 100) * (plotRight - plotLeft);
    const y = (v: number) => plotTop + (1 - (v - d0) / (d1 - d0)) * (plotBottom - plotTop);

    // Followed chains are drawn last, so the accent sits on top of the grey.
    const placed: Placed[] = [...points]
      .sort((a, b) => Number(a.followed) - Number(b.followed))
      .map((point) => {
        const off = point.realYield > d1;
        return { point, x: x(point.staked), y: off ? plotTop : y(point.realYield), off };
      });

    // Names for followed chains and off-scale ones (with their figure),
    // greedily, skipping any that would collide with one already placed.
    const labels: LabelBox[] = [];
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const candidates = placed.filter((p) => p.point.followed || p.off).sort((a, b) => Number(b.off) - Number(a.off) || a.y - b.y);
    for (const p of candidates) {
      const text = p.off ? `${p.point.name} ${signed(p.point.realYield)}` : p.point.name;
      const w = text.length * GLYPH;
      for (const side of ["start", "end"] as const) {
        const lx = side === "start" ? p.x + 9 : p.x - 9;
        const x0 = side === "start" ? lx : lx - w;
        const x1 = x0 + w;
        const ly = p.y + 4;
        const box = { x0, x1, y0: ly - 10, y1: ly + 3 };
        if (x0 < 2 || x1 > width - 2) continue;
        if (boxes.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
        boxes.push(box);
        labels.push({ id: p.point.chainId, x: lx, y: ly, anchor: side, text });
        break;
      }
    }

    return {
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      zeroY: d0 < 0 && d1 > 0 ? y(0) : null,
      yTicks: axis.ticks.map((value) => ({ value, y: y(value) })),
      xTicks: X_TICKS.map((value) => ({ value, x: x(value) })),
      placed,
      labels,
    };
  }, [points, width]);

  // Keyboard order: by staked share, left to right.
  const order = useMemo(() => [...points].sort((a, b) => a.staked - b.staked || b.realYield - a.realYield), [points]);
  const activePoint = active ? (points.find((p) => p.chainId === active.id) ?? null) : null;
  const activePlaced = active && geometry ? (geometry.placed.find((p) => p.point.chainId === active.id) ?? null) : null;

  // A mouse hovers to read and clicks to open; a finger has no hover, so its
  // first tap reads a chain and a second tap on the same one opens it.
  const pointerType = useRef<string>("mouse");

  /** The chain nearest the pointer, within reach. */
  const nearest = (event: PointerEvent<HTMLDivElement>): string | null => {
    if (!geometry) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    let best: Placed | null = null;
    let bestDistance = REACH;
    for (const p of geometry.placed) {
      const distance = Math.hypot(p.x - px, p.y - py);
      if (distance < bestDistance) {
        best = p;
        bestDistance = distance;
      }
    }
    return best?.point.chainId ?? null;
  };

  const open = (chainId: string) => router.push(`/chains/${encodeURIComponent(chainId)}`);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const id = nearest(event);
    if (id !== (active?.id ?? null)) setActive(id ? { id, source: "mouse" } : null);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerType.current = event.pointerType;
    if (event.pointerType === "mouse") return;
    const id = nearest(event);
    if (id && id === active?.id) open(id);
    else setActive(id ? { id, source: "touch" } : null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = active ? order.findIndex((p) => p.chainId === active.id) : -1;
    let next: number | null | undefined;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = index < 0 ? 0 : Math.min(order.length - 1, index + 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = index < 0 ? order.length - 1 : Math.max(0, index - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = order.length - 1;
        break;
      case "Enter":
        if (active) {
          event.preventDefault();
          open(active.id);
        }
        return;
      case "Escape":
        next = active ? null : undefined;
        break;
      default:
        return;
    }
    if (next === undefined) return;
    event.preventDefault();
    const target = next === null ? null : order[next];
    setActive(target ? { id: target.chainId, source: "keyboard" } : null);
  };

  const highest = [...points].sort((a, b) => b.realYield - a.realYield)[0];
  const lowest = [...points].sort((a, b) => a.realYield - b.realYield)[0];
  const summary =
    `Yield map of ${points.length} chains: real yield against the share of supply staked.` +
    (highest ? ` Highest: ${highest.name}, ${signed(highest.realYield)} with ${formatPercent(highest.staked, { digits: 0 })} staked.` : "") +
    (lowest ? ` Lowest: ${lowest.name}, ${signed(lowest.realYield)} with ${formatPercent(lowest.staked, { digits: 0 })} staked.` : "") +
    " Use the arrow keys to read each chain; every figure is also in the table below.";

  const legend: LegendItem[] = [
    { id: "followed", label: "Followed", color: VIZ_ACCENT, kind: "dot" },
    { id: "other", label: "Other chains", color: VIZ_OTHER, kind: "dot" },
  ];
  const offCount = geometry ? geometry.placed.filter((p) => p.off).length : 0;

  return (
    <div className="viz-chart min-w-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Legend items={legend} />
        {offCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-muted">
            <svg width="10" height="9" viewBox="0 0 10 9" aria-hidden>
              <path d="M5 0.5 9.5 8.5H0.5Z" style={{ fill: VIZ_OTHER }} />
            </svg>
            Above the scale, figure printed
          </span>
        ) : null}
      </div>
      <div ref={frame} className="viz-frame" style={{ height: HEIGHT }}>
        {geometry ? (
          <div
            className="viz-plot"
            role="img"
            aria-label={summary}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse" && active?.source === "mouse") setActive(null);
            }}
            onClick={() => {
              if (pointerType.current === "mouse" && active?.source === "mouse") open(active.id);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            style={{ cursor: active?.source === "mouse" ? "pointer" : undefined }}
          >
            <svg width={width} height={HEIGHT} aria-hidden="true" focusable="false">
              <text className="viz-axis-caption" x={0} y={11}>
                Real yield
              </text>
              {/* Below zero even stakers lose share of supply. */}
              {geometry.zeroY !== null ? (
                <>
                  <rect
                    x={geometry.plotLeft}
                    y={geometry.zeroY}
                    width={geometry.plotRight - geometry.plotLeft}
                    height={geometry.plotBottom - geometry.zeroY}
                    style={{ fill: "var(--viz-neg)", opacity: 0.07 }}
                  />
                  <text className="viz-axis-caption" x={geometry.plotRight - 6} y={geometry.plotBottom - 7} textAnchor="end" style={{ fill: "var(--viz-neg)" }}>
                    Stakers diluted
                  </text>
                </>
              ) : null}
              {geometry.yTicks.map((tick) => (
                <g key={`y${tick.value}`}>
                  <line
                    x1={geometry.plotLeft}
                    x2={geometry.plotRight}
                    y1={Math.round(tick.y) + 0.5}
                    y2={Math.round(tick.y) + 0.5}
                    shapeRendering="crispEdges"
                    style={{ stroke: tick.value === 0 ? "var(--viz-baseline)" : "var(--viz-grid)" }}
                  />
                  <text className="viz-tick" x={geometry.plotLeft - 8} y={tick.y} dy="0.34em" textAnchor="end">
                    {tickLabel(tick.value)}
                  </text>
                </g>
              ))}
              {geometry.xTicks.map((tick, index) => (
                <g key={`x${tick.value}`}>
                  {index > 0 ? (
                    <line
                      x1={Math.round(tick.x) + 0.5}
                      x2={Math.round(tick.x) + 0.5}
                      y1={geometry.plotTop}
                      y2={geometry.plotBottom}
                      shapeRendering="crispEdges"
                      style={{ stroke: "var(--viz-grid)" }}
                    />
                  ) : null}
                  <text
                    className="viz-tick"
                    x={tick.x}
                    y={geometry.plotBottom + 15}
                    textAnchor={index === 0 ? "start" : index === X_TICKS.length - 1 ? "end" : "middle"}
                  >
                    {tick.value}%
                  </text>
                </g>
              ))}
              <text className="viz-axis-caption" x={(geometry.plotLeft + geometry.plotRight) / 2} y={HEIGHT - 4} textAnchor="middle">
                Share of supply staked →
              </text>

              {geometry.placed.map((p) => {
                const isActive = active?.id === p.point.chainId;
                const color = p.point.followed ? VIZ_ACCENT : VIZ_OTHER;
                // Reading one chain dims the rest; grey dots sit a step back.
                const opacity = active && !isActive ? 0.3 : p.point.followed || isActive ? 1 : 0.8;
                if (p.off) {
                  const s = isActive ? 7 : 5.5;
                  return (
                    <path
                      key={p.point.chainId}
                      className="viz-mark"
                      d={`M${p.x} ${p.y - s}L${p.x + s} ${p.y + s * 0.8}L${p.x - s} ${p.y + s * 0.8}Z`}
                      strokeWidth={1.5}
                      style={{ fill: color, stroke: "var(--viz-surface)", opacity }}
                    />
                  );
                }
                return (
                  <circle
                    key={p.point.chainId}
                    className="viz-mark"
                    cx={p.x}
                    cy={p.y}
                    r={(p.point.followed ? 5.5 : 4.5) + (isActive ? 1.5 : 0)}
                    strokeWidth={1.5}
                    style={{ fill: color, stroke: "var(--viz-surface)", opacity }}
                  />
                );
              })}
              {geometry.labels.map((label) => (
                <text
                  key={label.id}
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  className={cn("viz-end-label", active && active.id !== label.id && "opacity-40")}
                  style={{ fontSize: LABEL_FONT, fill: "var(--z-fg-muted)", fontWeight: 500, paintOrder: "stroke", stroke: "var(--viz-surface)", strokeWidth: 3, strokeLinejoin: "round" }}
                >
                  {label.text}
                </text>
              ))}
            </svg>
          </div>
        ) : null}
        {activePoint && activePlaced ? (
          <ChartTooltip
            anchor={{ x: activePlaced.x, y: activePlaced.y }}
            bounds={{ width, height: HEIGHT }}
            title={activePoint.name}
            rows={[
              { id: "real", value: signed(activePoint.realYield), label: "Real yield", color: activePoint.followed ? VIZ_ACCENT : VIZ_OTHER },
              { id: "staked", value: formatPercent(activePoint.staked, { digits: 1 }), label: "Supply staked", color: "var(--viz-grid)" },
              { id: "apr", value: activePoint.apr === null ? "—" : formatPercent(activePoint.apr), label: "APR", color: "var(--viz-grid)" },
              { id: "inflation", value: activePoint.inflation === null ? "—" : formatPercent(activePoint.inflation), label: "Inflation", color: "var(--viz-grid)" },
            ]}
            footer={active?.source === "keyboard" ? "Enter opens its page" : active?.source === "mouse" ? "Click to open its page" : "Tap it again to open its page"}
          />
        ) : null}
        <div className="viz-sr" aria-live="polite" aria-atomic="true">
          {active?.source === "keyboard" && activePoint
            ? `${activePoint.name}: real yield ${signed(activePoint.realYield)}, ${formatPercent(activePoint.staked, { digits: 1 })} of supply staked${activePoint.followed ? ", followed" : ""}.`
            : ""}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ reading */

function Reading({ reading }: { reading: MapReading }) {
  const names = reading.diluting.slice(0, 3).map((p) => `${p.name} ${signed(p.realYield)}`);
  const more = reading.diluting.length - names.length;
  return (
    <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-[var(--d-hairline)] lg:pl-6">
      <ReadingItem
        label="Median real yield"
        value={reading.median === null ? "—" : signed(reading.median)}
        tone={reading.median !== null && reading.median < 0 ? "neg" : undefined}
        detail={`Across ${reading.count} chains on the map`}
      />
      <ReadingItem
        label="Stakers diluted"
        value={String(reading.diluting.length)}
        tone={reading.diluting.length > 0 ? "neg" : undefined}
        detail={
          reading.diluting.length > 0
            ? `${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}: issuance below inflation`
            : "Every chain here pays stakers more than its inflation"
        }
      />
      <ReadingItem
        className="max-sm:col-span-2"
        label="Pattern"
        value={
          reading.link === "inverse"
            ? "Less staked, more yield"
            : reading.link === "same"
              ? "More staked, more yield"
              : reading.link === "none"
                ? "No clear link"
                : "Too few chains"
        }
        small
        detail={
          reading.rho !== null
            ? `Rank correlation ${reading.rho.toFixed(2).replace("-", "\u2212")} between staked share and real yield (−1 to 1)`
            : "Needs five chains with both figures"
        }
      />
    </dl>
  );
}

function ReadingItem({
  label,
  value,
  detail,
  tone,
  small,
  className,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neg";
  small?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="d-label">{label}</dt>
      <dd
        className={cn(
          "mt-1.5 font-semibold leading-tight tracking-[-0.02em] tabular-nums",
          small ? "text-[15px]" : "text-[22px]",
          tone === "neg" ? "text-[var(--d-neg)]" : "text-fg",
        )}
      >
        {value}
      </dd>
      <dd className="mt-1 text-[12.5px] leading-snug text-fg-dim">{detail}</dd>
    </div>
  );
}
