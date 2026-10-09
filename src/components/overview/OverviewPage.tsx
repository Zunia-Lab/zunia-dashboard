"use client";

/**
 * Overview: the decision desk's first screen (design spec §6).
 *
 * Row by row: net worth with its history next to the allocation; six key
 * figures; insights; the chains side by side (or, with one chain in scope,
 * that chain's vital signs); top assets next to recent activity; governance
 * deadlines next to unbonding releases. An empty wallet gets an onboarding
 * card instead of a page of zeros.
 *
 * Every read follows the chain scope and keeps its previous answer on screen,
 * dimmed, while a new scope loads; each card owns its loading, empty and
 * error states, so one slow node never blanks the page. The page lays itself
 * out on its own width (container queries), not the viewport's, so it fits
 * whatever the shell around it takes.
 */

import { useCallback } from "react";
import { Page } from "@/components/shell/Page";
import { Button, Callout, EmptyState, useNow, useReducedMotion } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { useChainStats } from "@/lib/data/chains";
import { useProposals } from "@/lib/data/governance";
import { useMarkets } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { useStakingPositions } from "@/lib/data/staking";
import { INSIGHT_PROPOSALS, useInsights } from "@/lib/insights";
import { useActivity } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";
import { HOME_CHAIN_ID } from "@/providers/WalletProvider";
import { AllocationCard } from "./AllocationCard";
import { ChainHeader } from "./ChainHeader";
import { ChainsBreakdown } from "./ChainsBreakdown";
import { GovernanceDeadlines } from "./GovernanceDeadlines";
import { InsightsRow } from "./InsightsRow";
import { KpiStrip } from "./KpiStrip";
import { NetWorthCard, type ScopeInfo } from "./NetWorthCard";
import { OverviewOnboarding } from "./OverviewOnboarding";
import { RecentActivity } from "./RecentActivity";
import { TopAssets } from "./TopAssets";
import { UnbondingReleases } from "./UnbondingReleases";

const chainName = (chainId: string) => findChain(chainId)?.chainName ?? chainId;

export function OverviewPage() {
  return (
    <Page
      title="Overview"
      access="wallet"
      connectTitle="Everything you hold across Cosmos, in one view"
      connectDescription="Connect a wallet to see your net worth, staking yield, allocation, insights and activity on every chain you follow. Reading is free and signs nothing."
    >
      <OverviewBody />
    </Page>
  );
}

