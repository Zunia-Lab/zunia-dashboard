"use client";

/**
 * The list page's side column:
 *
 * - "Closing soon": time left on every open vote, against a 48-hour mark,
 *   once there are enough open votes for an overview to help (a short list
 *   of cards, each with its deadline, needs none).
 * - "Recent outcomes": how the latest proposals ended on each network and
 *   why the others failed — a chain that vetoes a stream of airdrop spam
 *   reads differently from one where proposals fail for lack of turnout.
 * - "Rules by network" (all chains) / "Governance rules" (one chain): quorum,
 *   pass threshold, veto, voting period and minimum deposit, read from each
 *   chain's own gov params. The comparison is the analytical part: the same
 *   turnout passes on Osmosis (30 % quorum) and fails on the Hub (40 %).
 */

import { BarList, VIZ_ACCENT } from "@/components/charts";
import {
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  chainById,
  InlineError,
  KeyValueList,
  Skeleton,
  SourceTag,
  TokenAmount,
  useNow,
} from "@/components/ui";
import type { ChainStats, ProposalRow } from "@/lib/chain/types";
import { formatDuration } from "@/lib/format";
import { useChainStats } from "@/lib/data/chains";
import { pastOrNow, trackRecords, type ChainRecord, type RecordEntry } from "./model";
import { pct, reasonText, votingEnded, type OutcomeReason } from "./rules";

const HOURS = 3_600_000;

/** Open votes from which a side-by-side view of deadlines earns its place. */
const CLOSING_SOON_MIN = 4;

const hoursText = (hours: number) => formatDuration(hours * 3600);

