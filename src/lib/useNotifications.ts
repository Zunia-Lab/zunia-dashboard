"use client";

/**
 * The notification feed in the browser.
 *
 * `useNoticeFeed(inputs)` is the driver: the app shell passes what its data
 * hooks read (rewards, staking, proposals, activity) and the hook derives the
 * feed (`deriveNotices`, pure), persists its memory and read state, raises OS
 * notifications for what is new while the tab is hidden, and sets the app
 * badge. Called with no inputs it only reads, so the bell, the popover and the
 * notification centre can all subscribe to one feed without each deriving its
 * own. Exactly one mounted component should pass inputs.
 *
 * What is new while the tab is visible and focused raises no OS alert; it is
 * handed to `useNoticeAnnouncements` listeners instead (the shell's toasts).
 * Nothing a read reports the first time it reaches the feed is announced
 * anywhere: that is how things already were (`DeriveResult.silent`).
 *
 * The store lives at module level behind `useSyncExternalStore`: one copy per
 * tab, shared by every subscriber, server-rendered as empty. Other tabs follow
 * through the `storage` event (read ids, cleared ids, prefs and memory each
 * have their own key, see `@/lib/notifications/store`).
 *
 * `useNotifications()` keeps the v1 shape (`notes`, `unreadCount`, `isRead`,
 * `markAllRead`) for the callers that still use it.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { findChain } from "@/lib/chains";
import { closeNativeNotification, showNativeNotification, usePush, type PushAccount } from "@/lib/data/push";
import { deriveNotices, pendingAnnouncements, type DeriveInput } from "@/lib/notifications/derive";
import { DEFAULT_NOTIFY_PREFS, inQuietHours, parseNotifyPrefs } from "@/lib/notifications/prefs";
import { INITIAL_NOTICE_STATE, type NoticeState } from "@/lib/notifications/state";
import {
  dropLegacyKeys,
  loadDismissedIds,
  loadNoticeState,
  loadNotifyPrefs,
  loadReadIds,
  NOTICE_STORAGE_KEYS,
  saveDismissedIds,
  saveNoticeState,
  saveNotifyPrefs,
  saveReadIds,
  withRead,
  type KeyValueStorage,
} from "@/lib/notifications/store";
import type { Notice, NotifyPrefs } from "@/lib/notifications/types";

/** What the shell feeds the derivation. Field shapes: `@/lib/notifications/types`. */
export interface NoticeFeedInputs {
  /** The connected account's address (any stable key); null when none is connected. */
  readonly account: string | null;
  readonly portfolio?: DeriveInput["portfolio"];
  readonly staking?: DeriveInput["staking"];
  readonly proposals?: DeriveInput["proposals"];
  readonly activity?: DeriveInput["activity"];
  readonly system?: DeriveInput["system"];
}

export interface NoticeFeed {
  /** Newest first, at most 60, without the ones the user cleared. */
  readonly notices: readonly Notice[];
  readonly unreadCount: number;
  isRead(id: string): boolean;
  markRead(id: string): void;
  markAllRead(): void;
  /** Removes notices from the feed (and marks them read). A later event is a new id and shows. */
  dismiss(ids: string | readonly string[]): void;
  /** Clears every notice currently in the feed ("Clear" in the notification centre). */
  clear(): void;
  readonly prefs: NotifyPrefs;
  setPrefs(next: NotifyPrefs | ((prev: NotifyPrefs) => NotifyPrefs)): void;
  /** False during server render and before storage was read. */
  readonly ready: boolean;
}

/** How often a driver re-derives with unchanged inputs: time alone changes the feed. */
const TICK_MS = 60_000;

interface Snapshot {
  readonly notices: readonly Notice[];
  readonly readSet: ReadonlySet<string>;
  readonly unreadCount: number;
  readonly prefs: NotifyPrefs;
  readonly ready: boolean;
}

const EMPTY: Snapshot = {
  notices: [],
  readSet: new Set(),
  unreadCount: 0,
  prefs: DEFAULT_NOTIFY_PREFS,
  ready: false,
};

const store = {
  hydrated: false,
  /** Everything derived, cleared ones included (the snapshot leaves them out). */
  notices: [] as readonly Notice[],
  read: [] as string[],
  dismissed: [] as string[],
  state: INITIAL_NOTICE_STATE as NoticeState,
  prefs: DEFAULT_NOTIFY_PREFS as NotifyPrefs,
  snapshot: EMPTY,
  listeners: new Set<() => void>(),
};

/** Listeners for what was announced while the page was in front of the user. */
const announcementListeners = new Set<(notices: readonly Notice[]) => void>();

