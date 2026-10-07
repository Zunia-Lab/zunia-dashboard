/**
 * Governance across chains (G1/G2 in the research report): proposals with
 * live tallies, turnout against quorum, "would pass if it ended now", and —
 * for a connected voter — their own vote, their voting power, and the vote
 * their stake inherits from their validators when they have not voted.
 *
 * gov v1 first, v1beta1 when a chain never migrated. Votes are only
 * readable while voting is open (x/gov prunes them after the tally), which is
 * why `myVoteStatus` is "unknown" on ended proposals rather than a guess.
 *
 * Bounded work per request: lists are capped per chain (20 recent / all in
 * voting, ≤ 50), inherited-vote lookups are capped per request, and
 * validator votes on the detail page cover the 30 largest validators only.
 *
 * Cache: voting lists and tallies 2 min, other lists 5 min, votes 60 s. A
 * proposal whose voting period has ended while a cached list still says
 * "voting" triggers one fresh read of the chain's lists (at most once a
 * minute per chain), so the result shows up within a request or two instead
 * of after the list's whole cache lifetime.
 */

import "server-only";
import type { ServerChainEntry } from "@/lib/server/chains";
import { mapLimit, UpstreamError } from "@/lib/server/http";
import { attachValidatorLogos } from "@/lib/server/validator-logos";
import {
  displayTally,
  elideJson,
  govVotingPower,
  inheritedVotes,
  parseProposalV1,
  parseProposalV1beta1,
  parseTally,
  parseVote,
  passingIfEndedNow,
  plainExcerpt,
  turnout,
  votingOverdue,
  type ParsedProposal,
} from "@/lib/chain/governance";
import { arr, clip, pick } from "@/lib/chain/parse";
import { depositProgress, parsePool, parseStakingParams } from "@/lib/chain/params";
import type {
  GovParams,
  PartError,
  ProposalDetail,
  ProposalRow,
  ProposalStatusFilter,
  Tally,
  ValidatorVote,
  VoteChoice,
} from "@/lib/chain/types";
import { operatorAccount } from "@/lib/chain/valcons";
import { readGovParams } from "./economics";
import {
  describeLcdError,
  describeMiss,
  forgetLcd,
  forgetLcdNamed,
  lcd,
  LcdMissError,
  type LcdResult,
} from "./lcd";
import { readDelegations } from "./staking";
import { readValidatorSet } from "./validator-set";

const MIN = 60_000;
const VOTING_TTL = 2 * MIN;
const LIST_TTL = 5 * MIN;
const TALLY_TTL = 2 * MIN;
const VOTE_TTL = 60_000;
const VOTE_STALE = 30_000;
const DETAIL_TTL = 2 * MIN;
/** Validators whose votes are looked up for one voter's inherited vote. */
const MAX_INHERITED_VALIDATORS = 10;
/** Validator-vote lookups one list request may spend on inherited votes. */
export const INHERITED_BUDGET = 60;
/** Validators listed with their vote on the detail page. */
const VALIDATOR_VOTES = 30;
/** Minimum time between two forced re-reads of one chain's (or proposal's) cache. */
const REFRESH_COOLDOWN_MS = MIN;

export type GovApi = "v1" | "v1beta1";
type ListKind = "voting" | "deposit" | "passed" | "rejected" | "failed" | "recent";

const STATUS_PARAM: Record<Exclude<ListKind, "recent">, string> = {
  voting: "PROPOSAL_STATUS_VOTING_PERIOD",
  deposit: "PROPOSAL_STATUS_DEPOSIT_PERIOD",
  passed: "PROPOSAL_STATUS_PASSED",
  rejected: "PROPOSAL_STATUS_REJECTED",
  failed: "PROPOSAL_STATUS_FAILED",
};

const LIMIT: Record<ListKind, number> = {
  voting: 50,
  deposit: 20,
  passed: 20,
  rejected: 20,
  failed: 10,
  recent: 20,
};

