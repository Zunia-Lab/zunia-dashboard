/**
 * What the feed remembers between derivations.
 *
 * `deriveNotices` is pure, but some notices are about change over time and
 * need memory: a rewards cycle, an unbonding that vanished from the chain's
 * list because it completed, a commission that went up, a validator that has
 * been jailed since a given moment. That memory lives here, per account, and
 * is persisted by the caller (localStorage in the browser).
 *
 * Everything is bounded, and `parseNoticeState` validates field by field: the
 * blob comes back from storage that anything can have written.
 */

import { INITIAL_REWARDS_CYCLE, parseRewardsCycle, type RewardsCycle } from "@/lib/notifications/rewards";

/**
 * The reads a derivation can carry. The shell's data hooks answer one by one
 * (rewards first, votes a few seconds later, …), so "seeded" is tracked per
 * source: what a read reports the first time it reaches the feed is the state
 * of the world, not news, whichever read it is.
 */
export type NoticeSource = "portfolio" | "staking" | "proposals" | "activity";

export const NOTICE_SOURCES: readonly NoticeSource[] = ["portfolio", "staking", "proposals", "activity"];

/** An unbonding seen on chain, kept until its completion has been notified and aged out. */
export interface TrackedUnbonding {
  readonly id: string;
  readonly chainId: string;
  readonly validator: string;
  readonly completesAt: number;
  readonly amountText: string;
  readonly validatorName?: string;
}

/** What was last seen of one validator the account delegates to. */
export interface ValidatorMemo {
  readonly moniker: string;
  /** In the last staking read the account still delegated here. */
  readonly delegated: boolean;
  readonly commission: number;
  readonly jailedSince?: number;
  readonly inactiveSince?: number;
  /** The last raise, kept so its notice stays in the feed after the new rate becomes "current". */
  readonly raise?: { readonly from: number; readonly to: number; readonly at: number };
  readonly seenAt: number;
}

export interface AccountNoticeState {
  /**
   * The first time the feed looked at this account. History older than this
   * is not news: connecting a wallet with a year of transfers must not open
   * on fifty unread "Received" rows.
   */
  readonly since: number;
  /** Last derivation for this account; the least recent account is dropped first. */
  readonly seenAt: number;
  /**
   * A derivation with data (rewards, staking, votes or activity) has run for
   * this account. The first one only records what is already true, silently:
   * the very first derivation usually runs before any read has answered, so
   * "first run" alone would let month-old rewards fire a notification a second
   * later, or the moment a second wallet is connected.
   */
  readonly seeded: boolean;
  /**
   * Sources that have reached a derivation for this account. Notices from a
   * source's first appearance are recorded without an announcement (see
   * `DeriveResult.silent`): votes that loaded after the rewards read are as
   * old as the rewards were.
   */
  readonly sources: readonly NoticeSource[];
  readonly rewards: RewardsCycle;
  readonly unbonding: readonly TrackedUnbonding[];
  readonly validators: Readonly<Record<string, ValidatorMemo>>;
}

export interface NoticeState {
  readonly v: 1;
  /**
   * Ids already turned into an OS notification, newest first. `null` until the
   * first run recorded the feed: that run announces nothing (opening a wallet
   * with month-old claimable rewards must not fire a notification), and it is
   * recorded explicitly because "the list is empty" is also what a trimmed or
   * cleared list looks like (the extension shipped that bug once).
   */
  readonly announced: readonly string[] | null;
  readonly accounts: Readonly<Record<string, AccountNoticeState>>;
  /**
   * The highest rewards cycle ever raised in this browser. Read ids are not
   * per account, so `rewards:<cycle>` must never be reused: deriving the next
   * number from the accounts still kept would reuse one as soon as the account
   * that raised it is evicted (past `NOTICE_STATE_LIMITS.accounts`), and the
   * new notice would arrive already "read".
   */
  readonly cycles: number;
}

export const NOTICE_STATE_LIMITS = {
  accounts: 8,
  announced: 200,
  unbonding: 50,
  validators: 100,
} as const;

export const INITIAL_NOTICE_STATE: NoticeState = { v: 1, announced: null, accounts: {}, cycles: 0 };

