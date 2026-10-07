/**
 * The notification feed, derived.
 *
 * Ported from zunia-extension `lib/notices.ts` (deriveNotices,
 * pendingAnnouncements) @ 1453e7a and widened to the dashboard's inputs.
 *
 * `deriveNotices` is pure and takes its clock as an argument. That is not
 * ceremony: the row ids are what "already read" and "already announced" key
 * on, so a derivation that is not reproducible for the same inputs silently
 * re-alerts the user for things they dismissed. Same inputs + same `now` →
 * same rows, same order, same ids, same state.
 *
 * What it produces, per account:
 * - rewards ready (a cycle, see `rewards.ts`), only while the cycle is raised;
 * - unbonding complete, remembered from earlier reads because a completed
 *   unbonding disappears from the chain's list a block after it matures;
 * - incoming transfers, IBC arrivals and swap outcomes from the activity read,
 *   but only those newer than the first time the feed saw this account —
 *   history is not news;
 * - open votes where the account stakes and has not voted, plus a separate
 *   "ends within 24 h" notice;
 * - validator alerts: jailed, out of the active set, commission raised.
 * Plus pass-through `system` notices. Kinds the prefs turn off are dropped
 * from the feed but their state is still tracked, so turning a kind back on
 * shows the truth, not a gap.
 */

import { noticeHref, noticeId, parseChainTime } from "@/lib/notifications/ids";
import { reminderInterval, wantsKind } from "@/lib/notifications/prefs";
import { nextRewardsCycle, type RewardsCycle } from "@/lib/notifications/rewards";
import {
  freshAccountState,
  NOTICE_SOURCES,
  NOTICE_STATE_LIMITS,
  type AccountNoticeState,
  type NoticeSource,
  type NoticeState,
  type TrackedUnbonding,
  type ValidatorMemo,
} from "@/lib/notifications/state";
import { clip, durationText, joinNames, percentText } from "@/lib/notifications/text";
import type {
  ActivityInput,
  Notice,
  NoticeData,
  NotifyPrefs,
  ProposalInput,
  RewardsChainInput,
  SystemNoticeInput,
  UnbondingInput,
  ValidatorInput,
} from "@/lib/notifications/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const FEED_LIMITS = {
  /** Rows in the feed, newest first. */
  notices: 60,
  /** How long an event (a transfer, a completed unbonding, a raise) stays in the feed. */
  eventRetentionMs: 14 * DAY,
  /** A vote inside this window gets its own "ends soon" notice. */
  governanceEndingMs: DAY,
  /** OS notifications per derivation; a backlog must not fire a volley. */
  announce: 3,
  /**
   * Older events go to the feed without an alert — the same ages the push
   * server uses. A transfer three hours old that only now reaches the feed (a
   * history read that answered late, a wider scope) is history to the user.
   */
  announceTransferMaxAgeMs: 6 * HOUR,
  /** An unbonding may wait out quiet hours or a closed browser: a day. */
  announceUnbondingMaxAgeMs: DAY,
  body: 240,
} as const;

export interface DeriveInput {
  readonly now: number;
  /**
   * The account the data belongs to (its address, or any stable key): every
   * read passed with it must be that account's. Null: no account is
   * connected, so only `system` notices are produced and no account state is
   * touched. Required, so a caller cannot forget it and get an empty feed.
   */
  readonly account: string | null;
  readonly portfolio?: { readonly chains: readonly RewardsChainInput[] };
  readonly staking?: {
    readonly unbonding: readonly UnbondingInput[];
    readonly validators: readonly ValidatorInput[];
    /**
     * Chains whose staking read failed this time. Their rows are absent from
     * the lists above because they are unknown, not because they went away:
     * what the feed remembers for them (a pending unbonding, a validator you
     * delegate to) is kept as it was, instead of reading as "unbonding
     * cancelled" or "no longer delegated".
     */
    readonly failedChains?: readonly string[];
  };
  readonly proposals?: readonly ProposalInput[];
  readonly activity?: readonly ActivityInput[];
  readonly system?: readonly SystemNoticeInput[];
  readonly prefs: NotifyPrefs;
  readonly state: NoticeState;
  /** Display name of a chain id; defaults to the id itself. */
  readonly chainName?: (chainId: string) => string;
}

export interface DeriveResult {
  readonly notices: Notice[];
  readonly state: NoticeState;
  /**
   * This was the account's first derivation with data. Kept for callers that
   * seed everything at once; `silent` is the finer rule and covers it.
   */
  readonly seeding: boolean;
  /**
   * Ids in `notices` to record without announcing: rows from a read reaching
   * this account's feed for the first time (rewards, staking, votes or
   * activity, each on its own — they describe how things already were), the
   * user's own swaps, and events older than the announce ages in
   * `FEED_LIMITS`. Pass them as `pendingAnnouncements(…, { silent })`.
   */
  readonly silent: string[];
}

