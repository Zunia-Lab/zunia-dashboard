/**
 * How the notification centre slices the feed: by calendar day ("Today",
 * "Yesterday", "Monday, Oct 5", "Sep 28, 2025"), with counts per type filter
 * and the networks present. The bell's popover groups more coarsely (Today /
 * This week / Earlier, `@/lib/notifications/group`); the centre is the
 * history, so it keeps each day.
 *
 * Pure, so `node --test` covers it.
 */

import { NOTICE_FILTERS, filterNotices, type NoticeFilter } from "@/lib/notifications/group";
import type { Notice } from "@/lib/notifications/types";

const DAY = 86_400_000;

/** Days since the epoch of the calendar date `at` falls on in `timeZone` (default: the runtime's). */
function calendarDay(at: number, timeZone?: string): number | null {
  if (!Number.isFinite(at)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(at));
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
    const day = Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
    return Number.isFinite(day) ? day : null;
  } catch {
    return null;
  }
}

function dayLabel(day: number, today: number): string {
  const age = today - day;
  if (age === 0) return "Today";
  if (age === 1) return "Yesterday";
  const date = new Date(day * DAY);
  // The day number is a UTC midnight: format it in UTC so it stays that date.
  if (age > 1 && age < 7) {
    return date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" });
  }
  const sameYear = new Date(today * DAY).getUTCFullYear() === date.getUTCFullYear();
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export interface DayGroup {
  /** "2026-10-07", or "unknown" for notices without a usable time. */
  key: string;
  label: string;
  notices: Notice[];
}

/** `notices` (newest first) cut into calendar days, keeping their order. */
export function groupByDay(notices: readonly Notice[], now: number, timeZone?: string): DayGroup[] {
  const today = calendarDay(now, timeZone);
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const notice of notices) {
    const day = calendarDay(notice.at, timeZone);
    const key = day === null || today === null ? "unknown" : new Date(day * DAY).toISOString().slice(0, 10);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: day === null || today === null ? "Earlier" : dayLabel(day, today), notices: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.notices.push(notice);
  }
  return groups;
}

/** Count per type filter ("All" included) over `notices`. */
export function filterCounts(notices: readonly Notice[]): Record<NoticeFilter, number> {
  const counts = {} as Record<NoticeFilter, number>;
  for (const entry of NOTICE_FILTERS) counts[entry.value] = filterNotices(notices, { filter: entry.value }).length;
  return counts;
}

/** The networks notices mention, busiest first (ties keep first-seen order). */
export function noticeChains(notices: readonly Notice[]): { chainId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const notice of notices) {
    if (notice.chainId) counts.set(notice.chainId, (counts.get(notice.chainId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([chainId, count]) => ({ chainId, count })).sort((a, b) => b.count - a.count);
}
