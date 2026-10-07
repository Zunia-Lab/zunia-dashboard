/**
 * Governance: proposal normalisation (gov v1 and v1beta1), tallies, turnout,
 * the SDK's pass/fail rules, votes and inherited votes.
 *
 * `passingIfEndedNow` mirrors x/gov's tally (`keeper/tally.go`, SDK 0.47–0.50):
 *
 * 1. turnout (all votes incl. abstain ÷ bonded) below quorum → fails;
 * 2. everyone abstained → fails;
 * 3. veto ÷ all votes above the veto threshold → fails (vetoed);
 * 4. yes ÷ (all votes − abstain) above the threshold → passes; else fails.
 *
 * Floating point is used for the ratios; a tally sitting exactly on a
 * threshold to the last base unit could round either way, which no
 * proposal has ever needed decided by a dashboard.
 *
 * Pure: parsing and math only.
 */

import {
  arr,
  clip,
  coins,
  intString,
  parseDec,
  parseTime,
  pick,
  rec,
  shortTypeName,
  str,
  toBigInt,
} from "./parse";
import type {
  Coin,
  InheritedVote,
  ProposalStatus,
  Tally,
  VoteChoice,
  VoteOptionName,
} from "./types";

export function proposalStatus(raw: unknown): ProposalStatus {
  const value = String(raw ?? "").toUpperCase().replace(/^PROPOSAL_STATUS_/, "");
  switch (value) {
    case "DEPOSIT_PERIOD":
    case "1":
      return "deposit";
    case "VOTING_PERIOD":
    case "2":
      return "voting";
    case "PASSED":
    case "3":
      return "passed";
    case "REJECTED":
    case "4":
      return "rejected";
    case "FAILED":
    case "5":
      return "failed";
    default:
      return "unknown";
  }
}

/** `VOTE_OPTION_YES` / `1` / `"yes"` → `yes`; null for unspecified. */
export function voteOptionName(raw: unknown): VoteOptionName | null {
  const value = String(raw ?? "").toUpperCase().replace(/^VOTE_OPTION_/, "");
  switch (value) {
    case "YES":
    case "1":
      return "yes";
    case "ABSTAIN":
    case "2":
      return "abstain";
    case "NO":
    case "3":
      return "no";
    case "NO_WITH_VETO":
    case "VETO":
    case "4":
      return "veto";
    default:
      return null;
  }
}

/**
 * A vote from `proposals/{id}/votes/{voter}` (`{ vote: {...} }`) or a bare
 * vote object. Weighted (split) votes keep every option; a single option with
 * full weight is reported as that option.
 */
export function parseVote(body: unknown): VoteChoice | null {
  const vote = rec(pick(body, ["vote"])) ?? rec(body);
  if (!vote) return null;
  const weights: Array<{ option: VoteOptionName; weight: number }> = [];
  for (const item of arr(vote.options)) {
    const entry = rec(item);
    const option = voteOptionName(entry?.option);
    const weight = parseDec(entry?.weight);
    if (option && weight !== null && weight > 0) weights.push({ option, weight });
  }
  if (weights.length === 0) {
    // v1beta1 before weighted votes: a single `option`.
    const option = voteOptionName(vote.option);
    return option ? { option } : null;
  }
  const first = weights[0];
  if (weights.length === 1 && first && first.weight >= 0.999999) return { option: first.option };
  return { option: "weighted", weights };
}

/** A tally in either spelling (v1 `yes_count`, v1beta1 `yes`), or null. */
export function parseTally(raw: unknown): Tally | null {
  const tally = rec(pick(raw, ["tally"])) ?? rec(raw);
  if (!tally) return null;
  const read = (v1: string, legacy: string) => intString(tally[v1]) ?? intString(tally[legacy]);
  const yes = read("yes_count", "yes");
  const no = read("no_count", "no");
  const abstain = read("abstain_count", "abstain");
  const veto = read("no_with_veto_count", "no_with_veto");
  if (yes === null || no === null || abstain === null || veto === null) return null;
  return { yes, no, abstain, veto };
}

export function tallyTotal(tally: Tally): bigint {
  return (
    (toBigInt(tally.yes) ?? BigInt(0)) +
    (toBigInt(tally.no) ?? BigInt(0)) +
    (toBigInt(tally.abstain) ?? BigInt(0)) +
    (toBigInt(tally.veto) ?? BigInt(0))
  );
}

/**
 * The tally a proposal row shows, by status.
 *
 * - voting: the live tally (a separate query), or null when unreadable;
 * - deposit: none — nobody can vote yet, and `final_tally_result` is a
 *   placeholder of zeros that would read as "0 % turnout";
 * - ended (passed / rejected / failed / unknown): the final tally.
 */