/** Time left on each open vote, soonest first. */
export function ClosingSoon({ rows, now, pending }: { rows: readonly ProposalRow[]; now: number | null; pending: boolean }) {
  if (now === null) return null;
  const open = rows
    .filter((row) => row.status === "voting" && row.votingEndTime && !votingEnded(row, now))
    .map((row) => ({ row, left: (Date.parse(row.votingEndTime as string) - now) / HOURS }))
    .filter((entry) => Number.isFinite(entry.left) && entry.left > 0)
    .sort((a, b) => a.left - b.left)
    .slice(0, 8);
  // With a few open votes the cards and the strip already say it all.
  if (open.length < CLOSING_SOON_MIN) return null;
  const longest = open[open.length - 1]?.left ?? 0;
  return (
    <Card pending={pending}>
      <CardHeader title="Closing soon" subtitle="Time left to vote, soonest first" icon="clock" />
      <CardBody>
        <BarList
          title="Time left to vote"
          sort={false}
          showShare={false}
          color={VIZ_ACCENT}
          valueFormatter={hoursText}
          reference={longest > 48 ? { value: 48, label: "48 h" } : undefined}
          items={open.map(({ row, left }) => ({
            id: `${row.chainId}:${row.id}`,
            label: `${chainById(row.chainId)?.chainName ?? row.chainId} #${row.id}`,
            value: left,
            icon: <ChainLogo chainId={row.chainId} size={16} />,
            detail: row.title,
          }))}
        />
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ recent outcomes */

const ENTRY_FILL: Record<RecordEntry["status"], string> = {
  passed: "bg-[var(--z-success)]",
  rejected: "bg-[var(--z-danger)]",
  failed: "bg-[var(--z-warning)]",
};

const ENTRY_LABEL: Record<RecordEntry["status"], string> = {
  passed: "Passed",
  rejected: "Rejected",
  failed: "Passed, execution failed",
};

/** Rejection reasons, most frequent first: "7 vetoed · 2 below quorum". */
function reasonsText(record: ChainRecord): string {
  return (Object.entries(record.reasons) as Array<[OutcomeReason, number]>)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${reasonText(reason)}`)
    .join(" · ");
}

/**
 * How the latest proposals ended on each network in scope: one mark per
 * ended proposal, oldest to newest, so a run of rejections stands out, and
 * the count of each reason. Reads only the rows the page already has (the 20
 * most recent per network), and says so.
 */
export function RecentOutcomes({
  rows,
  chainIds,
  loading,
  pending,
}: {
  rows: readonly ProposalRow[];
  chainIds: readonly string[];
  loading: boolean;
  pending: boolean;
}) {
  const records = trackRecords(rows, chainIds).filter((record) => record.entries.length > 0);
  if (loading) {
    return (
      <Card>
        <CardHeader title="Recent outcomes" icon="list" />
        <div className="flex flex-col gap-4" aria-hidden>
          {Array.from({ length: Math.min(3, Math.max(1, chainIds.length)) }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-2.5 w-full" />
            </div>
          ))}
        </div>
      </Card>
    );
  }
  if (records.length === 0) return null;
  const present = (["passed", "rejected", "failed"] as const).filter((status) => records.some((record) => record[status] > 0));
  return (
    <Card pending={pending}>
      <CardHeader
        title="Recent outcomes"
        subtitle={chainIds.length === 1 ? "How the latest proposals ended" : "How the latest proposals ended, per network"}
        icon="list"
        info="Among the 20 most recent proposals of each network. Quorum is checked first, as the chain does: below quorum when the turnout estimate (against today's staked total) is clearly under it, or when the final tally met both other rules. Otherwise vetoed or not enough Yes, exact from the final tally."
      />
      <ul className="flex flex-col divide-y divide-[var(--d-hairline)]">
        {records.map((record) => {
          const ended = record.entries.length;
          const name = chainById(record.chainId)?.chainName ?? record.chainId;
          const reasons = reasonsText(record);
          return (
            <li key={record.chainId} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-2 text-[13px]">
                <ChainLogo chainId={record.chainId} size={18} />
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{name}</span>
                <span className="shrink-0 tabular-nums text-fg-muted">
                  <span className="font-medium text-fg">{record.passed + record.failed}</span> of {ended} passed
                </span>
              </div>
              <span
                role="img"
                aria-label={`${name}: ${record.passed + record.failed} of the last ${ended} ended proposals passed${record.rejected ? `, ${record.rejected} rejected` : ""}${record.failed ? `, ${record.failed} failed to execute` : ""}.`}
                className="flex flex-wrap gap-[3px]"
              >
                {record.entries.map((entry) => (
                  <span
                    key={entry.id}
                    title={`#${entry.id} · ${ENTRY_LABEL[entry.status]}${entry.reason ? ` (${reasonText(entry.reason)})` : ""} — ${entry.title}`}
                    className={`h-2.5 w-2 shrink-0 rounded-[2px] ${ENTRY_FILL[entry.status]}`}
                  />
                ))}
              </span>
              {record.rejected > 0 ? (
                <p className="text-[12px] leading-snug text-fg-dim">
                  {record.rejected} rejected{reasons ? `: ${reasons}` : ""}
                  {record.failed > 0 ? ` · ${record.failed} failed to execute` : ""}
                </p>
              ) : record.failed > 0 ? (
                <p className="text-[12px] leading-snug text-fg-dim">{record.failed} passed but failed to execute</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-dim">
        {present.map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-2 w-1.5 rounded-[2px] ${ENTRY_FILL[status]}`} />
            {status === "failed" ? "Execution failed" : ENTRY_LABEL[status]}
          </span>
        ))}
        <span className="ml-auto">Oldest → newest</span>
      </p>
    </Card>
  );
}

function minDepositOf(gov: NonNullable<ChainStats["gov"]>, stats: ChainStats) {
  const coin = gov.minDeposit?.[0] ?? null;
  if (!coin) return null;
  const native = coin.denom === stats.nativeDenom;
  return { amount: coin.amount, decimals: native ? stats.nativeDecimals : null, symbol: native ? stats.nativeSymbol : coin.denom };
}

/**
 * Each chain's gov rules side by side (all chains) or one chain's in full.
 * `ready={false}` holds the read (and shows the skeleton) while the page does
 * not know yet which networks it covers.
 */
export function RulesCard({
  chainIds,
  selectedChainId,
  ready = true,
}: {
  chainIds: readonly string[];
  selectedChainId: string | null;
  ready?: boolean;
}) {
  const stats = useChainStats(ready ? chainIds : []);
  const now = useNow();
  const chains = (stats.data?.chains ?? []).filter((chain) => chainIds.includes(chain.chainId));
  const single = selectedChainId ? chains.find((chain) => chain.chainId === selectedChainId) ?? null : null;
  const title = selectedChainId ? "Governance rules" : "Rules by network";
  const subtitle = selectedChainId ? (chainById(selectedChainId)?.chainName ?? selectedChainId) : "What it takes to pass, per chain";

  return (
    <Card pending={stats.refreshing || stats.stale}>
      <CardHeader title={title} subtitle={subtitle} icon="governance" />
      <CardBody>
        {!ready || stats.loading ? (
          <div className="flex flex-col gap-3" aria-hidden>
            {Array.from({ length: Math.min(5, Math.max(1, chainIds.length)) }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton circle width={18} />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : stats.error && !stats.data ? (
          <InlineError message="Chain parameters could not be read." onRetry={stats.refetch} />
        ) : selectedChainId ? (
          single?.gov ? (
            <SingleRules stats={single} />
          ) : (
            <p className="text-[13px] text-fg-dim">{single?.reasons?.gov ?? "This chain's governance parameters could not be read."}</p>
          )
        ) : (
          <RulesTable chains={chains} />
        )}
      </CardBody>
      {stats.data ? (
        <p className="-mt-1">
          <SourceTag source="Chain gov params" at={pastOrNow(stats.updatedAt, now)} />
        </p>
      ) : null}
    </Card>
  );
}

function SingleRules({ stats }: { stats: ChainStats }) {
  const gov = stats.gov;
  if (!gov) return null;
  const deposit = minDepositOf(gov, stats);
  return (
    <KeyValueList
      divided
      items={[
        { key: "quorum", label: "Quorum", value: pct(gov.quorum), info: "Share of staked voting power that must vote (abstain counts) for the result to stand." },
        { key: "threshold", label: "Pass threshold", value: `> ${pct(gov.threshold)}`, info: "Yes must exceed this share of Yes + No + No with veto." },
        { key: "veto", label: "Veto", value: `> ${pct(gov.vetoThreshold)}`, info: "No with veto above this share of all votes rejects the proposal and can burn its deposit." },
        { key: "period", label: "Voting period", value: gov.votingPeriodDays !== null ? formatDuration(gov.votingPeriodDays * 86_400) : "—" },
        {
          key: "expedited",
          label: "Expedited",
          value:
            gov.expeditedThreshold !== null
              ? `> ${pct(gov.expeditedThreshold)}${gov.expeditedVotingPeriodDays !== null ? ` in ${formatDuration(gov.expeditedVotingPeriodDays * 86_400)}` : ""}`
              : "Not available",
        },
        {
          key: "deposit",
          label: "Minimum deposit",
          value: deposit ? <TokenAmount amount={deposit.amount} decimals={deposit.decimals} symbol={deposit.symbol} compact masked={false} /> : "—",
          sub: gov.depositPeriodDays !== null ? `Within ${formatDuration(gov.depositPeriodDays * 86_400)}` : undefined,
        },
        { key: "api", label: "Gov module", value: <span className="font-mono text-[12.5px]">{gov.api}</span> },
      ]}
    />
  );
}

function RulesTable({ chains }: { chains: readonly ChainStats[] }) {
  const rows = chains.filter((chain) => chain.gov);
  if (rows.length === 0) return <p className="text-[13px] text-fg-dim">No governance parameters could be read for these networks.</p>;
  const missing = chains.length - rows.length;
  // A rule every network shares is said once under the table, not per row.
  const firstVeto = rows[0]?.gov?.vetoThreshold ?? null;
  const sameVeto = rows.every((chain) => chain.gov?.vetoThreshold === firstVeto);
  return (
    <div className="-mx-1 flex flex-col">
      <table className="w-full text-[13px] tabular-nums">
        <caption className="sr-only">Governance rules by network</caption>
        <thead>
          <tr className="text-left font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-dim">
            <th scope="col" className="px-1 pb-2 font-normal">
              Network
            </th>
            <th scope="col" className="px-1 pb-2 text-right font-normal">
              Quorum
            </th>
            <th scope="col" className="px-1 pb-2 text-right font-normal">
              Pass
            </th>
            <th scope="col" className="px-1 pb-2 text-right font-normal">
              Voting
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((chain) => {
            const gov = chain.gov as NonNullable<ChainStats["gov"]>;
            const deposit = minDepositOf(gov, chain);
            return (
              <tr key={chain.chainId} className="border-t border-[var(--d-hairline)] align-top">
                <th scope="row" className="w-full max-w-0 px-1 py-2 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <ChainLogo chainId={chain.chainId} size={18} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg">{chain.chainName}</span>
                      {deposit ? (
                        <span className="block truncate text-[11.5px] text-fg-dim" title="Minimum deposit">
                          Deposit <TokenAmount amount={deposit.amount} decimals={deposit.decimals} symbol={deposit.symbol} compact masked={false} />
                        </span>
                      ) : null}
                    </span>
                  </span>
                </th>
                <td className="whitespace-nowrap px-1 py-2 text-right text-fg">{pct(gov.quorum)}</td>
                <td className="whitespace-nowrap px-1 py-2 text-right text-fg">
                  {pct(gov.threshold)}
                  {sameVeto ? null : (
                    <span className="block text-[11.5px] text-fg-dim" title="Veto threshold">
                      veto {pct(gov.vetoThreshold)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-1 py-2 text-right text-fg">
                  {gov.votingPeriodDays !== null ? formatDuration(gov.votingPeriodDays * 86_400) : "—"}
                  {gov.expeditedVotingPeriodDays !== null ? (
                    <span className="block text-[11.5px] text-fg-dim" title="Expedited proposals">
                      fast {formatDuration(gov.expeditedVotingPeriodDays * 86_400)}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sameVeto && firstVeto !== null ? (
        <p className="mt-2 px-1 text-[12px] text-fg-dim">Veto threshold {pct(firstVeto)} on every network; “fast” is the expedited voting period.</p>
      ) : null}
      {missing > 0 ? (
        <p className="mt-2 px-1 text-[12px] text-fg-dim">
          {missing} {missing === 1 ? "network's" : "networks'"} parameters could not be read.
        </p>
      ) : null}
    </div>
  );
}
