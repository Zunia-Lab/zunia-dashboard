"use client";

/**
 * The live preview's frame without its data: what paints while the preview
 * code and its first answers are on their way.
 *
 * Shared by the lazy island's fallback and by the preview itself (first
 * load), so both draw the same boxes at the same heights and the swap to real
 * numbers moves nothing on the page.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Card, CardFooter, CardHeader, RelativeTime, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import styles from "./landing.module.css";

/** Height of one asset row, px (the skeleton and the real row share it). */
export const ASSET_ROW_H = 52;
/** The 7-day sparkline's height, px: it shares its column with the 7-day figure. */
export const SPARK_H = 24;
/**
 * The row's two figure columns, shared with the skeleton so nothing moves
 * when the numbers land. The 7-day column goes from the narrowest phones,
 * where the name and the price need its width.
 */
export const SPARK_COLUMN = "flex w-[88px] shrink-0 flex-col items-center gap-1 max-[379px]:hidden";
export const PRICE_COLUMN = "flex w-[92px] shrink-0 flex-col items-end gap-1";
/** BarList's own row height, px. */
export const BAR_ROW_H = 34;
export const PREVIEW_ROWS = 5;

/** One column beside the copy (≥1280), side by side under it from 768, stacked on phones. */
export const PREVIEW_STACK = "grid gap-3 md:grid-cols-2 xl:grid-cols-1";

/** The cards' shared surface: the kit card, lifted off the animated backdrop. */
export const PREVIEW_CARD = "shadow-[0_24px_60px_-28px_rgba(0,0,0,0.55)] [.zunia-light_&]:shadow-[0_24px_60px_-30px_rgba(17,17,17,0.22)]";

/** The market card's footer before any source has answered. */
export const MARKETS_LOADING = "Reading Numia and Coinstore…";
export const APR_SOURCE = "Chain LCDs · observed block times";
export const APR_SOURCE_THIRD_PARTY = "Chain LCDs + cosmos.directory (third-party)";

/**
 * Where a card's numbers come from and how old the stalest one is, in the
 * kit's SourceTag voice (mono, dim). Plain wrapping text rather than the
 * SourceTag chip: the market line names two sources and has to wrap
 * gracefully when the cards sit side by side. The skeleton prints the same
 * line, so the footers keep their height when the numbers land.
 */
export function Provenance({ source, at }: { source: string; at: number | null }) {
  return (
    <p className="min-w-0 font-mono text-[11px] leading-[1.5] tracking-[0.02em] text-fg-dim">
      {source}
      {at ? (
        <>
          {" · "}
          <RelativeTime at={at} />
        </>
      ) : null}
    </p>
  );
}

export function CompareChainsLink() {
  return (
    <Link href="/chains" className="d-hit inline-flex items-center gap-1 text-[12.5px] font-medium text-fg-muted transition-colors duration-[160ms] hover:text-fg">
      Compare chains
      <Icon name="arrowRight" size={13} />
    </Link>
  );
}

/** What the market card's title dot says about the numbers under it. */
export type LiveState = "live" | "loading" | "error";

/**
 * The market card's title and its status dot. Green and pulsing only while
 * real rows are on the card; a still, neutral dot while they load; a still
 * amber one, with the words for screen readers, when the read failed. A
 * "live" pulse beside skeletons or beside "Market data didn't load"
 * promised numbers that were not there.
 */
export function LiveTitle({ state, children }: { state: LiveState; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {state === "live" ? (
        <span aria-hidden className={styles.pulse} />
      ) : (
        <span
          aria-hidden
          className={cn("inline-flex size-2 shrink-0 rounded-full", state === "error" ? "bg-[var(--z-warning)]" : "bg-[var(--z-fg-faint)]")}
        />
      )}
      {children}
      {state === "error" ? <span className="sr-only">, data unavailable</span> : null}
    </span>
  );
}

export function AssetRowsSkeleton() {
  return (
    <ul aria-hidden className="-mx-2 flex flex-col">
      {Array.from({ length: PREVIEW_ROWS }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-2" style={{ height: ASSET_ROW_H }}>
          <Skeleton circle width={30} />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3" width={48} />
            <Skeleton className="h-2.5" width={72} />
          </span>
          {/* The 7-day line over its figure, then price over the 24 h change:
              the real row's columns, at their widths. */}
          <span className={SPARK_COLUMN}>
            <Skeleton width={88} height={SPARK_H} />
            <Skeleton className="h-2.5" width={52} />
          </span>
          <span className={PRICE_COLUMN}>
            <Skeleton className="h-3" width={56} />
            <Skeleton className="h-2.5" width={40} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AprRowsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: PREVIEW_ROWS }, (_, index) => (
        <div key={index} className="flex items-center gap-3" style={{ height: BAR_ROW_H }}>
          <Skeleton circle width={18} />
          <Skeleton className="h-2.5" width={76} />
          <Skeleton className="h-2.5 flex-1" style={{ maxWidth: `${88 - index * 13}%` }} />
          <Skeleton className="h-2.5" width={36} />
        </div>
      ))}
    </div>
  );
}

/** Both cards, empty, at their final size. */
export function LivePreviewSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(PREVIEW_STACK, className)} role="status" aria-label="Loading live market data">
      <Card className={PREVIEW_CARD}>
        <CardHeader title={<LiveTitle state="loading">Live across Cosmos</LiveTitle>} subtitle="Price, 24 h change and 7-day trend" />
        <AssetRowsSkeleton />
        <CardFooter className="justify-between gap-y-1">
          <Provenance source={MARKETS_LOADING} at={null} />
        </CardFooter>
      </Card>
      <Card className={PREVIEW_CARD}>
        <CardHeader title="Staking APR, actual" subtitle="Before commission, at observed block times" />
        <AprRowsSkeleton />
        <div className="min-h-[38px]">
          <Skeleton className="h-2.5" width="92%" />
          <Skeleton className="mt-2 h-2.5" width="64%" />
        </div>
        <CardFooter className="justify-between gap-y-1">
          <Provenance source={APR_SOURCE} at={null} />
          <CompareChainsLink />
        </CardFooter>
      </Card>
    </div>
  );
}
