"use client";

/**
 * Proposals in their voting period on the chains in scope, closing soonest
 * first, each with the wallet's position on it: its own vote, the vote its
 * validators cast for its stake while it has not voted, or no stake there.
 */

import Link from "next/link";
import { proposalHref } from "@/components/governance/model";
import { pct, tallyShares } from "@/components/governance/rules";
import { Badge, Button, Card, CardBody, CardHeader, ChainLogo, EmptyState, InlineError, Skeleton, chainById } from "@/components/ui";
import type { ProposalRow } from "@/lib/chain/types";
import type { ProposalsState } from "@/lib/data/governance";
import { formatPercent } from "@/lib/format";
import { untilText, voteLabel } from "@/lib/insights/rules";
import { deadlines, hasVotingPower } from "./model";

/** 30% and 33.4%, not 30.0%: a parameter reads better without a padded decimal. */
function paramPct(fraction: number): string {
  const percent = Math.round(fraction * 1000) / 10;
  return formatPercent(percent, { digits: Number.isInteger(percent) ? 0 : 1 });
}

/**
 * "Yes 88.5% · turnout ≈46.9% · quorum 30% · passing now": Yes as a share of
 * all votes cast, the figure the governance cards print beside the same
 * label (so one proposal never reads two ways), on their formatter (">99.9%",
 * never a 100% with No votes in the tally); turnout against quorum (≈ when
 * the server estimated it); where the tally stands if voting ended now.
 */
function tallyParts(proposal: ProposalRow): string[] {
  const shares = tallyShares(proposal.tally);
  return [
    shares ? `Yes ${pct(shares.yes)}` : "No votes yet",
    proposal.turnout !== null ? `turnout ${proposal.turnoutEstimate ? "≈" : ""}${formatPercent(proposal.turnout * 100, { digits: 1 })}` : null,
    proposal.quorum !== null ? `quorum ${paramPct(proposal.quorum)}` : null,
    proposal.passingIfEndedNow !== null ? (proposal.passingIfEndedNow ? "passing now" : "failing now") : null,
  ].filter((part): part is string => part !== null);
}

function MyVote({ proposal }: { proposal: ProposalRow }) {
  if (proposal.myVoteStatus === "voted") {
    return (
      <Badge tone="success" size="sm" icon="check">
        You voted {voteLabel(proposal.myVote) ?? ""}
      </Badge>
    );
  }
  if (proposal.myVotingPower === "0") return <Badge size="sm">No stake here</Badge>;
  if (proposal.myVoteStatus === "not-voted" && hasVotingPower(proposal)) {
    const inherited = (proposal.inheritedVote ?? []).filter((vote) => vote.option !== null);
    if (inherited.length > 0) {
      const first = inherited[0];
      // Neutral, not `info`: the kit's info is the brand amber, as loud as the
      // warning "Not voted" below, and a vote your validators already cast for
      // you is the calmer of the two states, not an equal alarm.
      return (
        <Badge tone="neutral" size="sm" title="Until you vote, your validators vote for the stake you gave them.">
          Not voted · {first?.moniker ?? "your validator"} voted {voteLabel(first?.option) ?? ""}
          {inherited.length > 1 ? ` +${inherited.length - 1}` : ""}
        </Badge>
      );
    }
    return (
      <Badge tone="warning" size="sm" icon="warning">
        Not voted
      </Badge>
    );
  }
  return <Badge size="sm">Vote status unknown</Badge>;
}

export function GovernanceDeadlines({ proposals, now }: { proposals: ProposalsState; now: number | null }) {
  const rows = now !== null ? deadlines(proposals.data?.proposals ?? [], now, 4) : [];
  const loading = proposals.loading || now === null;

  return (
    <Card pending={proposals.stale}>
      <CardHeader
        title="Governance deadlines"
        subtitle="Voting now on the chains in scope"
        actions={
          <Button size="sm" variant="ghost" href="/governance" iconRight="arrowRight">
            All proposals
          </Button>
        }
      />
      <CardBody flush>
        {proposals.status === "error" && !proposals.data ? (
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">
            <InlineError message={proposals.error?.message ?? "Governance could not be read."} onRetry={proposals.refetch} />
          </div>
        ) : loading ? (
          <ul aria-busy="true" aria-label="Loading proposals">
            {[0, 1].map((i) => (
              <li key={i} className="flex gap-3 px-[var(--d-pad)] py-3">
                <Skeleton circle width={28} />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-2.5 w-1/3" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-4 w-24" />
                </span>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="px-[var(--d-pad)] pb-2">
            <EmptyState inline icon="governance" title="No proposals in voting" body="Proposals on the chains in scope appear here while their vote is open." />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--d-hairline)]">
            {rows.map((proposal) => {
              const end = proposal.votingEndTime ? Date.parse(proposal.votingEndTime) : NaN;
              const left = now !== null && Number.isFinite(end) ? end - now : null;
              const soon = left !== null && left < 48 * 3_600_000;
              return (
                <li key={`${proposal.chainId}:${proposal.id}`}>
                  <Link
                    href={proposalHref(proposal.chainId, proposal.id)}
                    className="flex gap-3 px-[var(--d-pad)] py-3 transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)] focus-visible:outline-offset-[-2px]"
                  >
                    <ChainLogo chainId={proposal.chainId} size={28} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-fg-dim">
                        <span>{chainById(proposal.chainId)?.chainName ?? proposal.chainId}</span>
                        <span className="font-mono">#{proposal.id}</span>
                        <span aria-hidden>·</span>
                        <span className={soon ? "font-medium text-[var(--z-warning)]" : undefined}>
                          {left !== null ? `closes ${untilText(left)}` : "closing time unknown"}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[13.5px] font-medium leading-snug text-fg">{proposal.title}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <MyVote proposal={proposal} />
                        {/* Wraps between figures, never inside one ("passing / now"). */}
                        <span className="text-[12px] tabular-nums text-fg-dim">
                          {tallyParts(proposal).map((part, index) => (
                            <span key={part}>
                              {index > 0 ? (
                                <>
                                  {" "}
                                  <span aria-hidden>·</span>{" "}
                                </>
                              ) : null}
                              <span className="whitespace-nowrap">{part}</span>
                            </span>
                          ))}
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
