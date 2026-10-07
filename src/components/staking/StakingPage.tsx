"use client";

/**
 * /staking — the connected wallet's stake across the scope (spec §6).
 *
 * Order (spec §6 Staking): the six figures; what needs doing now (stake on a
 * validator that earns nothing, with the move that fixes it); positions
 * grouped by network with risk badges and row actions; the unbonding
 * timeline when something is coming back; then two columns — the rewards
 * forecast beside the stake mix and its health checks, with the APR
 * comparison and the idle balance under them. Both columns size to their
 * content, so a tall simulator never leaves a hole beside a short card.
 *
 * A wallet known not to stake anywhere in scope (every chain answered) gets
 * the "start staking" summary instead of six empty figures and an empty
 * table; one with no address on any network in scope gets a card that says
 * so (nothing was read, so nothing is claimed about its stake).
 *
 * Prices and APRs arrive from a second read (`/api/chains/stats`). The first
 * view waits briefly for it (see `useStakingView`); past that wait, what is
 * drawn from prices keeps a skeleton until they land, and a failed price
 * read says so with a Retry instead of calling every token unpriced.
 *
 * Deep links: `?action=claim[&chain=<id>]` opens the claim review;
 * `?action=delegate&chain=<id>` opens the stake sheet on that chain (Assets,
 * Insights); `?validator=<valoper>&chain=<id>` opens it on that validator (the
 * validator page's Delegate button); `?action=redelegate&validator=…&chain=…`
 * opens a move toward it; a bare `?chain=<id>` focuses the scope on that
 * chain ("View staking"). The query is cleared once handled, so a reload
 * does not reopen a sheet the user closed.
 */

import { Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, CardBody, CardHeader, EmptyState, Skeleton, toast } from "@/components/ui";
import { Page } from "@/components/shell/Page";
import { cn } from "@/lib/cn";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/lib/connect/context";
import { explainError } from "@/lib/tx/errors";
import { useChainScope } from "@/lib/useChainScope";
import { AttentionCallout } from "./AttentionCallout";
import { IdleCard } from "./IdleCard";
import { ConsiderValidatorsCard, NetworkAprCard } from "./OpportunityCards";
import { PositionsCard } from "./PositionsCard";
import { RewardsForecast } from "./RewardsForecast";
import { StakeMixCard } from "./StakeMixCard";
import { StakingKpis } from "./StakingKpis";
import { StartStaking } from "./StartStaking";
import { UnbondingTimeline } from "./UnbondingTimeline";
import { StakingFlowsProvider, useStakingFlows } from "./flows/StakingFlows";
import { useStakingView } from "./hooks";
import { knownNotStaking, positive } from "./model";

export function StakingPage() {
  return (
    <Page
      title="Staking"
      access="wallet"
      connectTitle="Connect to see your staking"
      connectDescription="Your stake on every network you follow: positions and validator health, rewards to claim, what is unbonding and when, and what restaking would add. Keys stay in your wallet."
    >
      <StakingFlowsProvider>
        <Suspense fallback={null}>
          <DeepLinks />
        </Suspense>
        <StakingContent />
      </StakingFlowsProvider>
    </Page>
  );
}

/** Opens the sheet a link asked for, once, then clears the query. */
function DeepLinks() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const flows = useStakingFlows();
  const { followedAll, setSelectedChainId } = useChainScope();
  const handled = useRef<string | null>(null);

  const action = search.get("action");
  const validator = search.get("validator");
  const rawChain = search.get("chain") ?? search.get("chainId");
  const chain = rawChain && findChain(rawChain) ? rawChain : null;
  const key = action || validator || chain ? search.toString() : null;

  useEffect(() => {
    if (!key || handled.current === key) return;
    handled.current = key;
    if (action === "claim") {
      flows.open({ kind: "claim", chainIds: chain ? [chain] : undefined });
    } else if (action === "redelegate" && validator && chain) {
      flows.open({ kind: "redelegate", chainId: chain, dst: validator });
    } else if (action === "delegate" || validator) {
      flows.open({ kind: "delegate", chainId: chain ?? undefined, validator: validator ?? undefined });
    } else if (chain && followedAll.includes(chain)) {
      // "View staking" for one chain: the rail's own selection, so the whole
      // page (and every other page) follows until the user picks again.
      setSelectedChainId(chain);
    }
    router.replace(pathname, { scroll: false });
  }, [key, action, validator, chain, flows, router, pathname, followedAll, setSelectedChainId]);

  return null;
}

/**
 * Two columns from `lg`, one below. Under `lg` the column wrappers are
 * `display: contents`, so the cards join one stack and `order` interleaves
 * them by priority (actionable first) instead of left column, then right.
 */
