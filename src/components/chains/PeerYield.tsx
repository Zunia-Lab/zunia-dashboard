"use client";

/**
 * "How does this chain's real yield compare?" A diverging bar per chain
 * (the chain on the page and the user's followed mainnets), zero in the
 * middle: right of it staking grows your share of supply, left of it even
 * stakers are diluted. The page's chain wears the accent; the others are
 * context grey. Values are printed, signed and toned, so neither colour nor
 * bar length carries the figure alone.
 */

import Link from "next/link";
import { ChainLogo } from "@/components/ui";
import type { ChainStats } from "@/lib/chain/types";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { RealYieldText } from "./cells";

interface PeerYieldProps {
  chainId: string;
  /** Stats of the chain on the page and its peers (any order). */
  peers: readonly ChainStats[];
  className?: string;
}

export function PeerYield({ chainId, peers, className }: PeerYieldProps) {
  const rows = peers
    .filter((s) => s.realYield !== null && Number.isFinite(s.realYield))
    .sort((a, b) => (b.realYield as number) - (a.realYield as number));
  if (rows.length < 2 || !rows.some((s) => s.chainId === chainId)) return null;

  const max = Math.max(...rows.map((s) => Math.abs(s.realYield as number)), 0.0001);
  const hasNegative = rows.some((s) => (s.realYield as number) < 0);
  const hasPositive = rows.some((s) => (s.realYield as number) > 0);
  // Zero sits where the data needs it: centred when values go both ways,
  // at the edge when they all share a sign.
  const zero = hasNegative && hasPositive ? 50 : hasNegative ? 100 : 0;
  const span = hasNegative && hasPositive ? 50 : 100;
  const rank = rows.findIndex((s) => s.chainId === chainId) + 1;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="d-label">Real yield vs your chains</p>
        <p className="text-[12px] text-fg-dim">
          {rank === 1 ? "Highest" : `#${rank}`} of {rows.length}
        </p>
      </div>
      <ul className="flex flex-col gap-1.5" aria-label="Real yield of this chain and your followed mainnets">
        {rows.map((s) => {
          const value = s.realYield as number;
          const self = s.chainId === chainId;
          const width = `${Math.max(1, (Math.abs(value) / max) * span)}%`;
          // Negative values grow left from zero, positive ones right.
          const bar = value < 0 ? { right: `${100 - zero}%`, width } : { left: `${zero}%`, width };
          return (
            <li key={s.chainId} className="grid grid-cols-[minmax(0,7.5rem)_1fr_4.25rem] items-center gap-2.5 text-[12.5px]">
              <span className={cn("flex min-w-0 items-center gap-1.5", self ? "font-medium text-fg" : "text-fg-muted")}>
                <ChainLogo chainId={s.chainId} size={16} />
                {self ? (
                  <span className="truncate">{s.chainName}</span>
                ) : (
                  <Link href={`/chains/${encodeURIComponent(s.chainId)}`} className="truncate hover:text-fg hover:underline hover:underline-offset-[3px]">
                    {s.chainName}
                  </Link>
                )}
              </span>
              <span className="relative h-2 rounded-full bg-[var(--d-glass)]" aria-hidden>
                <span className="absolute inset-y-[-3px] w-px bg-[var(--viz-axis)]" style={{ left: `${zero}%` }} />
                <span
                  className={cn("absolute inset-y-0 rounded-full", self ? "bg-[var(--viz-accent)]" : "bg-[var(--viz-other)]")}
                  style={bar}
                />
              </span>
              <span className="text-right tabular-nums" title={formatPercent(value * 100, { signed: true })}>
                <RealYieldText value={value} className={self ? "" : "font-normal"} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
