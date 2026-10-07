"use client";

/**
 * The next three unbonding completions across the chains in scope: when,
 * how much, from which validator. The tokens return to the liquid balance on
 * their own at that time; nothing needs signing.
 *
 * With nothing unbonding, the card says how long each chain you stake on
 * would take to release tokens unstaked today (its unbonding period), which
 * is the figure that matters before deciding to unstake.
 */

import { Button, Card, CardBody, CardHeader, ChainLogo, EmptyState, InlineError, Money, Skeleton, TokenAmount, chainById } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import type { ChainStatsState } from "@/lib/data/chains";
import type { PortfolioState } from "@/lib/data/portfolio";
import type { StakingPositionsState } from "@/lib/data/staking";
import { formatDate } from "@/lib/format";
import { untilText } from "@/lib/insights/rules";
import { upcomingReleases } from "./model";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });
const DAY_OF_MONTH = new Intl.DateTimeFormat("en-US", { day: "numeric" });

export interface UnbondingReleasesProps {
  staking: StakingPositionsState;
  portfolio: PortfolioState;
  stats: ChainStatsState;
  now: number | null;
  /** The rail's chain when one is selected (the subtitle names it). */
  selectedChain: ChainEntry | null;
}

export function UnbondingReleases({ staking, portfolio, stats, now, selectedChain }: UnbondingReleasesProps) {
  const releases = now !== null ? upcomingReleases(staking.data, portfolio.data, now, 3) : [];
  const total = now !== null ? upcomingReleases(staking.data, portfolio.data, now, Number.POSITIVE_INFINITY).length : 0;
  const currency = portfolio.data?.currency ?? "usd";
  const loading = staking.loading || now === null;
  // Chains holding stake, with their unbonding period, longest first.
  const periods = (staking.data?.chains ?? [])
    .filter((chain) => chain.totals.staked !== null && chain.totals.staked !== "0")
    .map((chain) => ({ chainId: chain.chainId, days: stats.statsFor(chain.chainId)?.unbondingDays ?? null }))
    .filter((row): row is { chainId: string; days: number } => row.days !== null)
    .sort((a, b) => b.days - a.days || a.chainId.localeCompare(b.chainId))
    .slice(0, 5);

  return (
    <Card pending={staking.stale}>
      <CardHeader
        title="Unbonding releases"
        subtitle={
          total > 3
            ? `Next 3 of ${total} unlocks`
            : selectedChain
              ? `Next unlocks on ${selectedChain.chainName}`
              : "Next unlocks across chains"
        }
        actions={
          <Button size="sm" variant="ghost" href="/staking" iconRight="arrowRight">
            Staking
          </Button>
        }
      />
      <CardBody flush>
        {staking.status === "error" && !staking.data ? (
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">
            <InlineError message={staking.error?.message ?? "Staking positions could not be read."} onRetry={staking.refetch} />
          </div>
        ) : loading ? (
          <ul aria-busy="true" aria-label="Loading unbonding">
            {[0, 1].map((i) => (
              <li key={i} className="flex items-center gap-3 px-[var(--d-pad)] py-3">
                <Skeleton className="h-11 w-11 rounded-[10px]" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </span>
              </li>
            ))}
          </ul>
        ) : releases.length === 0 ? (
          <>
            <div className="px-[var(--d-pad)] pb-2">
              <EmptyState
                inline
                icon="hourglass"
                title="Nothing unbonding"
                body="Tokens you undelegate return to your balance once the chain's unbonding period ends."
              />
            </div>
            {periods.length > 0 && now !== null ? (
              <div className="border-t border-[var(--d-hairline)] pt-2.5">
                <p className="d-label px-[var(--d-pad)] pb-1">If you unstake today</p>
                <ul className="divide-y divide-[var(--d-hairline)]">
                  {periods.map((row) => (
                    <li key={row.chainId} className="flex items-center gap-2.5 px-[var(--d-pad)] py-2 text-[13px]">
                      <ChainLogo chainId={row.chainId} size={18} />
                      <span className="min-w-0 flex-1 truncate text-fg">{chainById(row.chainId)?.chainName ?? row.chainId}</span>
                      <span className="tabular-nums text-fg-muted">{Math.round(row.days)} days</span>
                      <span className="w-[4.5rem] text-right tabular-nums text-fg-dim">{formatDate(now + row.days * 86_400_000, "short")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <ul className="divide-y divide-[var(--d-hairline)]">
            {releases.map((release) => (
              <li key={`${release.chainId}:${release.at}:${release.validator}`} className="flex items-center gap-3 px-[var(--d-pad)] py-3">
                <span
                  className="flex w-11 shrink-0 flex-col items-center rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-glass)] py-1 leading-none"
                  aria-hidden
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-dim">{MONTH.format(release.at)}</span>
                  <span className="mt-1 text-[17px] font-semibold tabular-nums text-fg">{DAY_OF_MONTH.format(release.at)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <TokenAmount
                      amount={release.amount}
                      decimals={release.decimals}
                      symbol={release.symbol}
                      maxFraction={2}
                      className="text-[14px] font-medium text-fg"
                    />
                    {release.value !== null ? <Money value={release.value} currency={currency} compact className="text-[12.5px] text-fg-dim" /> : null}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-dim">
                    <ChainLogo chainId={release.chainId} size={14} />
                    <span className="truncate">
                      {chainById(release.chainId)?.chainName ?? release.chainId} · from {release.validator}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right text-[12px] tabular-nums text-fg-dim" title={formatDate(release.at, "datetime")}>
                  {now !== null ? untilText(release.at - now) : formatDate(release.at, "short")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
