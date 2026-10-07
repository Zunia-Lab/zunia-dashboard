/**
 * Read state, feed state and preferences in browser storage.
 *
 * One key per thing that changes at its own pace: read ids change on every
 * click, the derivation state on every derivation, prefs only in Settings,
 * cleared ids when the user clears the centre. Separate keys keep a click from
 * rewriting the whole blob and let other tabs react to exactly what changed
 * (the `storage` event names the key).
 *
 * The storage is passed in (anything with get/set/remove), so these helpers
 * stay pure and testable; every access is wrapped because Safari private mode,
 * a full quota or a blocked third-party context all throw.
 */

import { DEFAULT_NOTIFY_PREFS, parseNotifyPrefs } from "@/lib/notifications/prefs";
import { INITIAL_NOTICE_STATE, parseNoticeState, type NoticeState } from "@/lib/notifications/state";
import type { NotifyPrefs } from "@/lib/notifications/types";

export const NOTICE_STORAGE_KEYS = {
  read: "zunia.dashboard.notices.read",
  state: "zunia.dashboard.notices.state",
  prefs: "zunia.dashboard.notices.prefs",
  /** Ids the user cleared from the feed ("Clear" in the centre). */
  dismissed: "zunia.dashboard.notices.dismissed",
} as const;

/** The v1 dashboard's read list; its ids (`claimable:<amount>`) mean nothing now. */
export const LEGACY_READ_KEY = "zunia.dashboard.readNotifications";

/** Read ids kept. The feed holds at most 60 rows, so 500 spans months of churn. */
export const MAX_READ_IDS = 500;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function readJson(storage: KeyValueStorage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeJson(storage: KeyValueStorage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** `ids` plus `add`, de-duplicated, oldest dropped first past the cap. */
export function withRead(ids: readonly string[], add: readonly string[]): string[] {
  const next = ids.filter((id) => !add.includes(id));
  next.push(...new Set(add));
  return next.slice(-MAX_READ_IDS);
}

export function loadReadIds(storage: KeyValueStorage | null): string[] {
  const value = readJson(storage, NOTICE_STORAGE_KEYS.read);
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 300)
    .slice(-MAX_READ_IDS);
}

export function saveReadIds(storage: KeyValueStorage | null, ids: readonly string[]): boolean {
  return writeJson(storage, NOTICE_STORAGE_KEYS.read, ids.slice(-MAX_READ_IDS));
}

/**
 * Cleared ids, same rules as read ids. A cleared notice stays cleared while
 * its id stays in the feed (ids are stable), and a later event is a new id.
 */
export function loadDismissedIds(storage: KeyValueStorage | null): string[] {
  const value = readJson(storage, NOTICE_STORAGE_KEYS.dismissed);
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 300)
    .slice(-MAX_READ_IDS);
}

export function saveDismissedIds(storage: KeyValueStorage | null, ids: readonly string[]): boolean {
  return writeJson(storage, NOTICE_STORAGE_KEYS.dismissed, ids.slice(-MAX_READ_IDS));
}

export function loadNoticeState(storage: KeyValueStorage | null): NoticeState {
  const value = readJson(storage, NOTICE_STORAGE_KEYS.state);
  return value === null ? INITIAL_NOTICE_STATE : parseNoticeState(value);
}

export function saveNoticeState(storage: KeyValueStorage | null, state: NoticeState): boolean {
  return writeJson(storage, NOTICE_STORAGE_KEYS.state, state);
}

export function loadNotifyPrefs(storage: KeyValueStorage | null): NotifyPrefs {
  const value = readJson(storage, NOTICE_STORAGE_KEYS.prefs);
  return value === null ? DEFAULT_NOTIFY_PREFS : parseNotifyPrefs(value);
}

export function saveNotifyPrefs(storage: KeyValueStorage | null, prefs: NotifyPrefs): boolean {
  return writeJson(storage, NOTICE_STORAGE_KEYS.prefs, prefs);
}

/** Drops the v1 read list once; nothing reads it any more. */
export function dropLegacyKeys(storage: KeyValueStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(LEGACY_READ_KEY);
  } catch {
    /* blocked storage: nothing to clean */
  }
}
