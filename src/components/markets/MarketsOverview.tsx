"use client";

/**
 * Above the Markets table: the strip (Cosmos market cap, Osmosis liquidity,
 * 24 h volume, breadth, top movers, SAF) and the analysis row (how many
 * assets moved how much today; where Osmosis liquidity sits).
 */

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { BarChart, BarList, Swatch, VIZ_NEG, VIZ_NEUTRAL, VIZ_POS, type BarDatum, type TickFormatter } from "@/components/charts";
import { Icon } from "@/components/icons";
import { AssetLogo, Card, CardHeader, Delta, Money, StatTile } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatFiat, formatPercent } from "@/lib/format";
import type { MarketAsset, MarketsResponse } from "@/lib/token/wire";
import { assetHref } from "@/components/assets/links";
import { changeBuckets, liquidityLeaders, MOVER_FLOOR, type MarketSummary } from "./markets";

const SAF_KEY = "safrochain-1:usaf";

function MoverLine({ asset, side }: { asset: MarketAsset | null; side: "best" | "worst" }) {
  if (!asset) {
    return (
      <span className="flex h-[22px] items-center text-[12.5px] font-normal tracking-normal text-fg-dim">
        {side === "best" ? "Nothing rose" : "Nothing fell"}
      </span>
    );
  }
  return (
    <span className="flex h-[22px] min-w-0 items-center gap-2">
      <AssetLogo src={asset.logoUrl} symbol={asset.symbol} size={18} />
      <span className="min-w-0 truncate text-[15px] font-medium tracking-[-0.01em]">{asset.symbol}</span>
      <Delta value={asset.change24h} size="md" className="ml-auto" />
    </span>
  );
}

export interface MarketsStripProps {
  data: MarketsResponse | null;
  summary: MarketSummary | null;
  loading: boolean;
  /** Figures from the previous currency while the new read lands. */
  stale?: boolean;
}