const KINDS: Record<ProposalStatusFilter, ListKind[]> = {
  voting: ["voting"],
  deposit: ["deposit"],
  passed: ["passed"],
  rejected: ["rejected", "failed"],
  all: ["recent", "voting"],
};

function listPath(api: GovApi, kind: ListKind): string {
  const status = kind === "recent" ? "" : `proposal_status=${STATUS_PARAM[kind]}&`;
  return `cosmos/gov/${api}/proposals?${status}pagination.limit=${LIMIT[kind]}&pagination.reverse=true`;
}

function detailPath(api: GovApi, id: string): string {
  return `cosmos/gov/${api}/proposals/${id}`;
}

/**
 * Last forced refresh per key (chain id, or chain id + proposal). On
 * `globalThis` like the caches it bypasses; bounded by the catalog size
 * (lists) and by MAX_REFRESH_KEYS (proposals).
 */
const REFRESH_KEY = "__zuniaGovRefreshes";
const MAX_REFRESH_KEYS = 2_000;

function mayRefresh(key: string, now: number): boolean {
  const g = globalThis as unknown as Record<string, Map<string, number> | undefined>;
  let map = g[REFRESH_KEY];
  if (!map) {
    map = new Map();
    g[REFRESH_KEY] = map;
  }
  const last = map.get(key) ?? 0;
  if (now - last < REFRESH_COOLDOWN_MS) return false;
  if (map.size >= MAX_REFRESH_KEYS) map.clear();
  map.set(key, now);
  return true;
}

/**
 * What a list keeps of a proposal: the description is cut (the excerpt needs
 * the start only) and messages dropped — a `MsgStoreCode` list on Osmosis is a
 * megabyte of wasm the list never shows.
 */
function slim(proposal: ParsedProposal): ParsedProposal {
  return {
    ...proposal,
    description: proposal.description.slice(0, 3_000),
    metadata: clip(proposal.metadata, 500),
    messages: [],
  };
}

function parseList(parse: (raw: unknown) => ParsedProposal | null) {
  return (body: unknown): ParsedProposal[] =>
    arr(pick(body, ["proposals"]))
      .map(parse)
      .filter((p): p is ParsedProposal => p !== null)
      .map(slim);
}

interface ProposalList {
  api: GovApi;
  proposals: ParsedProposal[];
  at: number;
  /** Set when only the newest proposals could be read (see `readNewestOnly`). */
  partial?: string;
}

async function readList(chain: ServerChainEntry, kind: ListKind): Promise<ProposalList> {
  const ttlMs = kind === "voting" ? VOTING_TTL : LIST_TTL;
  let v1: LcdResult<ParsedProposal[]>;
  try {
    v1 = await lcd(chain, listPath("v1", kind), {
      ttlMs,
      timeoutMs: 10_000,
      name: "proposals",
      map: parseList(parseProposalV1),
    });
  } catch (error) {
    if (!(error instanceof UpstreamError && error.kind === "http" && error.status === 500)) throw error;
    return readNewestOnly(chain, kind, ttlMs, error);
  }
  if (v1.ok) return { api: "v1", proposals: v1.data, at: v1.at };
  // gov v1 not served (SDK < 0.46): the legacy API.
  const legacy = await lcd(chain, listPath("v1beta1", kind), {
    ttlMs,
    timeoutMs: 10_000,
    name: "proposals",
    map: parseList(parseProposalV1beta1),
  });
  if (legacy.ok) return { api: "v1beta1", proposals: legacy.data, at: legacy.at };
  throw new LcdMissError(legacy.miss);
}

const KIND_STATUS: Record<Exclude<ListKind, "recent">, ProposalRow["status"]> = {
  voting: "voting",
  deposit: "deposit",
  passed: "passed",
  rejected: "rejected",
  failed: "failed",
};

/**
 * Degraded read for chains whose node fails a whole list when one old
 * proposal no longer decodes: Crypto.org (SDK 0.53) answers HTTP 500 to any
 * query whose scan reaches a legacy `ParameterChangeProposal` — every status
 * filter, and the plain list past its 15 newest — on both gov APIs. The
 * newest proposals still decode, so read those unfiltered (10, then 5) and
 * filter here. Voting and deposit proposals are the newest ones, so those
 * views stay complete in practice; the list says it is partial either way.
 */
