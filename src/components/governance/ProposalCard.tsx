"use client";

/**
 * One proposal in the list: where and what (chain, #id, type), the title,
 * the deadline, the tally against its rules, the verdict "if it ended now",
 * and — with a wallet — your vote or the one your validators cast for you,
 * with the Vote action.
 *
 * The whole card links to the proposal page through a link laid over it (the
 * StatTile pattern): the Vote button sits above that link, so no button is
 * nested in an anchor and a click on Vote never navigates.
 */

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { Badge, Button, ChainLogo, chainById, ProgressBar, Skeleton, StatusBadge, Tooltip, useNow } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ProposalRow } from "@/lib/chain/types";
import { formatDate, formatDuration, formatTokenAmount } from "@/lib/format";
import {
  deadlineOf,
  depositState,
  ENDING_SOON_MS,
  inheritedSummary,
  powerState,
  proposalHref,
  STATUS_LABEL,
  typeBadge,
  VOTE_SHORT,
  voteChoiceText,
  type InheritedPart,
} from "./model";
import { outcomeOf, pct, type Outcome } from "./rules";
import { TallyBar, VoteSwatch } from "./TallyBar";

export interface ProposalCardProps {
  proposal: ProposalRow;
  /** A wallet is connected: show your vote and the Vote action. */
  connected: boolean;
  onVote?: (proposal: ProposalRow) => void;
  className?: string;
}

const OUTCOME_ICON: Record<Outcome["tone"], "success" | "warning" | "danger" | "info"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "info",
  info: "info",
};

const OUTCOME_COLOR: Record<Outcome["tone"], string> = {
  success: "text-[var(--z-success)]",
  warning: "text-[var(--z-warning)]",
  danger: "text-[var(--z-danger)]",
  neutral: "text-fg-dim",
  info: "text-[var(--z-info)]",
};

export function ProposalCard({ proposal, connected, onVote, className }: ProposalCardProps) {
  const titleId = useId();
  const now = useNow();
  const chain = chainById(proposal.chainId);
  const chainName = chain?.chainName ?? proposal.chainId;
  const outcome = outcomeOf(proposal, now);
  const voting = proposal.status === "voting";
  const ended = proposal.status === "passed" || proposal.status === "rejected" || proposal.status === "failed";
  const href = proposalHref(proposal.chainId, proposal.id);

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "d-card relative flex min-w-0 flex-col gap-3 p-[var(--d-pad)] [overflow:clip]",
        "transition-[border-color,background-color] duration-[160ms] hover:border-[var(--d-hairline-strong)] hover:bg-[var(--d-card-hover)]",
        className,
      )}
    >
      <Link
        href={href}
        aria-labelledby={titleId}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-offset-[-2px]"
      />

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <ChainLogo chainId={proposal.chainId} size={18} />
        <span className="text-[13px] font-medium text-fg-muted">{chainName}</span>
        <span className="font-mono text-[12px] text-fg-dim">#{proposal.id}</span>
        <Badge className="max-w-[16rem]">{typeBadge(proposal)}</Badge>
        {proposal.expedited ? (
          <Badge tone="accent" icon="sparkle">
            Expedited
          </Badge>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {ended ? (
            <StatusBadge tone={proposal.status === "passed" ? "success" : "danger"}>{STATUS_LABEL[proposal.status]}</StatusBadge>
          ) : null}
          <Deadline proposal={proposal} now={now} />
        </span>
      </div>

      <h3 id={titleId} className="line-clamp-2 text-[15.5px] font-medium leading-snug tracking-[-0.015em] text-fg">
        {proposal.title}
      </h3>

      {proposal.status === "deposit" ? (
        <DepositProgress proposal={proposal} />
      ) : (
        <TallyBar row={proposal} size="compact" />
      )}

      <div className="-mx-[var(--d-pad)] mt-0.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--d-hairline)] px-[var(--d-pad)] pt-3">
        {proposal.status === "deposit" ? (
          <DepositNeeds proposal={proposal} />
        ) : (
          <p className={cn("flex min-w-0 flex-[1_1_14rem] items-start gap-1.5 text-[13px] leading-snug", OUTCOME_COLOR[outcome.tone])}>
            <Icon name={OUTCOME_ICON[outcome.tone]} size={15} className="mt-px shrink-0" />
            <span className="min-w-0">
              <span className="block font-medium">{outcome.label}</span>
              {outcome.detail && outcome.kind !== "passing" && outcome.kind !== "passed" ? (
                <span className="block text-[12.5px] text-fg-dim">{outcome.detail}</span>
              ) : null}
            </span>
          </p>
        )}
        {connected && voting && outcome.kind !== "ended-pending" ? (
          <YourVote proposal={proposal} onVote={onVote} />
        ) : null}
      </div>
    </article>
  );
}

