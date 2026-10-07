"use client";

/**
 * The analysis cards of a chain's page. Each takes the chain's stats (or
 * null while loading) and renders a skeleton shaped like itself on first
 * load, so the page never jumps when the answer lands.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { BarList, VIZ_OTHER, formatShare, type BarListItem } from "@/components/charts";
import {
  AssetLogo,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  KeyValueList,
  Percent,
  RelativeTime,
  Skeleton,
  SkeletonText,
  StatusBadge,
  TokenAmount,
  useNow,
  type KeyValueItem,
} from "@/components/ui";
import { proposalHref } from "@/components/governance/model";
import type { ChainEntry } from "@/lib/chains";
import type { ChainDetailResponse, ChainStats } from "@/lib/data/chains";
import type { ProposalRow } from "@/lib/data/governance";
import type { StakingDelegation } from "@/lib/chain/types";
import { formatDate, formatDuration, formatNumber, formatPercent, formatRelativeTime, formatTokenAmount } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Dash, RealYieldText, STATUS_TEXT, liveStatus, reasonOf } from "./cells";
import { blockSpeedup, dilution, formatDays, formatSeconds, stakeInHaltingSet, toPct, type StakeInHaltingSet } from "./model";
import { PeerYield } from "./PeerYield";
import { StakeDistribution } from "./StakeDistribution";

type ValidatorSet = NonNullable<ChainDetailResponse["validatorSet"]>;

/* ------------------------------------------------------------------ live status */

