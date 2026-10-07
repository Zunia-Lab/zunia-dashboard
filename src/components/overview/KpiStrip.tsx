"use client";

/**
 * Six figures under the hero: what staking earns, what can be claimed, how
 * much of the stakeable tokens is staked, how many networks answered (with
 * one chain in scope: which validators its stake sits with), how many assets
 * are held (and how many have no price), and the votes waiting.
 *
 * Each one is computed from the same reads as the rest of the page
 * (`./model.ts`), and each says what it leaves out: a chain with an unknown
 * APR is named, not counted as 0 %, rewards without a price read "—", not
 * $0.00, and a read that failed reads "—" with the reason, never as a zero
 * ("0 open votes" when governance did not answer would be a false
 * all-clear).
 */

import { useMemo, type ReactNode } from "react";
import { Meter } from "@/components/charts";
import { Button, Dot, LogoStack, Money, Percent, StatTile, chainById } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ChainStatsState } from "@/lib/data/chains";
import type { ProposalsState } from "@/lib/data/governance";
import type { PortfolioState } from "@/lib/data/portfolio";
import type { StakingPositionsState } from "@/lib/data/staking";
import { untilText } from "@/lib/insights/rules";
import { groupAssets } from "@/lib/token/holdings";
import {
  assetCounts,
  rewardChainCount,
  stakedRatio,
  stakingDenomMap,
  unpricedByType,
  unreadByType,
  validatorsUsed,
  voteSummary,
  yieldEstimate,
} from "./model";

export interface KpiStripProps {
  portfolio: PortfolioState;
  staking: StakingPositionsState;
  stats: ChainStatsState;
  proposals: ProposalsState;
  /** Chains in scope (followed on the slice, or the selected one). */
  scopedCount: number;
  /** The rail's chain when one is selected: the Networks tile becomes its validators. */
  selectedChainId: string | null;
  now: number | null;
  chainName: (chainId: string) => string;
  /**
   * Some chain's rewards pass the insight rules' fee test (worth ≥ 3 claim
   * fees and one currency unit): only then is "Claim all" the primary action.
   */
  claimWorthIt: boolean;
}

/** Why a balance-derived tile reads "—" when the portfolio read failed. */
const BALANCES_FAILED = "Balances could not be read";

const INFO = "max-w-[280px] text-[12.5px] leading-snug text-fg-muted";

/**
 * A tile's second line while it loads: StatTile draws the line's skeleton
 * only when there is a line to come, and a tile that grows a line when its
 * data lands pushes the whole strip down.
 */
function line(sub: ReactNode, loading: boolean): ReactNode {
  return sub ?? (loading ? "…" : undefined);
}