async function readNewestOnly(
  chain: ServerChainEntry,
  kind: ListKind,
  ttlMs: number,
  original: unknown,
): Promise<ProposalList> {
  for (const limit of [10, 5]) {
    try {
      const newest = await lcd(chain, `cosmos/gov/v1/proposals?pagination.limit=${limit}&pagination.reverse=true`, {
        ttlMs,
        timeoutMs: 10_000,
        name: "proposals",
        map: parseList(parseProposalV1),
      });
      if (!newest.ok) break;
      return {
        api: "v1",
        proposals: kind === "recent" ? newest.data : newest.data.filter((p) => p.status === KIND_STATUS[kind]),
        at: newest.at,
        partial: `Older proposals on this chain cannot be decoded by its public endpoint; showing what the ${limit} newest include`,
      };
    } catch {
      // Still failing: try fewer.
    }
  }
  throw original;
}

function readTally(chain: ServerChainEntry, api: GovApi, id: string): Promise<LcdResult<Tally | null>> {
  return lcd(chain, `cosmos/gov/${api}/proposals/${id}/tally`, {
    ttlMs: TALLY_TTL,
    name: "tally",
    map: parseTally,
  });
}

/**
 * A vote: the choice, `null` for "has not voted", or throws when unreadable.
 *
 * x/gov answers an absent vote with InvalidArgument / NotFound (HTTP 400 /
 * 404): that is "not voted". A 501 means the endpoint does not serve votes at
 * all, which says nothing about the voter, so it throws like a failed read.
 */
async function readVote(
  chain: ServerChainEntry,
  api: GovApi,
  id: string,
  voter: string,
): Promise<VoteChoice | null> {
  const result = await lcd(chain, `cosmos/gov/${api}/proposals/${id}/votes/${encodeURIComponent(voter)}`, {
    ttlMs: VOTE_TTL,
    staleMs: VOTE_STALE,
    name: "vote",
    map: parseVote,
  });
  if (!result.ok) {
    if (result.miss === "not-implemented") throw new LcdMissError(result.miss);
    return null;
  }
  return result.data;
}

/** Chain-level context every row needs: gov params, bonded tokens, bond denom. */
interface ChainGovContext {
  gov: GovParams | null;
  bonded: string | null;
  bondDenom: string;
}

async function chainContext(chain: ServerChainEntry, errors: PartError[]): Promise<ChainGovContext> {
  const id = chain.chainId;
  const [gov, pool, staking] = await Promise.all([
    readGovParams(chain).catch((error: unknown) => {
      errors.push({ chainId: id, scope: "gov-params", message: describeLcdError(error) });
      return null;
    }),
    lcd(chain, "cosmos/staking/v1beta1/pool", { ttlMs: 15 * MIN }).catch((error: unknown) => {
      errors.push({ chainId: id, scope: "pool", message: describeLcdError(error) });
      return null;
    }),
    lcd(chain, "cosmos/staking/v1beta1/params", { ttlMs: 60 * MIN }).catch(() => null),
  ]);
  if (pool && !pool.ok) errors.push({ chainId: id, scope: "pool", message: describeMiss(pool.miss) });
  const bonded = pool?.ok ? (parsePool(pool.data)?.bonded ?? null) : null;
  const bondDenom = (staking?.ok ? parseStakingParams(staking.data)?.bondDenom : null) ?? chain.coinMinimalDenom;
  return { gov, bonded, bondDenom };
}

/** The voter's stake on the chain as x/gov counts it. */
interface VoterContext {
  address: string;
  /**
   * Delegations to validators in the bonded set (the only ones x/gov
   * counts), largest first; null when the delegations or the set are
   * unreadable.
   */
  bondedDelegations: Array<{ validator: string; amount: string }> | null;
  /** Gov voting power, base units; null when unknown. */
  power: string | null;
  monikers: Map<string, string>;
}