/** "Ends in 1 d 13 h" (amber within 48 h), "Deposit ends in 9 d", or the end date. */
function Deadline({ proposal, now }: { proposal: ProposalRow; now: number | null }) {
  const at = deadlineOf(proposal);
  if (proposal.status === "voting" || proposal.status === "deposit") {
    if (at === null) return null;
    const left = now === null ? null : at - now;
    const soon = proposal.status === "voting" && left !== null && left > 0 && left <= ENDING_SOON_MS;
    const text =
      left === null
        ? formatDate(at, "short")
        : left <= 0
          ? "Ended"
          : `${proposal.status === "deposit" ? "Deposit ends" : "Ends"} in ${formatDuration(Math.max(60, left / 1000))}`;
    return (
      <Tooltip content={formatDate(at, "datetime")}>
        <span
          className={cn(
            "relative z-[1] inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] tabular-nums",
            soon ? "font-medium text-[var(--z-warning)]" : "text-fg-dim",
          )}
          tabIndex={-1}
        >
          <Icon name="clock" size={13} />
          {text}
        </span>
      </Tooltip>
    );
  }
  const ended = proposal.votingEndTime ? Date.parse(proposal.votingEndTime) : null;
  return ended && Number.isFinite(ended) ? (
    <span className="whitespace-nowrap text-[12.5px] text-fg-dim">{formatDate(ended, "short")}</span>
  ) : null;
}

/** A deposit amount's display: the chain's own token with its decimals, else raw base units of the denom. */
function depositToken(chainId: string, denom: string | null): { decimals: number | null; symbol: string } {
  const chain = chainById(chainId);
  return chain && denom === chain.coinMinimalDenom ? { decimals: chain.coinDecimals, symbol: chain.coinDenom } : { decimals: null, symbol: "" };
}

/** Deposit raised against the chain's minimum. */
function DepositProgress({ proposal }: { proposal: ProposalRow }) {
  const deposit = depositState(proposal);
  const { decimals, symbol } = depositToken(proposal.chainId, deposit.denom);
  const ratio = deposit.ratio;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="text-fg-dim">Deposit</span>
        <span className="tabular-nums text-fg-muted">
          {deposit.total !== null ? formatTokenAmount(deposit.total, decimals, { compact: true }) : "—"}
          <span className="text-fg-dim">
            {" "}
            of {deposit.min !== null ? formatTokenAmount(deposit.min, decimals, { compact: true }) : "—"} {symbol}
          </span>
          {ratio !== null ? <span className="ml-1.5 font-medium text-fg">{pct(Math.min(ratio, 9.99), 0)}</span> : null}
        </span>
      </div>
      <ProgressBar value={ratio !== null ? Math.min(1, ratio) * 100 : 0} tone="neutral" label="Deposit raised of the minimum" />
      {ratio !== null && ratio < 0.1 ? (
        <p className="flex items-start gap-1.5 text-[12px] leading-snug text-fg-dim">
          <Icon name="shield" size={13} className="mt-px shrink-0" />
          Unvetted: little deposit so far. Spam proposals often stay here; never use a link in one to “claim” anything.
        </p>
      ) : null}
    </div>
  );
}