export function LiveStatusCard({ stats, loading, className }: { stats: ChainStats | null; loading: boolean; className?: string }) {
  const status = liveStatus(stats);
  const at = stats?.latestBlockTime ? Date.parse(stats.latestBlockTime) : null;
  const observed = stats?.blockTimeSec ?? null;
  const assumed = stats?.paramsBlockTimeSec ?? null;
  const speedup = stats ? blockSpeedup(stats) : null;
  const max = Math.max(observed ?? 0, assumed ?? 0) || 1;
  return (
    <Card className={className}>
      <CardHeader title="Live status" icon="pulse" />
      {loading ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-2 w-full" />
          <Skeleton className="h-2 w-2/3" />
        </div>
      ) : !stats ? (
        // Nothing was read: say so once, rather than a column of dashes and
        // a block-time sentence the page cannot back.
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="d-label">Latest block</p>
            <StatusBadge tone="neutral">{STATUS_TEXT.unknown}</StatusBadge>
          </div>
          <p className="text-[13px] leading-snug text-fg-dim">No live figures: the chain&apos;s public node did not answer.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            {/* The status sits on the label's line: in the header it wrapped
                under the title in a column this narrow. */}
            <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="d-label">Latest block</p>
              <StatusBadge tone={status === "producing" ? "success" : status === "halted" ? "danger" : "neutral"} pulse={status === "producing"}>
                {STATUS_TEXT[status]}
              </StatusBadge>
            </div>
            <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
              {stats?.latestHeight !== null && stats?.latestHeight !== undefined ? `#${formatNumber(stats.latestHeight)}` : <Dash reason={reasonOf(stats, "latestHeight")} />}
            </p>
            <p className="mt-1.5 text-[12.5px] text-fg-dim">
              {at ? (
                <>
                  Produced <RelativeTime at={at} /> · as read by the public node
                </>
              ) : (
                "Block time unknown"
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="d-label">Block time</p>
            {/* Bars only as a comparison: observed against what the mint
                assumes, on one scale. Alone, the observed bar was a full
                track with nothing to measure it against. */}
            {assumed ? (
              <>
                <BlockBar label="Observed" seconds={observed} max={max} accent reason={reasonOf(stats, "blockTimeSec")} />
                <BlockBar label="Mint assumes" seconds={assumed} max={max} />
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-fg-muted">Observed</span>
                  <span className="tabular-nums text-fg">{formatSeconds(observed) ?? <Dash reason={reasonOf(stats, "blockTimeSec")} />}</span>
                </div>
                <p className="text-[12.5px] leading-snug text-fg-dim">
                  {stats?.apr.note ?? "This chain's issuance does not assume a block time."}
                </p>
              </>
            )}
            <p className="text-[12.5px] leading-snug text-fg-dim">
              {speedup && Math.abs(speedup - 1) > 0.02 ? (
                <>
                  Blocks arrive <span className="font-medium text-fg">{speedup.toFixed(2)}×</span> {speedup > 1 ? "faster" : "slower"} than
                  the mint parameters assume, so issuance runs {speedup > 1 ? "ahead of" : "behind"} the published rate.
                </>
              ) : null}{" "}
              {stats?.blockTimeWindow ? `Measured over the last ${formatNumber(stats.blockTimeWindow)} blocks.` : null}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function BlockBar({ label, seconds, max, accent, reason }: { label: string; seconds: number | null; max: number; accent?: boolean; reason?: string }) {
  const text = formatSeconds(seconds);
  return (
    <div className="grid grid-cols-[88px_1fr_56px] items-center gap-3 text-[13px]">
      <span className="text-fg-muted">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
        <span
          className={cn("block h-full rounded-full", accent ? "bg-[var(--viz-accent)]" : "bg-[var(--viz-other)]")}
          style={{ width: seconds ? `${Math.max(2, (seconds / max) * 100)}%` : 0 }}
        />
      </span>
      <span className="text-right tabular-nums text-fg">{text ?? <Dash reason={reason} />}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ yield */

/**
 * Where a staker's return comes from and what eats it: the APR the mint
 * parameters publish, the APR blocks actually pay, the inflation everyone
 * pays, and what is left (real yield). Bars share one scale.
 */
export function YieldCard({
  chain,
  stats,
  peers,
  loading,
  className,
}: {
  chain: ChainEntry;
  stats: ChainStats | null;
  /** This chain and the user's followed chains of the same network, for the peer bars. */
  peers: readonly ChainStats[];
  loading: boolean;
  className?: string;
}) {
  if (loading || !stats) {
    return (
      <Card className={className}>
        <CardHeader title="Where the yield comes from" icon="trendingUp" />
        <div className="flex flex-col gap-4">
          {[80, 92, 64].map((w) => (
            <div key={w} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2.5" width={`${w}%`} />
            </div>
          ))}
          <SkeletonText lines={2} />
        </div>
      </Card>
    );
  }
  const naive = stats.apr.naive;
  const actual = stats.apr.actual;
  const inflation = stats.inflation.actual;
  const real = stats.realYield;
  const scale = Math.max(naive ?? 0, actual ?? 0, inflation ?? 0) || 1;
  const lose = dilution(inflation);
  const differs = naive !== null && actual !== null && Math.abs(actual - naive) > 1e-4;
  const thirdParty = stats.apr.source === "cosmos.directory";

  return (
    <Card className={className}>
      <CardHeader
        title="Where the yield comes from"
        icon="trendingUp"
        subtitle="Before validator commission · issuance only, fees not included"
        info={stats.apr.method ? <>How it is computed: {stats.apr.method}.</> : undefined}
      />
      <div className="flex flex-col gap-3.5">
        {differs ? <YieldBar label="APR the mint parameters publish" value={naive} scale={scale} tone="muted" /> : null}
        <YieldBar
          label={differs ? "APR blocks actually pay" : "Staking APR"}
          value={actual}
          scale={scale}
          tone="accent"
          reason={stats.apr.note ?? reasonOf(stats, "apr")}
          tag={thirdParty ? "cosmos.directory" : undefined}
        />
        <YieldBar label="Inflation (new supply a year)" value={inflation} scale={scale} tone="warn" reason={reasonOf(stats, "inflation")} />
        <div className="flex items-baseline justify-between gap-3 border-t border-[var(--d-hairline)] pt-3">
          <span className="text-[13.5px] font-medium text-fg">Real yield</span>
          <RealYieldText value={real} reason={reasonOf(stats, "realYield")} className="text-[20px] font-semibold tracking-[-0.02em]" />
        </div>
        <p className="text-[12.5px] leading-[1.55] text-fg-dim">
          {differs && stats.apr.blockTimeFactor ? (
            <>
              The mint pays per block and assumes {formatSeconds(stats.paramsBlockTimeSec) ?? "a slower"} blocks; the chain makes one every{" "}
              {formatSeconds(stats.blockTimeSec) ?? "—"}, so stakers earn {stats.apr.blockTimeFactor.toFixed(2)}× the published rate.{" "}
            </>
          ) : stats.apr.note ? (
            <>{stats.apr.note}. </>
          ) : null}
          {lose !== null ? (
            <>
              Holding {chain.coinDenom} without staking loses {formatPercent(toPct(lose), { digits: 1 })} of your share of supply a year.
            </>
          ) : null}
        </p>
        <PeerYield chainId={chain.chainId} peers={peers} className="border-t border-[var(--d-hairline)] pt-3" />
      </div>
    </Card>
  );
}

function YieldBar({
  label,
  value,
  scale,
  tone,
  reason,
  tag,
}: {
  label: string;
  value: number | null;
  scale: number;
  tone: "accent" | "muted" | "warn";
  reason?: string;
  tag?: string;
}) {
  const fill = tone === "accent" ? "bg-[var(--viz-accent)]" : tone === "warn" ? "bg-[var(--viz-warn)]" : "bg-[var(--viz-other)]";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
          <span className="truncate">{label}</span>
          {tag ? (
            <Badge size="sm" tone="neutral" title="Third-party figure: this chain publishes no mint data we can read">
              {tag}
            </Badge>
          ) : null}
        </span>
        <Percent value={toPct(value)} reason={reason} className={cn("tabular-nums", tone === "accent" ? "font-semibold text-fg" : "text-fg")} />
      </div>
      <span className="h-2 overflow-hidden rounded-full bg-[var(--d-glass-2)]" aria-hidden>
        <span className={cn("block h-full rounded-full", fill)} style={{ width: value !== null && value > 0 ? `${Math.max(1.5, (value / scale) * 100)}%` : 0 }} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ validator set */

export function ValidatorSetCard({
  chain,
  stats,
  set,
  delegations,
  loading,
  className,
}: {
  chain: ChainEntry;
  stats: ChainStats | null;
  set: ValidatorSet | null;
  /** The connected wallet's delegations here (null without a wallet or a read). */
  delegations: readonly StakingDelegation[] | null;
  loading: boolean;
  className?: string;
}) {
  const href = `/validators?chain=${encodeURIComponent(chain.chainId)}`;
  const action = (
    <Button size="sm" variant="ghost" href={href} iconRight="arrowRight">
      All validators
    </Button>
  );
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader title="Validator set" icon="validators" actions={action} />
        <Skeleton className="h-6 w-full" />
        <div className="flex flex-col gap-2.5 pt-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-3" width={`${90 - i * 9}%`} />
          ))}
        </div>
      </Card>
    );
  }
  if (!set) {
    return (
      <Card className={className}>
        <CardHeader title="Validator set" icon="validators" actions={action} />
        <EmptyState inline icon="validators" title="Validator set unavailable" body={reasonOf(stats, "activeValidators", "The validator list could not be read right now.")} />
      </Card>
    );
  }

  // With a wallet that stakes here, its own validators wear the accent and
  // the rest step back, so "where is my stake in this set" is visible.
  const mine = new Set((delegations ?? []).filter((d) => /^[1-9]\d*$/.test(d.amount)).map((d) => d.validator.operatorAddress));
  const yours = mine.size > 0 ? stakeInHaltingSet(delegations ?? []) : null;
  const items: BarListItem[] = [
    ...set.top.map((v) => ({
      id: v.operatorAddress,
      label: v.moniker,
      value: v.votingPower,
      icon: <AssetLogo src={v.logoUrl} symbol={v.moniker} size={18} />,
      detail: mine.has(v.operatorAddress) ? `Rank ${v.rank} · you stake with it` : `Rank ${v.rank}`,
      color: mine.size === 0 || mine.has(v.operatorAddress) ? undefined : VIZ_OTHER,
    })),
    ...(set.othersShare > 0
      ? [{ id: "others", label: `Everyone else (${Math.max(0, set.active - set.top.length)})`, value: set.othersShare, color: VIZ_OTHER }]
      : []),
  ];

  return (
    <Card className={className}>
      <CardHeader
        title="Validator set"
        icon="validators"
        subtitle={`${formatNumber(set.active)} active${set.maxValidators ? ` of ${formatNumber(set.maxValidators)} slots` : ""}${set.activeSetFull ? " · set full" : ""}`}
        actions={action}
      />
      <StakeDistribution
        top={set.top.map((v) => ({ id: v.operatorAddress, label: v.moniker, share: v.votingPower }))}
        othersShare={set.othersShare}
        nakamoto={set.nakamoto}
      />
      <div className="grid grid-cols-3 gap-3 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] p-3">
        <MiniStat label="Nakamoto" value={set.nakamoto !== null ? formatNumber(set.nakamoto) : <Dash reason={reasonOf(stats, "nakamoto")} />} hint="can halt the chain" />
        <MiniStat label="Top 10 hold" value={set.top10Share !== null ? formatShare(set.top10Share) : <Dash reason={reasonOf(stats, "top10Share")} />} hint="of voting power" />
        <MiniStat
          label="Median fee"
          value={set.medianCommission !== null ? formatShare(set.medianCommission) : <Dash reason={reasonOf(stats, "medianCommission")} />}
          // The chain's floor beside the median it bounds (it used to caption
          // the unbonding tile, where it explained nothing).
          hint={stats?.minCommission !== null && stats?.minCommission !== undefined ? `commission · min ${formatPercent(toPct(stats.minCommission), { digits: 0 })}` : "commission"}
        />
      </div>
      {yours ? <YourStakeLine yours={yours} nakamoto={set.nakamoto} highlighted={set.top.some((v) => mine.has(v.operatorAddress))} /> : null}
      <CardBody>
        <BarList items={items} sort={false} showShare={false} valueFormatter={formatShare} ariaLabel={`Voting power of the ten largest validators on ${chain.chainName}`} />
      </CardBody>
    </Card>
  );
}

/**
 * Where the wallet's own stake sits: a fact, not advice. Stake with the
 * validators that could halt the chain together concentrates it further.
 */
function YourStakeLine({ yours, nakamoto, highlighted }: { yours: StakeInHaltingSet; nakamoto: number | null; highlighted: boolean }) {
  const set = nakamoto !== null ? `the ${formatNumber(nakamoto)} largest validators, who could halt the chain together` : "the validators that could halt the chain together";
  return (
    <p className="flex items-start gap-2 rounded-[var(--d-radius-inner)] bg-[var(--d-glass)] px-3 py-2.5 text-[12.5px] leading-snug text-fg-muted">
      <span aria-hidden className="mt-[5px] size-2 shrink-0 rounded-[3px] bg-[var(--viz-accent)]" />
      <span>
        You stake with {yours.validators} validator{yours.validators === 1 ? "" : "s"} here{highlighted ? " (highlighted below)" : ""}.{" "}
        {yours.share === null ? (
          <>Their place in the set could not be read.</>
        ) : (
          <>
            <span className="font-medium text-fg">{formatPercent(yours.share, { digits: 0 })}</span> of your stake sits with {set}
            {yours.unknown > 0 ? ` (${yours.unknown} not ranked)` : ""}.
          </>
        )}
      </span>
    </p>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-dim">{label}</p>
      <p className="mt-1 text-[18px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{value}</p>
      {/* Wraps rather than truncates: a third of a phone is ~100px. */}
      <p className="mt-1 text-[11.5px] leading-snug text-fg-dim">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ governance */

export function GovernanceCard({
  chain,
  stats,
  counts,
  proposals,
  proposalsLoading,
  loading,
  className,
}: {
  chain: ChainEntry;
  stats: ChainStats | null;
  counts: ChainDetailResponse["proposals"] | undefined;
  proposals: ProposalRow[];
  proposalsLoading: boolean;
  loading: boolean;
  className?: string;
}) {
  const now = useNow();
  const href = `/governance?chain=${encodeURIComponent(chain.chainId)}`;
  const gov = stats?.gov ?? null;
  const symbol = chain.coinDenom;
  const deposit = gov?.minDeposit?.find((coin) => coin.denom === chain.coinMinimalDenom) ?? null;
  const params: KeyValueItem[] = gov
    ? [
        { key: "quorum", label: "Quorum", value: <Percent value={toPct(gov.quorum)} digits={1} reason="Not published" /> },
        { key: "threshold", label: "Pass threshold", value: <Percent value={toPct(gov.threshold)} digits={1} reason="Not published" /> },
        { key: "veto", label: "Veto threshold", value: <Percent value={toPct(gov.vetoThreshold)} digits={1} reason="Not published" /> },
        { key: "period", label: "Voting period", value: formatDays(gov.votingPeriodDays) ?? <Dash /> },
        {
          key: "deposit",
          label: "Minimum deposit",
          value: deposit ? (
            // A protocol parameter, not a holding: never masked.
            <TokenAmount amount={deposit.amount} decimals={chain.coinDecimals} symbol={symbol} compact masked={false} />
          ) : (
            <Dash reason="Not published" />
          ),
        },
      ]
    : [];
  const voting = proposals.filter((p) => p.status === "voting").slice(0, 3);
  // Nothing open: the latest decisions say how this chain governs instead.
  const decided = voting.length === 0 ? proposals.filter((p) => p.status === "passed" || p.status === "rejected" || p.status === "failed").slice(0, 3) : [];

  return (
    <Card className={className}>
      <CardHeader
        title="Governance"
        icon="governance"
        actions={
          <Button size="sm" variant="ghost" href={href} iconRight="arrowRight">
            Proposals
          </Button>
        }
      />
      {loading ? (
        <SkeletonText lines={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <CountTile label="In voting" value={counts ? counts.voting : null} live={Boolean(counts && counts.voting > 0)} />
            <CountTile label="In deposit" value={counts ? counts.deposit : null} />
          </div>
          {voting.length > 0 ? (
            <ul className="flex flex-col divide-y divide-[var(--d-hairline)]">
              {voting.map((p) => {
                const ends = p.votingEndTime ? Date.parse(p.votingEndTime) : null;
                return (
                  <li key={p.id} className="py-2.5 first:pt-0">
                    {/* The proposal page itself: the old `/governance/<id>?chain=`
                        form still works, but as a redirect on every click. */}
                    <Link href={proposalHref(chain.chainId, p.id)} className="group flex flex-col gap-1 rounded-[6px] focus-visible:outline-offset-2">
                      <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-fg group-hover:underline group-hover:underline-offset-[3px]">
                        <span className="font-mono text-[12px] text-fg-dim">#{p.id}</span> {p.title}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-dim">
                        {ends ? <span>{now === null ? `Ends ${formatDate(ends, "short")}` : ends > now ? `Ends ${formatRelativeTime(ends, now)}` : "Voting ended, result pending"}</span> : null}
                        {p.passingIfEndedNow !== null ? (
                          <Badge size="sm" tone={p.passingIfEndedNow ? "success" : "danger"}>
                            {p.passingIfEndedNow ? "Passing now" : "Failing now"}
                          </Badge>
                        ) : null}
                        {p.myVoteStatus === "not-voted" && p.myVotingPower && p.myVotingPower !== "0" ? (
                          <Badge size="sm" tone="warning">
                            You haven&apos;t voted
                          </Badge>
                        ) : p.myVoteStatus === "voted" ? (
                          <Badge size="sm" tone="neutral">
                            You voted
                          </Badge>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : decided.length > 0 ? (
            <div>
              <p className="d-label mb-1.5">Latest decisions</p>
              <ul className="flex flex-col divide-y divide-[var(--d-hairline)]">
                {decided.map((p) => {
                  const ended = p.votingEndTime ? Date.parse(p.votingEndTime) : null;
                  return (
                    <li key={p.id} className="py-2 first:pt-1">
                      <Link href={proposalHref(chain.chainId, p.id)} className="group flex items-start justify-between gap-3 rounded-[6px] focus-visible:outline-offset-2">
                        <span className="min-w-0">
                          <span className="line-clamp-1 text-[13.5px] leading-snug text-fg group-hover:underline group-hover:underline-offset-[3px]">
                            <span className="font-mono text-[12px] text-fg-dim">#{p.id}</span> {p.title}
                          </span>
                          {ended ? <span className="text-[12px] text-fg-dim">Ended {formatDate(ended, "short")}</span> : null}
                        </span>
                        <Badge size="sm" tone={p.status === "passed" ? "success" : "danger"} className="mt-0.5">
                          {p.status === "passed" ? "Passed" : p.status === "rejected" ? "Rejected" : "Failed"}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (counts && counts.voting > 0) || proposalsLoading ? (
            <SkeletonText lines={2} />
          ) : null}
          {params.length > 0 ? (
            <div className="rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] p-3">
              <p className="d-label mb-2">Rules · gov {gov?.api}</p>
              <KeyValueList items={params} />
            </div>
          ) : (
            <p className="text-[12.5px] text-fg-dim">{reasonOf(stats, "gov", "Governance parameters could not be read.")}</p>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * A count in a quiet inset. Open votes get the kit's accent marker (the dot
 * StatTile uses for an actionable figure), not a red-tinted box that read as
 * an error in light mode.
 */
function CountTile({ label, value, live }: { label: string; value: number | null; live?: boolean }) {
  return (
    <div className="rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[12px] text-fg-dim">
        {live ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--z-accent)]" /> : null}
        {label}
      </p>
      <p className="mt-0.5 text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">{value === null ? <Dash reason="Governance could not be read" /> : formatNumber(value)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ rules */

export function RulesCard({ chain, stats, loading, className }: { chain: ChainEntry; stats: ChainStats | null; loading: boolean; className?: string }) {
  const slashing = stats?.slashing ?? null;
  const windowSeconds = slashing?.signedBlocksWindow && stats?.blockTimeSec ? slashing.signedBlocksWindow * stats.blockTimeSec : null;
  const staking: KeyValueItem[] = stats
    ? [
        { key: "unbonding", label: "Unbonding period", value: formatDays(stats.unbondingDays) ?? <Dash reason={reasonOf(stats, "unbondingDays")} /> },
        { key: "commission", label: "Minimum commission", value: <Percent value={toPct(stats.minCommission)} digits={1} reason={reasonOf(stats, "minCommission")} /> },
        { key: "tax", label: "Community tax", value: <Percent value={toPct(stats.communityTax)} digits={1} reason={reasonOf(stats, "communityTax")} />, info: "Share of every reward sent to the community pool before stakers are paid." },
        {
          key: "supply",
          label: "Bonded / supply",
          value:
            stats.bondedTokens && stats.totalSupply && stats.nativeDecimals !== null ? (
              <span className="whitespace-nowrap">
                {formatTokenAmount(stats.bondedTokens, stats.nativeDecimals, { compact: true })}
                <span className="text-fg-dim"> / {formatTokenAmount(stats.totalSupply, stats.nativeDecimals, { compact: true })} {chain.coinDenom}</span>
              </span>
            ) : (
              <Dash reason={reasonOf(stats, "totalSupply")} />
            ),
        },
      ]
    : [];
  const slash: KeyValueItem[] = slashing
    ? [
        {
          key: "window",
          label: "Uptime window",
          value: slashing.signedBlocksWindow ? `${formatNumber(slashing.signedBlocksWindow)} blocks` : <Dash />,
          sub: windowSeconds ? `≈ ${formatDuration(windowSeconds)} at today's block time` : undefined,
        },
        { key: "min", label: "Must sign at least", value: <Percent value={toPct(slashing.minSignedPerWindow)} digits={0} reason="Not published" /> },
        { key: "jail", label: "Downtime jail", value: slashing.downtimeJailSeconds !== null ? formatDuration(slashing.downtimeJailSeconds, { style: "long" }) : <Dash /> },
        { key: "down", label: "Downtime slash", value: <Percent value={toPct(slashing.slashFractionDowntime)} digits={2} reason="Not published" /> },
        { key: "double", label: "Double-sign slash", value: <Percent value={toPct(slashing.slashFractionDoubleSign)} digits={1} reason="Not published" />, emphasis: true },
      ]
    : [];
  return (
    <Card className={className}>
      <CardHeader title="Staking rules" icon="shield" subtitle="What a delegator signs up for" />
      {loading ? (
        <SkeletonText lines={6} />
      ) : (
        <>
          {staking.length > 0 ? <KeyValueList items={staking} /> : <p className="text-[12.5px] text-fg-dim">Staking parameters could not be read.</p>}
          <div className="rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] p-3">
            <p className="d-label mb-2">Slashing</p>
            {slash.length > 0 ? (
              <KeyValueList items={slash} />
            ) : (
              <p className="text-[12.5px] text-fg-dim">{reasonOf(stats, "slashing", "Slashing parameters could not be read.")}</p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
