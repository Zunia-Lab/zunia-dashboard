"use client";

/**
 * How the largest validators voted, while voting is open (x/gov deletes
 * individual votes after the tally, so this exists only during the vote).
 *
 * The summary bar weights each vote by voting power — it is the part of the
 * live tally these validators cast for everyone staked with them who has not
 * voted — and the grey remainder is the power that has not voted yet: the
 * swing that can still change the result.
 */

import { useState } from "react";
import { Button, Card, CardBody, CardHeader, ChainLogo, DataTable, InfoTip, type Column } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ValidatorVote, VoteOptionName } from "@/lib/chain/types";
import { VOTE_LABEL, VOTE_ORDER } from "./model";
import { pct, stackParts } from "./rules";
import { SPLIT_FILL, VOTE_FILL, VoteSwatch } from "./TallyBar";

const PREVIEW_ROWS = 10;

type Bucket = VoteOptionName | "weighted" | "none";

function summarise(votes: readonly ValidatorVote[]) {
  const power: Record<Bucket, number> = { yes: 0, no: 0, veto: 0, abstain: 0, weighted: 0, none: 0 };
  const count: Record<Bucket, number> = { yes: 0, no: 0, veto: 0, abstain: 0, weighted: 0, none: 0 };
  let total = 0;
  for (const vote of votes) {
    const bucket: Bucket = vote.option ?? "none";
    power[bucket] += vote.votingPower;
    count[bucket] += 1;
    total += vote.votingPower;
  }
  return { power, count, total };
}

/** A validator's vote as a fill, in the tally's colours (no vote: a hollow bar, as in the legend). */
function voteFill(option: NonNullable<ValidatorVote["option"]>): string {
  return option === "weighted" ? SPLIT_FILL : VOTE_FILL[option];
}

/**
 * Voting power as a bar scaled to the largest validator in the list (a
 * ranking, so differences between 10% and 3% are visible; the share is
 * printed beside it), filled with the validator's vote and hollow when it
 * has not voted: the table reads as the summary bar above, one validator at
 * a time.
 */
function PowerCell({ row, max }: { row: ValidatorVote; max: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2.5">
      <span aria-hidden className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
        <span
          className={cn("block h-full rounded-full", !row.option && "shadow-[inset_0_0_0_1px_var(--d-control-line)]")}
          style={{
            width: `max(2px, ${max > 0 ? (row.votingPower / max) * 100 : 0}%)`,
            background: row.option ? voteFill(row.option) : "transparent",
          }}
        />
      </span>
      <span className="min-w-[3.25rem] text-right tabular-nums text-fg-muted">{pct(row.votingPower, 2)}</span>
    </span>
  );
}

function VoteCell({ option }: { option: ValidatorVote["option"] }) {
  if (!option) return <span className="text-fg-dim">Not voted</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg">
      <VoteSwatch option={option === "weighted" ? "weighted" : option} />
      {option === "weighted" ? "Split" : VOTE_LABEL[option]}
    </span>
  );
}