/** Which market sources answered the last read (`numia` for Osmosis, `coinstore` for SAF). */
export function sourcesDown(data: MarketsResponse | null): { osmosis: boolean; coinstore: boolean } {
  const down = (id: string) => data?.sources.some((source) => source.id === id && !source.ok) ?? false;
  return { osmosis: down("numia"), coinstore: down("coinstore") };
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

export function MarketsStrip({ data, summary, loading, stale }: MarketsStripProps) {
  const currency = data?.currency ?? "usd";
  const saf = data?.assets.find((asset) => asset.key === SAF_KEY) ?? null;
  const pending = loading || !summary;
  const breadthTotal = summary ? summary.up + summary.down + summary.flat : 0;
  const down = sourcesDown(data);
  // A sum over nothing is unknown, not zero (an Osmosis outage leaves only SAF).
  const capSum = summary && summary.capCount > 0 ? summary.capSum : null;
  const liquiditySum = summary && summary.liquidityCount > 0 ? summary.liquiditySum : null;
  const osmosisReason = "Osmosis market data (Numia) did not answer: try again in a moment";
  const volumeVenues = down.osmosis ? "Coinstore only: Osmosis did not answer" : down.coinstore ? "Osmosis only: Coinstore did not answer" : "Osmosis and Coinstore";

  return (
    <div
      aria-busy={stale || undefined}
      className={cn("grid grid-cols-2 gap-[var(--d-gap)] transition-opacity duration-[160ms] md:grid-cols-3 2xl:grid-cols-6", stale && "opacity-60")}
    >
      <StatTile
        label="Cosmos market cap"
        loading={pending}
        value={
          <Money
            masked={false}
            value={capSum}
            currency={currency}
            compact
            reason={down.osmosis ? osmosisReason : "No listed asset reports a market cap"}
          />
        }
        delta={capSum !== null && summary ? { value: summary.cap24hPct, kind: "pct", period: "24h" } : undefined}
        sub={summary ? (capSum !== null ? plural(summary.capCount, "asset") : down.osmosis ? "Osmosis data unavailable" : "none reported") : undefined}
        info="Sum of the market caps of the Cosmos-native assets listed here. Bridged and alloyed forms of outside assets (USDC.n, allBTC) carry none, so they are not added. The 24 h change is weighted by cap from each asset's price change, supplies assumed unchanged (an estimate)."
      />
      <StatTile
        label="Osmosis liquidity"
        loading={pending}
        value={
          <Money
            masked={false}
            value={liquiditySum}
            currency={currency}
            compact
            reason={down.osmosis ? osmosisReason : "No listed asset is in an Osmosis pool"}
          />
        }
        sub={summary ? (liquiditySum !== null ? `${plural(summary.liquidityCount, "asset")} in pools` : down.osmosis ? "Osmosis data unavailable" : "no pools") : undefined}
        info="Value locked in the Osmosis pools that hold each listed asset, summed per asset."
      />
      <StatTile
        label="Volume 24h"
        loading={pending}
        value={<Money masked={false} value={summary?.volumeSum} currency={currency} compact />}
        sub={volumeVenues}
        info="Each asset's 24 h volume, summed. A swap counts for both of its tokens, so this is about twice the value that changed hands."
      />
      <StatTile
        label="Breadth 24h"
        loading={pending}
        value={
          summary ? (
            // Arrows, colour and words for screen readers: fits a phone tile.
            <span className="flex items-center gap-3 tabular-nums">
              <span className="inline-flex items-center gap-1 text-[var(--d-pos)]">
                <Icon name="triUp" size={12} fill="currentColor" strokeWidth={1} aria-hidden />
                {summary.up}
                <span className="sr-only"> rose</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[var(--d-neg)]">
                <Icon name="triDown" size={12} fill="currentColor" strokeWidth={1} aria-hidden />
                {summary.down}
                <span className="sr-only"> fell</span>
              </span>
            </span>
          ) : null
        }
        sub={
          summary && breadthTotal > 0 ? (
            <span className="flex w-full items-center gap-2">
              <span aria-hidden className="flex h-1.5 w-[64px] shrink-0 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
                <span className="h-full bg-[var(--d-pos)]" style={{ width: `${(summary.up / breadthTotal) * 100}%` }} />
                <span className="h-full bg-[var(--viz-neutral)] opacity-50" style={{ width: `${(summary.flat / breadthTotal) * 100}%` }} />
                <span className="h-full bg-[var(--d-neg)]" style={{ width: `${(summary.down / breadthTotal) * 100}%` }} />
              </span>
              <span className="truncate">{summary.flat} flat</span>
            </span>
          ) : undefined
        }
        info="How many listed assets rose, fell or did not move over 24 h."
      />
      <StatTile
        className="max-md:col-span-2"
        label="Best / worst 24h"
        loading={pending}
        value={
          <span className="flex flex-col gap-1.5 pt-0.5">
            <MoverLine asset={summary?.best ?? null} side="best" />
            <MoverLine asset={summary?.worst ?? null} side="worst" />
          </span>
        }
        info={`Among assets with at least ${formatFiat(MOVER_FLOOR, currency, { compact: true })} of Osmosis liquidity (or of 24 h volume off Osmosis): a thin pool can move 50% on one swap.`}
      />
      <StatTile
        className="max-md:col-span-2"
        label="SAF · Safrochain"
        tone="accent"
        loading={pending}
        href={saf ? assetHref(saf.key) : undefined}
        value={<Money masked={false} value={saf?.price} currency={currency} reason="SAF's market did not answer" />}
        delta={saf ? { value: saf.change24h, kind: "pct", period: "24h" } : undefined}
        sub={saf ? <>Coinstore · vol <Money masked={false} value={saf.volume24h} currency={currency} compact /></> : "Coinstore SAF/USDT"}
        info="Safrochain's coin trades on Coinstore (SAF/USDT), not on Osmosis: its price and volume come from there."
      />
    </div>
  );
}

/* ------------------------------------------------------------------ breadth chart */

const BREADTH_SERIES = [
  { id: "down", label: "Fell", color: VIZ_NEG },
  { id: "flat", label: "Unchanged", color: VIZ_NEUTRAL },
  { id: "up", label: "Rose", color: VIZ_POS },
];

const countFormatter = (value: number) => `${value} ${value === 1 ? "asset" : "assets"}`;
const countTicks: TickFormatter = (value) => (Number.isInteger(value) ? String(value) : "");

export function BreadthCard({
  data,
  summary,
  loading,
  pending,
  wide = false,
  className,
}: {
  data: MarketsResponse | null;
  /** The strip's counts (rose, fell, unchanged, unknown), shown as the chart's legend. */
  summary: MarketSummary | null;
  loading: boolean;
  pending: boolean;
  /** The table below is narrowed to one chain: say these figures are not. */
  wide?: boolean;
  className?: string;
}) {
  const bars = useMemo<BarDatum[]>(
    () =>
      changeBuckets(data?.assets ?? []).map((bucket) => ({
        x: bucket.id,
        label: bucket.label,
        values: { [bucket.side]: bucket.count },
      })),
    [data],
  );
  const counts = summary ? { down: summary.down, flat: summary.flat, up: summary.up } : null;
  const median = useMemo(() => {
    const changes = (data?.assets ?? []).map((asset) => asset.change24h).filter((c): c is number => c !== null).sort((a, b) => a - b);
    if (changes.length === 0) return null;
    const mid = Math.floor(changes.length / 2);
    return changes.length % 2 ? (changes[mid] as number) : ((changes[mid - 1] as number) + (changes[mid] as number)) / 2;
  }, [data]);

  return (
    <Card className={className} pending={pending}>
      <CardHeader
        title="How the market moved"
        subtitle={
          median !== null ? (
            <>
              {wide ? "Cosmos-wide · " : ""}Median 24 h change{" "}
              <span className={median > 0 ? "text-[var(--d-pos)]" : median < 0 ? "text-[var(--d-neg)]" : "text-fg"}>{formatPercent(median, { signed: true })}</span>{" "}
              across {plural(data?.assets.length ?? 0, "asset")}
            </>
          ) : (
            "24 h price change of every listed asset"
          )
        }
        info="Every listed asset counted once, whatever its size. A change on a bucket edge counts in the bucket further from zero."
      />
      <BarChart
        data={bars}
        series={BREADTH_SERIES}
        xType="category"
        layout="stacked"
        height={230}
        legend="none"
        loading={loading}
        pending={pending}
        valueFormatter={countFormatter}
        tickFormatter={countTicks}
        title="Assets by 24 h change"
        ariaLabel={counts ? `24 h change of listed assets: ${counts.down} fell, ${counts.flat} unchanged, ${counts.up} rose` : undefined}
        empty={<span className="text-[13px] text-fg-dim">No 24 h changes reported</span>}
      />
      {counts && summary && !loading ? (
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fg-dim">
          {BREADTH_SERIES.map((series) => (
            <span key={series.id} className="inline-flex items-center gap-1.5">
              <Swatch color={series.color} />
              {series.label}
              <span className="font-medium tabular-nums text-fg">{counts[series.id as keyof typeof counts]}</span>
            </span>
          ))}
          {summary.unknown > 0 ? <span>{summary.unknown} without a 24 h change</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ depth list */

export function DepthCard({
  data,
  loading,
  pending,
  wide = false,
  className,
}: {
  data: MarketsResponse | null;
  loading: boolean;
  pending: boolean;
  /** The table below is narrowed to one chain: say these figures are not. */
  wide?: boolean;
  className?: string;
}) {
  const currency = data?.currency ?? "usd";
  const osmosisDown = sourcesDown(data).osmosis;
  const leaders = useMemo(() => liquidityLeaders(data?.assets ?? [], 7), [data]);
  const total = useMemo(() => (data?.assets ?? []).reduce((sum, asset) => sum + (asset.liquidity ?? 0), 0), [data]);
  const formatter = useCallback((value: number) => formatFiat(value, currency, { compact: value >= 10_000 }), [currency]);
  const topShare = leaders.reduce((sum, entry) => sum + entry.share, 0);

  return (
    <Card className={className} pending={pending}>
      <CardHeader
        title="Where liquidity sits"
        subtitle={
          leaders.length > 0 ? (
            <>
              {wide ? "Cosmos-wide · " : ""}Top {leaders.length} hold {formatPercent(topShare, { digits: 0 })} of{" "}
              <Money masked={false} value={total} currency={currency} compact />
            </>
          ) : (
            "Osmosis pool liquidity per asset"
          )
        }
        // One (i) for the card: a second one inline in the caption below was
        // a 16 px target crowding the Swap link.
        info="Liquidity is the value in the Osmosis pools holding each asset, as Numia reports it. Deeper pools mean smaller price impact for the same swap size."
      />
      <BarList
        items={leaders.map(({ asset, share }) => ({
          id: asset.key,
          label: asset.symbol,
          value: asset.liquidity ?? 0,
          icon: <AssetLogo src={asset.logoUrl} symbol={asset.symbol} size={18} />,
          detail: `${formatPercent(share, { digits: 1 })} of listed liquidity`,
        }))}
        valueFormatter={formatter}
        loading={loading}
        pending={pending}
        showShare={false}
        title="Osmosis liquidity by asset"
        empty={
          <span className="text-[13px] text-fg-dim">
            {osmosisDown ? "Osmosis pool data (Numia) did not answer. The list comes back with the next read." : "No listed asset is in an Osmosis pool"}
          </span>
        }
      />
      {leaders.length > 0 ? (
        <p className="text-[12px] text-fg-dim">
          {/* Underlined, not only coloured: a link inside a sentence must not
              rely on hue alone (WCAG 1.4.1), the accent against dim text is
              about 1:1 in lightness. */}
          <Link
            href="/swap"
            className="text-[var(--d-accent-text)] underline decoration-[var(--d-accent-line)] underline-offset-[3px] transition-[text-decoration-color] duration-[160ms] hover:decoration-current"
          >
            Swap
          </Link>{" "}
          routes through these pools; the quote shows the price impact before you sign.
        </p>
      ) : null}
    </Card>
  );
}
