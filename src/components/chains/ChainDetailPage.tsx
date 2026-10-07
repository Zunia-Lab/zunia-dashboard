"use client";

/**
 * /chains/[chainId]: one chain's decision page. The hero answers "what is it
 * and how is its token doing"; the KPI strip "what does staking here pay,
 * net of dilution, and how hard is the chain to stop"; the cards explain
 * each figure (why actual APR differs from the published one, how
 * concentrated the stake is, the rules a delegator signs up for), then the
 * wallet's own position and holdings when one is connected.
 *
 * Public and indexable for curated mainnets. Catalog facts (name, chain id,
 * token) render on the server; live figures stream in through the shared
 * hooks and keep their frame on refresh. A chain whose public endpoints are
 * down still gets its page, with the reason and a Retry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AreaChart, useChartSize } from "@/components/charts";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import {
  Badge,
  Button,
  Card,
  ChainLogo,
  chainById,
  CopyButton,
  Delta,
  InlineError,
  Money,
  PartialDataBadge,
  Segmented,
  Skeleton,
  SourceTag,
  StatTile,
} from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { useChainDetail, useChainStats, type ChainStats } from "@/lib/data/chains";
import { useProposals } from "@/lib/data/governance";
import { useMarkets, type MarketAsset } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { usePriceHistory } from "@/lib/data/prices";
import { useStakingPositions } from "@/lib/data/staking";
import { currencySymbol, formatFiat, formatNumber, formatPercent } from "@/lib/format";
import type { PriceRange } from "@/lib/token/types";
import { cn } from "@/lib/cn";
import { useWallet } from "@/providers/WalletProvider";
import { compareHref } from "@/components/compare/model";
import { Dash, RealYieldText, reasonOf } from "./cells";
import { GovernanceCard, LiveStatusCard, RulesCard, ValidatorSetCard, YieldCard } from "./detail-cards";
import { HoldingsCard, PositionCard } from "./PositionCards";
import { FollowButton } from "./FollowButton";
import { firstReason, formatDays, nativeAssetKey, statsUnreadable, toPct } from "./model";
import { useFollow } from "./useFollow";

const RANGES: { value: PriceRange; label: string }[] = [
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "90D", label: "90D" },
  { value: "1Y", label: "1Y" },
];

const CHART_MIN_HEIGHT = 210;

/** The single-chain routes stop at 15 s and ask to be retried (`Retry-After: 5`). */
const TIMEOUT_RETRY_MS = 5_000;