function Columns({ left, right, stretch = false }: { left: ReactNode; right: ReactNode; stretch?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-[var(--d-gap)] lg:grid lg:grid-cols-12", stretch ? "lg:items-stretch" : "lg:items-start")}>
      <div className="contents lg:col-span-7 lg:flex lg:min-w-0 lg:flex-col lg:gap-[var(--d-gap)] lg:[&>*:last-child]:grow">{left}</div>
      <div className="contents lg:col-span-5 lg:flex lg:min-w-0 lg:flex-col lg:gap-[var(--d-gap)] lg:[&>*:last-child]:grow">{right}</div>
    </div>
  );
}

/** Stacking order under `lg` (see `Columns`). */
const ORDER = {
  mix: "max-lg:order-1",
  idle: "max-lg:order-2",
  unbonding: "max-lg:order-3",
  forecast: "max-lg:order-4",
  next: "max-lg:order-5",
} as const;

/**
 * A card drawn from prices while the first prices are still on their way:
 * its title and a block of skeleton, so the forecast never starts on a
 * fallback chain and the stake mix never reads "nothing staked".
 */
function PricedCardSkeleton({ title, label, height }: { title: string; label: string; height: number }) {
  return (
    <Card as="section" aria-label={label} aria-busy>
      <CardHeader title={title} subtitle="Reading prices…" />
      <CardBody>
        <Skeleton className="w-full rounded-[12px]" height={height} />
      </CardBody>
    </Card>
  );
}

/**
 * No network in scope has an address from this wallet (another key scheme,
 * or a phone session that left it out): nothing was read, so the page says
 * that instead of "you're not staking", and offers to add the network.
 */
function NoAddressCard({ chainIds }: { chainIds: string[] }) {
  const wallet = useWallet();
  const first = chainIds[0] ?? null;
  const name = (id: string) => findChain(id)?.chainName ?? id;
  const listed = chainIds.length <= 2 ? chainIds.map(name).join(" and ") : `${chainIds.length} networks in this scope`;
  const phone = wallet.walletKind === "zunia-mobile";
  return (
    <Card as="section" aria-label="Positions">
      <EmptyState
        icon="staking"
        title={`Your wallet hasn't shared an address on ${listed}`}
        body={
          phone
            ? "Your stake is read from your address on each network. Pair again and approve the network on your phone to see it here."
            : "Your stake is read from your address on each network. Add the network in your wallet to see it here."
        }
        action={
          first && !phone ? (
            <Button
              size="sm"
              iconLeft="plus"
              onClick={() => {
                wallet.ensureChain(first).catch((error: unknown) => {
                  const explained = explainError(error);
                  toast.error(explained.title, { description: explained.message });
                });
              }}
            >
              Add {name(first)}
            </Button>
          ) : undefined
        }
      />
    </Card>
  );
}