export function KpiStrip({ portfolio, staking, stats, proposals, scopedCount, selectedChainId, now, chainName, claimWorthIt }: KpiStripProps) {
  const data = portfolio.data;
  const currency = data?.currency ?? "usd";
  const portfolioFailed = portfolio.status === "error" && !data;
  const stakingFailed = staking.status === "error" && !staking.data;
  const statsFailed = stats.status === "error" && !stats.data;
  const votesFailed = proposals.status === "error" && !proposals.data;

  const estimate = data && !stakingFailed ? yieldEstimate(data, staking.data) : null;
  const denoms = stakingDenomMap(staking.data, stats.data?.chains);
  const ratio = data ? stakedRatio(data, denoms) : null;
  const holdings = useMemo(() => {
    if (!data) return null;
    const groups = groupAssets(data.assets);
    return {
      counts: assetCounts(groups, data.assets.length),
      top: groups.filter((group) => group.value !== null).slice(0, 3),
      unpricedRewards: unpricedByType(data.assets).rewards,
      unreadRewards: unreadByType(data.errors).rewards,
      rewardChains: rewardChainCount(data.assets),
    };
  }, [data]);
  const counts = holdings?.counts ?? null;
  const votes = now !== null && !votesFailed ? voteSummary(proposals.data?.proposals ?? [], now) : null;
  // Chains with rewards to claim, priced or not: a testnet's rewards are
  // real and claimable although their priced total is 0.
  const rewardChains = holdings?.rewardChains ?? 0;
  const unpricedRewards = holdings?.unpricedRewards ?? 0;
  const unreadRewards = holdings?.unreadRewards ?? 0;
  // Rewards held but none of them priced, or not read on some network: their
  // value is unknown, not $0.00.
  const claimValue =
    data && (data.totals.rewards > 0 || (unpricedRewards === 0 && unreadRewards === 0)) ? data.totals.rewards : null;
  const unreachable = data?.chains.filter((chain) => chain.status === "error").length ?? 0;
  const skipped = portfolio.accounts.skipped.length;
  const nextVoteIn = votes?.next?.votingEndTime && now !== null ? Date.parse(votes.next.votingEndTime) - now : null;
  // Who is behind three of the counts, as logos beside them: the chains
  // holding assets (largest first), the three largest assets, the chains
  // with a vote open to you.
  const heldChains = (data?.chains ?? [])
    .filter((chain) => chain.status === "ok" && chain.assetCount > 0)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    .map((chain) => ({ src: chain.iconUrl, label: chain.chainName }));
  const voteChains = votes
    ? votes.eligibleChains.map((id) => ({ src: chainById(id)?.iconUrl, label: chainById(id)?.chainName ?? id }))
    : [];
  // A new scope keeps the previous one's figures on screen until its reads
  // land: dimmed, like every card on the page.
  const stale = portfolio.stale || staking.stale || proposals.stale;

  const yieldLoading = portfolio.loading || staking.loading;
  const yieldValue = stakingFailed
    ? null
    : estimate
      ? (estimate.yearly ?? (estimate.missing.length > 0 ? null : 0))
      : null;
  const yieldReason = portfolioFailed
    ? BALANCES_FAILED
    : stakingFailed
      ? "Staking positions could not be read"
      : estimate && estimate.missing.length > 0
        ? "APR unknown on the chains you stake on"
        : undefined;
  const yieldSub = portfolioFailed ? (
    "balances unreadable"
  ) : stakingFailed ? (
    "staking unreadable"
  ) : estimate?.apr !== null && estimate?.apr !== undefined ? (
    <>
      <Percent value={estimate.apr * 100} digits={1} /> weighted APR
      {estimate.missing.length > 0 ? ` · excl. ${estimate.missing.map(chainName).join(", ")}` : ""}
    </>
  ) : estimate && estimate.missing.length > 0 ? (
    `APR unknown on ${estimate.missing.map(chainName).join(", ")}`
  ) : estimate && estimate.coveredValue === 0 ? (
    "Nothing staked yet"
  ) : undefined;

  // Without balances, or without staking positions and chain stats (which
  // token stakes where), say which read failed, not that nothing stakeable
  // is held.
  const ratioReason = portfolioFailed
    ? BALANCES_FAILED
    : denoms.size === 0 && (stakingFailed || statsFailed)
      ? "Staking data could not be read"
      : "No priced staking token in scope";
  const ratioSub =
    ratio && ratio.ratio !== null ? (
      <>
        {/* Two-across tiles on a phone keep the figure; the (i) says what the ratio is of. */}
        <span className="@max-[639px]:hidden">of stakeable · </span>
        {/* "Idle", as the Assets page calls it: the staking tokens not staked,
            not every liquid holding the hero's Liquid figure counts. */}
        <Money value={ratio.liquidValue} currency={currency} compact precision={2} /> idle
      </>
    ) : portfolioFailed ? (
      "balances unreadable"
    ) : data && denoms.size === 0 && (stakingFailed || statsFailed) ? (
      "staking unreadable"
    ) : undefined;

  // With one chain in scope, "1 / 1 networks" says nothing: the tile names
  // the validators that chain's stake sits with instead.
  const used = selectedChainId ? validatorsUsed(staking.chainFor(selectedChainId)) : null;
  // A previous scope's answer may not hold this chain yet: still loading.
  const usedLoading = staking.loading || (staking.stale && used === null);

  return (
    <section aria-label="Key figures" aria-busy={stale || undefined} className="@container">
      <div
        className={cn(
          // Six across only when each tile keeps ~230px: narrower, the
          // Claimable tile's label and its button no longer share a line.
          "grid grid-cols-2 gap-[var(--d-gap)] transition-opacity duration-[160ms] @[640px]:grid-cols-3 @[1460px]:grid-cols-6",
          stale && "opacity-60",
        )}
      >
        <StatTile
          label="Est. yearly yield"
          icon="trendingUp"
          loading={yieldLoading}
          value={<Money value={yieldValue} currency={currency} precision={2} reason={yieldReason} />}
          sub={line(yieldSub, yieldLoading)}
          info={
            <p className={INFO}>
              Each chain&apos;s staked value × the stake-weighted APR of your validators after their commission
              (actual APR: block-time corrected, mint rewards only, fees excluded). At today&apos;s prices and rates,
              so an estimate.
            </p>
          }
        />
        <StatTile
          className="@max-[639px]:order-first @max-[639px]:col-span-2"
          label="Claimable"
          icon="sparkle"
          tone={claimWorthIt ? "accent" : "default"}
          loading={portfolio.loading}
          value={
            // Cents, as the hero's Rewards figure prints the same amount.
            <Money
              value={claimValue}
              currency={currency}
              precision={2}
              reason={
                portfolioFailed
                  ? BALANCES_FAILED
                  : unpricedRewards > 0
                    ? "No price for these rewards"
                    : `Rewards not read on ${unreadRewards} ${unreadRewards === 1 ? "network" : "networks"}`
              }
            />
          }
          sub={line(
            portfolioFailed
              ? "balances unreadable"
              : data
                ? rewardChains > 0
                  ? `rewards on ${rewardChains} ${rewardChains === 1 ? "network" : "networks"}${unpricedRewards > 0 ? ` · ${unpricedRewards} unpriced` : ""}`
                  : unreadRewards > 0
                    ? `not read on ${unreadRewards} ${unreadRewards === 1 ? "network" : "networks"}`
                    : "no rewards yet"
                : undefined,
            portfolio.loading,
          )}
          info={
            <p className={INFO}>
              Staking rewards accrued on the chains in scope, valued at spot prices (rewards in a token without a price
              are counted, not valued). Claiming moves them to your liquid balance; Staking shows each chain&apos;s fee
              first.
            </p>
          }
          action={
            // Negative margins: the button may be taller than the label row
            // it sits in, but must not push this tile's figure below its
            // neighbours'.
            <Button
              size="sm"
              variant={claimWorthIt ? "primary" : "secondary"}
              href="/staking?action=claim"
              disabled={rewardChains === 0}
              aria-label="Claim all rewards"
              className="-my-1 h-7 px-2.5 text-[12.5px]"
            >
              {/* "Claim" alone in the narrowest three-across tiles. One
                  element: the button lays its children out with a gap. */}
              <span>
                Claim<span className="@min-[640px]:@max-[779px]:hidden"> all</span>
              </span>
            </Button>
          }
        />
        <StatTile
          label="Staked ratio"
          icon="staking"
          loading={portfolio.loading}
          value={
            <span className="flex items-center gap-3">
              <Percent value={ratio?.ratio != null ? ratio.ratio * 100 : null} digits={1} reason={ratioReason} />
              {ratio?.ratio != null ? (
                <Meter value={ratio.ratio} size="sm" ariaLabel="Staked share of stakeable tokens" className="w-full max-w-[96px]" />
              ) : null}
            </span>
          }
          sub={line(ratioSub, portfolio.loading)}
          info={
            <p className={INFO}>
              Staked value of each chain&apos;s staking token ÷ its staked, liquid and unbonding value; idle is the
              part neither staked nor unbonding. Other tokens (stablecoins, IBC assets) cannot be staked and are left
              out.
            </p>
          }
        />
        {selectedChainId ? (
          <StatTile
            label="Validators"
            icon="validators"
            href={`/validators?chain=${encodeURIComponent(selectedChainId)}`}
            loading={usedLoading}
            value={
              used ? (
                <span className="flex items-center gap-3">
                  {used.validators.length}
                  <LogoStack
                    size={18}
                    max={3}
                    items={used.validators.map((validator) => ({ src: validator.logoUrl, label: validator.moniker }))}
                    label={`Your stake is with ${used.validators.map((validator) => validator.moniker).join(", ")}`}
                  />
                </span>
              ) : (
                "—"
              )
            }
            sub={line(
              used ? (
                used.validators.length === 0 ? (
                  "nothing staked here"
                ) : used.idle > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Dot tone="warning" />
                    {used.idle} not earning
                  </span>
                ) : (
                  "all in the active set"
                )
              ) : usedLoading ? undefined : (
                "staking unreadable"
              ),
              usedLoading,
            )}
            info={
              <p className={INFO}>
                Validators your stake on {chainName(selectedChainId)} sits with. One outside the active set, jailed or
                tombstoned earns nothing for the stake it holds.
              </p>
            }
          />
        ) : (
          <StatTile
            label="Networks"
            icon="networks"
            href="/networks"
            loading={portfolio.loading}
            value={
              data ? (
                <span className="flex items-center gap-3">
                  <span>
                    {data.totals.chainCount}
                    <span className="text-[16px] font-medium text-fg-dim"> / {scopedCount}</span>
                  </span>
                  <LogoStack size={18} max={4} items={heldChains} label={`Holding assets: ${heldChains.map((chain) => chain.label).join(", ")}`} />
                </span>
              ) : (
                "—"
              )
            }
            sub={line(
              portfolioFailed ? (
                "balances unreadable"
              ) : unreachable > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone="warning" />
                  {unreachable} unreachable
                </span>
              ) : skipped > 0 ? (
                `${skipped} without an address`
              ) : data ? (
                "with assets"
              ) : undefined,
              portfolio.loading,
            )}
          />
        )}
        <StatTile
          label="Assets"
          icon="assets"
          href="/assets"
          loading={portfolio.loading}
          value={
            counts ? (
              <span className="flex items-center gap-3">
                {counts.assets}
                <LogoStack
                  size={18}
                  items={(holdings?.top ?? []).map((group) => ({ src: group.identity.logoUrl, label: group.identity.ticker }))}
                  label={`Largest: ${(holdings?.top ?? []).map((group) => group.identity.ticker).join(", ")}`}
                />
              </span>
            ) : (
              "—"
            )
          }
          sub={line(
            counts ? (
              counts.unpriced > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone="warning" />
                  {counts.unpriced} without a price
                </span>
              ) : (
                "all priced"
              )
            ) : portfolioFailed ? (
              "balances unreadable"
            ) : undefined,
            portfolio.loading,
          )}
          info={
            counts ? (
              <p className={INFO}>
                An asset held on several chains counts once: {counts.assets} {counts.assets === 1 ? "asset" : "assets"} in{" "}
                {counts.holdings} {counts.holdings === 1 ? "balance" : "balances"}. Unpriced ones are shown in their own units and
                left out of net worth.
              </p>
            ) : undefined
          }
        />
        <StatTile
          className="@max-[639px]:col-span-2"
          label="Open votes"
          icon="governance"
          href="/governance"
          tone={votes && votes.awaiting > 0 && nextVoteIn !== null && nextVoteIn < 48 * 3_600_000 ? "warning" : "default"}
          loading={proposals.loading || now === null}
          value={
            votes ? (
              <span className="flex items-center gap-3">
                {votes.eligible}
                <LogoStack size={18} max={3} items={voteChains} label={`Open to you on ${voteChains.map((chain) => chain.label).join(", ")}`} />
              </span>
            ) : (
              "—"
            )
          }
          sub={line(
            votesFailed
              ? "governance unreadable"
              : votes
                ? votes.awaiting > 0
                  ? // Short enough for a three-across tile at 768 ("3 not voted ·
                    // next closes in 3…" was cut there).
                    `${votes.awaiting} to vote${nextVoteIn !== null ? ` · next ${untilText(nextVoteIn)}` : ""}`
                  : votes.eligible > 0
                    ? "all voted"
                    : votes.open > 0
                      ? `${votes.open} open, no voting power`
                      : "none in voting"
                : undefined,
            proposals.loading || now === null,
          )}
        />
      </div>
    </section>
  );
}
