"use client";

/**
 * /assets/[key]: one asset, market first, then your position.
 *
 * Header (name, identity line, price with 24 h / 7 d, source, actions,
 * watchlist star) → price chart with range statistics beside the market
 * figures (or one "no market" card) → your position (or an inline connect
 * prompt; its skeleton while a remembered wallet restores, so a returning
 * user never sees "Connect" flash) → the chain's staking economics for its
 * own coin → the transactions that moved it → provenance.
 *
 * Only the chart and the market figures share a row: they are the same
 * height by nature. Everything below spans the page, so no column runs
 * empty whatever the wallet holds (or without a wallet: the public page is
 * the one search engines index).
 *
 * The identity arrives from the server (so the first paint names the asset);
 * market figures, history and holdings load here.
 */

import { useMemo } from "react";
import { Page } from "@/components/shell/Page";
import { AssetLogo, Badge, BigNumber, Button, Card, Delta, IconButton, InlineError, Money, PartialDataBadge, Skeleton, SourceTag } from "@/components/ui";
import { Icon } from "@/components/icons";
import { compareHref } from "@/components/compare/model";
import { liquidityRanks } from "@/components/markets/markets";
import { useWatchlist } from "@/components/markets/watchlist";
import { cn } from "@/lib/cn";
import { useAsset } from "@/lib/data/assets";
import { useMarkets } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { tokenKindLabel, tokenText } from "@/lib/token/text";
import type { TokenIdentity } from "@/lib/token/types";
import type { AssetDetailResponse, MarketAsset, PortfolioAsset } from "@/lib/token/wire";
import { useWallet } from "@/providers/WalletProvider";
import { TrustBadge } from "./AssetCells";
import { ProvenanceCard, StakingEconomicsCard } from "./AssetFacts";
import { MarketStatsCard, NoMarketCard, PriceChartCard } from "./AssetMarket";
import { AssetActivityCard, ConnectPrompt, PositionCard, PositionSkeleton } from "./AssetPosition";
import { useBondDenoms } from "./bond-denoms";
import { isUnlisted } from "./holdings";
import { bridgeHref, isStakingCoin, sendHref, stakeHref, swapToHref } from "./links";
import { useReadAt } from "./read-at";
import { useWalletRestoring } from "./wallet-restore";

/** Phones: an action is a tile, icon over label, the row shared equally. */
const PHONE_TILE = "max-sm:h-auto max-sm:min-h-[56px] max-sm:flex-col max-sm:gap-1 max-sm:px-1 max-sm:py-2 max-sm:text-[12.5px]";

export interface AssetDetailPageProps {
  /** The canonical asset key (`TokenIdentity.key`). */
  assetKey: string;
  /** Resolved on the server from the bundled tables. */
  initialIdentity: TokenIdentity;
}

export function AssetDetailPage({ assetKey, initialIdentity }: AssetDetailPageProps) {
  const { account } = useWallet();
  const restoring = useWalletRestoring();
  const ticker = initialIdentity.ticker;
  // A wallet user comes from Assets, a visitor from Markets; while a
  // remembered wallet restores it is already the former (no "Markets" flip).
  const crumbs =
    account || restoring ? [{ label: "Assets", href: "/assets" }, { label: ticker }] : [{ label: "Markets", href: "/markets" }, { label: ticker }];
  return (
    <Page title={ticker} breadcrumbs={crumbs} access="public">
      <AssetDetailBody assetKey={assetKey} initialIdentity={initialIdentity} />
    </Page>
  );
}

/** The holding with the most liquid balance: where Send and Bridge start from. */
function liquidHolding(rows: readonly PortfolioAsset[]): PortfolioAsset | null {
  let best: PortfolioAsset | null = null;
  for (const row of rows) {
    const liquid = /^\d+$/.test(row.amounts.liquid) ? BigInt(row.amounts.liquid) : BigInt(0);
    if (liquid === BigInt(0)) continue;
    if (!best || liquid > BigInt(best.amounts.liquid)) best = row;
  }
  return best;
}

