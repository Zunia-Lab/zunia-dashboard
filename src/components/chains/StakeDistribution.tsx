"use client";

/**
 * How concentrated a chain's stake is, in one bar: the ten largest
 * validators as segments (largest first), everyone else as one grey block,
 * and hairlines at one third (enough stake to halt the chain) and two thirds
 * (enough to finalise blocks alone). The validators it takes to cross the
 * first line — the Nakamoto set — wear the accent, so "6 validators can halt
 * this chain" is something you see, not only read.
 *
 * Decorative geometry over real shares; the figures are in the summary
 * (aria-label) and in the legend under the bar.
 */

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatShare } from "@/components/charts";

export interface StakeSegment {
  id: string;
  label: string;
  /** Share of bonded stake, 0..1. */
  share: number;
}

interface StakeDistributionProps {
  /** The largest validators, largest first. */
  top: readonly StakeSegment[];
  /** Share held by everyone else, 0..1. */
  othersShare: number;
  /** Nakamoto coefficient from the server (it sees the whole set). */
  nakamoto: number | null;
  className?: string;
}

const HALT = 1 / 3;
const CONTROL = 2 / 3;

export function StakeDistribution({ top, othersShare, nakamoto, className }: StakeDistributionProps) {
  const [active, setActive] = useState<string | null>(null);
  const total = top.reduce((sum, s) => sum + s.share, 0) + Math.max(0, othersShare);
  if (!(total > 0)) return null;
  const scale = (share: number) => (share / total) * 100;

  // Segments inside the Nakamoto set: the server's count when it has one
  // (it sees every validator), else where the running share crosses 1/3.
  let crossing = top.length;
  let running = 0;
  for (let i = 0; i < top.length; i += 1) {
    running += top[i]!.share;
    if (running > HALT) {
      crossing = i + 1;
      break;
    }
  }
  const inSet = Math.min(top.length, nakamoto ?? crossing);
  const setShare = top.slice(0, inSet).reduce((sum, s) => sum + s.share, 0);
  const hovered = top.find((s) => s.id === active) ?? (active === "others" ? { id: "others", label: "Everyone else", share: othersShare } : null);

  const summary =
    `Stake distribution: the largest validator holds ${formatShare(top[0]?.share ?? 0)}, the ten largest ${formatShare(top.reduce((s, x) => s + x.share, 0))}.` +
    (nakamoto !== null ? ` ${nakamoto} validators together pass one third of the stake.` : "");

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative pt-5">
        {/* Threshold labels sit above the track, at their share. */}
        <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-dim" style={{ left: `${HALT * 100}%` }}>
          ⅓ halt
        </span>
        <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-dim" style={{ left: `${CONTROL * 100}%` }}>
          ⅔ control
        </span>
        <div role="img" aria-label={summary} className="relative flex h-6 w-full overflow-hidden rounded-[6px]">
          {top.map((segment, index) => (
            <span
              key={segment.id}
              onPointerEnter={() => setActive(segment.id)}
              onPointerLeave={() => setActive(null)}
              className={cn(
                "h-full shrink-0 border-r-2 border-[var(--d-card)] transition-opacity duration-[160ms]",
                index < inSet ? "bg-[var(--viz-accent)]" : "bg-[color-mix(in_srgb,var(--viz-other)_70%,transparent)]",
              )}
              // Inside the set each step is a shade lighter, so neighbours
              // read as separate validators; hovering one dims the rest.
              style={{
                width: `${scale(segment.share)}%`,
                opacity: active && active !== segment.id ? 0.4 : index < inSet ? 1 - index * 0.07 : 1,
              }}
            />
          ))}
          {othersShare > 0 ? (
            <span
              onPointerEnter={() => setActive("others")}
              onPointerLeave={() => setActive(null)}
              className={cn("h-full flex-1 bg-[var(--d-glass-2)] transition-opacity duration-[160ms]", active && active !== "others" && "opacity-50")}
            />
          ) : null}
          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-[var(--z-fg)] opacity-70" style={{ left: `${HALT * 100}%` }} />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-[var(--z-fg)] opacity-40" style={{ left: `${CONTROL * 100}%` }} />
        </div>
      </div>
      <div className="flex min-h-[20px] flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-dim">
        {hovered ? (
          <span className="text-fg-muted">
            <span className="font-medium text-fg">{hovered.label}</span> · {formatShare(hovered.share)} of stake
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--viz-accent)]" />
              {nakamoto !== null ? `${nakamoto} largest` : `${inSet} largest`} · {formatShare(setShare)}
              {nakamoto !== null && nakamoto > top.length ? ` (top ${top.length} shown)` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[color-mix(in_srgb,var(--viz-other)_70%,transparent)]" />
              Rest of top {top.length}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--d-glass-2)] ring-1 ring-inset ring-[var(--d-hairline-strong)]" />
              Everyone else · {formatShare(othersShare)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