async function voterContext(
  chain: ServerChainEntry,
  address: string,
  bondDenom: string,
  errors: PartError[],
): Promise<VoterContext> {
  let delegations: Array<{ validator: string; amount: string }> | null = null;
  try {
    const result = await readDelegations(chain, address);
    if (result.ok) {
      delegations = result.data
        .filter((d) => d.denom === bondDenom)
        .map((d) => ({ validator: d.validator, amount: d.amount }))
        .sort((a, b) => Number(b.amount) - Number(a.amount));
    } else {
      errors.push({ chainId: chain.chainId, scope: "voter-delegations", message: describeMiss(result.miss) });
    }
  } catch (error) {
    errors.push({ chainId: chain.chainId, scope: "voter-delegations", message: describeLcdError(error) });
  }

  const monikers = new Map<string, string>();
  const bondedSet = delegations?.length ? await bondedOperators(chain, monikers, errors) : null;
  let bondedDelegations: VoterContext["bondedDelegations"] = null;
  if (delegations && delegations.length === 0) bondedDelegations = [];
  else if (delegations && bondedSet) bondedDelegations = delegations.filter((d) => bondedSet.has(d.validator));
  return {
    address,
    bondedDelegations,
    power: delegations === null ? null : govVotingPower(delegations, bondedSet),
    monikers,
  };
}

/** Operators of the bonded set (monikers filled in on the way); null when unreadable. */
async function bondedOperators(
  chain: ServerChainEntry,
  monikers: Map<string, string>,
  errors: PartError[],
): Promise<Set<string> | null> {
  try {
    const set = await readValidatorSet(chain, { status: "bonded", chainApr: null, withSigning: false });
    const operators = new Set<string>();
    for (const row of set.rows) {
      monikers.set(row.operatorAddress, row.moniker);
      if (row.status === "bonded") operators.add(row.operatorAddress);
    }
    return operators;
  } catch (error) {
    errors.push({ chainId: chain.chainId, scope: "voter-power", message: describeLcdError(error) });
    return null;
  }
}

/** Mutable budget shared by all chains of one request. */
export interface LookupBudget {
  remaining: number;
}

