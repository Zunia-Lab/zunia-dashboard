"use client";

/**
 * Insights: the decision centre (design spec §6). Everything the rules in
 * `@/lib/insights` find for the current scope, sorted into what to do now,
 * what can be gained and what to keep an eye on, each with its numbers, one
 * action and how it was measured.
 *
 * Around the list, the reading aids a decision needs: a summary by severity,
 * where the insights are (network by network, or the selected chain's
 * staking economics), how concentrated the priced value is, the security
 * review with a fix on every row, and a way into /compare.
 *
 * It reads the same URLs as the Overview (portfolio, staking, chain stats,
 * voting proposals, security review): the shared store makes each one
 * request, whichever page asked first. Every card follows the scope and keeps
 * its previous answer on screen, dimmed, while a new scope loads.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Page } from "@/components/shell/Page";
import { Button, Callout, EmptyState, InlineError, useNow, useReducedMotion, type PartialError } from "@/components/ui";
import { useChainStats } from "@/lib/data/chains";
import { useProposals } from "@/lib/data/governance";
import { usePortfolio } from "@/lib/data/portfolio";
import { useSecurityReview, useStakingPositions } from "@/lib/data/staking";
import { findChain } from "@/lib/chains";
import { INSIGHT_PROPOSALS, useInsights, type Insight } from "@/lib/insights";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { ByNetworkCard } from "./ByNetworkCard";
import { ChainContextCard } from "./ChainContextCard";
import { CompareTeaser } from "./CompareTeaser";
import { ConcentrationCard } from "./ConcentrationCard";
import { InsightGroupCard } from "./InsightList";
import { InsightsSummary } from "./InsightsSummary";
import { countBySeverity, nextSteps, splitByGroup, summaryText } from "./model";
import { SecurityReview } from "./SecurityReview";

/** Sections a link can land on (`/insights#security` from a security insight). */
const ANCHORS = new Set(["do-now", "opportunities", "risks", "security"]);

/**
 * From 900px of page width, two columns that stack independently: the three
 * lists on the left, the analysis beside them on the right, so a long list
 * never leaves a hole under a short card. Below that one column, where the
 * two column wrappers dissolve (`display: contents`) and `order` interleaves
 * the cards: each list is followed by the reading aid that belongs to it.
 */
const BOARD = "flex flex-col gap-[var(--d-gap)] @min-[900px]:grid @min-[900px]:grid-cols-12 @min-[900px]:items-start";
const COLUMN = "contents @min-[900px]:flex @min-[900px]:min-w-0 @min-[900px]:flex-col @min-[900px]:gap-[var(--d-gap)]";
const MAIN = `${COLUMN} @min-[900px]:col-span-7 @min-[1080px]:col-span-8`;
const SIDE = `${COLUMN} @min-[900px]:col-span-5 @min-[1080px]:col-span-4`;

export function InsightsPage() {
  return (
    <Page
      title="Insights"
      access="wallet"
      connectTitle="What to do next, measured from your own wallet"
      connectDescription="Connect a wallet to see rewards worth claiming, votes closing, idle balances that could earn, validator and chain risks, concentration, and who can act for your accounts. Reading signs nothing."
    >
      <InsightsBody />
    </Page>
  );
}