function storage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function rebuild(): void {
  const readSet = new Set(store.read);
  const dismissed = new Set(store.dismissed);
  const notices = dismissed.size > 0 ? store.notices.filter((notice) => !dismissed.has(notice.id)) : store.notices;
  store.snapshot = {
    notices,
    readSet,
    unreadCount: notices.reduce((count, notice) => count + (readSet.has(notice.id) ? 0 : 1), 0),
    prefs: store.prefs,
    ready: true,
  };
}

function publish(): void {
  rebuild();
  for (const listener of store.listeners) listener();
}

function hydrate(): void {
  if (store.hydrated || typeof window === "undefined") return;
  store.hydrated = true;
  const local = storage();
  store.read = loadReadIds(local);
  store.dismissed = loadDismissedIds(local);
  store.state = loadNoticeState(local);
  store.prefs = loadNotifyPrefs(local);
  dropLegacyKeys(local);
  rebuild();
}

function onStorage(event: StorageEvent): void {
  if (event.storageArea && event.storageArea !== storage()) return;
  const local = storage();
  const all = event.key === null;
  if (!all && !(Object.values(NOTICE_STORAGE_KEYS) as string[]).includes(event.key ?? "")) return;
  if (all || event.key === NOTICE_STORAGE_KEYS.read) store.read = loadReadIds(local);
  if (all || event.key === NOTICE_STORAGE_KEYS.dismissed) store.dismissed = loadDismissedIds(local);
  if (all || event.key === NOTICE_STORAGE_KEYS.state) store.state = loadNoticeState(local);
  if (all || event.key === NOTICE_STORAGE_KEYS.prefs) store.prefs = loadNotifyPrefs(local);
  publish();
}

