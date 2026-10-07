/**
 * Governance view model: everything the pages say about proposals beyond
 * the tally rules themselves (those are in `./rules`): vote options and
 * labels, your vote and the one your validators cast, deadlines, tabs and
 * search, the participation strip, how recent proposals ended per network,
 * the timeline, deposits, and the text around a proposal.
 *
 * Pure (no React, no fetch), so `node --test` covers it: what a tab or a
 * search shows, what "your validators voted" adds up to, and which numbers
 * the strip counts.
 */

import type { InheritedVote, ProposalRow, ProposalStatus, VoteChoice, VoteOptionName } from "@/lib/chain/types";
import { formatDate } from "@/lib/format";
import { outcomeOf, pct, rejectionReason, votingEnded, type OutcomeReason } from "./rules";

const HOUR = 3_600_000;

/* ------------------------------------------------------------------ options */

/** Bar and legend order: the decisive options first, abstain (quorum only) last. */
export const VOTE_ORDER: readonly VoteOptionName[] = ["yes", "no", "veto", "abstain"];

/** The vote form's order: two rows, "for / against" then "abstain / veto". */
export const FORM_ORDER: readonly VoteOptionName[] = ["yes", "no", "abstain", "veto"];

export const VOTE_LABEL: Record<VoteOptionName, string> = {
  yes: "Yes",
  no: "No",
  veto: "No with veto",
  abstain: "Abstain",
};

/** Compact labels for legends where "No with veto" does not fit. */
export const VOTE_SHORT: Record<VoteOptionName, string> = {
  yes: "Yes",
  no: "No",
  veto: "Veto",
  abstain: "Abstain",
};

/* ------------------------------------------------------------------ track record */

export interface RecordEntry {
  id: string;
  title: string;
  status: "passed" | "rejected" | "failed";
  reason: OutcomeReason | null;
}

export interface ChainRecord {
  chainId: string;
  /** Ended proposals among the rows read, oldest first. */
  entries: RecordEntry[];
  passed: number;
  rejected: number;
  /** Passed, but their messages failed to execute. */
  failed: number;
  /** Rejections by the rule that decided them (unknown ones are not counted). */
  reasons: Partial<Record<OutcomeReason, number>>;
}

/**
 * How recent proposals ended on each network, in `chainIds` order: the pass
 * rate and why the others failed ("10 rejected, 7 of them vetoed" says a
 * chain gets spam). Covers only the rows given (the list reads the 20 most
 * recent per network), which the card says.
 */
export function trackRecords(rows: readonly ProposalRow[], chainIds: readonly string[]): ChainRecord[] {
  const records = new Map<string, ChainRecord>(
    chainIds.map((chainId) => [chainId, { chainId, entries: [], passed: 0, rejected: 0, failed: 0, reasons: {} }]),
  );
  for (const row of rows) {
    const record = records.get(row.chainId);
    if (!record || (row.status !== "passed" && row.status !== "rejected" && row.status !== "failed")) continue;
    const reason = rejectionReason(row);
    record.entries.push({ id: row.id, title: row.title, status: row.status, reason });
    record[row.status] += 1;
    if (reason) record.reasons[reason] = (record.reasons[reason] ?? 0) + 1;
  }
  for (const record of records.values()) record.entries.sort((a, b) => Number(a.id) - Number(b.id));
  return [...records.values()];
}

/* ------------------------------------------------------------------ your vote */

/** Voting power as x/gov counts it: positive, zero ("0") or unknown (null). */
export function powerState(power: string | null | undefined): "some" | "none" | "unknown" {
  if (power === null || power === undefined) return "unknown";
  return /^0*$/.test(power) ? "none" : "some";
}

export interface InheritedPart {
  option: VoteOptionName | "weighted" | "none";
  /** Share of the voter's whole voting power, 0..1. */
  weight: number;
}

/**
 * "Your validators voted: 70% Yes · 30% not yet", from the per-validator list
 * (largest first, weights are shares of your whole voting power). Weight of
 * validators past the server's lookup cap is `unlisted`, never assigned.
 */
