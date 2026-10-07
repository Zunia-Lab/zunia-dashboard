"use client";

/**
 * Small figures the chain pages share: a chain's identity with its live
 * status, the APR with its provenance, real yield, and the honest dash.
 *
 * Every unknown renders "—" with the server's reason on hover and for screen
 * readers (the house rule), and a figure from a third party says so.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, ChainLogo, Skeleton, Tooltip } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import type { ChainStats, ChainStatsField } from "@/lib/chain/types";
import { cn } from "@/lib/cn";
import { NO_VALUE, formatPercent } from "@/lib/format";
import { firstReason, statsUnreadable, toPct } from "./model";

/** "—" that says why: on hover, and to screen readers. */
export function Dash({ reason, className }: { reason?: string | null; className?: string }) {
  return (
    <span className={cn("text-fg-dim", className)} title={reason ?? undefined}>
      <span aria-hidden>{NO_VALUE}</span>
      <span className="sr-only">{reason ? `Unavailable: ${reason}` : "Unavailable"}</span>
    </span>
  );
}

/** A table-cell placeholder while a row's stats load. */
export function CellSkeleton({ width = 40, align = "right" }: { width?: number; align?: "left" | "right" }) {
  return (
    <span className={cn("flex", align === "right" ? "justify-end" : "justify-start")}>
      <Skeleton className="h-3" width={width} />
    </span>
  );
}

/** Why a stats field is null, from the answer's `reasons` (falls back to a generic line). */
export function reasonOf(stats: ChainStats | null, field: ChainStatsField, fallback = "Not published by this chain"): string {
  return stats?.reasons?.[field] ?? fallback;
}

/* ------------------------------------------------------------------ status */

export type LiveStatus = "producing" | "halted" | "unknown";

export function liveStatus(stats: ChainStats | null): LiveStatus {
  if (!stats || stats.halted === null) return "unknown";
  return stats.halted ? "halted" : "producing";
}

export const STATUS_TEXT: Record<LiveStatus, string> = {
  producing: "Producing blocks",
  halted: "Halted or node stalled",
  unknown: "Status unknown",
};

/* ------------------------------------------------------------------ identity */

interface ChainIdentityProps {
  chain: ChainEntry;
  stats: ChainStats | null;
  /** Make the name a link (to the chain's page). */
  href?: string;
  /** Stretch the link over the nearest positioned ancestor (phone cards). */
  stretch?: boolean;
  size?: number;
  /** Trailing line after the chain id, e.g. the ticker. */
  meta?: ReactNode;
  className?: string;
}

/**
 * Logo with a live dot (green when blocks are coming, red when the chain or
 * its public node has stopped), the name and the chain id. The dot is never
 * alone: a stopped chain also gets a "Halted" badge, and the state is in the
 * accessible name.
 */
export function ChainIdentity({ chain, stats, href, stretch, size = 28, meta, className }: ChainIdentityProps) {
  const status = liveStatus(stats);
  // Nothing about the chain could be read: say it once on the name rather
  // than leave a row of unexplained dashes.
  const unreachable = stats && statsUnreadable(stats) ? (firstReason(stats) ?? "Its public node is not answering") : null;
  const name = href ? (
    <Link
      href={href}
      className={cn(
        "truncate font-medium text-fg underline-offset-[3px] hover:underline focus-visible:outline-offset-1",
        stretch && "after:absolute after:inset-0 after:content-['']",
      )}
    >
      {chain.chainName}
    </Link>
  ) : (
    <span className="truncate font-medium text-fg">{chain.chainName}</span>
  );
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span className="relative inline-flex shrink-0">
        <ChainLogo chainId={chain.chainId} size={size} />
        {status !== "unknown" ? (
          <span
            aria-hidden
            title={STATUS_TEXT[status]}
            className={cn(
              "absolute -bottom-px -right-px size-2.5 rounded-full shadow-[0_0_0_2px_var(--d-table-bg,var(--d-card))]",
              status === "producing" ? "bg-[var(--z-success)]" : "bg-[var(--z-danger)]",
            )}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1.5 text-[14px]">
          {name}
          {status === "halted" ? (
            <Badge tone="danger" size="sm" className="shrink-0">
              Halted
            </Badge>
          ) : unreachable ? (
            <Badge tone="neutral" size="sm" className="shrink-0" title={unreachable}>
              Unreachable
            </Badge>
          ) : null}
          <span className="sr-only">, {STATUS_TEXT[status]}</span>
        </span>
        {/* The ticker in the id's own dim, not fainter: fg-faint at 11.5px
            fell to ~3.2:1 on a dark card (2.8:1 in light), under AA. */}
        <span className="mt-0.5 truncate font-mono text-[11.5px] tracking-[-0.01em] text-fg-dim">
          {chain.chainId}
          {meta ? <> · {meta}</> : null}
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ yields */

/** Actual APR, the naive one on hover, and a "3P" tag when cosmos.directory supplied it. */
export function AprText({ stats, className }: { stats: ChainStats; className?: string }) {
  const { apr } = stats;
  if (apr.actual === null) return <Dash reason={apr.note ?? reasonOf(stats, "apr")} className={className} />;
  const naive = apr.naive !== null && Math.abs(apr.naive - apr.actual) > 1e-6 ? `Naive ${formatPercent(toPct(apr.naive))}` : null;
  const title = [naive, apr.note, apr.method ? `Method: ${apr.method}` : null].filter(Boolean).join(" · ");
  return (
    <span className={cn("inline-flex items-center justify-end gap-1", className)} title={title || undefined}>
      {apr.source === "cosmos.directory" ? (
        <Tooltip content="Third-party figure from cosmos.directory: this chain publishes no mint data we can read">
          <span className="rounded-[4px] bg-[var(--d-glass-2)] px-1 font-mono text-[10px] font-medium leading-[16px] text-fg-muted">3P</span>
        </Tooltip>
      ) : null}
      <span>{formatPercent(toPct(apr.actual))}</span>
    </span>
  );
}

/**
 * Real yield (APR − actual inflation), signed and toned: positive means
 * stakers gain share of supply, negative means even stakers are diluted.
 * Words for screen readers, not only colour.
 */
export function RealYieldText({ value, reason, className }: { value: number | null; reason?: string; className?: string }) {
  if (value === null || !Number.isFinite(value)) return <Dash reason={reason} className={className} />;
  const pct = value * 100;
  const tone = pct > 0.005 ? "text-[var(--d-pos)]" : pct < -0.005 ? "text-[var(--d-neg)]" : "text-fg-muted";
  const text = formatPercent(pct, { signed: true });
  return (
    <span className={cn("font-medium", tone, className)}>
      <span aria-hidden>{text}</span>
      <span className="sr-only">{pct >= 0 ? `gain of ${formatPercent(pct)}` : `loss of ${formatPercent(-pct)}`}</span>
    </span>
  );
}
