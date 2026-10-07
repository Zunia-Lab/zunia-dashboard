"use client";

/**
 * The market row of an asset page: the price chart with its range
 * statistics, and the market figures beside it; or one compact card saying
 * why there is no market when no venue quotes the token (two empty cards
 * would only repeat "—"). The reference cards that span the page below
 * (staking economics, provenance) live in `AssetFacts`.
 */

import { useCallback, useMemo, useState } from "react";
import { AreaChart, type TickFormatter, type TimePoint } from "@/components/charts";
import {
  Callout,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  ExternalLink,
  IconButton,
  InlineError,
  KeyValueList,
  Money,
  Segmented,
  Skeleton,
  SourceTag,
  useIsPhone,
  type KeyValueItem,
} from "@/components/ui";
import { marketCapReason } from "@/components/markets/markets";
import { cn } from "@/lib/cn";
import { usePriceHistory } from "@/lib/data/prices";
import { currencySymbol, formatDate, formatFiat, formatNumber, formatPercent } from "@/lib/format";
import type { PriceRange, TokenIdentity } from "@/lib/token/types";
import { UNPRICED_TEXT, type AssetDetailResponse } from "@/lib/token/wire";
import { Figure } from "./AssetCells";
import { isUnlisted } from "./holdings";
import { drawdownText, priceDomain, rangeStats } from "./price-stats";
import { useReadAt } from "./read-at";

const RANGES: { value: PriceRange; label: string; words: string }[] = [
  { value: "1D", label: "1D", words: "24 hours" },
  { value: "7D", label: "7D", words: "7 days" },
  { value: "30D", label: "30D", words: "30 days" },
  { value: "90D", label: "90D", words: "90 days" },
  { value: "1Y", label: "1Y", words: "1 year" },
];

/* ------------------------------------------------------------------ price chart */

export interface PriceChartCardProps {
  assetKey: string;
  identity: TokenIdentity;
  /**
   * The live spot price the page header shows. History is cached longer than
   * spot; when this is newer and from the same source and currency, the line
   * ends on it, so the chart and the header never disagree about "now".
   */
  spot?: { t: number; v: number; source: string | null; currency: string } | null;
  className?: string;
}