export function displayTally(
  status: ProposalStatus,
  finalTally: Tally | null,
  liveTally: Tally | null,
): { tally: Tally | null; kind: "live" | "final" | null } {
  if (status === "voting") return liveTally ? { tally: liveTally, kind: "live" } : { tally: null, kind: null };
  if (status === "deposit") return { tally: null, kind: null };
  return finalTally ? { tally: finalTally, kind: "final" } : { tally: null, kind: null };
}

/**
 * The proposal is still marked "voting" but its voting period is over: the
 * chain has tallied it (at the first block past `votingEndTime`) and our
 * cached list has not caught up yet. `graceMs` covers that first block.
 */
export function votingOverdue(status: ProposalStatus, votingEndTime: string | null, now: number, graceMs = 30_000): boolean {
  if (status !== "voting" || !votingEndTime) return false;
  const end = Date.parse(votingEndTime);
  return Number.isFinite(end) && now > end + graceMs;
}

/**
 * Gov voting power of a delegator: x/gov's tally counts only delegations to
 * validators in the bonded set, so stake on a jailed or inactive validator
 * carries no vote. Null when the bonded set is unknown (unless there is no
 * stake at all, which is "0" whatever the set).
 */
export function govVotingPower(
  delegations: ReadonlyArray<{ validator: string; amount: string }>,
  bondedOperators: ReadonlySet<string> | null,
): string | null {
  if (delegations.length === 0) return "0";
  if (!bondedOperators) return null;
  let total = BigInt(0);
  for (const delegation of delegations) {
    if (bondedOperators.has(delegation.validator)) total += toBigInt(delegation.amount) ?? BigInt(0);
  }
  return total.toString();
}

/** Share of bonded voting power that has voted (abstain included). */
export function turnout(tally: Tally | null, bonded: string | null): number | null {
  if (!tally || bonded === null) return null;
  const total = Number(bonded);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Number(tallyTotal(tally)) / total;
}

export interface TallyRules {
  quorum: number | null;
  threshold: number | null;
  vetoThreshold: number | null;
}

/** Whether the proposal would pass if voting closed with this tally (SDK rules). */
export function passingIfEndedNow(
  tally: Tally | null,
  bonded: string | null,
  rules: TallyRules,
): boolean | null {
  if (!tally || rules.quorum === null || rules.threshold === null || rules.vetoThreshold === null) {
    return null;
  }
  const participation = turnout(tally, bonded);
  if (participation === null) return null;
  if (participation < rules.quorum) return false;
  const total = Number(tallyTotal(tally));
  const abstain = Number(tally.abstain);
  const nonAbstain = total - abstain;
  if (!(nonAbstain > 0)) return false;
  if (Number(tally.veto) / total > rules.vetoThreshold) return false;
  return Number(tally.yes) / nonAbstain > rules.threshold;
}

/**
 * Plain-text excerpt of a markdown body for list cards: headings, emphasis,
 * images, link syntax and HTML stripped, whitespace collapsed, cut at a word.
 * The full markdown is served raw on the detail endpoint for the UI to render
 * through its sanitiser.
 */