type Name = (chainId: string) => string;

const NO_CHAINS: ReadonlySet<string> = new Set();

function systemNotice(row: SystemNoticeInput): Notice {
  return {
    id: row.id,
    kind: "system",
    title: clip(row.title, 120),
    body: clip(row.body, FEED_LIMITS.body),
    ...(row.chainId ? { chainId: row.chainId } : {}),
    ...(row.url ? { url: row.url } : {}),
    at: row.at,
    severity: row.severity,
  };
}

function rewardsNotice(cycle: RewardsCycle, chains: readonly RewardsChainInput[] | undefined, name: Name): Notice {
  // No amount in the words: it grows every block, and the OS notification
  // would freeze a number that is wrong a minute later. Where is enough.
  const waiting = (chains ?? [])
    .filter((row) => !row.failed && Number.isFinite(row.rewardsWhole) && row.rewardsWhole > 0)
    .sort((a, b) => b.rewardsWhole - a.rewardsWhole)
    .map((row) => name(row.chainId));
  const where = joinNames(waiting, 2, waiting.length - 2 === 1 ? "more network" : "more networks");
  return {
    id: noticeId.rewards(cycle.cycle),
    kind: "rewards",
    title: "Staking rewards ready to claim",
    body: where ? `Waiting on ${where}. Claim them from Staking.` : "Claim them from Staking.",
    url: noticeHref.staking(),
    at: cycle.raisedAt,
    severity: "info",
  };
}

/**
 * Unbondings seen now, merged with the ones remembered.
 *
 * A remembered entry missing from a fresh read either completed (its time has
 * passed: keep it, it is the notice) or was cancelled (still in the future:
 * drop it). With no fresh read (`inputs` undefined), or for a chain whose read
 * failed (`failed`), nothing is decided.
 */
function trackUnbonding(
  prev: readonly TrackedUnbonding[],
  inputs: readonly UnbondingInput[] | undefined,
  now: number,
  failed: ReadonlySet<string> = NO_CHAINS,
): TrackedUnbonding[] {
  const fresh = (entry: TrackedUnbonding) => now - entry.completesAt < FEED_LIMITS.eventRetentionMs;
  if (!inputs) return prev.filter(fresh);
  const merged = new Map<string, TrackedUnbonding>();
  for (const row of inputs) {
    const completesAt = parseChainTime(row.completionTime);
    if (completesAt === null || !row.chainId || !row.validator || failed.has(row.chainId)) continue;
    const id = noticeId.unbonding(row.chainId, row.validator, completesAt);
    if (merged.has(id)) continue;
    merged.set(id, {
      id,
      chainId: row.chainId,
      validator: row.validator,
      completesAt,
      amountText: clip(row.amountText, 80),
      ...(row.validatorName ? { validatorName: clip(row.validatorName, 80) } : {}),
    });
  }
  for (const entry of prev) {
    if (!merged.has(entry.id) && (entry.completesAt <= now || failed.has(entry.chainId))) merged.set(entry.id, entry);
  }
  return [...merged.values()]
    .filter(fresh)
    .sort((a, b) => b.completesAt - a.completesAt)
    .slice(0, NOTICE_STATE_LIMITS.unbonding);
}

function unbondingNotice(entry: TrackedUnbonding, name: Name): Notice {
  const from = entry.validatorName ? ` from ${entry.validatorName}` : "";
  return {
    id: entry.id,
    kind: "unbonding",
    title: "Unbonding complete",
    body: `${entry.amountText}${from} is liquid again on ${name(entry.chainId)}.`,
    chainId: entry.chainId,
    url: noticeHref.staking(),
    at: entry.completesAt,
    severity: "success",
    data: { amount: entry.amountText },
  };
}

/**
 * Activity kinds that can be an incoming transfer: `receive` and `ibc-in`
 * (and the v1 names `received` / `ibc`). Anything else that brought coins in —
 * a reward claim, an undelegation, a contract call — was the user's own doing,
 * not something sent to them, and must never read "Received …".
 */
const INCOMING_KIND = /receiv|ibc|transfer/;