async function rowFor(
  chain: ServerChainEntry,
  api: GovApi,
  proposal: ParsedProposal,
  context: ChainGovContext,
  voter: VoterContext | null,
  budget: LookupBudget,
  errors: PartError[],
): Promise<ProposalRow> {
  const id = chain.chainId;
  const voting = proposal.status === "voting";
  let live: Tally | null = null;
  if (voting) {
    // During voting `final_tally_result` is all zeros; the live tally is a
    // separate query that counts validators' votes for silent delegators.
    try {
      const result = await readTally(chain, api, proposal.id);
      if (result.ok) live = result.data;
      const why = !result.ok ? describeMiss(result.miss) : result.data ? null : "Tally unreadable";
      if (why) errors.push({ chainId: id, scope: `tally:${proposal.id}`, message: why });
    } catch (error) {
      errors.push({ chainId: id, scope: `tally:${proposal.id}`, message: describeLcdError(error) });
    }
  }
  const { tally, kind: tallyKind } = displayTally(proposal.status, proposal.finalTally, live);

  const gov = context.gov;
  const threshold = proposal.expedited ? (gov?.expeditedThreshold ?? gov?.threshold ?? null) : (gov?.threshold ?? null);
  const rules = { quorum: gov?.quorum ?? null, threshold, vetoThreshold: gov?.vetoThreshold ?? null };
  const share = turnout(tally, context.bonded);

  const row: ProposalRow = {
    chainId: id,
    id: proposal.id,
    api,
    title: proposal.title,
    summary: plainExcerpt(proposal.description),
    type: proposal.type,
    messageTypes: proposal.messageTypes,
    status: proposal.status,
    submitTime: proposal.submitTime,
    depositEndTime: proposal.depositEndTime,
    votingStartTime: proposal.votingStartTime,
    votingEndTime: proposal.votingEndTime,
    totalDeposit: proposal.totalDeposit,
    minDeposit: gov?.minDeposit ?? null,
    expedited: proposal.expedited,
    tally,
    tallyKind,
    turnout: share,
    ...(share !== null && !voting ? { turnoutEstimate: true as const } : {}),
    quorum: rules.quorum,
    threshold: rules.threshold,
    vetoThreshold: rules.vetoThreshold,
    passingIfEndedNow: voting ? passingIfEndedNow(tally, context.bonded, rules) : null,
    ...(proposal.failedReason ? { failedReason: clip(proposal.failedReason, 300) ?? undefined } : {}),
    myVote: null,
    myVoteStatus: null,
    myVotingPower: null,
  };

  if (!voter) return row;
  row.myVotingPower = voter.power;
  if (!voting) {
    row.myVoteStatus = "unknown";
    return row;
  }
  try {
    const mine = await readVote(chain, api, proposal.id, voter.address);
    row.myVote = mine;
    row.myVoteStatus = mine ? "voted" : "not-voted";
  } catch (error) {
    row.myVoteStatus = "unknown";
    errors.push({ chainId: id, scope: `vote:${proposal.id}`, message: describeLcdError(error) });
    return row;
  }
  if (row.myVoteStatus === "not-voted" && voter.bondedDelegations?.length) {
    const validators = voter.bondedDelegations.slice(0, MAX_INHERITED_VALIDATORS);
    if (budget.remaining < validators.length) {
      errors.push({ chainId: id, scope: `inherited:${proposal.id}`, message: "Skipped: too many lookups in one request" });
      return row;
    }
    budget.remaining -= validators.length;
    const votes = new Map<string, VoteChoice | null>();
    let unreadable = 0;
    await mapLimit(validators, 4, async ({ validator }) => {
      const account = operatorAccount(validator, chain.bech32Prefix);
      if (!account) return;
      try {
        votes.set(validator, await readVote(chain, api, proposal.id, account));
      } catch {
        unreadable += 1;
      }
    });
    if (unreadable) {
      // Their rows read "not voted (yet)"; say that some of that is "unknown".
      errors.push({
        chainId: id,
        scope: `inherited:${proposal.id}`,
        message: `${unreadable} validator vote(s) unreadable`,
      });
    }
    row.inheritedVote = inheritedVotes(
      validators.map((d) => ({ validator: d.validator, moniker: voter.monikers.get(d.validator) ?? null, amount: d.amount })),
      votes,
      voter.power,
    );
  }
  return row;
}

const STATUS_ORDER: Record<ProposalRow["status"], number> = {
  voting: 0,
  deposit: 1,
  passed: 2,
  rejected: 2,
  failed: 2,
  unknown: 3,
};

/** Voting first (ending soonest), then deposit, then the rest newest first. */
export function sortProposals(rows: ProposalRow[]): ProposalRow[] {
  const time = (value: string | null) => (value ? Date.parse(value) : 0);
  return rows.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.status === "voting") return time(a.votingEndTime) - time(b.votingEndTime);
    if (a.status === "deposit") return time(a.depositEndTime) - time(b.depositEndTime);
    return time(b.votingEndTime ?? b.submitTime) - time(a.votingEndTime ?? a.submitTime);
  });
}

export interface ChainProposals {
  chainId: string;
  api: GovApi | null;
  rows: ProposalRow[];
  errors: PartError[];
  /** False when no list could be read at all. */
  ok: boolean;
  at: number | null;
}

/** Reads the lists of `kinds` and merges them by id. */
async function readMerged(
  chain: ServerChainEntry,
  kinds: readonly ListKind[],
  errors: PartError[],
): Promise<{ lists: ProposalList[]; merged: Map<string, ParsedProposal> }> {
  const settled = await Promise.all(
    kinds.map((kind) =>
      readList(chain, kind).catch((error: unknown) => {
        errors.push({ chainId: chain.chainId, scope: `proposals:${kind}`, message: describeLcdError(error) });
        return null;
      }),
    ),
  );
  const lists = settled.filter((list): list is ProposalList => list !== null);
  const partial = lists.find((list) => list.partial)?.partial;
  if (partial) errors.push({ chainId: chain.chainId, scope: "proposals", message: partial });
  // Lists are listed most-cached first in KINDS, so walking them backwards
  // lets the fresher voting list win for a proposal in both.
  const merged = new Map<string, ParsedProposal>();
  for (const list of [...lists].reverse()) {
    for (const proposal of list.proposals) {
      if (!merged.has(proposal.id)) merged.set(proposal.id, proposal);
    }
  }
  return { lists, merged };
}

