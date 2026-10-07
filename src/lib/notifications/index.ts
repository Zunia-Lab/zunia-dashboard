/**
 * Notifications core: pure, shared by the browser feed, the push server and
 * the tests. Nothing in this folder touches the network, the DOM or Node APIs.
 */

export type {
  ActivityDirection,
  ActivityInput,
  Notice,
  NoticeData,
  NoticeKind,
  NoticeSeverity,
  NotifyPrefs,
  ProposalInput,
  QuietHours,
  RewardReminder,
  RewardsChainInput,
  SystemNoticeInput,
  UnbondingInput,
  ValidatorInput,
} from "@/lib/notifications/types";
export { NOTICE_KINDS, REWARD_REMINDERS } from "@/lib/notifications/types";
export {
  DEFAULT_NOTIFY_PREFS,
  inQuietHours,
  isTimeZone,
  localHour,
  parseNotifyPrefs,
  parseQuietHours,
  reminderInterval,
  wantsKind,
} from "@/lib/notifications/prefs";
export { noticeHref, noticeId, parseChainTime } from "@/lib/notifications/ids";
export { NOTICE_FALLBACK_URL, safeNoticeUrl } from "@/lib/notifications/url";
export {
  INITIAL_REWARDS_CYCLE,
  nextRewardsCycle,
  parseRewardsCycle,
  type RewardsCycle,
  type RewardsPhase,
} from "@/lib/notifications/rewards";
export {
  INITIAL_NOTICE_STATE,
  NOTICE_SOURCES,
  NOTICE_STATE_LIMITS,
  parseNoticeState,
  type AccountNoticeState,
  type NoticeSource,
  type NoticeState,
  type TrackedUnbonding,
  type ValidatorMemo,
} from "@/lib/notifications/state";
export {
  filterNotices,
  groupNotices,
  NOTICE_FILTERS,
  noticeGroupOf,
  type NoticeFilter,
  type NoticeGroup,
  type NoticeGroupKey,
  type NoticeQuery,
} from "@/lib/notifications/group";
export {
  deriveNotices,
  FEED_LIMITS,
  pendingAnnouncements,
  type AnnounceOptions,
  type DeriveInput,
  type DeriveResult,
} from "@/lib/notifications/derive";
export {
  buildPushPayload,
  encodePushPayload,
  parsePushPayload,
  PUSH_LIMITS,
  testNotice,
  type PushPayload,
} from "@/lib/notifications/payload";
export {
  dropLegacyKeys,
  loadDismissedIds,
  loadNoticeState,
  loadNotifyPrefs,
  loadReadIds,
  MAX_READ_IDS,
  NOTICE_STORAGE_KEYS,
  saveDismissedIds,
  saveNoticeState,
  saveNotifyPrefs,
  saveReadIds,
  withRead,
  type KeyValueStorage,
} from "@/lib/notifications/store";
export {
  AMOUNT_MASK,
  clip,
  durationText,
  joinNames,
  maskAmounts,
  percentText,
  shortAddress,
} from "@/lib/notifications/text";
