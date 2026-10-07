"use client";

/**
 * Ended proposals (Passed / Rejected tabs) as one dense, sortable table: a
 * history is read by scanning and comparing — which passed, by how much, on
 * what turnout — not card by card. Each row opens the proposal page.
 *
 * The Passed tab drops the Result column (every row would say "Passed"); the
 * Rejected tab says why each one failed, in x/gov's order: quorum first,
 * then the final tally (see `rejectionReason`). Turnout of an ended vote is
 * an estimate ("≈"), and "—" once it is too old to mean anything.
 */

import { Card, CardBody, ChainLogo, chainById, DataTable, StatusBadge, type Column } from "@/components/ui";
import type { ProposalRow } from "@/lib/chain/types";
import { formatDate } from "@/lib/format";
import { proposalHref, STATUS_LABEL, typeBadge, VOTE_LABEL, VOTE_ORDER } from "./model";
import { pct, reasonText, rejectionReason, stackParts, tallyShares, TURNOUT_WITHHELD, turnoutWithheld, yesOfDecisive } from "./rules";
import { VOTE_FILL } from "./TallyBar";

function endedAt(row: ProposalRow): number | null {
  const at = row.votingEndTime ? Date.parse(row.votingEndTime) : Number.NaN;
  return Number.isFinite(at) && at > 0 ? at : null;
}

const chainName = (row: ProposalRow) => chainById(row.chainId)?.chainName ?? row.chainId;

/** A 6px votes bar: the shape of the result at a glance (figures sit beside it). */
function MiniTally({ row, width = 88 }: { row: ProposalRow; width?: number }) {
  const shares = tallyShares(row.tally);
  if (!shares) return <span className="text-fg-dim">—</span>;
  const parts = stackParts(VOTE_ORDER.map((option) => ({ option, share: shares[option] })).filter((p) => p.share > 0));
  return (
    <span
      role="img"
      aria-label={VOTE_ORDER.map((o) => `${VOTE_LABEL[o]} ${pct(shares[o])}`).join(", ")}
      className="relative inline-block h-1.5 shrink-0 overflow-hidden rounded-[3px] bg-[var(--d-glass-2)] align-middle"
      style={{ width }}
    >
      {parts.map((part, index) => (
        <span
          key={part.option}
          className="absolute inset-y-0 box-border"
          style={{
            left: `${part.start * 100}%`,
            width: `${part.share * 100}%`,
            background: VOTE_FILL[part.option],
            borderLeft: index > 0 ? "1.5px solid var(--d-card)" : undefined,
          }}
        />
      ))}
    </span>
  );
}

/** "≈ 30% turnout", or "turnout —" with the reason on hover. */
function Turnout({ row }: { row: ProposalRow }) {
  if (row.turnout !== null) return <>≈ {pct(row.turnout)} turnout</>;
  return <span title={turnoutWithheld(row) ? TURNOUT_WITHHELD : "Turnout unknown"}>turnout —</span>;
}

/** Rejected / Failed and why, in a few words (the proposal page spells it out). */
function Result({ row }: { row: ProposalRow }) {
  const reason = rejectionReason(row);
  const text = row.status === "failed" ? "vote passed; execution failed" : reason ? reasonText(reason) : null;
  const why = text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <StatusBadge tone={row.status === "passed" ? "success" : "danger"}>{STATUS_LABEL[row.status]}</StatusBadge>
      {why ? <span className="text-[12px] leading-snug text-fg-dim">{why}</span> : null}
    </span>
  );
}

export function ResultsTable({ rows, tab, pending }: { rows: ProposalRow[]; tab: "passed" | "rejected"; pending?: boolean }) {
  const columns: Column<ProposalRow>[] = [
    {
      key: "proposal",
      header: "Proposal",
      // Takes the room left by the fixed columns and truncates inside it,
      // instead of growing the table to the title's full length.
      className: "w-full max-w-0",
      cell: (row) => (
        <span className="flex min-w-0 items-start gap-2.5 py-1">
          <ChainLogo chainId={row.chainId} size={20} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-fg-dim">
              <span className="shrink-0 text-fg-muted">{chainName(row)}</span>
              <span className="shrink-0 font-mono">#{row.id}</span>
              <span className="min-w-0 truncate">· {typeBadge(row)}</span>
            </span>
            <span className="block truncate text-[14px] font-medium text-fg" title={row.title}>
              {row.title}
            </span>
          </span>
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.title.toLowerCase(),
      sortDescFirst: false,
    },
    ...(tab === "rejected"
      ? [
          {
            key: "result",
            header: "Result",
            width: 156,
            cell: (row: ProposalRow) => <Result row={row} />,
            sortable: true,
            sortValue: (row: ProposalRow) => `${STATUS_LABEL[row.status]} ${rejectionReason(row) ?? ""}`,
            sortDescFirst: false,
            hideBelow: "sm" as const,
          },
        ]
      : []),
    {
      key: "votes",
      header: "Votes",
      align: "right",
      width: 136,
      cell: (row) => (
        <span className="inline-flex flex-col items-end gap-1 tabular-nums">
          <span className="inline-flex items-center gap-2">
            <MiniTally row={row} width={44} />
            <span className="whitespace-nowrap text-fg">Yes {pct(yesOfDecisive(row.tally))}</span>
          </span>
          <span className="whitespace-nowrap text-[12px] text-fg-dim">
            <Turnout row={row} />
          </span>
        </span>
      ),
      sortable: true,
      sortValue: (row) => yesOfDecisive(row.tally),
      hideBelow: "sm",
    },
    {
      key: "ended",
      header: "Ended",
      align: "right",
      width: 96,
      cell: (row) => {
        const at = endedAt(row);
        return <span className="whitespace-nowrap tabular-nums text-fg-muted">{at !== null ? formatDate(at, "short") : "—"}</span>;
      },
      sortable: true,
      sortValue: (row) => endedAt(row),
    },
  ];

  return (
    <Card pending={pending}>
      <CardBody flush>
        <DataTable
          ariaLabel={tab === "passed" ? "Passed proposals" : "Rejected and failed proposals"}
          columns={columns}
          rows={rows}
          getRowKey={(row) => `${row.chainId}:${row.id}`}
          rowHref={(row) => proposalHref(row.chainId, row.id)}
          initialSort={{ key: "ended", dir: "desc" }}
          mobileCard={(row) => {
            const at = endedAt(row);
            return (
              <span className="flex min-w-0 flex-col gap-2">
                <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-fg-dim">
                  <ChainLogo chainId={row.chainId} size={18} />
                  <span className="truncate text-fg-muted">{chainName(row)}</span>
                  <span className="shrink-0 font-mono">#{row.id}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{at !== null ? formatDate(at, "short") : ""}</span>
                </span>
                <span className="line-clamp-2 text-[14px] font-medium leading-snug text-fg">{row.title}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
                  {tab === "rejected" ? <Result row={row} /> : null}
                  <span className="ml-auto inline-flex items-center gap-2 tabular-nums text-fg-muted">
                    <MiniTally row={row} width={72} />
                    Yes {pct(yesOfDecisive(row.tally))}
                    <span className="text-fg-dim">
                      · <Turnout row={row} />
                    </span>
                  </span>
                </span>
              </span>
            );
          }}
        />
      </CardBody>
    </Card>
  );
}