export function plainExcerpt(markdown: string, max = 400): string {
  const text = markdown
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/`{1,3}/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+>]\s+/gm, "")
    // Emphasis markers only when they wrap text: parameter names such as
    // `min_deposit` must keep their underscores.
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/\*(\S(?:.*?\S)?)\*/g, "$1")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** A proposal in one shape, whichever gov API it came from. */
export interface ParsedProposal {
  id: string;
  title: string;
  /** Full description (markdown). */
  description: string;
  metadata: string | null;
  proposer: string | null;
  status: ProposalStatus;
  messageTypes: string[];
  type: string;
  submitTime: string | null;
  depositEndTime: string | null;
  votingStartTime: string | null;
  votingEndTime: string | null;
  totalDeposit: Coin[];
  finalTally: Tally | null;
  expedited: boolean;
  failedReason: string | null;
  /** Raw messages (gov v1) or the legacy content (v1beta1), untrimmed. */
  messages: unknown[];
}

const LEGACY_CONTENT = "MsgExecLegacyContent";

function typeOfMessages(messageTypes: string[], legacyContentType: string | null): string {
  const first = messageTypes[0];
  if (!first) return legacyContentType ?? "Text";
  if (first === LEGACY_CONTENT && legacyContentType) return legacyContentType;
  return first;
}

/** One proposal from `cosmos/gov/v1/proposals` (list item or `{ proposal }`). */
export function parseProposalV1(raw: unknown): ParsedProposal | null {
  const p = rec(pick(raw, ["proposal"])) ?? rec(raw);
  const id = str(p?.id);
  if (!p || !id || !/^\d+$/.test(id)) return null;
  const messages = arr(p.messages);
  const messageTypes: string[] = [];
  let legacyTitle: string | null = null;
  let legacyDescription: string | null = null;
  let legacyType: string | null = null;
  for (const message of messages) {
    const record = rec(message);
    const typeUrl = str(record?.["@type"]);
    if (typeUrl) messageTypes.push(shortTypeName(typeUrl));
    const content = rec(record?.content);
    if (content && legacyType === null) {
      const contentType = str(content["@type"]);
      legacyType = contentType ? shortTypeName(contentType) : null;
      legacyTitle = str(content.title);
      legacyDescription = str(content.description);
    }
  }
  const metadata = str(p.metadata);
  return {
    id,
    title: clip(str(p.title) ?? legacyTitle ?? `Proposal ${id}`, 300) ?? `Proposal ${id}`,
    description: str(p.summary) ?? legacyDescription ?? "",
    metadata,
    proposer: str(p.proposer),
    status: proposalStatus(p.status),
    messageTypes,
    type: typeOfMessages(messageTypes, legacyType),
    submitTime: parseTime(p.submit_time),
    depositEndTime: parseTime(p.deposit_end_time),
    votingStartTime: parseTime(p.voting_start_time),
    votingEndTime: parseTime(p.voting_end_time),
    totalDeposit: coins(p.total_deposit),
    finalTally: parseTally(p.final_tally_result),
    expedited: p.expedited === true,
    failedReason: str(p.failed_reason),
    messages,
  };
}

/** One proposal from `cosmos/gov/v1beta1/proposals`. */
export function parseProposalV1beta1(raw: unknown): ParsedProposal | null {
  const p = rec(pick(raw, ["proposal"])) ?? rec(raw);
  const id = str(p?.proposal_id) ?? str(p?.id);
  if (!p || !id || !/^\d+$/.test(id)) return null;
  const content = rec(p.content);
  const contentType = str(content?.["@type"]);
  const type = contentType ? shortTypeName(contentType) : "Text";
  return {
    id,
    title: clip(str(content?.title) ?? `Proposal ${id}`, 300) ?? `Proposal ${id}`,
    description: str(content?.description) ?? "",
    metadata: null,
    proposer: null,
    status: proposalStatus(p.status),
    messageTypes: [type],
    type,
    submitTime: parseTime(p.submit_time),
    depositEndTime: parseTime(p.deposit_end_time),
    votingStartTime: parseTime(p.voting_start_time),
    votingEndTime: parseTime(p.voting_end_time),
    totalDeposit: coins(p.total_deposit),
    finalTally: parseTally(p.final_tally_result),
    expedited: false,
    failedReason: null,
    messages: content ? [content] : [],
  };
}

/**
 * A JSON value with oversized parts elided, for showing proposal messages.
 *
 * `MsgStoreCode` carries the whole wasm binary as base64 (hundreds of KB) and
 * parameter-change proposals can carry long lists; the detail page needs the
 * structure, not the blob.
 */
export function elideJson(
  value: unknown,
  limits: { maxString?: number; maxArray?: number; maxDepth?: number } = {},
): { value: unknown; truncated: boolean } {
  const maxString = limits.maxString ?? 2_000;
  const maxArray = limits.maxArray ?? 100;
  const maxDepth = limits.maxDepth ?? 12;
  let truncated = false;
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === "string") {
      if (node.length <= maxString) return node;
      truncated = true;
      return `${node.slice(0, 64)}… [${node.length.toLocaleString("en-US")} characters omitted]`;
    }
    if (node === null || typeof node !== "object") return node;
    if (depth >= maxDepth) {
      truncated = true;
      return "[nested too deep]";
    }
    if (Array.isArray(node)) {
      const items = node.slice(0, maxArray).map((item) => walk(item, depth + 1));
      if (node.length > maxArray) {
        truncated = true;
        items.push(`[${node.length - maxArray} more items omitted]`);
      }
      return items;
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      out[key] = walk(child, depth + 1);
    }
    return out;
  };
  return { value: walk(value, 0), truncated };
}

/**
 * How a non-voting delegator's stake is cast: each validator's vote, weighted
 * by the share of the delegator's voting power it holds. Largest first.
 *
 * `totalPower` is the delegator's whole voting power; pass it when only the
 * largest delegations are listed, so the weights stay shares of everything
 * (a list of the top 10 of 15 must not sum to 100 %). Defaults to the sum of
 * the listed delegations.
 */
export function inheritedVotes(
  delegations: ReadonlyArray<{ validator: string; moniker: string | null; amount: string }>,
  votes: ReadonlyMap<string, VoteChoice | null>,
  totalPower?: string | null,
): InheritedVote[] {
  let total = toBigInt(totalPower) ?? BigInt(0);
  if (total <= BigInt(0)) {
    total = BigInt(0);
    for (const delegation of delegations) total += toBigInt(delegation.amount) ?? BigInt(0);
  }
  if (total <= BigInt(0)) return [];
  return delegations
    .map((delegation) => {
      const vote = votes.get(delegation.validator) ?? null;
      return {
        validator: delegation.validator,
        moniker: delegation.moniker,
        option: vote ? vote.option : null,
        weight: Number(toBigInt(delegation.amount) ?? BigInt(0)) / Number(total),
      };
    })
    .sort((a, b) => b.weight - a.weight);
}
