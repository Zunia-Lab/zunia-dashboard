/**
 * Notification preferences: defaults, validation, and the two questions every
 * channel asks of them — "does the user want this kind?" and "is it quiet
 * time?".
 *
 * Ported from zunia-extension `lib/settings.ts` (DEFAULT_NOTIFY_PREFS,
 * parseNotifyPrefs) and `lib/notices.ts` (reminderInterval) @ 1453e7a.
 *
 * The same parser guards three doors: localStorage (anything can be in there
 * after a downgrade or a hand edit), the push subscribe route (a request body
 * is untrusted input), and the push store file on disk. Unreadable fields fall
 * back to their default one by one, so one bad field never resets the rest.
 */

import {
  REWARD_REMINDERS,
  type NoticeKind,
  type NotifyPrefs,
  type QuietHours,
  type RewardReminder,
} from "@/lib/notifications/types";

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  transfers: true,
  rewards: "once",
  governance: false,
  unbonding: false,
  validator: true,
  browserAlerts: false,
};

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

/** A stored or posted quiet-hours window; `undefined` when absent or unusable. */
export function parseQuietHours(value: unknown): QuietHours | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  // start === end would be either "always quiet" or "never quiet" depending on
  // how one reads it; refusing it is clearer than picking one.
  if (!isHour(row.start) || !isHour(row.end) || row.start === row.end) return undefined;
  return { start: row.start, end: row.end };
}

/** A stored `NotifyPrefs`, field by field; anything unreadable keeps its default. */
export function parseNotifyPrefs(value: unknown): NotifyPrefs {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const flag = (key: "transfers" | "governance" | "unbonding" | "validator" | "browserAlerts"): boolean =>
    typeof row[key] === "boolean" ? (row[key] as boolean) : DEFAULT_NOTIFY_PREFS[key];
  const rewards = REWARD_REMINDERS.includes(row.rewards as RewardReminder)
    ? (row.rewards as RewardReminder)
    : DEFAULT_NOTIFY_PREFS.rewards;
  const quietHours = parseQuietHours(row.quietHours);
  return {
    transfers: flag("transfers"),
    rewards,
    governance: flag("governance"),
    unbonding: flag("unbonding"),
    validator: flag("validator"),
    browserAlerts: flag("browserAlerts"),
    ...(quietHours ? { quietHours } : {}),
  };
}

/** Whether notices of this kind reach the feed, the badge and the alerts at all. */
export function wantsKind(prefs: NotifyPrefs, kind: NoticeKind): boolean {
  switch (kind) {
    case "transfer":
    case "ibc":
    case "swap":
      return prefs.transfers;
    case "rewards":
      return prefs.rewards !== "off";
    case "governance":
      return prefs.governance;
    case "unbonding":
      return prefs.unbonding;
    case "validator":
      return prefs.validator;
    case "system":
      return true;
  }
}

/** How long a waiting rewards notice stays quiet before it is raised again. */
export function reminderInterval(reminder: RewardReminder): number | null {
  if (reminder === "daily") return 86_400_000;
  if (reminder === "weekly") return 7 * 86_400_000;
  return null;
}

/** True when `timeZone` is an IANA zone this runtime knows. */
export function isTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The hour (0–23) at `at` in `timeZone`, or in this runtime's local zone when
 * none is given (the browser). Null when the zone is unknown, so a server
 * never evaluates quiet hours on a guessed clock.
 */
export function localHour(at: number, timeZone?: string | null): number | null {
  if (!Number.isFinite(at)) return null;
  if (!timeZone) return new Date(at).getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
  } catch {
    return null;
  }
}

/**
 * Whether `at` falls inside the quiet window.
 *
 * A zone that cannot be read means "not quiet": delivering at an odd hour is a
 * smaller failure than silently dropping something the user asked for.
 */
export function inQuietHours(
  quiet: QuietHours | undefined,
  at: number,
  timeZone?: string | null,
): boolean {
  if (!quiet) return false;
  const hour = localHour(at, timeZone);
  if (hour === null) return false;
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}