export function ValidatorVotes({ chainId, votes, pending }: { chainId: string; votes: readonly ValidatorVote[]; pending?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { power, count, total } = summarise(votes);
  const rows = expanded ? votes : votes.slice(0, PREVIEW_ROWS);
  const voted = total - power.none;
  const largest = votes.reduce((max, vote) => Math.max(max, vote.votingPower), 0);
  const segments = stackParts(
    [...VOTE_ORDER, "weighted" as const]
      .map((key) => ({ key: key as Bucket, share: total > 0 ? power[key as Bucket] / total : 0 }))
      .filter((segment) => segment.share > 0),
  );

  const columns: Column<ValidatorVote>[] = [
    {
      key: "rank",
      header: "#",
      width: 44,
      cell: (row) => <span className="font-mono text-[12px] text-fg-dim">{row.rank || "—"}</span>,
      sortable: true,
      sortValue: (row) => row.rank,
      sortDescFirst: false,
    },
    {
      key: "validator",
      header: "Validator",
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <ChainLogo chain={{ chainName: row.moniker, coinDenom: row.moniker, iconUrl: row.logoUrl ?? null }} size={22} />
          <span className="truncate font-medium text-fg">{row.moniker}</span>
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.moniker.toLowerCase(),
      sortDescFirst: false,
    },
    {
      key: "power",
      header: "Voting power",
      align: "right",
      cell: (row) => <PowerCell row={row} max={largest} />,
      sortable: true,
      sortValue: (row) => row.votingPower,
      hideBelow: "sm",
    },
    {
      key: "vote",
      header: "Vote",
      cell: (row) => <VoteCell option={row.option} />,
      sortable: true,
      sortValue: (row) => (row.option ? VOTE_ORDER.indexOf(row.option as VoteOptionName) : 99),
      sortDescFirst: false,
    },
  ];

  return (
    <Card pending={pending}>
      <CardHeader
        title="Largest validators"
        subtitle={`How the ${votes.length} largest validators voted so far`}
        icon="validators"
        info="Until a delegator votes, their validator's vote counts for their stake. Votes are read while voting is open; chains delete them after the tally."
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={`Voting power of the ${votes.length} largest validators: ${segments
              .map((s) => `${s.key === "weighted" ? "split" : VOTE_LABEL[s.key as VoteOptionName]} ${pct(s.share)}`)
              .join(", ")}, not voted ${pct(total > 0 ? power.none / total : null)}.`}
            className="relative h-2.5 w-full overflow-hidden rounded-[4px] bg-[var(--d-glass-2)]"
          >
            {segments.map((segment, index) => {
              return (
                <span
                  key={segment.key}
                  className="absolute inset-y-0 box-border"
                  style={{
                    left: `${segment.start * 100}%`,
                    width: `max(2px, ${segment.share * 100}%)`,
                    background: segment.key === "weighted" ? SPLIT_FILL : VOTE_FILL[segment.key as VoteOptionName],
                    borderLeft: index > 0 ? "2px solid var(--d-card)" : undefined,
                  }}
                />
              );
            })}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
            {VOTE_ORDER.filter((option) => count[option] > 0).map((option) => (
              <li key={option} className="inline-flex items-center gap-1.5">
                <VoteSwatch option={option} />
                <span className="text-fg-dim">{VOTE_LABEL[option]}</span>
                <span className="font-medium tabular-nums text-fg">{pct(total > 0 ? power[option] / total : null)}</span>
                <span className="text-fg-dim">({count[option]})</span>
              </li>
            ))}
            {count.weighted > 0 ? (
              <li className="inline-flex items-center gap-1.5">
                <VoteSwatch option="weighted" />
                <span className="text-fg-dim">Split</span>
                <span className="font-medium tabular-nums text-fg">{pct(power.weighted / total)}</span>
              </li>
            ) : null}
            <li className="inline-flex items-center gap-1.5">
              <VoteSwatch option="none" />
              <span className="text-fg-dim">Not voted</span>
              <span className="font-medium tabular-nums text-fg">{pct(total > 0 ? power.none / total : null)}</span>
              <span className="text-fg-dim">({count.none})</span>
            </li>
          </ul>
          <p className="text-[12.5px] leading-snug text-fg-dim">
            Together they hold <span className="font-medium text-fg">{pct(total)}</span> of the voting power;{" "}
            <span className="font-medium text-fg">{pct(total > 0 ? voted / total : null)}</span> of theirs has voted.
            <InfoTip
              size={13}
              className="ml-1"
              content="Shares are of the bonded voting power. A validator's vote is weighted by all stake delegated to it, including delegators who will override it with their own vote."
            />
          </p>
        </div>
      </CardBody>
      <CardBody flush>
        <DataTable
          ariaLabel={`Votes of the ${votes.length} largest validators`}
          columns={columns}
          rows={[...rows]}
          getRowKey={(row) => row.operatorAddress}
          density="compact"
          rowHref={(row) => `/validators/${encodeURIComponent(row.operatorAddress)}?chain=${encodeURIComponent(chainId)}`}
          mobileCard={(row) => (
            <span className="flex min-w-0 items-center gap-3">
              <span className="w-6 shrink-0 font-mono text-[12px] text-fg-dim">{row.rank || "—"}</span>
              <ChainLogo chain={{ chainName: row.moniker, coinDenom: row.moniker, iconUrl: row.logoUrl ?? null }} size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-fg">{row.moniker}</span>
                <span className="block text-[12.5px] tabular-nums text-fg-dim">{pct(row.votingPower, 2)} of voting power</span>
              </span>
              <span className="shrink-0 text-[13px]">
                <VoteCell option={row.option} />
              </span>
            </span>
          )}
        />
      </CardBody>
      {votes.length > PREVIEW_ROWS ? (
        <div className="-mt-1 flex justify-center">
          <Button size="sm" variant="ghost" iconRight={expanded ? "chevronUp" : "chevronDown"} onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Show the top 10" : `Show all ${votes.length}`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