function activityNotice(row: ActivityInput, since: number, now: number, name: Name): Notice | null {
  const at = parseChainTime(row.time);
  if (at === null || at <= since || now - at > FEED_LIMITS.eventRetentionMs) return null;
  if (!row.hash || !row.chainId) return null;
  const chain = name(row.chainId);
  const kind = row.kind.toLowerCase();
  const failed = row.success === false;
  const amount = row.amountText?.trim() || null;
  const data: NoticeData = amount ? { hash: row.hash, amount } : { hash: row.hash };
  const base = { chainId: row.chainId, url: noticeHref.tx(row.chainId, row.hash), at, data };
  const summary = clip(row.summary, FEED_LIMITS.body);

  if (kind.includes("swap")) {
    return {
      id: noticeId.swap(row.hash),
      kind: "swap",
      title: failed ? `Swap failed on ${chain}` : `Swap complete on ${chain}`,
      body: summary,
      severity: failed ? "danger" : "success",
      ...base,
    };
  }
  if (failed || row.direction !== "in" || !INCOMING_KIND.test(kind)) return null;
  if (kind.includes("ibc")) {
    const from = row.counterpartyChainId ? name(row.counterpartyChainId) : null;
    return {
      id: noticeId.transfer(row.hash),
      kind: "ibc",
      title: from ? `Arrived from ${from}` : `IBC transfer arrived on ${chain}`,
      body: amount ? `${amount} landed on ${chain}.` : summary,
      severity: "success",
      ...base,
    };
  }
  return {
    id: noticeId.transfer(row.hash),
    kind: "transfer",
    title: amount ? `Received ${amount} on ${chain}` : `Received on ${chain}`,
    body: summary,
    severity: "success",
    ...base,
  };
}

function proposalNotice(row: ProposalInput, now: number, name: Name): Notice | null {
  if (!row.eligible || row.myVote === true || !row.id || !row.chainId) return null;
  const endsAt = parseChainTime(row.votingEndTime);
  if (endsAt === null || endsAt <= now) return null;
  const left = endsAt - now;
  const chain = name(row.chainId);
  // Only say "you haven't voted" when the read said so; null is "unknown".
  const tail = row.myVote === false ? " You haven't voted yet." : "";
  const what = clip(`#${row.id} ${row.title}`, 160);
  const base = {
    kind: "governance" as const,
    chainId: row.chainId,
    url: noticeHref.proposal(row.chainId, row.id),
    data: { proposalId: row.id },
  };
  if (left <= FEED_LIMITS.governanceEndingMs) {
    return {
      ...base,
      id: noticeId.governanceEnding(row.chainId, row.id),
      title: `Vote ends in ${durationText(left)}`,
      body: `${what} · ${chain}.${tail}`,
      at: endsAt - FEED_LIMITS.governanceEndingMs,
      severity: "warning",
    };
  }
  const opened = row.votingStartTime !== undefined ? parseChainTime(row.votingStartTime) : null;
  return {
    ...base,
    id: noticeId.governance(row.chainId, row.id),
    title: `Vote open on ${chain}`,
    body: `${what} · ends in ${durationText(left)}.${tail}`,
    at: opened !== null && opened <= now ? opened : now,
    severity: "info",
  };
}

