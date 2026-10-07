"use client";

/**
 * The strip above the Assets page, four figures: total value with its 24 h
 * move, how many assets (on how many chains, how many without a price),
 * the largest position's weight, and the day's best and worst mover.
 *
 * Four, not five: "without a price" lives in the Assets tile (as on
 * Overview), so the strip stays one row from a 1280 px laptop with the full
 * sidebar up, and makes a 2 × 2 block on a tablet. It sizes on its own
 * width (container queries), not the viewport's, so a collapsed sidebar
 * gets the wide layout too. Phones give the total and the movers a full row.
 */

import { AssetLogo, Delta, Dot, Money, Percent, StatTile } from "@/components/ui";
import { cn } from "@/lib/cn";
import { UNPRICED_TEXT } from "@/lib/token/wire";
import { SMALL_VALUE, floorText, type HoldingsSummary, type Mover } from "./holdings";

export interface AssetsSummaryProps {
  summary: HoldingsSummary | null;
  currency: string;
  loading: boolean;
  /**
   * Single-chain scope only: this chain's share (percent) of the wallet's
   * priced value across every followed chain; null while that is unknown.
   */
  scopeShare?: number | null;
  /** The figures belong to the previous scope or currency while the new read lands. */
  stale?: boolean;
  /** The viewer's small-balance floor: best and worst only rank positions worth at least this. */
  floor?: number;
}

function MoverLine({ mover, side, floorLabel }: { mover: Mover | null; side: "best" | "worst"; floorLabel: string }) {
  if (!mover) {
    return (
      <span className="flex h-[22px] items-center text-[12.5px] font-normal tracking-normal text-fg-dim">
        <span className="truncate">
          Nothing over {floorLabel} {side === "best" ? "rose" : "fell"}
        </span>
      </span>
    );
  }
  return (
    <span className="flex h-[22px] min-w-0 items-center gap-2">
      <AssetLogo src={mover.identity.logoUrl} symbol={mover.identity.ticker} size={18} />
      <span className="min-w-0 truncate text-[15px] font-medium tracking-[-0.01em] text-fg">{mover.identity.ticker}</span>
      <Delta value={mover.change} size="md" className="ml-auto" />
    </span>
  );
}

export function AssetsSummary({ summary, currency, loading, scopeShare, stale, floor = SMALL_VALUE }: AssetsSummaryProps) {
  const pending = loading || !summary;
  const unpriced = summary?.unpricedCount ?? 0;
  const floorLabel = floorText(floor, currency);

  const assetsInfo = (
    <span className="flex max-w-[280px] flex-col gap-1.5 text-[12.5px] leading-snug text-fg-muted">
      <span>An asset held on several chains (ATOM on the Hub and on Osmosis) counts once; each chain&apos;s balance is a holding.</span>
      {summary && summary.unpricedReasons.length > 0 ? (
        <>
          <span>
            Without a price: shown in native units and left out of every total
            {summary.unlistedCount > 0 ? ` (${summary.unlistedCount} of them unlisted, folded away in the table)` : ""}.
          </span>
          {summary.unpricedReasons.map((entry) => (
            <span key={entry.reason}>
              <span className="tabular-nums text-fg">{entry.count}</span> · {UNPRICED_TEXT[entry.reason]}
            </span>
          ))}
        </>
      ) : null}
    </span>
  );

  return (
    <section aria-label="Key figures" className="@container">
      <div
        aria-busy={stale || undefined}
        className={cn("grid grid-cols-2 gap-[var(--d-gap)] transition-opacity duration-[160ms] @[820px]:grid-cols-4", stale && "opacity-60")}
      >
        <StatTile
          className="col-span-2 @[600px]:col-span-1"
          label="Total value"
          icon="wallet"
          tone="accent"
          loading={pending}
          value={<Money value={summary?.value} currency={currency} animate reason="Nothing held here has a price" />}
          delta={summary ? { value: summary.change24hPct, kind: "pct", period: "24h" } : undefined}
          sub={
            summary ? (
              scopeShare !== undefined ? (
                <span>
                  <Percent value={scopeShare} digits={1} reason="Your other chains are still loading" /> of your total
                </span>
              ) : (
                <Delta value={summary.change24hAbs} kind="abs" currency={currency} />
              )
            ) : undefined
          }
          info="Priced holdings only (liquid, staked, rewards and unbonding). The 24 h change is today's amounts valued at yesterday's and today's prices."
        />
        <StatTile
          label="Assets"
          icon="assets"
          loading={pending}
          value={
            <span className="tabular-nums">
              {summary?.assetCount ?? 0}
              {summary ? (
                <span className="ml-1.5 text-[14px] font-medium tracking-normal text-fg-dim">
                  on {summary.chainCount} {summary.chainCount === 1 ? "chain" : "chains"}
                </span>
              ) : null}
            </span>
          }
          sub={
            summary ? (
              unpriced > 0 ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Dot tone="warning" />
                  <span className="truncate">{unpriced} without a price</span>
                </span>
              ) : (
                `all priced · ${summary.holdingCount} ${summary.holdingCount === 1 ? "holding" : "holdings"}`
              )
            ) : undefined
          }
          info={assetsInfo}
        />
        <StatTile
          label="Top position"
          icon="markets"
          loading={pending}
          value={
            summary?.largest ? (
              <span className="flex min-w-0 items-center gap-2">
                <AssetLogo src={summary.largest.group.identity.logoUrl} symbol={summary.largest.group.identity.ticker} size={22} />
                <span className="truncate">{summary.largest.group.identity.ticker}</span>
              </span>
            ) : (
              <span className="text-fg-dim">—</span>
            )
          }
          sub={
            summary?.largest ? (
              <span>
                <Percent value={summary.largest.share} digits={1} className="font-medium text-fg-muted" /> of total ·{" "}
                {/* Cents, as the holdings table prints the same position. */}
                <Money value={summary.largest.group.value} currency={currency} compact precision={2} />
              </span>
            ) : (
              "no priced position"
            )
          }
          info="Share of the priced value of this scope; the Allocation card shows the rest and how concentrated it is."
        />
        <StatTile
          className="col-span-2 @[600px]:col-span-1"
          label="Best / worst 24h"
          icon="trendingUp"
          loading={pending}
          value={
            <span className="flex flex-col gap-1.5 pt-0.5">
              <MoverLine mover={summary?.best ?? null} side="best" floorLabel={floorLabel} />
              <MoverLine mover={summary?.worst ?? null} side="worst" floorLabel={floorLabel} />
            </span>
          }
          info={`Price change over 24 h among positions worth at least ${floorLabel}: dust that tripled is noise, not news.`}
        />
      </div>
    </section>
  );
}