export function inheritedSummary(list: readonly InheritedVote[] | undefined): { parts: InheritedPart[]; unlisted: number } | null {
  if (!list || list.length === 0) return null;
  const byOption = new Map<InheritedPart["option"], number>();
  let listed = 0;
  for (const entry of list) {
    const key = entry.option ?? "none";
    byOption.set(key, (byOption.get(key) ?? 0) + entry.weight);
    listed += entry.weight;
  }
  const order: InheritedPart["option"][] = ["yes", "no", "veto", "abstain", "weighted", "none"];
  const parts = order
    .map((option) => ({ option, weight: byOption.get(option) ?? 0 }))
    .filter((part) => part.weight > 0.0005);
  return { parts, unlisted: Math.max(0, 1 - listed) };
}

/** "Yes", "No with veto", or "Split: 60% Yes · 40% Abstain". */
export function voteChoiceText(choice: VoteChoice | null | undefined): string | null {
  if (!choice) return null;
  if (choice.option !== "weighted") return VOTE_LABEL[choice.option];
  const weights = (choice.weights ?? []).slice().sort((a, b) => b.weight - a.weight);
  if (weights.length === 0) return "Split vote";
  return `Split: ${weights.map((w) => `${pct(w.weight, 0)} ${VOTE_SHORT[w.option]}`).join(" · ")}`;
}

/* ------------------------------------------------------------------ deposit */

export interface DepositState {
  /** The minimum's denom (or the first deposited one when the minimum is unknown). */
  denom: string | null;
  /** Deposited so far in that denom, base units ("0" when none of it). */
  total: string | null;
  /** The chain's minimum deposit, base units. */
  min: string | null;
  /** Deposited ÷ minimum (may exceed 1); null when either is unknown. */
  ratio: number | null;
  /** Base units still missing before voting opens ("0" once met). */
  missing: string | null;
}

function units(value: string | undefined): bigint | null {
  if (!value || !/^\d{1,40}$/.test(value)) return null;
  return BigInt(value);
}

/**
 * Where a proposal's deposit stands against today's minimum, counted in the
 * minimum's own denom only: a deposit in another token never counts toward it
 * (and is never compared with it).
 */
export function depositState(row: Pick<ProposalRow, "totalDeposit" | "minDeposit">): DepositState {
  const min = row.minDeposit?.[0] ?? null;
  if (!min) {
    const first = row.totalDeposit[0] ?? null;
    return { denom: first?.denom ?? null, total: first?.amount ?? null, min: null, ratio: null, missing: null };
  }
  const minUnits = units(min.amount);
  const totalUnits = units(row.totalDeposit.find((coin) => coin.denom === min.denom)?.amount ?? "0");
  if (minUnits === null || totalUnits === null) return { denom: min.denom, total: null, min: min.amount, ratio: null, missing: null };
  return {
    denom: min.denom,
    total: totalUnits.toString(),
    min: minUnits.toString(),
    ratio: minUnits > BigInt(0) ? Number(totalUnits) / Number(minUnits) : null,
    missing: (minUnits > totalUnits ? minUnits - totalUnits : BigInt(0)).toString(),
  };
}

/* ------------------------------------------------------------------ time */

export const ENDING_SOON_MS = 48 * HOUR;