function rateOf(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/**
 * Validator memory, updated from a fresh staking read (when there is one).
 *
 * The jailed/inactive "since" is the first time it was seen that way, so one
 * jailing is one notice; an unjail and a later jailing is a new one. A chain
 * whose read failed (`failed`) keeps what was remembered for it.
 */
function trackValidators(
  prev: Readonly<Record<string, ValidatorMemo>>,
  inputs: readonly ValidatorInput[] | undefined,
  now: number,
  failed: ReadonlySet<string> = NO_CHAINS,
): Record<string, ValidatorMemo> {
  if (!inputs) return { ...prev };
  const next: Record<string, ValidatorMemo> = {};
  for (const [key, memo] of Object.entries(prev)) {
    next[key] = failed.has(key.slice(0, key.indexOf("|"))) ? { ...memo } : { ...memo, delegated: false };
  }
  for (const row of inputs) {
    const rate = rateOf(row.commissionRate);
    if (rate === null || !row.chainId || !row.operatorAddress || failed.has(row.chainId)) continue;
    const key = `${row.chainId}|${row.operatorAddress}`;
    const old = prev[key];
    const before = rateOf(row.previousCommissionRate) ?? old?.commission ?? null;
    let raise = old?.raise;
    if (before !== null && rate > before + 1e-9 && (!raise || Math.abs(raise.to - rate) > 1e-9)) {
      raise = { from: before, to: rate, at: now };
    }
    const jailedSince = row.jailed ? (old?.jailedSince ?? now) : undefined;
    const inactiveSince = !row.jailed && row.active === false ? (old?.inactiveSince ?? now) : undefined;
    next[key] = {
      moniker: clip(row.moniker || row.operatorAddress, 80),
      delegated: true,
      commission: rate,
      seenAt: now,
      ...(jailedSince !== undefined ? { jailedSince } : {}),
      ...(inactiveSince !== undefined ? { inactiveSince } : {}),
      ...(raise ? { raise } : {}),
    };
  }
  const keep = Object.entries(next)
    .sort((a, b) => b[1].seenAt - a[1].seenAt)
    .slice(0, NOTICE_STATE_LIMITS.validators);
  return Object.fromEntries(keep);
}

function validatorNotices(memos: Readonly<Record<string, ValidatorMemo>>, now: number, name: Name): Notice[] {
  const rows: Notice[] = [];
  for (const [key, memo] of Object.entries(memos)) {
    if (!memo.delegated) continue;
    const split = key.indexOf("|");
    const chainId = key.slice(0, split);
    const validator = key.slice(split + 1);
    const base = { kind: "validator" as const, chainId, url: noticeHref.validator(chainId, validator) };
    const chain = name(chainId);
    if (memo.jailedSince !== undefined) {
      rows.push({
        ...base,
        id: noticeId.validatorJailed(chainId, validator, memo.jailedSince),
        title: `${memo.moniker} is jailed`,
        body: `Your stake with it on ${chain} earns nothing while it is jailed. Consider redelegating.`,
        at: memo.jailedSince,
        severity: "danger",
      });
    } else if (memo.inactiveSince !== undefined) {
      rows.push({
        ...base,
        id: noticeId.validatorInactive(chainId, validator, memo.inactiveSince),
        title: `${memo.moniker} left the active set`,
        body: `Your stake with it on ${chain} earns nothing until it is back in the active set.`,
        at: memo.inactiveSince,
        severity: "warning",
      });
    }
    if (memo.raise && now - memo.raise.at < FEED_LIMITS.eventRetentionMs) {
      rows.push({
        ...base,
        id: noticeId.validatorCommission(chainId, validator, memo.raise.to),
        title: `${memo.moniker} raised its commission`,
        body: `From ${percentText(memo.raise.from)} to ${percentText(memo.raise.to)} on ${chain}. Your rewards there shrink accordingly.`,
        at: memo.raise.at,
        severity: "warning",
      });
    }
  }
  return rows;
}

function deriveAccount(
  prev: AccountNoticeState,
  input: DeriveInput,
  name: Name,
  nextCycle: number,
  out: Notice[],
  silent: Set<string>,
): AccountNoticeState {
  const { now, prefs } = input;
  const present = NOTICE_SOURCES.filter((source) => input[source] !== undefined);
  const firstLook = new Set(present.filter((source) => !prev.sources.includes(source)));
  const emit = (notice: Notice, source: NoticeSource) => {
    out.push(notice);
    if (firstLook.has(source)) silent.add(notice.id);
  };

  const rewards = input.portfolio
    ? nextRewardsCycle(prev.rewards, input.portfolio.chains, now, reminderInterval(prefs.rewards), nextCycle)
    : prev.rewards;
  if (rewards.phase === "raised") emit(rewardsNotice(rewards, input.portfolio?.chains, name), "portfolio");

  const failedChains = input.staking?.failedChains?.length ? new Set(input.staking.failedChains) : NO_CHAINS;
  const unbonding = trackUnbonding(prev.unbonding, input.staking?.unbonding, now, failedChains);
  for (const entry of unbonding) {
    // Completed, and after the feed started looking (an unbonding that matured
    // before the first look is history, like an old transfer).
    if (entry.completesAt <= now && entry.completesAt > prev.since) {
      emit(unbondingNotice(entry, name), "staking");
      if (now - entry.completesAt > FEED_LIMITS.announceUnbondingMaxAgeMs) silent.add(entry.id);
    }
  }

  for (const row of input.activity ?? []) {
    const notice = activityNotice(row, prev.since, now, name);
    if (!notice) continue;
    emit(notice, "activity");
    // A swap is the user's own action (the swap screen already said how it
    // went): a row in the feed, never an alert or a toast.
    if (notice.kind === "swap" || now - notice.at > FEED_LIMITS.announceTransferMaxAgeMs) silent.add(notice.id);
  }

  for (const row of input.proposals ?? []) {
    const notice = proposalNotice(row, now, name);
    if (notice) emit(notice, "proposals");
  }

  const validators = trackValidators(prev.validators, input.staking?.validators, now, failedChains);
  for (const notice of validatorNotices(validators, now, name)) emit(notice, "staking");

  return {
    since: prev.since,
    seenAt: now,
    seeded: prev.seeded || present.length > 0,
    sources: NOTICE_SOURCES.filter((source) => prev.sources.includes(source) || firstLook.has(source)),
    rewards,
    unbonding,
    validators,
  };
}

function byTimeThenId(a: Notice, b: Notice): number {
  if (a.at !== b.at) return b.at - a.at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The feed, newest first, and the state to persist for the next call. */
export function deriveNotices(input: DeriveInput): DeriveResult {
  const name: Name = input.chainName ?? ((chainId) => chainId);
  const rows: Notice[] = (input.system ?? []).map(systemNotice);

  let accounts: Record<string, AccountNoticeState> = { ...input.state.accounts };
  let cycles = Math.max(0, input.state.cycles ?? 0);
  let seeding = false;
  const silentIds = new Set<string>();
  const key = typeof input.account === "string" && input.account ? input.account.slice(0, 200) : null;
  if (key) {
    const prev = accounts[key] ?? freshAccountState(input.now);
    // Cycle numbers stay unique across accounts and across evictions, so
    // `rewards:<cycle>` read on one wallet never marks another wallet's notice
    // (or a later one of the same wallet) as read.
    const nextCycle = 1 + Math.max(cycles, ...Object.values(accounts).map((account) => account.rewards.cycle));
    accounts[key] = deriveAccount(prev, input, name, nextCycle, rows, silentIds);
    cycles = Math.max(cycles, accounts[key].rewards.cycle);
    seeding = !prev.seeded && accounts[key].seeded;
    accounts = Object.fromEntries(
      Object.entries(accounts)
        .sort((a, b) => b[1].seenAt - a[1].seenAt)
        .slice(0, NOTICE_STATE_LIMITS.accounts),
    );
  }

  const seen = new Set<string>();
  const notices: Notice[] = [];
  for (const notice of rows.filter((row) => wantsKind(input.prefs, row.kind)).sort(byTimeThenId)) {
    if (seen.has(notice.id)) continue;
    seen.add(notice.id);
    notices.push(notice);
    if (notices.length >= FEED_LIMITS.notices) break;
  }
  const silent = notices.filter((notice) => silentIds.has(notice.id)).map((notice) => notice.id);
  return { notices, state: { v: 1, announced: input.state.announced, accounts, cycles }, seeding, silent };
}

export interface AnnounceOptions {
  /** Record the feed, announce nothing (an account's first derivation with data). */
  readonly seed?: boolean;
  /** Record these ids without announcing them (`DeriveResult.silent`). */
  readonly silent?: Iterable<string>;
  /** Ids the user already read: never announced. */
  readonly read?: Iterable<string>;
  /** Inside quiet hours: record, announce nothing. */
  readonly quiet?: boolean;
  /** Most notices to announce in one go (default `FEED_LIMITS.announce`). */
  readonly max?: number;
}

/**
 * Which notices to turn into OS notifications now, and the announced-id list
 * to store.
 *
 * The first run (`previousIds === null`), and an account's first derivation
 * with data (`seed`), record the feed and announce nothing; so do the `silent`
 * ids (rows from a read's first appearance). Afterwards, anything unread and
 * not announced before is announced — unless it is quiet time, in which case
 * it is recorded as announced all the same (quiet hours mean "not now", not
 * "later": the bell still shows it).
 * Ids still in the feed are always kept, so a long-lived notice cannot fall
 * off the bounded list and fire again.
 */
export function pendingAnnouncements(
  previousIds: readonly string[] | null,
  notices: readonly Notice[],
  options: AnnounceOptions = {},
): { announce: Notice[]; ids: string[] } {
  const current = notices.map((notice) => notice.id);
  if (previousIds === null || options.seed) {
    return {
      announce: [],
      ids: [...new Set([...current, ...(previousIds ?? [])])].slice(0, NOTICE_STATE_LIMITS.announced),
    };
  }
  const seen = new Set(previousIds);
  const read = new Set(options.read ?? []);
  const silent = new Set(options.silent ?? []);
  const fresh = notices.filter((notice) => !seen.has(notice.id) && !read.has(notice.id) && !silent.has(notice.id));
  const ids = [...new Set([...fresh.map((notice) => notice.id), ...current, ...previousIds])].slice(
    0,
    NOTICE_STATE_LIMITS.announced,
  );
  return {
    announce: options.quiet ? [] : fresh.slice(0, Math.max(0, options.max ?? FEED_LIMITS.announce)),
    ids,
  };
}