function subscribe(listener: () => void): () => void {
  hydrate();
  if (store.listeners.size === 0) window.addEventListener("storage", onStorage);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
    if (store.listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Snapshot {
  hydrate();
  return store.snapshot;
}

function getServerSnapshot(): Snapshot {
  return EMPTY;
}

function chainName(chainId: string): string {
  return findChain(chainId)?.chainName ?? chainId;
}

/** Derives, stores what changed, and returns the notices to announce. */
function derive(inputs: NoticeFeedInputs, now: number): Notice[] {
  hydrate();
  const result = deriveNotices({ ...inputs, now, prefs: store.prefs, state: store.state, chainName });
  const { announce, ids } = pendingAnnouncements(result.state.announced, result.notices, {
    seed: result.seeding,
    silent: result.silent,
    read: store.read,
    quiet: inQuietHours(store.prefs.quietHours, now),
  });
  const state: NoticeState = { ...result.state, announced: ids };
  let changed = false;
  if (JSON.stringify(state) !== JSON.stringify(store.state)) {
    store.state = state;
    saveNoticeState(storage(), state);
    changed = true;
  }
  if (JSON.stringify(result.notices) !== JSON.stringify(store.notices)) {
    store.notices = result.notices;
    changed = true;
  }
  if (changed) publish();
  return announce;
}

/**
 * OS notifications only when the user is not looking at this tab; a visible,
 * focused dashboard hands them to its in-page listeners (toasts) instead.
 */
async function announce(notices: readonly Notice[]): Promise<void> {
  if (notices.length === 0 || typeof document === "undefined") return;
  if (document.visibilityState === "visible" && document.hasFocus()) {
    for (const listener of announcementListeners) {
      try {
        listener(notices);
      } catch {
        /* a listener's failure is its own */
      }
    }
    return;
  }
  for (const notice of notices) await showNativeNotification(notice, store.prefs);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function markReadIds(ids: readonly string[]): void {
  hydrate();
  const next = withRead(store.read, ids);
  if (sameList(next, store.read)) return;
  store.read = next;
  saveReadIds(storage(), next);
  publish();
  for (const id of ids) void closeNativeNotification(id);
}

function dismissIds(ids: readonly string[]): void {
  hydrate();
  if (ids.length === 0) return;
  const next = withRead(store.dismissed, ids);
  const read = withRead(store.read, ids);
  if (sameList(next, store.dismissed) && sameList(read, store.read)) return;
  store.dismissed = next;
  store.read = read;
  saveDismissedIds(storage(), next);
  saveReadIds(storage(), read);
  publish();
  for (const id of ids) void closeNativeNotification(id);
}

function updatePrefs(next: NotifyPrefs | ((prev: NotifyPrefs) => NotifyPrefs)): void {
  hydrate();
  store.prefs = parseNotifyPrefs(typeof next === "function" ? next(store.prefs) : next);
  saveNotifyPrefs(storage(), store.prefs);
  publish();
}

function setAppBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  try {
    const call = count > 0 ? navigator.setAppBadge?.(Math.min(count, 99)) : navigator.clearAppBadge?.();
    call?.catch(() => undefined);
  } catch {
    /* no Badging API */
  }
}

/**
 * The feed. Pass `inputs` from exactly one component (the shell) to drive it;
 * call with nothing to read it anywhere else.
 */
export function useNoticeFeed(inputs?: NoticeFeedInputs | null): NoticeFeed {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Compared by value: callers rebuild their inputs every render.
  const inputsKey = inputs ? JSON.stringify(inputs) : null;
  const prefsKey = JSON.stringify(snapshot.prefs);
  const driving = inputsKey !== null;

  useEffect(() => {
    if (inputsKey === null) return;
    const parsed = JSON.parse(inputsKey) as NoticeFeedInputs;
    const run = () => void announce(derive(parsed, Date.now()));
    run();
    const timer = window.setInterval(run, TICK_MS);
    return () => window.clearInterval(timer);
  }, [inputsKey, prefsKey]);

  useEffect(() => {
    if (driving) setAppBadge(snapshot.unreadCount);
  }, [driving, snapshot.unreadCount]);

  const isRead = useCallback((id: string) => snapshot.readSet.has(id), [snapshot.readSet]);
  const markRead = useCallback((id: string) => markReadIds([id]), []);
  const markAllRead = useCallback(() => markReadIds(store.snapshot.notices.map((notice) => notice.id)), []);
  const dismiss = useCallback((ids: string | readonly string[]) => dismissIds(typeof ids === "string" ? [ids] : ids), []);
  const clear = useCallback(() => dismissIds(store.snapshot.notices.map((notice) => notice.id)), []);

  return useMemo(
    () => ({
      notices: snapshot.notices,
      unreadCount: snapshot.unreadCount,
      isRead,
      markRead,
      markAllRead,
      dismiss,
      clear,
      prefs: snapshot.prefs,
      setPrefs: updatePrefs,
      ready: snapshot.ready,
    }),
    [snapshot, isRead, markRead, markAllRead, dismiss, clear],
  );
}

/**
 * Calls `handler` with the notices announced while this tab is visible and
 * focused — the ones that raise no OS alert because the user is looking. The
 * shell turns them into toasts. Seeded, read, cleared and quiet-hours notices
 * never arrive here, exactly as they never become alerts.
 */
export function useNoticeAnnouncements(handler: (notices: readonly Notice[]) => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  useEffect(() => {
    const listener = (notices: readonly Notice[]) => latest.current(notices);
    announcementListeners.add(listener);
    return () => {
      announcementListeners.delete(listener);
    };
  }, []);
}

/**
 * Keeps this browser's push registration on the connected wallet: while push
 * is on here, a change of accounts (another wallet, a newly followed chain) or
 * of prefs is re-sent to the server, debounced. Mount once in the shell with
 * the wallet's address on each followed chain (at most 32 are used); the
 * settings screen calls it too, and an unchanged registration is never re-sent.
 *
 * `null` or an empty list (no wallet yet, a restore in progress, a phone
 * session that expired) leaves the registration alone: a lapse is not a
 * decision to stop push. The decisions are explicit — Settings' "Turn off"
 * (`usePush().unsubscribe`), and Disconnect, which turns push off for this
 * browser in `WalletProvider.disconnect` (`stopPush`) so the next person at a
 * shared computer does not receive the previous wallet's notifications.
 */
export function usePushSync(accounts: readonly PushAccount[] | null): void {
  const { prefs, ready } = useNoticeFeed();
  const { subscribed, update } = usePush();
  const key = accounts && accounts.length > 0 ? JSON.stringify({ prefs, accounts }) : null;
  useEffect(() => {
    if (!subscribed || !ready || key === null) return;
    const timer = window.setTimeout(() => {
      const latest = JSON.parse(key) as { prefs: NotifyPrefs; accounts: PushAccount[] };
      void update(latest.accounts, latest.prefs);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [key, subscribed, ready, update]);
}

/** v1 row shape, kept for the callers written against it. */
export interface Note {
  id: string;
  title: string;
  meta: string;
  href?: string;
  tone?: "info" | "warning";
}

function toNote(notice: Notice): Note {
  return {
    id: notice.id,
    title: notice.title,
    meta: notice.body,
    ...(notice.url ? { href: notice.url } : {}),
    tone: notice.severity === "warning" || notice.severity === "danger" ? "warning" : "info",
  };
}

/** Compatibility layer over `useNoticeFeed()` (read-only; the shell drives the feed). */
export function useNotifications() {
  const feed = useNoticeFeed();
  const notes = useMemo(() => feed.notices.map(toNote), [feed.notices]);
  return {
    notes,
    notices: feed.notices,
    unreadCount: feed.unreadCount,
    isRead: feed.isRead,
    markRead: feed.markRead,
    markAllRead: feed.markAllRead,
  };
}
