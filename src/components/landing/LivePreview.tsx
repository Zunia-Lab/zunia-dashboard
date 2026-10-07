"use client";

/**
 * "Live across Cosmos": the hero's preview, built only from public reads.
 *
 * - Five key assets with price, 24 h change and a 7-day sparkline from
 *   `/api/markets` (Numia's Osmosis data; SAF from Coinstore SAF/USDT).
 * - The actual staking APR of the pinned chains from `/api/chains/stats`
 *   (published issuance corrected for observed block times), ranked, with
 *   the sentence that explains the biggest gap between the two.
 *
 * Loaded lazily (see LivePreviewIsland): the charts and their d3 helpers
 * stay out of the landing page's first bundle. Charts are imported from
 * their modules rather than the kit's barrel for the same reason.
 */

import Link from "next/link";
import { useMemo } from "react";
import { BarList, type BarListItem } from "@/components/charts/BarList";
import { VIZ_NEG, VIZ_NEUTRAL, VIZ_POS } from "@/components/charts/palette";
import { Sparkline } from "@/components/charts/Sparkline";
import { AssetLogo, Button, Card, CardFooter, CardHeader, ChainLogo, chainById, Delta, InlineError, PartialDataBadge } from "@/components/ui";
import { useChainStats } from "@/lib/data/chains";
import { useMarkets } from "@/lib/data/markets";
import { NO_VALUE, formatFiat, formatPercent } from "@/lib/format";
import { APR_CHAINS, aprDetail, aprSummary, assetRowLabel, changeDirection, marketProvenance, pickLiveAssets, type LiveAssetRow } from "./live";
import {
  APR_SOURCE,
  APR_SOURCE_THIRD_PARTY,
  ASSET_ROW_H,
  AprRowsSkeleton,
  AssetRowsSkeleton,
  CompareChainsLink,
  LiveTitle,
  MARKETS_LOADING,
  PREVIEW_CARD,
  PREVIEW_STACK,
  PRICE_COLUMN,
  Provenance,
  SPARK_COLUMN,
  SPARK_H,
  type LiveState,
} from "./LivePreviewSkeleton";

const formatApr = (value: number) => formatPercent(value, { digits: 1 });

export default function LivePreview() {
  return (
    <div className={PREVIEW_STACK}>
      <MarketsCard />
      <AprCard />
    </div>
  );
}

/* ------------------------------------------------------------------ markets */

function MarketsCard() {
  const markets = useMarkets();
  const data = markets.data;
  const rows = useMemo(() => (data ? pickLiveAssets(data.assets) : null), [data]);
  const provenance = data ? marketProvenance(data.sources) : null;
  // Live only with at least one real price on the card: an answer in which
  // no source listed any of the five is as empty as a failed read.
  const state: LiveState = rows?.some((row) => row.asset !== null) ? "live" : rows || markets.error ? "error" : "loading";

  return (
    <Card className={PREVIEW_CARD} pending={markets.refreshing && Boolean(data)}>
      <CardHeader
        title={<LiveTitle state={state}>Live across Cosmos</LiveTitle>}
        subtitle="Price, 24 h change and 7-day trend"
        actions={
          <>
            <PartialDataBadge errors={data?.errors} />
            <Button variant="ghost" size="sm" href="/markets" iconRight="arrowRight" className="-mr-2 -mt-1">
              Markets
            </Button>
          </>
        }
      />
      {rows && data ? (
        <ul className="-mx-2 flex flex-col">
          {rows.map((row) => (
            <AssetRow key={row.key} row={row} currency={data.currency} />
          ))}
        </ul>
      ) : markets.error ? (
        <InlineError
          title="Market data didn't load"
          message="The price sources did not answer. Nothing else on this page depends on them."
          onRetry={markets.refetch}
          retrying={markets.refreshing}
          className="my-auto"
        />
      ) : (
        <AssetRowsSkeleton />
      )}
      <CardFooter className="justify-between gap-y-1">
        <Provenance
          source={provenance ? provenance.label : markets.error ? "Sources: Numia · Osmosis, Coinstore SAF/USDT" : MARKETS_LOADING}
          at={provenance?.at ?? null}
        />
        {data?.currencyFallback ? <span className="text-[12px] text-fg-dim">In USD: {data.currencyFallback.reason}</span> : null}
      </CardFooter>
    </Card>
  );
}

/** The 7-day line in the colour of the 7-day figure under it (see changeDirection). */
const TREND_COLOR = { up: VIZ_POS, down: VIZ_NEG, flat: VIZ_NEUTRAL } as const;

const VIA_COINSTORE = "via Coinstore";

