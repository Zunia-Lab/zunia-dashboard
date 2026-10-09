"use client";

/**
 * /assets: every token the wallet holds in the current scope.
 *
 * KPI strip (value, assets, unpriced, largest position, movers), then the
 * analysis row (allocation and concentration, what moved the total today,
 * staking coverage of chain coins), then the holdings table with filters,
 * grouping, row actions and a CSV export.
 *
 * Scope: "All chains" reads every followed chain of the MAIN/TEST slice and
 * compares chains (allocation by chain, "By chain" grouping); one chain reads
 * only that chain and adds its share of the wallet's total. A scope or
 * currency change keeps the previous answer on screen, dimmed, until the new
 * one lands.
 */

import { useMemo } from "react";
import { Page } from "@/components/shell/Page";
import { Button, Callout, Card, EmptyState, InlineError, PartialDataBadge } from "@/components/ui";
import { useMarkets } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { groupAssets } from "@/lib/token/holdings";
import type { MarketAsset } from "@/lib/token/wire";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { AllocationCard, MoversCard, StakingCoverageCard } from "./AssetsAnalysis";
import { AssetsSummary } from "./AssetsSummary";
import { chainName } from "./AssetCells";
import { HoldingsCard } from "./HoldingsCard";
import { useBondDenoms } from "./bond-denoms";
import { summarize } from "./holdings";
import { useSmallFloor } from "./small-floor";
import { marketSummary } from "@/components/markets/markets";

export function AssetsPage() {
  return (
    <Page
      title="Assets"
      access="wallet"
      connectTitle="Connect a wallet to see every asset you hold"
      connectDescription="Balances, prices, 24 h moves and staking on every chain you follow, in one table you can filter, group and export. Keys stay in your wallet."
    >
      <AssetsBody />
    </Page>
  );
}

function AssetsBody() {
  const portfolio = usePortfolio();
  // The rail's hover cards already read every followed chain; in single-chain
  // scope the same answer gives this chain's share of the whole wallet.
  const { selectedChainId, scopedChainIds } = useChainScope();
  const singleChain = selectedChainId !== null;
  const followed = usePortfolio({ scope: "followed" });
  const markets = useMarkets();
  // The scope's chain stats: which coin each chain stakes, and its APR.
  const { bondDenomOf, stats: chainStats } = useBondDenoms();
  const { currency: preferred, lite } = usePrefs();
  const floor = useSmallFloor();

  const data = portfolio.data;
  const currency = data?.currency ?? preferred;
  const loading = portfolio.loading;
  const pending = portfolio.stale;
  const refreshing = portfolio.refreshing && !portfolio.stale;

  const groups = useMemo(() => (data ? groupAssets(data.assets) : []), [data]);
  const summary = useMemo(() => (data ? summarize(data, floor) : null), [data, floor]);
  const marketPct = useMemo(() => (markets.data ? marketSummary(markets.data.assets).cap24hPct : null), [markets.data]);
  const marketByKey = useMemo(() => {
    const map = new Map<string, MarketAsset>();
    for (const asset of markets.data?.assets ?? []) map.set(asset.key, asset);
    return map;
  }, [markets.data]);

  const scopeShare = useMemo(() => {
    if (!singleChain) return undefined;
    const whole = followed.data;
    const here = data?.totals.pricedValue;
    if (!whole || here === undefined || whole.currency !== data?.currency || whole.totals.pricedValue <= 0) return null;
    return (here / whole.totals.pricedValue) * 100;
  }, [singleChain, followed.data, data]);

  const scopeLabel = singleChain ? chainName(selectedChainId) : `All chains (${scopedChainIds.length} networks)`;

  if (portfolio.status === "idle") {
    return (
      <EmptyState
        icon="networks"
        title={singleChain ? `No address on ${chainName(selectedChainId)}` : "No address on the chains you follow"}
        body="This wallet did not share an address for the chains in this scope (another key type, or a phone session that left them out). Pick another chain or follow more networks."
        action={null}
      />
    );
  }

  // Nothing read at all: one error with Retry, not a page of skeletons that
  // would never resolve. A failed refetch keeps the last answer on screen.
  if (portfolio.status === "error" && !data) {
    return (
      <InlineError
        title="Couldn't read your balances"
        message={portfolio.error?.message ?? "The chains did not answer. Your assets are safe; this is a read problem."}
        onRetry={portfolio.refetch}
        retrying={portfolio.refreshing}
      />
    );
  }

  // Nothing held in scope: one empty state with the ways forward, not a
  // strip of zeros above three empty cards.
  if (data && data.assets.length === 0) {
    return (
      <Card>
        {data.errors && data.errors.length > 0 ? (
          <div className="flex justify-end">
            <PartialDataBadge errors={data.errors} />
          </div>
        ) : null}
        <EmptyState
          icon="wallet"
          title={singleChain ? `Nothing held on ${chainName(selectedChainId)}` : "No assets on the chains you follow"}
          body={
            singleChain
              ? "Receive tokens to your address on this chain, or pick All chains in the scope menu."
              : `This wallet holds nothing on the ${scopedChainIds.length} networks you follow. Receive tokens, follow more networks, or see what trades across Cosmos.`
          }
          action={
            <span className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="primary" iconLeft="receive" href="/receive">
                Receive
              </Button>
              <Button size="sm" variant="secondary" iconLeft="networks" href="/networks">
                Networks
              </Button>
              <Button size="sm" variant="ghost" iconLeft="markets" href="/markets">
                Markets
              </Button>
            </span>
          }
        />
      </Card>
    );
  }

  return (
    <>
      {data?.currencyFallback ? (
        <Callout tone="warning" title="Values in USD">
          {data.currencyFallback.reason}. Every figure on this page is in US dollars until the rate is back.
        </Callout>
      ) : null}
      <AssetsSummary summary={summary} currency={currency} loading={loading} scopeShare={scopeShare} stale={pending} floor={floor} />
      {/* Lite: the holdings list is the page; allocation, movers and staking coverage are analysis.
          Pro: three across from 1440 px; below, two and the staking card under them
          (a 1280 px third leaves the movers' bars no room). */}
      {lite ? null : (
        <div className="grid gap-[var(--d-gap)] md:grid-cols-2 min-[90rem]:grid-cols-3">
          <AllocationCard
            data={data}
            groups={groups}
            currency={currency}
            loading={loading}
            pending={pending}
            refreshing={refreshing}
            singleChain={singleChain}
          />
          <MoversCard
            data={data}
            groups={groups}
            marketPct={marketPct}
            currency={currency}
            loading={loading}
            pending={pending}
            refreshing={refreshing}
          />
          <StakingCoverageCard
            data={data}
            bondDenomOf={bondDenomOf}
            stats={chainStats}
            currency={currency}
            loading={loading}
            pending={pending}
            refreshing={refreshing}
            className="md:col-span-2 min-[90rem]:col-span-1"
          />
        </div>
      )}
      <HoldingsCard
        data={data}
        markets={marketByKey}
        currency={currency}
        loading={loading}
        pending={pending}
        refreshing={refreshing}
        singleChain={singleChain}
        scopeLabel={scopeLabel}
        skipped={portfolio.accounts.skipped}
        bondDenomOf={bondDenomOf}
        floor={floor}
      />
    </>
  );
}
