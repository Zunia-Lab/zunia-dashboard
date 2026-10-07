"use client";

/**
 * Voting-power concentration: the cumulative share of voting power held by
 * the top N validators (a Lorenz-style curve), against the line an even
 * split would draw. The ⅓ line is where a group can halt the chain (the
 * Nakamoto coefficient is where the curve crosses it) and ⅔ is where a group
 * can push blocks through alone. Your validators sit on the curve as dots,
 * so "is my stake adding to the top?" reads at a glance.
 *
 * Drawn in SVG over the measured width (kit `useChartSize`); hover, touch
 * and arrow keys move a crosshair with the kit tooltip.
 */

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartTooltip, useChartSize } from "@/components/charts";
import { formatPercent } from "@/lib/format";

export interface ConcentrationRow {
  rank: number;
  moniker: string;
  operatorAddress: string;
  votingPower: number;
  cumulative: number;
}

export interface ConcentrationChartProps {
  rows: ConcentrationRow[];
  /** Operators you delegate to. */
  mine?: ReadonlySet<string>;
  nakamoto: number | null;
  height?: number;
  chainName: string;
}

const M = { top: 14, right: 14, bottom: 26, left: 40 };
const THIRD = 1 / 3;
const TWO_THIRDS = 2 / 3;

const pct = (fraction: number, digits = 1) => formatPercent(fraction * 100, { digits });

