/**
 * How the bell popover and the notification centre slice the feed: day groups
 * ("Today / This week / Earlier", spec §2 "Popovers") and the type filters the
 * centre offers (spec §6 "/notifications"). Pure and shared, so the two
 * surfaces never disagree about which group or filter a notice belongs to.
 */

import type { Notice, NoticeKind } from "@/lib/notifications/types";

export type NoticeGroupKey = "today" | "week" | "earlier";

export interface NoticeGroup {
  readonly key: NoticeGroupKey;
  readonly label: string;
  readonly notices: readonly Notice[];
}

const GROUP_LABELS: Record<NoticeGroupKey, string> = {
  today: "Today",
  week: "This week",
  earlier: "Earlier",
};

const DAY = 86_400_000;

/**
 * Days since the epoch of the calendar date `at` falls on, in `timeZone` (the
 * runtime's zone when absent: the browser's). Calendar days, not 24-hour
 * spans: a transfer at 23:50 yesterday is "This week", not "Today".
 */
function calendarDay(at: number, timeZone?: string): number | null {
  if (!Number.isFinite(at)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(new Date(at));
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
    const day = Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
    return Number.isFinite(day) ? day : null;
  } catch {
    return null;
  }
}

/** The group a notice dated `at` falls in, seen from `now`. */
export function noticeGroupOf(at: number, now: number, timeZone?: string): NoticeGroupKey {
  const today = calendarDay(now, timeZone);
  const day = calendarDay(at, timeZone);
  if (today === null || day === null) return "earlier";
  const age = today - day;
  if (age <= 0) return "today";
  return age < 7 ? "week" : "earlier";
}

/**
 * `notices` (already newest first) cut into Today / This week / Earlier,
 * keeping their order; empty groups are left out.
 */
export function groupNotices(notices: readonly Notice[], now: number, timeZone?: string): NoticeGroup[] {
  const buckets: Record<NoticeGroupKey, Notice[]> = { today: [], week: [], earlier: [] };
  for (const notice of notices) buckets[noticeGroupOf(notice.at, now, timeZone)].push(notice);
  return (Object.keys(buckets) as NoticeGroupKey[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: GROUP_LABELS[key], notices: buckets[key] }));
}

/** The centre's type filters, each covering the kinds a user thinks of as one. */
export type NoticeFilter = "all" | "transfers" | "staking" | "governance" | "system";

export const NOTICE_FILTERS: ReadonlyArray<{
  readonly value: NoticeFilter;
  readonly label: string;
  readonly kinds: readonly NoticeKind[] | null;
}> = [
  { value: "all", label: "All", kinds: null },
  { value: "transfers", label: "Transfers", kinds: ["transfer", "ibc", "swap"] },
  { value: "staking", label: "Staking", kinds: ["rewards", "unbonding", "validator"] },
  { value: "governance", label: "Governance", kinds: ["governance"] },
  { value: "system", label: "Zunia", kinds: ["system"] },
];

export interface NoticeQuery {
  readonly filter?: NoticeFilter;
  /** Only this chain's notices (a notice without a chain matches no chain). */
  readonly chainId?: string | null;
  /** Only unread ones, judged by `isRead`. */
  readonly unreadOnly?: boolean;
  readonly isRead?: (id: string) => boolean;
}

/** The notices a filter row shows, in feed order. */
export function filterNotices(notices: readonly Notice[], query: NoticeQuery = {}): Notice[] {
  const kinds = NOTICE_FILTERS.find((entry) => entry.value === (query.filter ?? "all"))?.kinds ?? null;
  return notices.filter(
    (notice) =>
      (kinds === null || kinds.includes(notice.kind)) &&
      (!query.chainId || notice.chainId === query.chainId) &&
      (!query.unreadOnly || !query.isRead?.(notice.id)),
  );
}