export function PriceChartCard({ assetKey, identity, spot, className }: PriceChartCardProps) {
  const [range, setRange] = useState<PriceRange>("30D");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<TimePoint | null>(null);
  const phone = useIsPhone();
  const history = usePriceHistory(assetKey, range);
  const data = history.data;
  const currency = data?.currency ?? "usd";
  const points = useMemo(() => {
    const list = data?.points ?? [];
    const last = list[list.length - 1];
    if (!data || !spot || !last || spot.source !== data.source || spot.currency !== data.currency || spot.t <= last.t) return list;
    // The series ends with its own "now" point, a partial step after the last
    // close and as old as the cached history: the fresher spot replaces it.
    const before = list[list.length - 2];
    const step = data.resolution === "hour" ? 3_600_000 : 86_400_000;
    const partial = before !== undefined && last.t - before.t < step / 2;
    return [...(partial ? list.slice(0, -1) : list), { t: spot.t, v: spot.v }];
  }, [data, spot]);
  const stats = useMemo(() => (data ? rangeStats(points, data.resolution) : null), [data, points]);
  const domain = useMemo(() => priceDomain(points), [points]);
  const words = RANGES.find((entry) => entry.value === range)?.words ?? range;

  const formatPrice = useCallback((value: number) => formatFiat(value, currency), [currency]);
  const tickFormatter = useCallback<TickFormatter>((value, { affix }) => affix(value, currencySymbol(currency)), [currency]);
  const onActive = useCallback((point: TimePoint | null) => setActive(point), []);

  const shown = active ?? stats?.last ?? null;
  const changeFromStart = shown && stats && stats.first.v > 0 ? (shown.v / stats.first.v - 1) * 100 : null;
  const incomplete = data && !data.coverage.complete && data.coverage.from !== null;
  const readAt = useReadAt(data?.updatedAt);
  const quiet = Array.isArray(domain);
  // In EUR or GBP the series is USD history at today's rate (the server has
  // no historical FX), and it says so: without the line a past high or low
  // would read as the price that day in that currency. It qualifies the chart
  // and the range figures under it alike, so it sits between them.
  const note = data?.note ?? null;

  return (
    <Card className={className} pending={history.stale}>
      <CardHeader
        title="Price"
        refreshing={history.refreshing && !history.stale}
        subtitle={
          shown ? (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-medium tabular-nums text-fg">{formatPrice(shown.v)}</span>
              {changeFromStart !== null ? (
                <span className={cn("tabular-nums", changeFromStart > 0 ? "text-[var(--d-pos)]" : changeFromStart < 0 ? "text-[var(--d-neg)]" : "")}>
                  {formatPercent(changeFromStart, { signed: true })}
                </span>
              ) : null}
              <span>{active ? formatDate(active.t, data?.resolution === "hour" ? "datetime" : "short") : `over ${words}`}</span>
            </span>
          ) : (
            `${identity.ticker} in ${currency.toUpperCase()}`
          )
        }
        actions={
          <>
            <Segmented ariaLabel="Price range" mono value={range} onChange={setRange} options={RANGES.map(({ value, label }) => ({ value, label }))} />
            <IconButton
              size="sm"
              icon={view === "chart" ? "list" : "trendingUp"}
              label={view === "chart" ? "Show the prices as a table" : "Show the chart"}
              pressed={view === "table"}
              onClick={() => setView(view === "chart" ? "table" : "chart")}
            />
          </>
        }
      />
      {history.status === "error" && !data ? (
        <div className="flex min-h-[220px] items-center">
          <InlineError
            className="w-full"
            title="Price history unavailable"
            message={history.error?.message ?? "The price sources did not answer. Try again in a moment."}
            onRetry={history.refetch}
            retrying={history.refreshing}
          />
        </div>
      ) : (
        <AreaChart
          data={points}
          height={phone ? 220 : 280}
          label={`${identity.ticker} price`}
          gradient
          view={view}
          loading={history.loading}
          pending={history.stale}
          yDomain={domain}
          valueFormatter={formatPrice}
          tickFormatter={tickFormatter}
          baseline={stats?.first.v ?? null}
          baselineLabel="Start"
          onActiveChange={onActive}
          ariaLabel={
            stats
              ? `${identity.ticker} price over ${words}: from ${formatPrice(stats.first.v)} to ${formatPrice(stats.last.v)}, high ${formatPrice(stats.high.v)}, low ${formatPrice(stats.low.v)}${note ? `. ${note}` : ""}`
              : undefined
          }
          empty={<span className="text-[13px] text-fg-dim">No prices in this range</span>}
          className="-mx-1"
        />
      )}
      {note ? <p className="text-[12px] leading-snug text-fg-dim">{note}</p> : null}
      <CardBody>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[var(--d-hairline)] pt-3 sm:grid-cols-4">
          <Figure label="High" loading={history.loading} value={stats ? formatPrice(stats.high.v) : "—"} sub={stats ? formatDate(stats.high.t, "short") : undefined} />
          <Figure label="Low" loading={history.loading} value={stats ? formatPrice(stats.low.v) : "—"} sub={stats ? formatDate(stats.low.t, "short") : undefined} />
          <Figure
            label="Volatility"
            loading={history.loading}
            value={stats?.volatility != null ? formatPercent(stats.volatility, { digits: 0 }) : "—"}
            sub="annualised"
            info={`Standard deviation of ${data?.resolution === "hour" ? "hourly" : "daily"} log returns over ${words}, scaled to a year. Higher means wilder swings.`}
          />
          <Figure
            label="Max drawdown"
            loading={history.loading}
            value={drawdownText(stats?.maxDrawdown ?? null, (v) => formatPercent(v, { digits: 1 })) ?? "—"}
            sub={`within ${words}`}
            info="The deepest fall from a running high to a later low inside the range."
          />
        </dl>
      </CardBody>
      {data ? (
        <CardFooter className="justify-between">
          <SourceTag source={data.label ?? "Price feed"} at={readAt} />
          <span className="text-[12px]">
            {incomplete
              ? `History since ${formatDate(data.coverage.from as number, "long")}: the source has nothing older`
              : quiet
                ? "Drawn within ±1% of its level: it barely moved"
                : `${data.resolution === "hour" ? "Hourly" : "Daily"} closes, ${data.coverage.points} points`}
          </span>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ market stats */

function capReasonOf(identity: TokenIdentity, sourceFailed: boolean): string {
  return marketCapReason({
    symbol: identity.ticker,
    verified: identity.proven && !isUnlisted(identity),
    family: identity.family ?? null,
    sourceFailed,
  });
}

function compactMoney(value: number | null | undefined, currency: string, reason?: string) {
  return <Money masked={false} value={value} currency={currency} compact={value !== null && value !== undefined && Math.abs(value) >= 10_000} reason={reason} />;
}

export interface MarketStatsCardProps {
  detail: AssetDetailResponse | null;
  identity: TokenIdentity;
  loading: boolean;
  pending: boolean;
  /** The asset read itself failed: nothing is known, so no row may claim the market is absent. */
  failed?: boolean;
  className?: string;
}

export function MarketStatsCard({ detail, identity, loading, pending, failed = false, className }: MarketStatsCardProps) {
  const currency = detail?.currency ?? "usd";
  const market = detail?.market;
  const stats = detail?.stats ?? null;
  const venue = market?.source === "coinstore" ? "Coinstore" : market?.source === "numia" ? "Osmosis" : null;
  const ticker = identity.ticker;
  const marketAt = useReadAt(detail?.updatedAt);
  const geckoAt = useReadAt(stats?.at);
  // A price source failed on this read, or the read itself did: a missing
  // figure may be the outage, not the market (an Osmosis-traded coin is not
  // "not traded" because Numia is down, nor because the whole read failed
  // and the page above already offers its Retry).
  const sourceFailed = failed || (detail?.errors?.some((error) => !error.scope.startsWith("stats:")) ?? false);
  const capReason = capReasonOf(identity, sourceFailed);
  // The outage, not identity policy, is why the cap is missing: the "—" names
  // the cause and the line under it says "Unavailable right now" (a screen
  // reader would otherwise hear "Unavailable: Unavailable right now").
  const capOutage = sourceFailed && capReason !== capReasonOf(identity, false);

  // No price row and no liquidity rank: the page header shows both just
  // above (the price with its 24 h and 7 d moves, the rank in the identity
  // line) and the chart repeats the price, so the card starts at what only
  // it shows.
  const marketItems: KeyValueItem[] = [
    {
      key: "cap",
      label: "Market cap",
      value: compactMoney(market?.marketCap, currency, capOutage ? "The market source did not answer" : capReason),
      sub: market?.marketCap == null ? capReason : undefined,
      info: "CoinGecko's figure (relayed by Numia, else read directly), shown only for assets whose CoinGecko id describes this very token.",
    },
    {
      key: "volume",
      label: venue ? `Volume 24h · ${venue}` : "Volume 24h",
      value: compactMoney(market?.volume24h, currency, sourceFailed ? "The market source did not answer" : "No venue reports a volume"),
      info: venue === "Osmosis" ? "Volume of the Osmosis pools that hold this token; a swap counts for both of its tokens." : undefined,
    },
    {
      key: "liquidity",
      label: "Liquidity · Osmosis",
      value: compactMoney(market?.liquidity, currency, sourceFailed ? "The Osmosis pool data did not answer" : "Not in an Osmosis pool"),
      sub: market?.liquidity != null ? undefined : sourceFailed ? "Unavailable right now" : "Not traded on Osmosis",
    },
  ];

  const geckoItems: KeyValueItem[] = stats
    ? [
        {
          key: "circ",
          label: "Circulating supply",
          value: stats.circulatingSupply !== null ? `${formatNumber(stats.circulatingSupply, { compact: true })} ${ticker}` : "—",
          sub:
            stats.circulatingSupply !== null && stats.totalSupply !== null && stats.totalSupply > 0
              ? `${formatPercent((stats.circulatingSupply / stats.totalSupply) * 100, { digits: 1 })} of ${formatNumber(stats.totalSupply, { compact: true })} total`
              : undefined,
        },
        {
          key: "vol-all",
          label: "Volume 24h · all venues",
          value: compactMoney(stats.volume24h, currency, "Not reported"),
        },
        {
          key: "ath",
          label: "All-time high",
          value: <Money masked={false} value={stats.ath} currency={currency} reason="Not reported" />,
          sub:
            stats.athChangePct !== null ? (
              <>
                <span className={stats.athChangePct < 0 ? "text-[var(--d-neg)]" : "text-[var(--d-pos)]"}>{formatPercent(stats.athChangePct, { signed: true, digits: 1 })}</span>
                {stats.athAt !== null ? ` · ${formatDate(stats.athAt, "long")}` : ""}
              </>
            ) : undefined,
        },
      ]
    : [];

  const geckoFailed = detail?.errors?.some((error) => error.scope.startsWith("stats:"));
  // Why the supply block is missing, in words (an empty gap says nothing).
  const noStatsNote = !detail
    ? null
    : identity.coinGeckoId && geckoFailed
      ? "Supply and all-time figures (CoinGecko) are unavailable right now."
      : identity.coinGeckoId
        ? `CoinGecko's ${identity.coinGeckoId} page describes the wider asset, not ${ticker} itself, so no supply or all-time figures are shown.`
        : `No CoinGecko listing describes ${ticker}, so there are no supply or all-time figures.`;

  return (
    <Card className={cn("@container", className)} pending={pending}>
      <CardHeader title="Market" subtitle={venue ? `Spot market: ${venue}` : "Spot market"} />
      {market?.listedAs ? (
        <Callout tone="warning" title="Unverified token">
          Osmosis lists this denom as {market.listedAs.symbol} ({market.listedAs.name}). The figures are this denom&apos;s own pools, not the asset its name claims.
        </Callout>
      ) : null}
      {/* Beside the chart it is one column; spanning the page (tablets,
          laptops below 1280 px) the spot market and the supply block sit side
          by side instead of stretching label and value 600 px apart. */}
      <CardBody className="grid gap-x-10 gap-y-3 @[600px]:grid-cols-2 @[600px]:items-start">
        {loading ? (
          <div className="flex flex-col gap-3" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-3" width={96} />
                <Skeleton className="h-3" width={72} />
              </div>
            ))}
          </div>
        ) : (
          <>
            <KeyValueList items={marketItems} divided />
            {geckoItems.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1 @[600px]:pt-0">
                  <span className="d-label whitespace-nowrap">Supply · all-time</span>
                  <SourceTag source="CoinGecko" at={geckoAt} />
                </div>
                <KeyValueList items={geckoItems} divided />
              </div>
            ) : noStatsNote ? (
              <p className="border-t border-[var(--d-hairline)] pt-3 text-[12.5px] leading-snug text-fg-dim @[600px]:border-t-0 @[600px]:pt-0">{noStatsNote}</p>
            ) : null}
          </>
        )}
      </CardBody>
      {market?.label ? (
        <CardFooter className="justify-between">
          <SourceTag source={market.label} at={marketAt} />
          {market.url ? (
            <ExternalLink href={market.url} className="text-[12px]">
              Market
            </ExternalLink>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ no market */

/** Why no venue values this token, from what its identity says it is. */
function noMarketText(identity: TokenIdentity): string {
  if (isUnlisted(identity)) {
    return "Nothing identifies this token, so no market is attributed to it. Unlisted tokens are often airdropped spam: never follow a link or visit a site named in one.";
  }
  if (identity.testnet) return `${UNPRICED_TEXT.testnet}.`;
  if (!identity.proven) return `${UNPRICED_TEXT.unproven}.`;
  return `No venue Zunia reads (Osmosis pools, CoinGecko, Coinstore) quotes ${identity.ticker}.`;
}

/**
 * The market row of a token nothing quotes: one card that says so and why,
 * instead of an empty chart beside a column of dashes.
 */
export function NoMarketCard({ identity, className }: { identity: TokenIdentity; className?: string }) {
  const unlisted = isUnlisted(identity);
  return (
    <Card className={className}>
      <CardHeader title="Market" subtitle="No price, no chart" />
      <EmptyState
        inline
        icon={unlisted ? "warning" : "markets"}
        title={`No market price for ${identity.ticker}`}
        body={
          <>
            {noMarketText(identity)} Zunia shows it in native units and never adds it to a total.
          </>
        }
        className="py-1"
      />
    </Card>
  );
}