export function ChainDetailPage({ chain }: { chain: ChainEntry }) {
  const follow = useFollow();
  const { account, restoring } = useWallet();
  const connect = useConnectModal();
  const detail = useChainDetail(chain.chainId);
  // This chain and the followed chains of its network: the peer bars of the
  // yield card, and a quick first paint (the stats route is often warm from
  // the Chains table) while the heavier detail read (validator set,
  // proposals) runs.
  const peerIds = useMemo(
    () => [...new Set([chain.chainId, ...follow.followed.filter((id) => chainById(id)?.network === chain.network)])].slice(0, 8),
    [chain.chainId, chain.network, follow.followed],
  );
  const quick = useChainStats(peerIds);
  const stats = detail.data?.chain ?? quick.statsFor(chain.chainId);
  const peers = useMemo(() => {
    const own = detail.data?.chain;
    const list = quick.data?.chains ?? [];
    return own ? [own, ...list.filter((s) => s.chainId !== own.chainId)] : list;
  }, [detail.data, quick.data]);
  const markets = useMarkets();
  const portfolio = usePortfolio({ scope: "followed" });
  const staking = useStakingPositions({ chainIds: [chain.chainId] });
  // Everything recent (open ones first): the card lists open votes, or the
  // latest decisions when nothing is open.
  const proposals = useProposals({ status: "all", chains: [chain.chainId] });

  const timedOut = detail.status === "error" && detail.error?.code === "upstream_timeout";
  const refetchDetail = detail.refetch;
  useEffect(() => {
    if (!timedOut) return;
    const timer = window.setTimeout(refetchDetail, TIMEOUT_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [timedOut, refetchDetail]);

  const failed = detail.status === "error" && !timedOut;
  // Nothing to show but the catalog facts and the reason: the detail read
  // failed and the lighter stats route had nothing either, or the answer
  // came back but its node could not be read at all.
  const unreadable = stats ? statsUnreadable(stats) : false;
  const noData = (failed && !stats && quick.status !== "loading") || unreadable;
  const loading = !stats && !noData;
  const market = markets.data?.assets.find((asset) => asset.key === nativeAssetKey(chain)) ?? null;
  // The feed cannot say this token is unlisted: its read failed, or one of
  // its sources (Numia for Osmosis markets, Coinstore for SAF) did not
  // answer and the token is missing from what came back.
  const marketsFailed = markets.status === "error" || (market === null && Boolean(markets.data?.sources.some((source) => !source.ok)));
  const chartless = chain.network === "testnet";
  // The card's placement keys on `account` alone, never on `restoring`:
  // `restoring` is true on the server for everyone, so keying the phone
  // placement on it would render a tall skeleton above the KPI strip for
  // every visitor and drop it at hydration. The card itself shows its
  // loading frame while a remembered wallet restores.
  const connected = Boolean(account);
  const followed = follow.isFollowed(chain.chainId);
  const toggleFollow = () => follow.toggle(chain.chainId, { notify: true });
  const position = (className?: string) => (
    <PositionCard
      chain={chain}
      connected={connected}
      restoring={restoring}
      followed={followed}
      stakingApr={stats?.apr.actual ?? null}
      portfolio={portfolio.data}
      portfolioLoading={portfolio.loading}
      staking={staking.chainFor(chain.chainId)}
      stakingLoading={staking.loading}
      onConnect={() => connect.open()}
      onFollow={toggleFollow}
      className={className}
    />
  );

  return (
    <Page
      title={chain.chainName}
      subtitle={`${chain.chainId} · ${chain.coinDenom}`}
      breadcrumbs={[{ label: "Chains", href: "/chains" }, { label: chain.chainName }]}
      access="public"
    >
      <div className="grid grid-cols-1 gap-[var(--d-gap)] xl:grid-cols-12">
        <Hero
          chain={chain}
          stats={stats}
          market={market}
          marketCurrency={markets.data?.currency ?? null}
          statsCurrency={detail.data?.currency ?? quick.data?.currency ?? null}
          statsLoading={loading}
          marketsLoading={markets.loading}
          marketsFailed={marketsFailed}
          onRetryMarkets={markets.refetch}
          followed={followed}
          onToggleFollow={toggleFollow}
          errors={detail.data?.errors ?? null}
          className={chartless ? "xl:col-span-12" : "xl:col-span-8"}
        />
        {/* Live status and the position: a column beside the price chart on
            wide screens, a pair under the hero from tablets (and always for
            a testnet, whose hero has no chart). On phones a wallet's
            position follows the live status; the connect card waits at the
            end of the page instead of pushing the figures down. */}
        <div
          className={cn(
            // Side by side from tablets, each card as tall as its own content:
            // stretched to its neighbour's height, the live card ended in
            // ~140px of nothing (and an empty one read as broken).
            "grid grid-cols-1 gap-[var(--d-gap)] md:grid-cols-2 md:items-start",
            // Beside the chart the column fills the hero's height instead (the
            // position card takes what is left), so the cards span its width.
            chartless ? "xl:col-span-12" : "xl:col-span-4 xl:flex xl:flex-col xl:items-stretch",
          )}
        >
          {/* An answer where nothing could be read is no answer at all here. */}
          <LiveStatusCard stats={unreadable ? null : stats} loading={loading} />
          {position(cn(!chartless && "xl:flex-1", !connected && "max-md:hidden"))}
        </div>
      </div>

      {noData ? (
        <InlineError
          title={`Couldn't read ${chain.chainName} right now`}
          message={
            <>
              {unreadable && stats ? `Its public node is not answering (${firstReason(stats) ?? "no reply"}).` : detail.error?.code === "upstream_failed" || !detail.error ? "Its public endpoints are not answering." : detail.error.message}{" "}
              {market ? "The catalog facts and the market price still show; " : "The catalog facts still show; "}
              staking, validator and governance figures come back when the network does.
            </>
          }
          onRetry={() => {
            detail.refetch();
            quick.refetch();
          }}
          retrying={detail.refreshing || quick.refreshing}
        />
      ) : null}
      {timedOut && !stats ? (
        <p className="text-[13px] text-fg-dim" role="status">
          {chain.chainName} is slow to answer; the server keeps reading and this page retries on its own.
        </p>
      ) : null}

      {!noData ? (
        <>
          <KpiStrip chain={chain} loading={loading} stats={stats} />
          {/* Two independent columns, so each card is as tall as its content
              (equal-height rows left the yield card half empty): economics
              and governance on the left, the validator set and the rules a
              delegator signs up for on the right. Below lg the columns
              simply stack, so the reading order on screen is also the focus
              order (yield, governance, validators, rules). */}
          <div className="grid grid-cols-1 gap-[var(--d-gap)] lg:grid-cols-12 lg:items-start">
            <div className="flex min-w-0 flex-col gap-[var(--d-gap)] lg:col-span-5">
              <YieldCard chain={chain} stats={stats} peers={peers} loading={loading} />
              <GovernanceCard
                chain={chain}
                stats={stats}
                counts={detail.data?.proposals}
                proposals={proposals.data?.proposals ?? []}
                proposalsLoading={proposals.loading}
                loading={!detail.data && !failed}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-[var(--d-gap)] lg:col-span-7">
              <ValidatorSetCard
                chain={chain}
                stats={stats}
                set={detail.data?.validatorSet ?? null}
                delegations={account ? (staking.chainFor(chain.chainId)?.delegations ?? null) : null}
                loading={!detail.data && !failed}
              />
              <RulesCard chain={chain} stats={stats} loading={loading} />
            </div>
          </div>
        </>
      ) : null}

      {!connected ? position("md:hidden") : null}
      {account && portfolio.data && followed ? <HoldingsCard chain={chain} portfolio={portfolio.data} /> : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ hero */

interface HeroProps {
  chain: ChainEntry;
  stats: ChainStats | null;
  market: MarketAsset | null;
  marketCurrency: string | null;
  statsCurrency: string | null;
  /** The chain's stats (the price's second source) have not answered yet. */
  statsLoading: boolean;
  /** The markets feed has not answered yet. */
  marketsLoading: boolean;
  /** The markets feed could not say whether this token trades. */
  marketsFailed: boolean;
  onRetryMarkets: () => void;
  followed: boolean;
  onToggleFollow: () => void;
  errors: { chainId?: string; scope: string; message: string }[] | null;
  className?: string;
}

/** Why a market figure is missing when the read failed, not the market. */
const MARKET_DOWN = "Market data unavailable right now";

function Hero({
  chain,
  stats,
  market,
  marketCurrency,
  statsCurrency,
  statsLoading,
  marketsLoading,
  marketsFailed,
  onRetryMarkets,
  followed,
  onToggleFollow,
  errors,
  className,
}: HeroProps) {
  const [range, setRange] = useState<PriceRange>("30D");
  const testnet = chain.network === "testnet";
  const history = usePriceHistory(testnet ? null : nativeAssetKey(chain), range);
  const historyFailed = history.status === "error";
  const [chartBox, box] = useChartSize<HTMLDivElement>();

  // Price: the markets feed first (shared, cached), the stats' own spot second.
  const spot = stats?.price ?? null;
  const price = market?.price ?? spot?.price ?? null;
  // Either read may still bring the price: until both have settled (and on
  // the server, which renders before either) a missing price is pending, a
  // skeleton, never a "—" with a claim about the token.
  const pricePending = price === null && (marketsLoading || statsLoading);
  // "No market quotes this token" only once both sources answered without
  // it; a failed read says nothing about the token.
  const priceReason = reasonOf(stats, "price", marketsFailed || !stats ? MARKET_DOWN : "No market quotes this token");
  const changeReason = price === null ? priceReason : "Not reported by the price source";
  const factReason = (absent: string) => (marketsFailed ? MARKET_DOWN : absent);
  const currency = (market ? marketCurrency : statsCurrency) ?? history.data?.currency ?? "usd";
  const change24h = market?.change24h ?? spot?.change24h ?? null;
  const change7d = market?.change7d ?? spot?.change7d ?? null;
  const sourceLabel = market ? (market.source === "coinstore" ? "Coinstore SAF/USDT" : "Numia · Osmosis") : (spot?.label ?? null);

  const points = useMemo(() => (history.data?.points ?? []).map((p) => ({ t: p.t, v: p.v })), [history.data]);
  const chartCurrency = history.data?.currency ?? currency;
  const valueFormatter = useCallback((v: number) => formatFiat(v, chartCurrency), [chartCurrency]);
  const tickFormatter = useCallback(
    (v: number, ctx: { affix: (value: number, prefix: string, suffix?: string) => string }) => ctx.affix(v, currencySymbol(chartCurrency)),
    [chartCurrency],
  );
  const first = points[0]?.v ?? null;
  const last = points[points.length - 1]?.v ?? null;
  const rangeChange = first && last ? (last / first - 1) * 100 : null;
  const coverage = history.data?.coverage;

  return (
    <Card variant="hero" className={className}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <ChainLogo chainId={chain.chainId} size={52} ring={followed} />
        <div className="min-w-0 flex-[1_1_14rem]">
          <h2 className="truncate text-[24px] font-semibold leading-tight tracking-[-0.025em] sm:text-[26px]">{chain.chainName}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-0.5 rounded-[var(--d-radius-sm)] bg-[var(--d-glass-2)] pl-1.5 font-mono text-[11.5px] text-fg-muted">
              {chain.chainId}
              <CopyButton value={chain.chainId} label="chain id" />
            </span>
            <Badge tone="neutral">{chain.coinDenom}</Badge>
            <Badge tone={testnet ? "warning" : "neutral"} variant="outline">
              {testnet ? "Testnet" : "Mainnet"}
            </Badge>
            {chain.inCosmosRegistry ? (
              <Badge tone="neutral" variant="outline" icon="check" title="Listed in the official cosmos/chain-registry">
                Registry
              </Badge>
            ) : null}
            <PartialDataBadge errors={errors && errors.length > 0 ? errors : null} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          <FollowButton chainName={chain.chainName} followed={followed} onToggle={onToggleFollow} variant="button" />
          <Button size="sm" variant="secondary" iconLeft="compare" href={compareHref([{ kind: "chain", id: chain.chainId }, ...companions(chain.chainId)])}>
            Compare
          </Button>
        </div>
      </div>

      {testnet ? (
        <p className="flex items-center gap-2 rounded-[var(--d-radius-inner)] bg-[var(--d-glass)] px-3 py-2.5 text-[13px] text-fg-muted">
          <Icon name="info" size={16} className="shrink-0 text-fg-dim" />
          Testnet tokens have no market, so there is no price to chart. Staking and validator figures below are live.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-1">
            <div className="min-w-0">
              <p className="d-label">{chain.coinDenom} price</p>
              <p className="mt-1.5 text-[34px] font-semibold leading-none tracking-[-0.035em] [font-variant-numeric:proportional-nums] sm:text-[40px]">
                {/* A market price, not a holding: never masked. */}
                {price !== null ? (
                  <Money value={price} currency={currency} masked={false} animate />
                ) : pricePending ? (
                  // Glyph-high with the rest as margin: the line stays 1em
                  // tall, so the figure lands without moving anything.
                  <Skeleton className="my-[0.09em] h-[0.82em] w-[5.5ch] rounded-[8px]" />
                ) : (
                  <Dash reason={priceReason} />
                )}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {pricePending ? (
                  // The two pills' own height and rough width.
                  <>
                    <Skeleton className="h-5 rounded-[6px]" width={76} />
                    <Skeleton className="h-5 rounded-[6px]" width={68} />
                  </>
                ) : (
                  <>
                    <Delta value={change24h} variant="pill" period="24h" reason={changeReason} />
                    <Delta value={change7d} variant="pill" period="7d" reason={changeReason} />
                  </>
                )}
                {sourceLabel ? <SourceTag source={sourceLabel} at={market ? undefined : (spot?.at ?? null)} /> : null}
              </div>
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
              <Segmented<PriceRange> ariaLabel="Price range" value={range} onChange={setRange} options={RANGES} mono />
              {rangeChange !== null ? <Delta value={rangeChange} period={range} /> : null}
            </div>
          </div>
          {/* The chart takes whatever height the row gives the hero (the
              column beside it may be taller), never less than 210px. Its box
              is measured, not sized by its content, so it can shrink back. */}
          <div ref={chartBox} className="relative min-h-[210px] flex-1 basis-0">
            <div className="absolute inset-0">
              {historyFailed ? (
                // A failed read is not an empty history ("No price history
                // for X" is kept for an answer with no points): say so, with
                // a Retry that also re-reads a failed markets feed, so one
                // alert covers both. The server's own sentence when it sent
                // one; a browser's network error text is not plain words.
                <div className="flex h-full items-center">
                  <InlineError
                    className="w-full"
                    title="Price history unavailable"
                    message={history.error?.code ? history.error.message : "The price source did not answer. Try again in a moment."}
                    onRetry={() => {
                      history.refetch();
                      if (marketsFailed) onRetryMarkets();
                    }}
                  />
                </div>
              ) : (
                <AreaChart
                  data={points}
                  height={Math.max(CHART_MIN_HEIGHT, box.height)}
                  label={`${chain.coinDenom} price`}
                  gradient
                  loading={history.loading}
                  pending={history.refreshing}
                  baseline={first}
                  baselineLabel="Start"
                  valueFormatter={valueFormatter}
                  tickFormatter={tickFormatter}
                  empty={<span className="text-[13px] text-fg-dim">No price history for {chain.coinDenom} in this range.</span>}
                  ariaLabel={`${chain.coinDenom} price over ${range}${rangeChange !== null ? `, ${formatPercent(rangeChange, { signed: true })}` : ""}`}
                />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[var(--d-hairline)] pt-3 text-[12.5px] text-fg-dim">
            <MarketFact label="Market cap" value={market?.marketCap ?? null} currency={marketCurrency} loading={marketsLoading} reason={factReason("No Cosmos-native market cap for this token")} />
            <MarketFact label="Volume 24h" value={market?.volume24h ?? null} currency={marketCurrency} loading={marketsLoading} reason={factReason("No volume reported")} />
            <MarketFact label="Osmosis liquidity" value={market?.liquidity ?? null} currency={marketCurrency} loading={marketsLoading} reason={factReason("Not traded in Osmosis pools")} />
            {coverage && !coverage.complete && coverage.from ? (
              <span>History since {new Date(coverage.from).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            ) : null}
            {history.data?.label ? <SourceTag source={history.data.label} className="ml-auto" /> : null}
          </div>
          {/* The chart's error already offers a Retry that covers the feed too. */}
          {marketsFailed && !historyFailed ? (
            <InlineError
              title="Market data unavailable"
              message="The market feed did not answer; market cap, volume and liquidity come back when it does."
              onRetry={onRetryMarkets}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

function MarketFact({ label, value, currency, reason, loading }: { label: string; value: number | null; currency: string | null; reason: string; loading: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {label}
      {loading ? (
        <Skeleton className="h-3 self-center" width={40} />
      ) : (
        <Money value={value} currency={currency ?? undefined} compact masked={false} reason={reason} className="font-medium text-fg-muted tabular-nums" />
      )}
    </span>
  );
}

/** Who a chain is compared with by default: the Hub and the home chain, never itself. */
function companions(chainId: string) {
  return ["cosmoshub-4", "safrochain-1", "osmosis-1"]
    .filter((id) => id !== chainId)
    .slice(0, 2)
    .map((id) => ({ kind: "chain" as const, id }));
}

/* ------------------------------------------------------------------ KPI strip */

function KpiStrip({ chain, stats, loading }: { chain: ChainEntry; stats: ChainStats | null; loading: boolean }) {
  const apr = stats?.apr ?? null;
  const differs = apr && apr.naive !== null && apr.actual !== null && Math.abs(apr.actual - apr.naive) > 1e-4;
  const real = stats?.realYield ?? null;
  return (
    // Six across only from 1440: at 1280 a sixth of the content is too
    // narrow for the explanations under the figures (they truncated). Both
    // breakpoints are arbitrary px on purpose: Tailwind emits an arbitrary
    // `min-[1440px]` before the rem-based `md:`, which then wins.
    <div className="grid grid-cols-2 gap-[var(--d-gap)] min-[768px]:grid-cols-3 min-[1440px]:grid-cols-6">
      <StatTile
        label="Staking APR"
        loading={loading}
        tone="accent"
        value={<FigurePct value={apr?.actual ?? null} reason={apr?.note ?? reasonOf(stats, "apr")} />}
        sub={differs && apr ? `Published ${formatPercent(toPct(apr.naive))}` : apr?.source === "cosmos.directory" ? "cosmos.directory (3P)" : "Before commission"}
        info={
          <>
            Actual staking APR before validator commission: what the issuance really pays at the observed block time.
            {apr?.method ? <> Method: {apr.method}.</> : null} Fees and MEV are not included.
          </>
        }
      />
      <StatTile
        label="Real yield"
        loading={loading}
        tone={real === null ? "default" : real >= 0 ? "positive" : "negative"}
        value={<RealYieldText value={real} reason={reasonOf(stats, "realYield")} />}
        sub={stats?.inflation.actual !== null && stats?.inflation.actual !== undefined ? `After ${formatPercent(toPct(stats.inflation.actual))} inflation` : null}
        info="APR minus actual inflation: how much a staker's share of the supply grows in a year. Negative means even stakers are diluted."
      />
      <StatTile
        label="Inflation"
        loading={loading}
        value={<FigurePct value={stats?.inflation.actual ?? null} reason={reasonOf(stats, "inflation")} />}
        sub={inflationCaption(stats)}
        info="New tokens issued in a year ÷ total supply, at the observed block time. The parameter is what the mint module publishes."
      />
      <StatTile
        label="Bonded"
        loading={loading}
        value={<FigurePct value={stats?.bondedRatio ?? null} digits={1} reason={reasonOf(stats, "bondedRatio")} />}
        // Short enough for a sixth of 1440 (the kit truncates the line).
        sub={stats?.goalBonded ? `Target ${formatPercent(toPct(stats.goalBonded), { digits: 0 })}` : "No target set"}
        info="Share of the supply staked. With a target, inflation rises below it and falls above it."
      />
      <StatTile
        label="Unbonding"
        loading={loading}
        value={formatDays(stats?.unbondingDays) ?? <Dash reason={reasonOf(stats, "unbondingDays")} />}
        // What the figure means for a delegator, as on the asset page (in
        // fewer words: the tile is narrower). The minimum commission lives
        // with the validator set it constrains.
        sub="to get coins back"
        info={`How long staked ${chain.coinDenom} stays locked after you unstake, earning nothing.`}
      />
      <StatTile
        label="Nakamoto"
        loading={loading}
        value={stats?.nakamoto !== null && stats?.nakamoto !== undefined ? formatNumber(stats.nakamoto) : <Dash reason={reasonOf(stats, "nakamoto")} />}
        sub={stats?.activeValidators !== null && stats?.activeValidators !== undefined ? `of ${formatNumber(stats.activeValidators)} validators` : null}
        info="The fewest validators that together hold more than a third of the stake: enough to halt the chain. Higher is harder to stop."
      />
    </div>
  );
}

/**
 * The line under the inflation figure: the rate the mint publishes when it
 * has one, else how this chain issues ("No mint parameter" read as jargon,
 * and as a fault, on Osmosis, whose issuance runs per epoch).
 */
function inflationCaption(stats: ChainStats | null): string | null {
  if (!stats) return null;
  if (stats.inflation.param !== null) return `Parameter ${formatPercent(toPct(stats.inflation.param))}`;
  if (stats.apr.source === "osmosis-mint") return "Epoch issuance";
  if (stats.apr.source === "cosmos.directory") return "No standard mint";
  return "No published rate";
}

function FigurePct({ value, reason, digits }: { value: number | null; reason?: string; digits?: number }) {
  if (value === null) return <Dash reason={reason} />;
  return <>{formatPercent(toPct(value), { digits })}</>;
}