export function ConcentrationChart({ rows, mine, nakamoto, height = 232, chainName }: ConcentrationChartProps) {
  const [ref, size] = useChartSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const washId = `vp-wash-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const n = rows.length;
  const width = size.width;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const x = (rank: number) => M.left + (n > 0 ? (rank / n) * plotW : 0);
  const y = (share: number) => M.top + (1 - share) * plotH;

  const line = n > 0 ? `M${x(0)},${y(0)}` + rows.map((row) => `L${x(row.rank).toFixed(1)},${y(row.cumulative).toFixed(1)}`).join("") : "";
  const area = n > 0 ? `${line}L${x(n).toFixed(1)},${y(0)}Z` : "";
  const crossing = nakamoto !== null ? rows.find((row) => row.rank === nakamoto) : undefined;

  const pick = (clientX: number, target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    const rank = Math.round(((clientX - box.left - M.left) / Math.max(1, plotW)) * n);
    setActive(Math.min(n, Math.max(1, rank)));
  };
  const onPointer = (event: PointerEvent<HTMLDivElement>) => pick(event.clientX, event.currentTarget);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowRight") setActive((current) => Math.min(n, (current ?? 0) + step));
    else if (event.key === "ArrowLeft") setActive((current) => Math.max(1, (current ?? 2) - step));
    else if (event.key === "Home") setActive(1);
    else if (event.key === "End") setActive(n);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  };

  const activeRow = active !== null ? rows[active - 1] : undefined;
  const xTicks = n > 0 ? Array.from(new Set([1, Math.max(1, Math.round(n / 4)), Math.round(n / 2), Math.round((3 * n) / 4), n])).filter((r) => r >= 1) : [];
  const summary =
    n > 0
      ? `${chainName}: the largest ${nakamoto ?? "?"} of ${n} validators hold over a third of voting power; the top 10 hold ${
          rows[Math.min(9, n - 1)] ? pct(rows[Math.min(9, n - 1)]!.cumulative) : "unknown"
        }.`
      : "No validators to chart.";

  return (
    <div className="viz-frame" style={{ height }} ref={ref}>
      <div
        className="viz-plot"
        role="img"
        aria-label={summary}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {width > 0 && n > 0 ? (
          <svg width={width} height={height} aria-hidden>
            <defs>
              <linearGradient id={washId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--viz-accent)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--viz-accent)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {/* Grid and thresholds */}
            {[0, THIRD, TWO_THIRDS, 1].map((share) => (
              <g key={share}>
                <line
                  x1={M.left}
                  x2={M.left + plotW}
                  y1={Math.round(y(share)) + 0.5}
                  y2={Math.round(y(share)) + 0.5}
                  style={{ stroke: share === THIRD || share === TWO_THIRDS ? "var(--viz-axis)" : "var(--viz-grid)" }}
                  strokeDasharray={share === THIRD || share === TWO_THIRDS ? "3 4" : undefined}
                />
                <text className="viz-tick" x={M.left - 8} y={y(share)} dy="0.34em" textAnchor="end">
                  {share === THIRD ? "33%" : share === TWO_THIRDS ? "67%" : pct(share, 0)}
                </text>
              </g>
            ))}
            <text className="viz-axis-caption" x={M.left + plotW - 2} y={y(THIRD) - 6} textAnchor="end">
              ⅓ can halt the chain
            </text>
            <text className="viz-axis-caption" x={M.left + plotW - 2} y={y(TWO_THIRDS) - 6} textAnchor="end">
              ⅔ can run it alone
            </text>
            {/* Even split reference */}
            <line x1={x(0)} y1={y(0)} x2={x(n)} y2={y(1)} style={{ stroke: "var(--viz-other)" }} strokeDasharray="2 5" strokeWidth={1.5} />
            {/* Curve */}
            <path d={area} fill={`url(#${washId})`} />
            <path d={line} fill="none" style={{ stroke: "var(--viz-accent)" }} strokeWidth={2} strokeLinejoin="round" />
            {/* Nakamoto crossing */}
            {crossing ? (
              <g>
                <line
                  x1={x(crossing.rank)}
                  x2={x(crossing.rank)}
                  y1={y(0)}
                  y2={y(crossing.cumulative)}
                  style={{ stroke: "var(--viz-warn)" }}
                  strokeWidth={1.5}
                />
                <circle cx={x(crossing.rank)} cy={y(crossing.cumulative)} r={4.5} style={{ fill: "var(--viz-warn)", stroke: "var(--viz-surface)" }} strokeWidth={2} />
                <text
                  className="viz-axis-caption"
                  x={x(crossing.rank) + 7}
                  y={y(crossing.cumulative) + 14}
                  style={{ fill: "var(--viz-text-strong)" }}
                >
                  Nakamoto {crossing.rank}
                </text>
              </g>
            ) : null}
            {/* Your validators */}
            {mine && mine.size > 0
              ? rows
                  .filter((row) => mine.has(row.operatorAddress))
                  .map((row) => (
                    <circle
                      key={row.operatorAddress}
                      cx={x(row.rank)}
                      cy={y(row.cumulative)}
                      r={5}
                      style={{ fill: "var(--viz-2)", stroke: "var(--viz-surface)" }}
                      strokeWidth={2}
                    />
                  ))
              : null}
            {/* X ticks */}
            {xTicks.map((rank) => (
              <text key={rank} className="viz-tick" x={x(rank)} y={height - 8} textAnchor={rank === n ? "end" : rank === 1 ? "start" : "middle"}>
                #{rank}
              </text>
            ))}
            {/* Crosshair */}
            {activeRow ? (
              <g>
                <line x1={x(activeRow.rank)} x2={x(activeRow.rank)} y1={M.top} y2={y(0)} style={{ stroke: "var(--viz-axis)" }} strokeWidth={1} />
                <circle cx={x(activeRow.rank)} cy={y(activeRow.cumulative)} r={4} style={{ fill: "var(--viz-accent)", stroke: "var(--viz-surface)" }} strokeWidth={2} />
              </g>
            ) : null}
          </svg>
        ) : null}
        <ChartTooltip
          anchor={activeRow ? { x: x(activeRow.rank), y: y(activeRow.cumulative) } : null}
          bounds={{ width, height }}
          title={activeRow ? `Top ${activeRow.rank} of ${n}` : undefined}
          rows={
            activeRow
              ? [
                  { id: "cum", value: pct(activeRow.cumulative), label: "of voting power together", color: "var(--viz-accent)" },
                  {
                    id: "one",
                    value: pct(activeRow.votingPower, 2),
                    label: `#${activeRow.rank} ${activeRow.moniker}${mine?.has(activeRow.operatorAddress) ? " (yours)" : ""}`,
                    color: mine?.has(activeRow.operatorAddress) ? "var(--viz-2)" : "var(--viz-other)",
                  },
                ]
              : undefined
          }
        />
      </div>
    </div>
  );
}