/** The deposit card's footer: what it takes to open voting. */
function DepositNeeds({ proposal }: { proposal: ProposalRow }) {
  const deposit = depositState(proposal);
  const { decimals, symbol } = depositToken(proposal.chainId, deposit.denom);
  const text =
    deposit.missing === null
      ? "Collecting deposit"
      : deposit.missing === "0"
        ? "Minimum reached: voting opens shortly"
        : `${formatTokenAmount(deposit.missing, decimals, { compact: true })}${symbol ? ` ${symbol}` : ""} more opens voting`;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-fg-muted">
      <Icon name="hourglass" size={15} className="shrink-0 text-fg-dim" />
      <span className="min-w-0 tabular-nums">{text}</span>
    </p>
  );
}

/**
 * Your vote, or the one your validators cast for you, and the Vote action:
 * a status line and, under it, what it means — two short lines that wrap
 * cleanly beside the verdict on a wide card and under it on a phone.
 */
function YourVote({ proposal, onVote }: { proposal: ProposalRow; onVote?: (proposal: ProposalRow) => void }) {
  const power = powerState(proposal.myVotingPower);
  const voted = proposal.myVoteStatus === "voted" && proposal.myVote ? proposal.myVote : null;
  const inherited = !voted ? inheritedSummary(proposal.inheritedVote) : null;

  let status: ReactNode;
  let detail: string | null = null;
  if (voted) {
    status = (
      <span className="inline-flex items-center gap-1.5 text-fg-muted">
        <VoteSwatch option={voted.option === "weighted" ? "weighted" : voted.option} />
        You voted <span className="font-medium text-fg">{voteChoiceText(voted)}</span>
      </span>
    );
  } else if (power === "none") {
    status = <span className="text-fg-dim">No voting power here</span>;
  } else if (proposal.myVoteStatus === null) {
    // No address of the wallet on this network was sent with the read.
    status = <span className="text-fg-dim">Not in your wallet yet</span>;
  } else if (proposal.myVoteStatus === "unknown") {
    status = <span className="text-fg-dim">Your vote couldn&apos;t be read</span>;
  } else {
    status = <span className="font-medium text-[var(--z-warning)]">Not voted</span>;
    detail = inherited ? inheritedText(inherited.parts) : null;
  }

  const canVote = power !== "none";
  return (
    <div className="relative z-[1] ml-auto flex min-w-0 items-center gap-3 text-[13px]">
      <span className="flex min-w-0 flex-col items-end text-right leading-snug">
        {status}
        {detail ? <span className="text-[12.5px] text-fg-dim">{detail}</span> : null}
      </span>
      {canVote && onVote ? (
        <Button size="sm" variant={voted ? "ghost" : "primary"} onClick={() => onVote(proposal)} iconLeft={voted ? undefined : "governance"}>
          {voted ? "Change" : "Vote"}
        </Button>
      ) : null}
    </div>
  );
}

/** "Your validators: 70% Yes" / "Your validators haven't voted". */
function inheritedText(parts: readonly InheritedPart[]): string {
  const top = parts
    .filter((part) => part.option !== "none")
    .slice()
    .sort((a, b) => b.weight - a.weight)[0];
  if (!top || top.option === "none") return "Your validators haven't voted";
  return `Your validators: ${pct(top.weight, 0)} ${top.option === "weighted" ? "split" : VOTE_SHORT[top.option]}`;
}

/** A card-shaped placeholder for the first load. */
export function ProposalCardSkeleton() {
  return (
    <div className="d-card flex flex-col gap-3 p-[var(--d-pad)]" aria-hidden>
      <div className="flex items-center gap-2">
        <Skeleton circle width={18} />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-28 rounded-[6px]" />
        <Skeleton className="ml-auto h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-[85%]" />
      <Skeleton className="h-4 w-[55%]" />
      <Skeleton className="mt-1 h-3 w-[60%]" />
      <Skeleton className="h-2 w-full rounded-[4px]" />
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="mt-1 flex items-center justify-between border-t border-[var(--d-hairline)] pt-3">
        <Skeleton className="h-3.5 w-44" />
        <Skeleton className="h-8 w-20 rounded-[10px]" />
      </div>
    </div>
  );
}