/** One chain's proposals for a status filter, with the voter's view when given. */
export async function readChainProposals(
  chain: ServerChainEntry,
  filter: ProposalStatusFilter,
  voterAddress: string | null,
  budget: LookupBudget,
): Promise<ChainProposals> {
  const id = chain.chainId;
  let listErrors: PartError[] = [];
  let { lists, merged } = await readMerged(chain, KINDS[filter], listErrors);

  // A cached list still says "voting" for a proposal whose voting period is
  // over: the chain has its result. Re-read the lists once (rate-limited per
  // chain) instead of serving the stale status for the lists' whole lifetime.
  const now = Date.now();
  if ([...merged.values()].some((p) => votingOverdue(p.status, p.votingEndTime, now)) && mayRefresh(id, now)) {
    forgetLcdNamed(chain, "proposals");
    forgetLcdNamed(chain, "tally");
    const freshErrors: PartError[] = [];
    const fresh = await readMerged(chain, KINDS[filter], freshErrors);
    if (fresh.lists.length > 0) {
      ({ lists, merged } = fresh);
      listErrors = freshErrors;
    }
  }
  const errors: PartError[] = [...listErrors];
  if (lists.length === 0) return { chainId: id, api: null, rows: [], errors, ok: false, at: null };

  const api = lists[0]?.api ?? "v1";
  const context = await chainContext(chain, errors);
  const voter = voterAddress ? await voterContext(chain, voterAddress, context.bondDenom, errors) : null;
  const rows = await mapLimit([...merged.values()], 4, (proposal) =>
    rowFor(chain, api, proposal, context, voter, budget, errors),
  );
  return {
    chainId: id,
    api,
    rows: sortProposals(rows),
    errors,
    ok: true,
    at: Math.min(...lists.map((list) => list.at)),
  };
}

/**
 * Open proposal counts for a chain header; null when unreadable. Proposals
 * whose period has already ended (a list not refreshed yet) are not counted.
 */
export async function countOpenProposals(
  chain: ServerChainEntry,
): Promise<{ voting: number; deposit: number } | null> {
  try {
    const [voting, deposit] = await Promise.all([readList(chain, "voting"), readList(chain, "deposit")]);
    const now = Date.now();
    return {
      voting: voting.proposals.filter((p) => !votingOverdue(p.status, p.votingEndTime, now)).length,
      deposit: deposit.proposals.filter((p) => {
        const end = p.depositEndTime ? Date.parse(p.depositEndTime) : Number.NaN;
        return !(Number.isFinite(end) && end < now);
      }).length,
    };
  } catch {
    return null;
  }
}

const MAX_DESCRIPTION = 100_000;
const MAX_METADATA = 20_000;

interface DetailRead {
  api: GovApi;
  proposal: ParsedProposal;
  messagesTruncated: boolean;
  at: number;
}

function detailMap(parse: (raw: unknown) => ParsedProposal | null) {
  return (body: unknown): { proposal: ParsedProposal; messagesTruncated: boolean } | null => {
    const proposal = parse(body);
    if (!proposal) return null;
    const { value, truncated } = elideJson(proposal.messages);
    return {
      proposal: {
        ...proposal,
        description: proposal.description.slice(0, MAX_DESCRIPTION),
        metadata: clip(proposal.metadata, MAX_METADATA),
        messages: Array.isArray(value) ? value : [],
      },
      messagesTruncated: truncated,
    };
  };
}