function InsightsBody() {
  const insights = useInsights();
  // The same reads the hook makes (one request each): here for retry, the
  // side cards and the security review's detail.
  const portfolio = usePortfolio();
  const staking = useStakingPositions();
  const stats = useChainStats();
  const proposals = useProposals(INSIGHT_PROPOSALS);
  const security = useSecurityReview();
  const { selectedChain, scopedChainIds, selectChain } = useChainScope();
  const now = useNow();
  const reduced = useReducedMotion();

  const { setInsightsOn, lite } = usePrefs();
  const groups = useMemo(() => splitByGroup(insights.items), [insights.items]);
  const hiddenGroups = useMemo(() => splitByGroup(insights.hiddenItems), [insights.hiddenItems]);
  const steps = useMemo(() => nextSteps(groups), [groups]);
  const counts = useMemo(() => countBySeverity(insights.items), [insights.items]);
  const networks = scopedChainIds.length;
  const where = selectedChain ? `on ${selectedChain.chainName}` : `on ${networks} ${networks === 1 ? "network" : "networks"}`;
  const scopeLabel = selectedChain ? selectedChain.chainName : `All chains · ${networks} ${networks === 1 ? "network" : "networks"}`;

  const errors: PartialError[] = [
    ...insights.errors.map((message) => ({ scope: "Insights", message })),
    ...(portfolio.data?.errors ?? []),
  ];
  const partial = errors.length > 0;
  // Neither of the reads every insight is measured from answered.
  const nothingRead = portfolio.status === "error" && staking.status === "error" && insights.items.length === 0;
  const text = summaryText(groups, where, partial, nothingRead, insights.hiddenItems.length);
  // Scope change: the lists still show the previous scope's answer.
  const pending = portfolio.stale || staking.stale;

  const retry = () => {
    portfolio.refetch();
    staking.refetch();
    stats.refetch();
    proposals.refetch();
    security.refetch();
  };

  const focusChain = useCallback(
    (chainId: string) => {
      selectChain(chainId);
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    },
    [reduced, selectChain],
  );

  // A link to a section (`/insights#security`) lands on it, and again once
  // the cards above it have loaded and pushed it down, unless the reader has
  // started scrolling in the meantime.
  const pendingAnchor = useRef<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!ANCHORS.has(hash)) return;
    pendingAnchor.current = hash;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
    const cancel = () => {
      pendingAnchor.current = null;
    };
    window.addEventListener("wheel", cancel, { once: true, passive: true });
    window.addEventListener("touchmove", cancel, { once: true, passive: true });
    window.addEventListener("keydown", cancel, { once: true });
    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchmove", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, []);
  const settled = !insights.loading && !security.loading;
  useEffect(() => {
    if (!settled || !pendingAnchor.current) return;
    const target = pendingAnchor.current;
    pendingAnchor.current = null;
    const frame = window.requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [settled]);

  if (!insights.enabled) {
    return (
      <div className="d-card px-[var(--d-pad)]">
        <EmptyState
          icon="insights"
          title="Insights are off"
          body="Turn them on to see rewards worth claiming, votes closing, idle balances that could earn and risks found on your chains. They are worked out on this device from what the dashboard already reads."
          action={
            <Button variant="primary" size="sm" onClick={() => setInsightsOn(true)}>
              Turn insights on
            </Button>
          }
        />
      </div>
    );
  }

  if (scopedChainIds.length === 0) {
    return (
      <div className="d-card px-[var(--d-pad)]">
        <EmptyState
          icon="networks"
          title="No networks followed on this slice"
          body="Follow at least one network to get insights about it."
          action={
            <Button variant="primary" size="sm" href="/networks">
              Manage networks
            </Button>
          }
        />
      </div>
    );
  }

  if (portfolio.status === "idle" && staking.status === "idle") {
    const skipped = portfolio.accounts.skipped.map((chainId) => findChain(chainId)?.chainName ?? chainId);
    return (
      <Callout tone="warning" title="No address for these networks">
        Your wallet hasn&apos;t shared an address on {skipped.length > 0 ? skipped.join(", ") : "the selected networks"}, so there is nothing to
        read. Approve them in your wallet, or pick another scope on the rail.
      </Callout>
    );
  }

  const listState = { loading: insights.loading, pending, refreshing: insights.refreshing, partial, onDismiss: (insight: Insight) => insights.dismiss([insight]) };

  return (
    <div className="@container flex flex-col gap-[var(--d-gap)]">
      {portfolio.data?.currencyFallback ? (
        <Callout tone="neutral" icon="info">
          Values are shown in USD: {portfolio.data.currencyFallback.reason}
        </Callout>
      ) : null}

      <InsightsSummary
        items={insights.items}
        steps={steps}
        counts={counts}
        text={text}
        scopeLabel={scopeLabel}
        loading={insights.loading}
        refreshing={insights.refreshing}
        errors={errors}
        // The shared clock ticks every 30 s: a read newer than its last tick
        // would read "in under a minute", so it is shown as now.
        updatedAt={portfolio.updatedAt !== null && now !== null ? Math.min(portfolio.updatedAt, now) : portfolio.updatedAt}
        failed={nothingRead}
        hidden={insights.hiddenItems.length}
        onClearAll={insights.clearAll}
        onRestore={insights.restore}
        onOpenStep={(step) => insights.dismiss([step])}
        severity={!lite}
      />

      {/* Nothing was read: three empty lists would only repeat it. The
          security review below has its own read and still shows. */}
      {nothingRead ? (
        <InlineError
          title="Couldn't read your balances or staking"
          message="The networks may be slow to answer. Retry, or come back in a minute: what you hold has not changed."
          onRetry={retry}
          retrying={portfolio.refreshing || staking.refreshing}
        />
      ) : (
        /* What to act on and keep an eye on, beside where it is (or, on one
           chain, that chain's economics) and how concentrated the value is. */
        // Lite: the three lists in one column; where they are, the chain's
        // economics and concentration are analysis.
        <div className={lite ? "flex flex-col gap-[var(--d-gap)]" : BOARD}>
          <div className={lite ? "contents" : MAIN}>
            <InsightGroupCard group="do-now" items={groups["do-now"]} hidden={hiddenGroups["do-now"].length} className="order-1" {...listState} />
            <InsightGroupCard group="opportunities" items={groups.opportunities} hidden={hiddenGroups.opportunities.length} limit={4} className="order-2" {...listState} />
            <InsightGroupCard group="risks" items={groups.risks} hidden={hiddenGroups.risks.length} limit={5} className="order-4" {...listState} />
          </div>
          {lite ? null : (
            <div className={SIDE}>
              {selectedChain ? (
                <ChainContextCard chain={selectedChain} stats={stats} staking={staking} className="order-3" />
              ) : (
                <ByNetworkCard
                  items={insights.items}
                  chainIds={scopedChainIds}
                  portfolio={portfolio.data}
                  loading={insights.loading}
                  pending={pending}
                  onSelect={focusChain}
                  className="order-3"
                />
              )}
              <ConcentrationCard portfolio={portfolio} singleChain={Boolean(selectedChain)} className="order-5" />
            </div>
          )}
        </div>
      )}

      <SecurityReview state={security} now={now} />

      {lite ? null : <CompareTeaser portfolio={portfolio} singleChain={Boolean(selectedChain)} />}
    </div>
  );
}