function StakingContent() {
  const state = useStakingView();
  const flows = useStakingFlows();
  const { view, currency, loading, pending, statsLoading, statsError } = state;
  // Single-chain mode follows the data on screen, not the scope alone: while
  // a new scope loads, the previous answer stays (dimmed), and its first
  // chain must not be presented as "the" chain of the new scope.
  const onlyChain = view && view.chains.length === 1 ? view.chains[0] : null;
  const single = state.single && onlyChain && onlyChain.chainId === state.chainIds[0] ? onlyChain : null;
  const hasStake = Boolean(view && view.chains.some((chain) => positive(chain.staked)));
  const notStaking = Boolean(view && knownNotStaking(view));
  const mine = useMemo(
    () => new Set((single?.positions ?? []).filter((p) => positive(p.amount)).map((p) => p.validator.operatorAddress)),
    [single],
  );
  const unbondingDays = (chainId: string) => state.statsFor(chainId)?.unbondingDays ?? null;
  const scopeChainId = state.single ? (state.chainIds[0] ?? null) : null;
  // Across networks the forecast and the mix add chains up by value, so
  // they wait for the first prices; one chain works in its own tokens.
  const pricedAcross = statsLoading && !single;

  const nextCard = (className?: string) =>
    scopeChainId ? (
      <div className={className}>
        <ConsiderValidatorsCard
          chainId={scopeChainId}
          chainName={single?.chainName ?? findChain(scopeChainId)?.chainName ?? scopeChainId}
          mine={mine}
        />
      </div>
    ) : (
      <div className={className}>
        <NetworkAprCard
          chainIds={state.chainIds}
          statsFor={state.statsFor}
          loading={statsLoading}
          error={statsError}
          onRetry={state.retryStats}
        />
      </div>
    );

  const idleCard = (className?: string) => (
    <div className={className}>
      <IdleCard
        items={state.idle}
        currency={currency}
        // Its rates and values come from the prices read: a skeleton until
        // then, not "APR unavailable" rows that reorder when they land.
        loading={state.idleLoading || statsLoading}
        error={state.idleError}
        ratesError={statsError}
        single={scopeChainId !== null}
      />
    </div>
  );

  if (!view && !loading && !state.error && state.chainIds.length === 0 && state.skipped.length > 0) {
    return <NoAddressCard chainIds={state.skipped} />;
  }

  if (view && notStaking) {
    const idleWorthShowing = state.idle.length > 0 || state.idleLoading || state.idleError;
    return (
      <>
        <StartStaking
          idle={state.idle}
          idleLoading={state.idleLoading}
          idleError={state.idleError}
          statsLoading={statsLoading}
          chainIds={state.chainIds}
          statsFor={state.statsFor}
          currency={currency}
          singleChainId={scopeChainId}
          pending={pending}
          skipped={state.skipped.map((id) => findChain(id)?.chainName ?? id)}
        />
        {idleWorthShowing ? (
          <Columns stretch left={nextCard(cn(ORDER.next, "[&>*]:h-full"))} right={idleCard(cn(ORDER.idle, "[&>*]:h-full"))} />
        ) : scopeChainId ? (
          // One chain, nothing to stake: its validators beside its unbonding period.
          <Columns
            stretch
            left={nextCard(cn(ORDER.next, "[&>*]:h-full"))}
            right={
              <div className={cn(ORDER.unbonding, "[&>*]:h-full")}>
                <UnbondingTimeline timeline={[]} chains={view.chains} currency={currency} unbondingDays={unbondingDays} pending={pending} />
              </div>
            }
          />
        ) : (
          // The network comparison already lists every unbonding period.
          nextCard()
        )}
      </>
    );
  }

  return (
    <>
      <StakingKpis
        view={view}
        currency={currency}
        single={single}
        loading={loading && !view}
        // Set only when the read failed with nothing to show (view is null);
        // a Retry turns it back into loading, so the skeletons return.
        failed={state.error !== null}
        pricesLoading={statsLoading}
        pricesError={statsError}
        pending={pending}
        onClaim={() => flows.open({ kind: "claim", chainIds: (view?.claimable ?? []).map((chain) => chain.chainId) })}
      />

      {view ? <AttentionCallout chains={view.chains} /> : null}

      <PositionsCard
        chains={view?.chains ?? null}
        currency={currency}
        single={single !== null}
        loading={loading && !view}
        pricesLoading={statsLoading}
        pricesError={statsError}
        pending={pending}
        error={state.error}
        onRetry={state.retry}
        skipped={state.skipped.map((id) => findChain(id)?.chainName ?? id)}
        totalValue={view?.totals.stakedValue ?? null}
      />

      {view && view.timeline.length > 0 ? (
        <UnbondingTimeline timeline={view.timeline} chains={view.chains} currency={currency} unbondingDays={unbondingDays} pending={pending} wide />
      ) : null}

      {view ? (
        // Which card goes where balances the columns: the simulator is the
        // tallest card, so the left takes the shorter companion (the APR
        // comparison across chains; the one-chain idle line in one scope)
        // and the right the stake mix with the other.
        <Columns
          left={
            <>
              {hasStake ? (
                <div className={ORDER.forecast}>
                  {pricedAcross ? (
                    <PricedCardSkeleton title="Rewards forecast" label="Rewards forecast" height={320} />
                  ) : (
                    <RewardsForecast view={view} currency={currency} single={single} pending={pending} />
                  )}
                </div>
              ) : null}
              {scopeChainId ? idleCard(ORDER.idle) : nextCard(ORDER.next)}
              {/* Nothing pending: one chain still states its unbonding period
                  (across chains the APR comparison lists them all). */}
              {view.timeline.length === 0 && scopeChainId ? (
                <div className={ORDER.unbonding}>
                  <UnbondingTimeline timeline={[]} chains={view.chains} currency={currency} unbondingDays={unbondingDays} pending={pending} />
                </div>
              ) : null}
            </>
          }
          right={
            <>
              {hasStake ? (
                <div className={ORDER.mix}>
                  {pricedAcross ? (
                    <PricedCardSkeleton title="Stake mix" label="Stake mix and health" height={240} />
                  ) : (
                    <StakeMixCard chains={view.chains} currency={currency} single={single} pending={pending} pricesError={statsError} />
                  )}
                </div>
              ) : null}
              {scopeChainId ? nextCard(ORDER.next) : idleCard(ORDER.idle)}
            </>
          }
        />
      ) : null}
    </>
  );
}
