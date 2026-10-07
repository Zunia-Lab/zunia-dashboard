/**
 * The notification model shared by the in-app feed, browser alerts and Web
 * Push.
 *
 * One shape for all three on purpose. A transfer the server pushes while the
 * tab is closed and the same transfer the feed derives when the tab opens must
 * be the *same notice* — same id — or the user reads it twice. The id is also
 * the OS notification `tag`, so a second display of a notice (the in-page alert
 * after the push, or a second open tab) replaces the first instead of stacking.
 *
 * Shapes ported from zunia-extension `lib/notices.ts` and `lib/settings.ts`
 * (NotifyPrefs) @ 1453e7a, widened for what the dashboard can see that the
 * extension popup cannot: IBC arrivals with their source chain, swaps,
 * validator alerts, and quiet hours that the push server honours too.
 *
 * Pure types: safe to import from client, server and tests.
 */

export type NoticeKind =
  | "transfer"
  | "ibc"
  | "swap"
  | "rewards"
  | "unbonding"
  | "governance"
  | "validator"
  | "system";

export const NOTICE_KINDS: readonly NoticeKind[] = [
  "transfer",
  "ibc",
  "swap",
  "rewards",
  "unbonding",
  "governance",
  "validator",
  "system",
];

/** Status tone. Drives the row icon and colour; never the only carrier of meaning. */
export type NoticeSeverity = "info" | "success" | "warning" | "danger";

/**
 * Facts a surface may need beyond the sentence.
 *
 * `amount` is the formatted amount the title/body contain ("12.5 OSMO"), so
 * privacy mode can mask exactly that substring instead of guessing at digits.
 */
export type NoticeData = Readonly<Record<string, string | number | boolean | null>>;

export interface Notice {
  /** Stable id (see `ids.ts`): what "read", "announced" and the OS tag key on. */
  readonly id: string;
  readonly kind: NoticeKind;
  readonly title: string;
  readonly body: string;
  readonly chainId?: string;
  /** Same-origin path the row opens ("/activity/ABC…?chain=osmosis-1"). */
  readonly url?: string;
  /** Epoch ms: when it happened (a transfer's block time) or was raised. */
  readonly at: number;
  readonly severity: NoticeSeverity;
  readonly data?: NoticeData;
}

/**
 * How often the "staking rewards ready" reminder comes back while rewards
 * wait: once until claimed, every day, every week, or never.
 */
export type RewardReminder = "once" | "daily" | "weekly" | "off";

export const REWARD_REMINDERS: readonly RewardReminder[] = ["once", "daily", "weekly", "off"];

/**
 * Hours (0–23, local to the user) during which nothing is *announced*: no
 * browser alert, no push. The in-app list still updates. `start` is inclusive,
 * `end` exclusive, and the window wraps midnight when `start > end`
 * ({start: 22, end: 7} is 22:00–06:59).
 */
export interface QuietHours {
  readonly start: number;
  readonly end: number;
}

/**
 * Which notifications appear, and where.
 *
 * Defaults (see `DEFAULT_NOTIFY_PREFS`) favour quiet, as in the extension:
 * incoming tokens and one rewards notice per cycle are on, governance and
 * unbonding are off until asked for. Validator alerts are on because a jailed
 * validator silently stops paying the user — the one case where staying quiet
 * costs money.
 */
export interface NotifyPrefs {
  /** Incoming transfers, IBC arrivals and swap outcomes. */
  readonly transfers: boolean;
  readonly rewards: RewardReminder;
  /** Open votes on chains where the account stakes and has not voted. */
  readonly governance: boolean;
  /** Unbonded stake that became liquid again. */
  readonly unbonding: boolean;
  /** A validator you delegate to was jailed, left the active set or raised its commission. */
  readonly validator: boolean;
  /** OS notifications from an open (possibly hidden) dashboard tab. */
  readonly browserAlerts: boolean;
  readonly quietHours?: QuietHours;
}

/* -------------------------------------------------------------------------- *
 * Inputs to `deriveNotices`. The shell maps its data hooks onto these; nothing
 * here depends on another module's response types.
 * -------------------------------------------------------------------------- */

export interface RewardsChainInput {
  readonly chainId: string;
  /** Claimable rewards in whole tokens of the chain's native asset (0.42 = 0.42 ATOM). */
  readonly rewardsWhole: number;
  readonly nativeSymbol: string;
  /**
   * The read for this chain failed. A failed read reports zero, which must not
   * pass for a claim, so such rows teach the rewards cycle nothing. (Omitting
   * the row has the same effect.)
   */
  readonly failed?: boolean;
}

export interface UnbondingInput {
  readonly chainId: string;
  /** Validator operator address. */
  readonly validator: string;
  /** ISO time (nanosecond precision accepted) or epoch ms. */
  readonly completionTime: string | number;
  /** Already formatted by the caller: "12.5 ATOM". */
  readonly amountText: string;
  readonly validatorName?: string;
}

export interface ValidatorInput {
  readonly chainId: string;
  readonly operatorAddress: string;
  readonly moniker: string;
  readonly jailed: boolean;
  /** Fraction, as the LCD reports it: 0.05 is 5 %. */
  readonly commissionRate: number;
  /** When the caller knows the previous rate; otherwise the last one seen is remembered. */
  readonly previousCommissionRate?: number;
  /** False when the validator is out of the active set (bonded = false). Absent = unknown. */
  readonly active?: boolean;
}

export interface ProposalInput {
  readonly chainId: string;
  readonly id: string;
  readonly title: string;
  readonly votingEndTime: string | number;
  /**
   * When voting opened: the "vote open" row's place in the feed. Without it the
   * row is dated at the derivation, which is honest but keeps it near the top.
   */
  readonly votingStartTime?: string | number;
  /** true voted, false not voted, null unknown (never claimed either way). */
  readonly myVote: boolean | null;
  /** The account has stake on this chain, so its vote counts. */
  readonly eligible: boolean;
}

export type ActivityDirection = "in" | "out" | "self";

export interface ActivityInput {
  readonly chainId: string;
  readonly hash: string;
  /**
   * The activity API's kind, as is (`ActivityItem.kind`: "receive", "ibc-in",
   * "swap", "claim", …). Only `receive` / `ibc-in` (v1: `received` / `ibc`)
   * can become a transfer notice, and `swap` a swap notice; other kinds are
   * the user's own actions and produce nothing.
   */
  readonly kind: string;
  /** ISO time or epoch ms (block time). */
  readonly time: string | number;
  /** One identity-named sentence ("Received 12.5 OSMO from osmo1…"). */
  readonly summary: string;
  /**
   * Net flow for the account: "in" when coins only came in
   * (`ActivityItem.amounts` all `in`), "out" when they only left, "self"
   * otherwise (a swap, a send to oneself).
   */
  readonly direction: ActivityDirection;
  /** False for a failed transaction. Absent = succeeded. */
  readonly success?: boolean;
  /** For IBC arrivals: the chain the tokens came from, when known. */
  readonly counterpartyChainId?: string;
  /** Formatted amount ("12.5 OSMO") for titles and privacy masking. */
  readonly amountText?: string;
}

/** Notices a caller raises itself (app update, phone session ended, …). */
export interface SystemNoticeInput {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly url?: string;
  readonly at: number;
  readonly severity: NoticeSeverity;
  readonly chainId?: string;
}