function AssetDetailBody({ assetKey, initialIdentity }: AssetDetailPageProps) {
  const { account } = useWallet();
  const restoring = useWalletRestoring();
  const asset = useAsset(assetKey);
  const markets = useMarkets();
  const portfolio = usePortfolio();

  const detail = asset.data;
  const identity = detail?.identity ?? initialIdentity;
  const ticker = identity.ticker;
  const market = detail?.market ?? null;

  const listing = useMemo(() => markets.data?.assets.find((entry) => entry.key === assetKey) ?? null, [markets.data, assetKey]);
  const rank = useMemo(() => (markets.data ? (liquidityRanks(markets.data.assets).get(assetKey) ?? null) : null), [markets.data, assetKey]);

  const held = useMemo(() => (portfolio.data?.assets ?? []).filter((row) => row.identity.key === assetKey), [portfolio.data, assetKey]);
  // Only a chain's own coin can be its staking coin; read that chain's stats to know.
  const homeChains = useMemo(() => (identity.kind === "native" ? [identity.chainId] : []), [identity.kind, identity.chainId]);
  const { bondDenomOf } = useBondDenoms(homeChains);
  const staking = isStakingCoin(identity, bondDenomOf);
  const assetFailed = asset.status === "error" && !detail;
  // No venue quotes it: an unlisted token never, a listed one when the read says so.
  const noMarket = isUnlisted(identity) || (market !== null && market.price === null);
  const spot = useMemo(
    () =>
      detail && market && market.price !== null
        ? { t: detail.updatedAt, v: market.price, source: market.source, currency: detail.currency }
        : null,
    [detail, market],
  );

  return (
    <>
      <AssetHeader
        assetKey={assetKey}
        identity={identity}
        detail={detail}
        loading={asset.loading}
        failed={assetFailed}
        listing={listing}
        rank={rank}
        source={liquidHolding(held)}
        staking={staking}
        connected={Boolean(account)}
      />

      {assetFailed ? (
        <InlineError
          title="Market data unavailable"
          message={asset.error?.message ?? "This asset's market figures could not be read."}
          onRetry={asset.refetch}
          retrying={asset.refreshing}
        />
      ) : null}

      {noMarket ? (
        <NoMarketCard identity={identity} />
      ) : (
        <div className="grid gap-[var(--d-gap)] xl:grid-cols-12">
          <PriceChartCard assetKey={assetKey} identity={identity} spot={spot} className="xl:col-span-8" />
          <MarketStatsCard
            detail={detail}
            identity={identity}
            loading={asset.loading}
            pending={asset.stale}
            failed={assetFailed}
            className="xl:col-span-4"
          />
        </div>
      )}

      {account ? (
        <PositionCard assetKey={assetKey} identity={identity} tradable={listing?.tradable ?? false} bondDenomOf={bondDenomOf} />
      ) : restoring ? (
        <PositionSkeleton />
      ) : (
        <ConnectPrompt ticker={ticker} />
      )}
      {staking ? <StakingEconomicsCard chainId={identity.chainId} ticker={ticker} /> : null}
      {account ? <AssetActivityCard assetKey={assetKey} identity={identity} /> : null}
      <ProvenanceCard identity={identity} holdersChains={detail?.holdersChains} />
    </>
  );
}

/* ------------------------------------------------------------------ header */

interface AssetHeaderProps {
  assetKey: string;
  identity: TokenIdentity;
  detail: AssetDetailResponse | null;
  loading: boolean;
  failed: boolean;
  /** The asset's row in the markets feed: tradable, watchable, comparable. */
  listing: MarketAsset | null;
  rank: number | null;
  /** The holding Send and Bridge start from (most liquid), when the wallet has one. */
  source: PortfolioAsset | null;
  staking: boolean;
  connected: boolean;
}