export function freshAccountState(now: number): AccountNoticeState {
  return {
    since: now,
    seenAt: now,
    seeded: false,
    sources: [],
    rewards: INITIAL_REWARDS_CYCLE,
    unbonding: [],
    validators: {},
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function shortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function parseUnbonding(value: unknown): TrackedUnbonding | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !shortString(row.id, 300) ||
    !shortString(row.chainId, 64) ||
    !shortString(row.validator, 128) ||
    !finite(row.completesAt) ||
    typeof row.amountText !== "string" ||
    row.amountText.length > 80
  ) {
    return null;
  }
  return {
    id: row.id,
    chainId: row.chainId,
    validator: row.validator,
    completesAt: row.completesAt,
    amountText: row.amountText,
    ...(shortString(row.validatorName, 80) ? { validatorName: row.validatorName } : {}),
  };
}

function parseValidatorMemo(value: unknown): ValidatorMemo | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!finite(row.commission) || row.commission < 0 || row.commission > 1 || !finite(row.seenAt)) return null;
  if (typeof row.moniker !== "string" || row.moniker.length > 80 || typeof row.delegated !== "boolean") {
    return null;
  }
  const raiseRow = row.raise && typeof row.raise === "object" ? (row.raise as Record<string, unknown>) : null;
  const raise =
    raiseRow && finite(raiseRow.from) && finite(raiseRow.to) && finite(raiseRow.at)
      ? { from: raiseRow.from, to: raiseRow.to, at: raiseRow.at }
      : undefined;
  return {
    moniker: row.moniker,
    delegated: row.delegated,
    commission: row.commission,
    seenAt: row.seenAt,
    ...(finite(row.jailedSince) ? { jailedSince: row.jailedSince } : {}),
    ...(finite(row.inactiveSince) ? { inactiveSince: row.inactiveSince } : {}),
    ...(raise ? { raise } : {}),
  };
}

function parseAccount(value: unknown): AccountNoticeState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!finite(row.since) || !finite(row.seenAt)) return null;
  const unbonding = Array.isArray(row.unbonding)
    ? row.unbonding
        .slice(0, NOTICE_STATE_LIMITS.unbonding)
        .map(parseUnbonding)
        .filter((entry): entry is TrackedUnbonding => entry !== null)
    : [];
  const validators: Record<string, ValidatorMemo> = {};
  if (row.validators && typeof row.validators === "object") {
    for (const [key, memo] of Object.entries(row.validators as Record<string, unknown>).slice(
      0,
      NOTICE_STATE_LIMITS.validators,
    )) {
      const parsed = key.length <= 200 ? parseValidatorMemo(memo) : null;
      if (parsed) validators[key] = parsed;
    }
  }
  const seeded = row.seeded === true;
  // A state written before sources were tracked: a seeded account had seen
  // what it was going to see, so nothing is treated as a first appearance.
  const sources = Array.isArray(row.sources)
    ? NOTICE_SOURCES.filter((source) => (row.sources as unknown[]).includes(source))
    : seeded
      ? [...NOTICE_SOURCES]
      : [];
  return {
    since: row.since,
    seenAt: row.seenAt,
    seeded,
    sources,
    rewards: parseRewardsCycle(row.rewards),
    unbonding,
    validators,
  };
}

/** A stored state, validated; anything unreadable starts fresh. */
export function parseNoticeState(value: unknown): NoticeState {
  if (!value || typeof value !== "object") return INITIAL_NOTICE_STATE;
  const row = value as Record<string, unknown>;
  if (row.v !== 1) return INITIAL_NOTICE_STATE;
  const announced = Array.isArray(row.announced)
    ? row.announced
        .filter((id): id is string => shortString(id, 300))
        .slice(0, NOTICE_STATE_LIMITS.announced)
    : null;
  const accounts: Record<string, AccountNoticeState> = {};
  if (row.accounts && typeof row.accounts === "object") {
    for (const [key, account] of Object.entries(row.accounts as Record<string, unknown>).slice(
      0,
      NOTICE_STATE_LIMITS.accounts,
    )) {
      const parsed = key.length <= 200 ? parseAccount(account) : null;
      if (parsed) accounts[key] = parsed;
    }
  }
  const stored = typeof row.cycles === "number" && Number.isSafeInteger(row.cycles) && row.cycles > 0 ? row.cycles : 0;
  const cycles = Math.max(stored, 0, ...Object.values(accounts).map((account) => account.rewards.cycle));
  return { v: 1, announced, accounts, cycles };
}