function OverviewBody() {
  const { selectedChain, scopedChains, scopedChainIds, selectChain } = useChainScope();
  const portfolio = usePortfolio();
  const staking = useStakingPositions();
  const stats = useChainStats();
  const proposals = useProposals(INSIGHT_PROPOSALS);
  const activity = useActivity();
  const markets = useMarkets();
  const insights = useInsights();
  const now = useNow();
  const reduced = useReducedMotion();

  const scope: ScopeInfo = {
    selected: selectedChain ?? null,
    chains: scopedChains,
    clear: () => selectChain(null),
  };

  // A chain row puts the whole dashboard on that chain; back to the top so
  // its hero is what the reader sees next (the document scrolls, not a box).
  const focusChain = useCallback(
    (chainId: string) => {
      selectChain(chainId);
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    },
    [reduced, selectChain],
  );

  const data = portfolio.data;
  const skipped = portfolio.accounts.skipped.map(chainName);

  if (scopedChainIds.length === 0) {
    return (
      <div className="d-card px-[var(--d-pad)]">
        <EmptyState
          icon="networks"
          title="No networks followed on this slice"
          body="Follow at least one network to see balances, staking and activity here."
          action={
            <Button variant="primary" size="sm" href="/networks">
              Manage networks
            </Button>
          }
        />
      </div>
    );
  }

  if (portfolio.status === "idle") {
    return (
      <Callout tone="warning" title="No address for these networks">
        Your wallet hasn&apos;t shared an address on {skipped.length > 0 ? skipped.join(", ") : "the selected networks"}, so there is
        nothing to read. Approve them in your wallet, or pick another scope on the rail.
      </Callout>
    );
  }

  // Empty only when every chain answered: a failed read is never a zero.
  const empty =
    portfolio.status === "ready" &&
    !portfolio.stale &&
    data !== null &&
    data.totals.assetCount === 0 &&
    data.chains.every((chain) => chain.status === "ok");

  // Row 1 shares one height (Allocation centres its donut in the hero's), but
  // not around an error: a callout stretched to its neighbour's height is a
  // tall empty card. The lists further down never stretch: a card as tall as
  // its neighbour holds empty space under a short list.
  const portfolioFailed = portfolio.status === "error" && !data;

  // The address the onboarding card offers to copy: the selected chain's,
  // else the home chain's, else the first one read.
  const accounts = portfolio.accounts.accounts;
  const firstAccount =
    accounts.find((account) => account.chainId === (selectedChain?.chainId ?? HOME_CHAIN_ID)) ?? accounts[0] ?? null;

  return (
    <div className="@container flex flex-col gap-[var(--d-gap)]">
      {data?.currencyFallback ? (
        <Callout tone="neutral" icon="info">
          Values are shown in USD: {data.currencyFallback.reason}
        </Callout>
      ) : null}

      {empty ? (
        <>
          <OverviewOnboarding scope={scope} address={firstAccount} />
          {/* An emptied wallet can still have history; a new one has none to
              show, and governance on the followed chains is worth seeing
              either way. */}
          <div className="grid grid-cols-1 items-start gap-[var(--d-gap)] @min-[760px]:grid-cols-2">
            {activity.items.length > 0 || activity.loading ? (
              <div className="min-w-0">
                <RecentActivity activity={activity} />
              </div>
            ) : null}
            <div className={cn("min-w-0", !(activity.items.length > 0 || activity.loading) && "@min-[760px]:col-span-2")}>
              <GovernanceDeadlines proposals={proposals} now={now} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-1 gap-[var(--d-gap)] @min-[880px]:grid-cols-12",
              portfolioFailed ? "items-start" : "items-stretch",
            )}
          >
            <div className="min-w-0 @min-[880px]:col-span-7 @min-[1000px]:col-span-8">
              <NetWorthCard state={portfolio} scope={scope} />
            </div>
            <div className="min-w-0 @min-[880px]:col-span-5 @min-[1000px]:col-span-4">
              <AllocationCard state={portfolio} singleChain={Boolean(selectedChain)} />
            </div>
          </div>

          <KpiStrip
            portfolio={portfolio}
            staking={staking}
            stats={stats}
            proposals={proposals}
            scopedCount={scopedChainIds.length}
            selectedChainId={selectedChain?.chainId ?? null}
            now={now}
            chainName={chainName}
            // A fact about the rewards, not a suggestion: it holds whether or not the reader hid the insight.
            claimWorthIt={insights.all.some((item) => item.kind === "claim" || item.kind === "compounding")}
          />

          {/* Turned off in Settings: the row goes, the cards below move up. */}
          {insights.enabled ? (
            <div className="mt-1">
              <InsightsRow insights={insights} />
            </div>
          ) : null}

          {selectedChain ? (
            <ChainHeader chain={selectedChain} stats={stats} staking={staking} />
          ) : (
            <ChainsBreakdown portfolio={portfolio} stats={stats} onSelect={focusChain} skipped={skipped} />
          )}

          <div className="grid grid-cols-1 items-start gap-[var(--d-gap)] @min-[880px]:grid-cols-12">
            <div className="min-w-0 @min-[880px]:col-span-7">
              <TopAssets portfolio={portfolio} markets={markets} />
            </div>
            <div className="min-w-0 @min-[880px]:col-span-5">
              <RecentActivity activity={activity} />
            </div>
          </div>

          {/* The same 7/5 split as the row above from 880 px, so the gutter
              runs straight down the page; two halves in between (the row
              above is stacked there, so there is nothing to line up with).
              The 880 rule is emitted after the 760 one, so it wins. */}
          <div className="grid grid-cols-1 items-start gap-[var(--d-gap)] @min-[760px]:grid-cols-2 @min-[880px]:grid-cols-12">
            <div className="min-w-0 @min-[880px]:col-span-7">
              <GovernanceDeadlines proposals={proposals} now={now} />
            </div>
            <div className="min-w-0 @min-[880px]:col-span-5">
              <UnbondingReleases staking={staking} portfolio={portfolio} stats={stats} now={now} selectedChain={selectedChain ?? null} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