/** Milliseconds until the deadline that matters for the row's status. */
export function deadlineOf(row: Pick<ProposalRow, "status" | "votingEndTime" | "depositEndTime">): number | null {
  const iso = row.status === "voting" ? row.votingEndTime : row.status === "deposit" ? row.depositEndTime : null;
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

export function endsWithin(row: ProposalRow, now: number | null, windowMs = ENDING_SOON_MS): boolean {
  if (row.status !== "voting" || now === null) return false;
  const at = deadlineOf(row);
  return at !== null && at > now && at - now <= windowMs;
}

/* ------------------------------------------------------------------ tabs & filters */

export type GovTab = "voting" | "deposit" | "passed" | "rejected";

export function tabOf(status: ProposalStatus): GovTab | null {
  switch (status) {
    case "voting":
    case "deposit":
    case "passed":
      return status;
    case "rejected":
    case "failed":
      return "rejected";
    default:
      return null;
  }
}

export interface RowFilter {
  tab: GovTab;
  query?: string;
  /** Keep chains where the wallet has voting power (unknown power is kept: never hide on a guess). */
  onlyVotable?: boolean;
  /** Chain display names for search. */
  chainName?: (chainId: string) => string | undefined;
}

export function matchesQuery(row: ProposalRow, query: string, chainName?: (chainId: string) => string | undefined): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  if (/^\d+$/.test(q) && row.id === q) return true;
  const haystack = [
    row.title,
    row.summary,
    row.type,
    typeLabel(row.type),
    ...row.messageTypes,
    row.chainId,
    chainName?.(row.chainId) ?? "",
    `#${row.id}`,
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word.replace(/^#/, "")));
}

export function filterRows(rows: readonly ProposalRow[], filter: RowFilter): ProposalRow[] {
  const out = rows.filter((row) => {
    if (tabOf(row.status) !== filter.tab) return false;
    if (filter.onlyVotable && powerState(row.myVotingPower) === "none") return false;
    return !filter.query || matchesQuery(row, filter.query, filter.chainName);
  });
  return sortForTab(out, filter.tab);
}

function time(iso: string | null): number {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
}

/** Voting: ending soonest. Deposit: deadline soonest. Ended: most recent first. */
export function sortForTab(rows: ProposalRow[], tab: GovTab): ProposalRow[] {
  const byId = (a: ProposalRow, b: ProposalRow) => Number(b.id) - Number(a.id);
  if (tab === "voting") return rows.sort((a, b) => time(a.votingEndTime) - time(b.votingEndTime) || byId(a, b));
  if (tab === "deposit") return rows.sort((a, b) => time(a.depositEndTime) - time(b.depositEndTime) || byId(a, b));
  return rows.sort((a, b) => time(b.votingEndTime ?? b.submitTime) - time(a.votingEndTime ?? a.submitTime) || byId(a, b));
}

/** Rows by `chainId:id`, first answer wins (merging the "all" list with a deeper history read). */
export function mergeRows(...lists: ReadonlyArray<readonly ProposalRow[] | null | undefined>): ProposalRow[] {
  const seen = new Map<string, ProposalRow>();
  for (const list of lists) {
    for (const row of list ?? []) {
      const key = `${row.chainId}:${row.id}`;
      if (!seen.has(key)) seen.set(key, row);
    }
  }
  return [...seen.values()];
}

/* ------------------------------------------------------------------ participation */

export interface Participation {
  /** Voting proposals still open (ended-but-not-tallied ones excluded). */
  open: number;
  passing: number;
  failing: number;
  /** Open proposals where the wallet voted. */
  voted: number;
  /** Open proposals where the wallet has voting power and has not voted. */
  notVoted: number;
  /** Open proposals where the wallet has voting power (voted or not). */
  eligible: number;
  /** Open proposals whose vote status could not be read. */
  unknown: number;
  /** Open proposals on networks the wallet has no address for (no vote status at all). */
  unaddressed: number;
  /** Networks with an open proposal, in the order they close. */
  openChainIds: string[];
  endingSoon: number;
  endingSoonNotVoted: number;
  /** The open proposal closing first. */
  next: ProposalRow | null;
  /** The one closing first among those waiting for your vote. */
  nextAwaiting: ProposalRow | null;
  deposit: number;
}

export function participation(rows: readonly ProposalRow[], now: number | null): Participation {
  const open = rows.filter((row) => row.status === "voting" && !votingEnded(row, now));
  const result: Participation = {
    open: open.length,
    passing: 0,
    failing: 0,
    voted: 0,
    notVoted: 0,
    eligible: 0,
    unknown: 0,
    unaddressed: 0,
    openChainIds: [],
    endingSoon: 0,
    endingSoonNotVoted: 0,
    next: null,
    nextAwaiting: null,
    deposit: rows.filter((row) => row.status === "deposit").length,
  };
  for (const row of open) {
    const outcome = outcomeOf(row, now);
    if (outcome.kind === "passing") result.passing += 1;
    else if (outcome.kind === "failing") result.failing += 1;
    const power = powerState(row.myVotingPower);
    const awaiting = row.myVoteStatus === "not-voted" && power === "some";
    if (row.myVoteStatus === "voted") result.voted += 1;
    if (awaiting) {
      result.notVoted += 1;
      if (!result.nextAwaiting || time(row.votingEndTime) < time(result.nextAwaiting.votingEndTime)) result.nextAwaiting = row;
    }
    if (row.myVoteStatus === "voted" || power === "some") result.eligible += 1;
    if (row.myVoteStatus === "unknown") result.unknown += 1;
    if (row.myVoteStatus === null) result.unaddressed += 1;
    if (endsWithin(row, now)) {
      result.endingSoon += 1;
      if (awaiting) result.endingSoonNotVoted += 1;
    }
    if (!result.next || time(row.votingEndTime) < time(result.next.votingEndTime)) result.next = row;
  }
  result.openChainIds = [
    ...new Set(open.slice().sort((a, b) => time(a.votingEndTime) - time(b.votingEndTime)).map((row) => row.chainId)),
  ];
  return result;
}

/* ------------------------------------------------------------------ labels */

const TYPE_LABELS: Record<string, string> = {
  Text: "Text",
  TextProposal: "Text",
  MsgSoftwareUpgrade: "Software upgrade",
  SoftwareUpgradeProposal: "Software upgrade",
  MsgCancelUpgrade: "Cancel upgrade",
  CancelSoftwareUpgradeProposal: "Cancel upgrade",
  MsgCommunityPoolSpend: "Community pool spend",
  CommunityPoolSpendProposal: "Community pool spend",
  MsgUpdateParams: "Parameter change",
  ParameterChangeProposal: "Parameter change",
  MsgExecLegacyContent: "Legacy proposal",
  MsgStoreCode: "Upload contract code",
  StoreCodeProposal: "Upload contract code",
  MsgInstantiateContract: "Instantiate contract",
  MsgInstantiateContract2: "Instantiate contract",
  MsgExecuteContract: "Contract call",
  MsgMigrateContract: "Migrate contract",
  MsgSudoContract: "Contract sudo call",
  MsgRecoverClient: "IBC client recovery",
  ClientUpdateProposal: "IBC client recovery",
  MsgIBCSoftwareUpgrade: "IBC upgrade",
  MsgSend: "Send",
  MsgTransfer: "IBC transfer",
  MsgSetSendEnabled: "Send enabled",
  MsgUpdateClient: "IBC client update",
};

/**
 * "MsgCommunityPoolSpend" → "Community pool spend"; unknown types are split
 * from their camel case ("MsgBatchExchangeModification" → "Batch exchange
 * modification"), acronyms kept ("IBC").
 */
export function typeLabel(type: string): string {
  const known = TYPE_LABELS[type];
  if (known) return known;
  const core = type.replace(/^Msg/, "").replace(/Proposal$/, "") || type;
  const words = core.match(/[A-Z]{2,}(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|[A-Z]+|\d+/g);
  if (!words || words.length === 0) return type;
  return words
    .map((word, index) =>
      /^[A-Z]{2,}$/.test(word) ? word : index === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase(),
    )
    .join(" ");
}

/** The type badge text, with "+2" when a proposal carries several kinds of message. */
export function typeBadge(row: Pick<ProposalRow, "type" | "messageTypes">): string {
  const kinds = new Set(row.messageTypes.filter((t) => t !== "MsgExecLegacyContent"));
  const extra = Math.max(0, kinds.size - 1);
  return extra > 0 ? `${typeLabel(row.type)} +${extra}` : typeLabel(row.type);
}

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  voting: "Voting",
  deposit: "Deposit",
  passed: "Passed",
  rejected: "Rejected",
  failed: "Failed",
  unknown: "Unknown",
};

/* ------------------------------------------------------------------ timeline */

export interface TimelineStep {
  key: "submitted" | "deposit" | "voting-start" | "voting-end" | "result";
  label: string;
  /** Epoch ms when the step happened (or will). */
  at: number | null;
  state: "done" | "current" | "todo" | "error";
  /** One short line: a date, "At submission", "Needs 3,800 SAF more". */
  note: string | null;
}

function at(iso: string | null): number | null {
  const value = iso ? Date.parse(iso) : Number.NaN;
  // Chains report unset times as year 1 ("0001-01-01T00:00:00Z").
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * submit → deposit met → voting opens → voting closes → result, with the
 * current step marked. A deposit met in the submitting transaction reads
 * "At submission" instead of a deposit deadline that no longer applies.
 */
export function proposalTimeline(row: ProposalRow): TimelineStep[] {
  const submitted = at(row.submitTime);
  const votingStart = at(row.votingStartTime);
  const votingEnd = at(row.votingEndTime);
  const depositEnd = at(row.depositEndTime);
  const inDeposit = row.status === "deposit";
  const voting = row.status === "voting";
  const ended = row.status === "passed" || row.status === "rejected" || row.status === "failed";
  const metAtSubmission = submitted !== null && votingStart !== null && votingStart - submitted < 60_000;

  return [
    { key: "submitted", label: "Submitted", at: submitted, state: "done", note: null },
    {
      key: "deposit",
      label: inDeposit ? "Deposit period" : "Deposit met",
      at: inDeposit ? depositEnd : votingStart,
      state: inDeposit ? "current" : votingStart !== null || ended ? "done" : "todo",
      note: inDeposit ? "Ends" : metAtSubmission ? "At submission" : null,
    },
    {
      key: "voting-start",
      label: "Voting opens",
      at: votingStart,
      state: voting || ended ? "done" : "todo",
      note: inDeposit ? "When the deposit is met" : null,
    },
    {
      key: "voting-end",
      label: ended ? "Voting closed" : "Voting closes",
      at: votingEnd,
      state: voting ? "current" : ended ? "done" : "todo",
      note: null,
    },
    {
      key: "result",
      label: ended ? STATUS_LABEL[row.status] : "Result",
      at: ended ? votingEnd : null,
      state: row.status === "passed" ? "done" : row.status === "rejected" || row.status === "failed" ? "error" : "todo",
      note: null,
    },
  ];
}

/**
 * An absolute time on a page the server renders (the proposal page). The
 * server cannot know the reader's time zone, so the server render and the
 * hydrating one (no clock yet: `now` is null, see `useNow`) both show UTC
 * and say so; once hydrated, the reader's own zone takes over. Both machines
 * then print the same text, so hydration never mismatches, and a crawler
 * reads a labelled time instead of the server's local one.
 */
export function dateText(at: number, style: "short" | "datetime", now: number | null): string {
  if (now !== null) return formatDate(at, style, { now });
  const utc = formatDate(at, style, { timeZone: "UTC" });
  return style === "datetime" ? `${utc} UTC` : utc;
}

/**
 * A server read time for a "2 min ago" tag: never in the future (a server
 * clock a few seconds ahead would otherwise read "in under a minute").
 */
export function pastOrNow(at: number | null, now: number | null): number | null {
  if (at === null) return null;
  return now !== null ? Math.min(at, now) : at;
}

/**
 * The summary excerpt without the title in front of it: descriptions often
 * open with the title as a heading, and the excerpt flattens that into
 * "Title Body…", which reads as a stutter under the title itself.
 */
export function summaryWithoutTitle(summary: string, title: string): string {
  const text = summary.trim();
  const head = title.trim();
  if (!head || !text.toLowerCase().startsWith(head.toLowerCase())) return text;
  return text.slice(head.length).replace(/^[\s.:—–-]+/, "").trim();
}

/** Title text for comparison: markup, case, spacing and closing punctuation ignored. */
function titleKey(text: string): string {
  return text
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:]+$/, "")
    .toLowerCase();
}

/**
 * The description without an opening line that only repeats the title (most
 * proposals start with "# <title>"), which the page header already shows. A
 * heading, a bold line or a setext title is dropped; anything else stays as
 * written. Literal "\n" sequences count as line breaks, as in the renderer.
 */
export function descriptionWithoutTitle(source: string, title: string): string {
  const key = titleKey(title);
  if (!key) return source;
  const lines = source.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").split("\n");
  let first = 0;
  while (first < lines.length && !(lines[first] ?? "").trim()) first += 1;
  const line = lines[first] ?? "";
  const heading = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
  const bold = /^\s*(\*\*|__)(.+)\1\s*$/.exec(line);
  const underline = /^ {0,3}(?:=+|-+)\s*$/.test(lines[first + 1] ?? "");
  const drop =
    heading && titleKey(heading[1] ?? "") === key
      ? 1
      : bold && titleKey(bold[2] ?? "") === key
        ? 1
        : underline && titleKey(line) === key
          ? 2
          : 0;
  return drop ? lines.slice(first + drop).join("\n").trim() : source;
}

/** Placeholders some proposers put in the metadata field ("Not Used", "{}"). */
const PLACEHOLDER_METADATA = /^(?:not used|unused|n\/?a|none|null|undefined|empty|-+|\{\s*\}|\[\s*\]|""|'')$/i;

/** The metadata text worth showing; "" for an empty field or a placeholder. */
export function meaningfulMetadata(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  return text && !PLACEHOLDER_METADATA.test(text) ? text : "";
}

/* ------------------------------------------------------------------ links */

/** The proposal page: chain in the path, because ids are per chain. */
export function proposalHref(chainId: string, id: string): string {
  return `/governance/${encodeURIComponent(chainId)}/${encodeURIComponent(id)}`;
}