function AssetHeader({ assetKey, identity, detail, loading, failed, listing, rank, source, staking, connected }: AssetHeaderProps) {
  const watchlist = useWatchlist();
  const ticker = identity.ticker;
  const market = detail?.market ?? null;
  const currency = detail?.currency ?? "usd";
  const tradable = listing?.tradable ?? false;
  // The watchlist and Compare both read the markets feed: an asset outside
  // it could be starred, but would never show up anywhere.
  const watchable = listing !== null;
  const watched = watchlist.has(assetKey);
  const readAt = useReadAt(detail?.updatedAt);
  const hasActions = tradable || source !== null || connected;

  const star = (
    <Icon name="star" size={16} fill={watched ? "currentColor" : "none"} className={watched ? "text-[var(--z-warning)]" : undefined} />
  );

  return (
    <Card variant="hero" className="gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <AssetLogo src={identity.logoUrl} symbol={ticker} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">{identity.name}</h2>
              <Badge size="sm" variant="outline">
                {tokenKindLabel(identity.kind)}
              </Badge>
              <TrustBadge identity={identity} />
              {identity.testnet ? (
                <Badge tone="info" size="sm">
                  Testnet
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13.5px] text-fg-dim">
              <span className="font-mono text-[12px] tracking-[0.02em] text-fg-muted">{ticker}</span>
              <span aria-hidden>·</span>
              <span>{tokenText(identity, "row")}</span>
              {rank !== null ? (
                <>
                  <span aria-hidden>·</span>
                  <span>#{rank} by Osmosis liquidity</span>
                </>
              ) : null}
            </p>
          </div>
          {watchable ? (
            <IconButton
              className="-mr-1.5 -mt-1 lg:hidden"
              label={watched ? `Remove ${ticker} from your watchlist` : `Add ${ticker} to your watchlist`}
              pressed={watched}
              onClick={() => watchlist.toggle(assetKey)}
            >
              {star}
            </IconButton>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5 lg:items-end">
          {/* The price first, then how it moved: "$1.71 ▼5.5% 24h ▼0.6% 7d" reads in order. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
            {loading ? (
              <>
                <BigNumber value={null} loading size="lg" />
                <Skeleton className="h-6" width={150} />
              </>
            ) : market?.price != null ? (
              <>
                <BigNumber size="lg" value={<Money masked={false} value={market.price} currency={currency} />} />
                <div className="flex items-center gap-1.5">
                  <Delta value={market.change24h} variant="pill" size="md" period="24h" />
                  <Delta value={market.change7d} variant="pill" size="md" period="7d" />
                </div>
              </>
            ) : (
              <span className="flex flex-col gap-0.5 lg:items-end">
                <span className="text-[17px] font-medium tracking-[-0.01em] text-fg-muted">No market price</span>
                <span className="text-[12.5px] text-fg-dim">
                  {failed ? "The price sources did not answer" : "Shown in native units, never valued"}
                </span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {market?.label ? <SourceTag source={market.label} at={readAt} /> : null}
            <PartialDataBadge errors={detail?.errors?.filter((error) => !error.scope.startsWith("stats:"))} />
          </div>
        </div>
      </div>
      {hasActions || watchable ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2 border-t border-[var(--d-hairline)] pt-3.5 max-sm:grid max-sm:auto-cols-fr max-sm:grid-flow-col",
            // Below 1024 px the star sits in the header corner: a row left with nothing goes.
            !hasActions && "max-lg:hidden",
          )}
        >
          {tradable ? (
            <Button variant="primary" iconLeft="swap" href={swapToHref(assetKey)} className={PHONE_TILE}>
              <span className="max-sm:hidden">Swap to {ticker}</span>
              <span className="sm:hidden">Swap</span>
            </Button>
          ) : null}
          {source ? (
            <>
              <Button variant="secondary" iconLeft="send" href={sendHref(source.chainId, source.identity.denom)} className={PHONE_TILE}>
                Send
              </Button>
              <Button variant="secondary" iconLeft="bridge" href={bridgeHref(source.chainId, source.identity.denom)} className={PHONE_TILE}>
                Bridge
              </Button>
            </>
          ) : null}
          {staking && connected ? (
            <Button variant="secondary" iconLeft="staking" href={stakeHref(identity.chainId)} className={PHONE_TILE}>
              Stake
            </Button>
          ) : null}
          {connected ? (
            <Button variant="secondary" iconLeft="receive" href="/receive" className={PHONE_TILE}>
              Receive
            </Button>
          ) : null}
          {watchable ? (
            <span className="ml-auto flex items-center gap-1 max-lg:hidden">
              <Button variant="ghost" iconLeft="compare" href={compareHref([{ kind: "asset", id: assetKey }])}>
                Compare
              </Button>
              <Button variant={watched ? "secondary" : "ghost"} aria-pressed={watched} onClick={() => watchlist.toggle(assetKey)} iconLeft={star}>
                {watched ? "Watching" : "Watch"}
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      {listing && !listing.tradable ? (
        <p className="-mt-2 text-[12.5px] text-fg-dim">
          {ticker} isn&apos;t traded on Osmosis{market?.source === "coinstore" ? "; its price comes from Coinstore" : ""}, so it can&apos;t be swapped here.
        </p>
      ) : null}
    </Card>
  );
}