function AssetRow({ row, currency }: { row: LiveAssetRow; currency: string }) {
  const asset = row.asset;
  const chainName = chainById(row.chainId)?.chainName ?? row.chainId;
  const viaCoinstore = asset?.source === "coinstore";
  const change7d = asset?.change7d ?? null;
  // Source order is name, price, 24 h, then the 7-day column, which `order`
  // draws before the price: the accessible name reads in that order (see
  // assetRowLabel), and it must hold the visible text in source order.
  const body = (
    <>
      <AssetLogo src={asset?.logoUrl} symbol={row.symbol} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-tight tracking-[-0.01em] text-fg">{row.symbol}</span>{" "}
        <span className="mt-0.5 block truncate text-[12px] leading-tight text-fg-dim">
          {chainName}
          {/* In parentheses, as in the row's accessible name, which carries
              it at every width while the row only has room for it on wide
              screens. */}
          {viaCoinstore ? <span className="hidden xl:inline"> ({VIA_COINSTORE})</span> : null}
        </span>
      </span>
      <span className={`${PRICE_COLUMN} order-1`}>
        <span className="text-[14px] font-medium leading-tight tabular-nums text-fg">
          {asset ? formatFiat(asset.price, currency) : <span title="Not listed by the market sources right now">{NO_VALUE}</span>}
        </span>
        <Delta value={asset?.change24h ?? null} reason="No 24 h change from the source" />
      </span>
      {/* The figure under the line says what its colour means: a green 7-day
          line beside a red 24 h change read as a contradiction. */}
      <span className={SPARK_COLUMN}>
        {asset?.sparkline7d && asset.sparkline7d.length > 1 ? (
          <Sparkline data={asset.sparkline7d} width={88} height={SPARK_H} color={TREND_COLOR[changeDirection(change7d)]} label={`${row.symbol}, 7 days`} />
        ) : (
          <span className="block text-center text-[12px] text-fg-faint" style={{ height: SPARK_H, lineHeight: `${SPARK_H}px` }} title="The source has no 7-day history for this asset">
            {NO_VALUE}
          </span>
        )}
        <Delta value={change7d} period="7d" reason="No 7-day change from the source" />
      </span>
    </>
  );
  const className = "flex items-center gap-3 rounded-[10px] px-2 transition-colors duration-[160ms]";
  return (
    <li>
      {asset ? (
        <Link
          href={`/assets/${encodeURIComponent(row.key)}`}
          className={`${className} hover:bg-[var(--d-row-hover)]`}
          style={{ height: ASSET_ROW_H }}
          aria-label={assetRowLabel({
            symbol: row.symbol,
            chainName,
            note: viaCoinstore ? VIA_COINSTORE : null,
            price: formatFiat(asset.price, currency),
            change24h: asset.change24h === null ? null : formatPercent(asset.change24h, { signed: true }),
            change7d: change7d === null ? null : formatPercent(change7d, { signed: true }),
          })}
        >
          {body}
        </Link>
      ) : (
        <div className={className} style={{ height: ASSET_ROW_H }}>
          {body}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ APR */

function AprCard() {
  const stats = useChainStats(APR_CHAINS);
  const data = stats.data;
  const summary = useMemo(() => (data ? aprSummary(data.chains) : null), [data]);
  const items = useMemo<BarListItem[]>(
    () =>
      (summary?.bars ?? []).map((bar) => ({
        id: bar.chainId,
        label: bar.chainName,
        value: bar.actual,
        icon: <ChainLogo chainId={bar.chainId} size={18} />,
        detail: aprDetail(bar, formatApr),
      })),
    [summary],
  );
  const highlight = summary?.highlight ?? null;

  return (
    <Card className={PREVIEW_CARD} pending={stats.refreshing && Boolean(data)}>
      <CardHeader
        title="Staking APR, actual"
        subtitle="Before commission, at observed block times"
        info="Published issuance × (observed ÷ assumed blocks per year) × (1 − community tax) ÷ bonded tokens. Mint rewards only: fees and validator commission are not included."
        actions={<PartialDataBadge errors={data?.errors} />}
      />
      {summary ? (
        <BarList items={items} valueFormatter={formatApr} showShare={false} title="Actual staking APR" ariaLabel={`Actual staking APR: ${summary.bars.map((bar) => `${bar.chainName} ${formatApr(bar.actual)}`).join(", ")}`} />
      ) : stats.error ? (
        <InlineError
          title="Chain data didn't load"
          message="The chains' public nodes did not answer in time."
          onRetry={stats.refetch}
          retrying={stats.refreshing}
        />
      ) : (
        <AprRowsSkeleton />
      )}
      <p className="min-h-[38px] text-[12.5px] leading-[1.5] text-fg-muted">
        {highlight && highlight.naive !== null && highlight.factor !== null ? (
          <>
            <span className="font-medium text-fg">{highlight.chainName}</span> makes {highlight.factor.toFixed(1)}× the blocks its mint
            parameters assume, so staking pays <span className="font-medium text-fg">{formatApr(highlight.actual)}</span> before commission,
            not the {formatApr(highlight.naive)} they suggest.
          </>
        ) : (
          "Actual APR corrects the published rate for how fast blocks really arrive; mint rewards only, before commission."
        )}
        {summary && summary.missing.length > 0 ? (
          <span className="mt-1 block text-fg-dim">
            {summary.missing.map((chain) => `${chain.chainName}: ${NO_VALUE} (${chain.reason})`).join(" · ")}
          </span>
        ) : null}
      </p>
      <CardFooter className="justify-between gap-y-1">
        <Provenance source={summary?.thirdParty ? APR_SOURCE_THIRD_PARTY : APR_SOURCE} at={data?.updatedAt ?? null} />
        <CompareChainsLink />
      </CardFooter>
    </Card>
  );
}