async function readDetail(chain: ServerChainEntry, id: string): Promise<DetailRead | null> {
  const v1 = await lcd(chain, detailPath("v1", id), {
    ttlMs: DETAIL_TTL,
    timeoutMs: 10_000,
    name: "proposal",
    map: detailMap(parseProposalV1),
  });
  if (v1.ok && v1.data) return { api: "v1", ...v1.data, at: v1.at };
  const legacy = await lcd(chain, detailPath("v1beta1", id), {
    ttlMs: DETAIL_TTL,
    timeoutMs: 10_000,
    name: "proposal",
    map: detailMap(parseProposalV1beta1),
  });
  if (legacy.ok && legacy.data) return { api: "v1beta1", ...legacy.data, at: legacy.at };
  return null;
}

/** Votes of the largest validators while voting is open. */
async function validatorVotes(
  chain: ServerChainEntry,
  api: GovApi,
  id: string,
  errors: PartError[],
): Promise<ValidatorVote[] | null> {
  try {
    const set = await readValidatorSet(chain, { status: "bonded", chainApr: null, withSigning: false });
    const top = await attachValidatorLogos(chain, set.rows.slice(0, VALIDATOR_VOTES), { waitMs: 600 });
    let unreadable = 0;
    const votes = await mapLimit(top, 6, async (row): Promise<ValidatorVote> => {
      let option: ValidatorVote["option"] = null;
      if (row.accountAddress) {
        try {
          option = (await readVote(chain, api, id, row.accountAddress))?.option ?? null;
        } catch {
          unreadable += 1;
        }
      }
      return {
        operatorAddress: row.operatorAddress,
        moniker: row.moniker,
        ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
        rank: row.rank ?? 0,
        votingPower: row.votingPower,
        option,
      };
    });
    if (unreadable) {
      errors.push({ chainId: chain.chainId, scope: "validator-votes", message: `${unreadable} validator votes unreadable` });
    }
    return votes;
  } catch (error) {
    errors.push({ chainId: chain.chainId, scope: "validator-votes", message: describeLcdError(error) });
    return null;
  }
}

/**
 * Full proposal for the detail page; null when the chain does not have it.
 * Rejects only when the proposal itself cannot be read.
 */
export async function readProposalDetail(
  chain: ServerChainEntry,
  id: string,
  voterAddress: string | null,
): Promise<{ proposal: ProposalDetail; errors: PartError[]; at: number } | null> {
  let read = await readDetail(chain, id);
  if (!read) return null;
  const now = Date.now();
  if (votingOverdue(read.proposal.status, read.proposal.votingEndTime, now) && mayRefresh(`${chain.chainId}#${id}`, now)) {
    // Same staleness rule as the lists: the chain has tallied it already.
    forgetLcd(chain, detailPath(read.api, id), "proposal");
    forgetLcd(chain, `cosmos/gov/${read.api}/proposals/${id}/tally`, "tally");
    read = (await readDetail(chain, id)) ?? read;
  }
  const errors: PartError[] = [];
  const context = await chainContext(chain, errors);
  const voter = voterAddress ? await voterContext(chain, voterAddress, context.bondDenom, errors) : null;
  const budget: LookupBudget = { remaining: INHERITED_BUDGET };
  const detail = read;
  const [row, votes] = await Promise.all([
    rowFor(chain, detail.api, detail.proposal, context, voter, budget, errors),
    detail.proposal.status === "voting" ? validatorVotes(chain, detail.api, id, errors) : Promise.resolve(null),
  ]);
  const minDeposit = context.gov?.minDeposit ?? null;
  return {
    proposal: {
      ...row,
      description: detail.proposal.description,
      metadata: detail.proposal.metadata,
      proposer: detail.proposal.proposer,
      messages: detail.proposal.messages,
      messagesTruncated: detail.messagesTruncated,
      deposit: {
        total: detail.proposal.totalDeposit,
        min: minDeposit,
        progress: depositProgress(detail.proposal.totalDeposit, minDeposit),
      },
      validatorVotes: votes,
    },
    errors,
    at: detail.at,
  };
}
