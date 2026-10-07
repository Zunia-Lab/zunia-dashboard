"use client";

/**
 * Notifications in the browser: Web Push for when the tab is closed, native
 * OS notifications for when it is open but hidden, and the bridge that lets
 * the service worker steer an open tab.
 *
 * Honest states are the point. The previous version showed "Subscribed" after
 * the server answered a 200 placeholder that stored nothing, and printed an
 * env variable name on failure. Here:
 * - `configured` comes from `/api/push/config` at runtime (null while it
 *   loads), and push is never offered when the server cannot send it;
 * - `subscribed` is true only when this browser holds a subscription, it was
 *   made with the server's current key, and the server accepted it (its
 *   endpoint is recorded in Cache Storage only after a 2xx);
 * - every non-2xx is a failure, phrased from the server's own `message`
 *   (written for users) or a plain fallback.
 *
 * The accounts and prefs sent with a subscription are also kept in Cache
 * Storage under `/__zunia/push-registration`, because that is the one store
 * the service worker can read when the browser rotates the subscription
 * (`pushsubscriptionchange`) with no page open.
 *
 * Privacy mode ("Hide amounts") reaches the OS too. An alert raised by an open
 * tab is masked here, and the worker masks a push itself at display time: the
 * server composes push text without knowing the setting (and must not need
 * to: it is a display choice of this browser, not account data), so the page
 * leaves the setting in Cache Storage under `/__zunia/privacy`, the one place
 * the worker can read it with no tab open. A lock screen or a shared screen
 * never shows an amount the page itself would hide.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { inQuietHours, parseNotifyPrefs } from "@/lib/notifications/prefs";
import { loadNotifyPrefs } from "@/lib/notifications/store";
import { maskAmounts } from "@/lib/notifications/text";
import type { Notice, NotifyPrefs } from "@/lib/notifications/types";
import { safeNoticeUrl } from "@/lib/notifications/url";
import { isIosSafari, isStandalonePwa } from "@/lib/pwa";
import { revalidateApi, useApi } from "@/lib/useApi";

export interface PushAccount {
  chainId: string;
  address: string;
}

export type PushPermission = "default" | "granted" | "denied";

/** `GET /api/push/config`. */
export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  reason?: string;
  watching: boolean;
  updatedAt: number;
}

export interface PushController {
  /** This browser can do Web Push here (secure context, service worker, PushManager). */
  supported: boolean;
  /** Why not, in words for the user (e.g. iOS needs the installed app). */
  unsupportedReason: string | null;
  permission: PushPermission;
  /** The server can send push. Null while unknown (loading, or the check failed: see `configStatus`). */
  configured: boolean | null;
  /** Why the server cannot, for the user. */
  configReason: string | null;
  /** The `/api/push/config` read: an `error` here is "could not check", never "not available". */
  configStatus: "loading" | "ready" | "error";
  /** Re-reads `/api/push/config` (after `configStatus: "error"`). */
  retryConfig(): void;
  /** The server's chain watcher runs; without it only test pushes arrive. */
  watching: boolean | null;
  subscribed: boolean;
  /** The initial subscription check has not finished. */
  checking: boolean;
  busy: boolean;
  error: string | null;
  /** Asks permission (call from a click), subscribes this browser and registers it. */
  subscribe(accounts: readonly PushAccount[], prefs: NotifyPrefs): Promise<boolean>;
  /**
   * Re-sends accounts/prefs for an existing subscription; no prompt. False when
   * not subscribed. Free to call often: an unchanged registration is not re-sent.
   */
  update(accounts: readonly PushAccount[], prefs: NotifyPrefs): Promise<boolean>;
  unsubscribe(): Promise<boolean>;
  /** Asks the server to push "Zunia notifications are on" to this browser now. */
  sendTest(): Promise<boolean>;
  clearError(): void;
}

export const MAX_PUSH_ACCOUNTS = 32;

const SW_URL = "/sw.js";
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";
const REGISTRATION_CACHE = "zunia-push-v1";
const REGISTRATION_KEY = "/__zunia/push-registration";
/** Where the worker reads privacy mode (see the module comment). Twin of PRIVACY_KEY in public/sw.js. */
const PRIVACY_KEY = "/__zunia/privacy";
/** `PrefsProvider`'s storage key for privacy mode (a JSON boolean). */
const HIDE_AMOUNTS_KEY = "zunia.dashboard.hideAmounts";
const BLOCKED = "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.";

/** What the browser shows; `renotify` and `timestamp` are standard but missing from TS's DOM types. */
type RichNotificationOptions = NotificationOptions & { renotify?: boolean; timestamp?: number };

interface StoredRegistration {
  endpoint: string;
  accounts: PushAccount[];
  prefs: NotifyPrefs;
  locale: string;
  timeZone: string | null;
  savedAt: number;
}

class PushProblem extends Error {}

/* -------------------------------------------------------------------------- *
 * Browser capability and permission, as external stores.
 * -------------------------------------------------------------------------- */

interface Support {
  supported: boolean;
  reason: string | null;
}

const SERVER_SUPPORT: Support = { supported: false, reason: null };
let supportMemo: Support | null = null;

function readSupport(): Support {
  if (typeof window === "undefined") return SERVER_SUPPORT;
  if (supportMemo) return supportMemo;
  let support: Support;
  if (!window.isSecureContext) {
    support = { supported: false, reason: "Notifications need a secure (https) connection." };
  } else if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    support = { supported: false, reason: "This browser does not support notifications." };
  } else if (!("PushManager" in window)) {
    support =
      isIosSafari() && !isStandalonePwa()
        ? {
            supported: false,
            reason: "On iPhone and iPad, add Zunia to your Home Screen, open it from there, then turn push on.",
          }
        : { supported: false, reason: "This browser does not support push notifications." };
  } else {
    support = { supported: true, reason: null };
  }
  supportMemo = support;
  return support;
}

const noopSubscribe = () => () => {};

const permissionListeners = new Set<() => void>();

function emitPermission(): void {
  for (const listener of permissionListeners) listener();
}

export function readNotificationPermission(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "default";
  const value = Notification.permission;
  return value === "granted" || value === "denied" ? value : "default";
}

function subscribePermission(listener: () => void): () => void {
  permissionListeners.add(listener);
  // The user can change it in site settings at any time; re-read on return.
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", listener);
  let status: PermissionStatus | null = null;
  let disposed = false;
  navigator.permissions
    ?.query({ name: "notifications" as PermissionName })
    .then((result) => {
      if (disposed) return;
      status = result;
      result.addEventListener("change", listener);
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    permissionListeners.delete(listener);
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", listener);
    status?.removeEventListener("change", listener);
  };
}

function readAlertSupport(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "Notification" in window;
}

/** Whether this page can show OS notifications at all (independent of Web Push support). */
export function useAlertSupport(): boolean {
  return useSyncExternalStore(noopSubscribe, readAlertSupport, () => false);
}

/** Use the browser's permission as React state (updates after a prompt or a settings change). */
export function useNotificationPermission(): PushPermission {
  return useSyncExternalStore(subscribePermission, readNotificationPermission, () => "default");
}

/**
 * Shows the browser's permission prompt. Call it first thing in a click
 * handler: Safari and Firefox only prompt while the click is the current
 * user activation, so nothing may be awaited before it.
 */
export async function requestNotificationPermission(): Promise<PushPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "default";
  if (Notification.permission !== "default") return readNotificationPermission();
  try {
    // Old Safari only has the callback form; the promise form returns undefined there.
    const result = await new Promise<NotificationPermission>((resolve) => {
      const maybe = Notification.requestPermission(resolve);
      if (maybe && typeof maybe.then === "function") void maybe.then(resolve);
    });
    emitPermission();
    return result === "granted" || result === "denied" ? result : "default";
  } catch {
    return readNotificationPermission();
  }
}

/* -------------------------------------------------------------------------- *
 * Service worker and stored registration.
 * -------------------------------------------------------------------------- */

let registering: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registers `/sw.js` (once) and resolves with the active registration, or null. */
export function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  registering ??= (async () => {
    try {
      await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
      // `ready` never settles if the worker cannot activate; do not hang a click on it.
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);
    } catch {
      return null;
    }
  })().then((registration) => {
    if (!registration) registering = null;
    return registration;
  });
  return registering;
}

async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!readSupport().supported) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

async function registrationCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(REGISTRATION_CACHE);
  } catch {
    return null;
  }
}

/** The stored registration, shape-checked: Cache Storage is writable by any script on this origin. */
function parseRegistration(raw: unknown): StoredRegistration | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.endpoint !== "string" || !Array.isArray(row.accounts)) return null;
  const accounts = normalizeAccounts(
    row.accounts.flatMap((entry: unknown) => {
      const account = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      return account && typeof account.chainId === "string" && typeof account.address === "string"
        ? [{ chainId: account.chainId, address: account.address }]
        : [];
    }),
  );
  return {
    endpoint: row.endpoint,
    accounts,
    prefs: parseNotifyPrefs(row.prefs),
    locale: typeof row.locale === "string" ? row.locale : "en",
    timeZone: typeof row.timeZone === "string" ? row.timeZone : null,
    savedAt: typeof row.savedAt === "number" && Number.isFinite(row.savedAt) ? row.savedAt : 0,
  };
}

async function readRegistration(): Promise<StoredRegistration | null> {
  try {
    const response = await (await registrationCache())?.match(REGISTRATION_KEY);
    return response ? parseRegistration(await response.json()) : null;
  } catch {
    return null;
  }
}

async function writeRegistration(value: StoredRegistration): Promise<void> {
  try {
    await (await registrationCache())?.put(
      REGISTRATION_KEY,
      new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }),
    );
  } catch {
    /* storage refused: the worker cannot re-register on its own, the page still can */
  }
}

async function clearRegistration(): Promise<void> {
  try {
    await (await registrationCache())?.delete(REGISTRATION_KEY);
  } catch {
    /* nothing stored */
  }
}

/** Privacy mode as this browser stores it; false when unknown (blocked storage, nothing stored). */
function amountsHidden(): boolean {
  try {
    return JSON.parse(window.localStorage.getItem(HIDE_AMOUNTS_KEY) ?? "false") === true;
  } catch {
    return false;
  }
}

/**
 * Copies privacy mode where the service worker can read it, so a push shown
 * with every tab closed is masked like the page would mask it. Reads the
 * stored setting itself rather than taking a value: the first render after a
 * reload has not read storage yet and would write a passing `false`. Writes
 * only on a change. Call it whenever the setting may have changed.
 */
export async function syncPushPrivacy(): Promise<void> {
  if (typeof window === "undefined" || typeof caches === "undefined") return;
  const hideAmounts = amountsHidden();
  try {
    // Off, with nothing recorded: the worker already reads that as off, and a
    // visitor who never turns push on gets no storage made for it.
    if (!hideAmounts && !(await caches.has(REGISTRATION_CACHE))) return;
    const cache = await caches.open(REGISTRATION_CACHE);
    const stored = await cache.match(PRIVACY_KEY);
    const current = stored ? ((await stored.json()) as { hideAmounts?: unknown } | null) : null;
    if (current && current.hideAmounts === hideAmounts) return;
    await cache.put(
      PRIVACY_KEY,
      new Response(JSON.stringify({ hideAmounts }), { headers: { "content-type": "application/json" } }),
    );
  } catch {
    /* storage refused: pushes show as the server wrote them */
  }
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A subscription made with another server key cannot receive this server's pushes. */
function madeWithKey(subscription: PushSubscription, publicKey: string): boolean {
  const key = subscription.options?.applicationServerKey;
  if (!key) return true;
  return bytesToBase64Url(new Uint8Array(key)) === publicKey.replace(/=+$/, "");
}

function normalizeAccounts(accounts: readonly PushAccount[]): PushAccount[] {
  const seen = new Set<string>();
  const out: PushAccount[] = [];
  for (const account of accounts) {
    const key = `${account.chainId}|${account.address}`;
    if (!account.chainId || !account.address || seen.has(key)) continue;
    seen.add(key);
    out.push({ chainId: account.chainId, address: account.address });
    if (out.length >= MAX_PUSH_ACCOUNTS) break;
  }
  return out;
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The server's own sentence for a failure (written for users), or a plain fallback. */
async function failureText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0 && body.message.length < 200) return body.message;
  } catch {
    /* not JSON */
  }
  if (response.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (response.status === 503) return "Push is not available right now. Try again later.";
  return "The server did not accept this request. Try again.";
}

/**
 * What this page last registered successfully (endpoint, accounts, prefs). The
 * shell's sync, the settings screen and the daily keep-alive may all ask for
 * the same registration; only a change reaches the server.
 */
let lastRegistered: string | null = null;

function registrationKey(endpoint: string, accounts: readonly PushAccount[], prefs: NotifyPrefs): string {
  return JSON.stringify([endpoint, accounts, prefs]);
}

async function register(subscription: PushSubscription, accounts: PushAccount[], prefs: NotifyPrefs): Promise<void> {
  const locale = typeof navigator !== "undefined" ? navigator.language : "en";
  const timeZone = browserTimeZone();
  let response: Response;
  try {
    response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), accounts, prefs, locale, timeZone }),
    });
  } catch {
    throw new PushProblem("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) throw new PushProblem(await failureText(response));
  lastRegistered = registrationKey(subscription.endpoint, accounts, prefs);
  await writeRegistration({ endpoint: subscription.endpoint, accounts, prefs, locale, timeZone, savedAt: Date.now() });
}

function describe(error: unknown): string {
  if (error instanceof PushProblem) return error.message;
  if (error instanceof DOMException && error.name === "NotAllowedError") return BLOCKED;
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The browser's push service did not answer. Try again in a moment.";
  }
  return "Push could not be turned on in this browser. Try again.";
}

function parseConfig(raw: unknown): PushConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.enabled !== "boolean") return null;
  return {
    enabled: row.enabled,
    publicKey: typeof row.publicKey === "string" ? row.publicKey : null,
    reason: typeof row.reason === "string" ? row.reason : undefined,
    watching: row.watching === true,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
  };
}

async function readConfig(): Promise<PushConfig | null> {
  try {
    const response = await fetch("/api/push/config");
    return response.ok ? parseConfig(await response.json()) : null;
  } catch {
    return null;
  }
}

/** How often an open dashboard re-posts its push registration. */
const KEEPALIVE_MS = 24 * 3_600_000;
let keepAliveStarted = false;

/**
 * Re-posts this browser's stored registration, at most once a day, from any
 * page that mounts the bridge.
 *
 * The server forgets subscriptions it has not heard from in 90 days (a dead
 * browser must not be polled forever). The settings screen re-sends on
 * mount, but someone who uses the dashboard every day and never opens it would
 * otherwise lose push silently after three months. Only a subscription the
 * server accepted, still held by this browser and made with the server's
 * current key is refreshed — re-posting a stale one would keep a dead record
 * alive. Prefs come from this browser's own store, the source of truth.
 */
async function keepRegistrationAlive(): Promise<void> {
  if (keepAliveStarted) return;
  keepAliveStarted = true;
  const saved = await readRegistration();
  if (!saved || saved.accounts.length === 0 || Date.now() - saved.savedAt < KEEPALIVE_MS) return;
  const subscription = await currentPushSubscription();
  if (!subscription || subscription.endpoint !== saved.endpoint) return;
  const config = await readConfig();
  if (!config?.enabled || !config.publicKey || !madeWithKey(subscription, config.publicKey)) return;
  let local: Storage | null = null;
  try {
    local = window.localStorage;
  } catch {
    /* blocked storage: the stored prefs below are the best copy */
  }
  const prefs = local ? loadNotifyPrefs(local) : saved.prefs;
  await register(subscription, saved.accounts, prefs).catch(() => undefined);
}

/*
 * The subscription changed: the worker rotated and re-registered it, or a
 * `usePush` on this page turned push on or off. Every `usePush` re-reads.
 */
const changeListeners = new Set<() => void>();
function emitPushChanged(): void {
  for (const listener of changeListeners) listener();
}

/**
 * Turns push off for this browser: the subscription is ended (that is what
 * stops delivery), the server is told to forget it, and the stored
 * registration — the addresses the worker would re-register on its own — is
 * dropped. Settings' "Turn off", and Disconnect and "Clear local data" too: on
 * a shared computer, leaving means the next person does not keep receiving the
 * previous person's transfers on this browser's lock screen. Rejects only when
 * the browser refuses to end the subscription.
 */
export async function stopPush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    // The browser side is what stops delivery; telling the server only
    // saves it a failed send (it deletes on the 410 anyway).
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => undefined);
  }
  await clearRegistration();
  lastRegistered = null;
  emitPushChanged();
}

/* -------------------------------------------------------------------------- *
 * The hook.
 * -------------------------------------------------------------------------- */

export function usePush(): PushController {
  const support = useSyncExternalStore(noopSubscribe, readSupport, () => SERVER_SUPPORT);
  const permission = useNotificationPermission();
  const config = useApi<PushConfig>("/api/push/config", { parse: parseConfig, persist: false, dedupeMs: 60_000 });
  const [subscribed, setSubscribed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const publicKey = config.data?.publicKey ?? null;

  useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    changeListeners.add(listener);
    return () => {
      changeListeners.delete(listener);
    };
  }, []);

  // What this browser holds now: a subscription, made with the current key,
  // that the server accepted (its endpoint was recorded after a 2xx).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const subscription = await currentPushSubscription();
      const saved = subscription ? await readRegistration() : null;
      const valid =
        subscription !== null &&
        saved?.endpoint === subscription.endpoint &&
        (publicKey === null || madeWithKey(subscription, publicKey));
      if (!cancelled) {
        setSubscribed(valid);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey, revision]);

  const subscribe = useCallback(
    async (accounts: readonly PushAccount[], prefs: NotifyPrefs): Promise<boolean> => {
      setError(null);
      const capability = readSupport();
      if (!capability.supported) {
        setError(capability.reason ?? "This browser does not support push notifications.");
        return false;
      }
      const list = normalizeAccounts(accounts);
      if (list.length === 0) {
        setError("Connect a wallet first: push watches your addresses.");
        return false;
      }
      const server = config.data;
      if (!server) {
        setError("Could not check whether push is available. Try again.");
        return false;
      }
      if (!server.enabled || !server.publicKey) {
        setError(server.reason ?? "Push is not available on this server.");
        return false;
      }
      // Nothing awaited before the prompt (see requestNotificationPermission).
      const allowed = await requestNotificationPermission();
      if (allowed !== "granted") {
        setError(allowed === "denied" ? BLOCKED : "Notifications were not allowed.");
        return false;
      }
      setBusy(true);
      try {
        const registration = await ensureServiceWorker();
        if (!registration) throw new PushProblem("The browser could not start Zunia's notification worker.");
        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !madeWithKey(subscription, server.publicKey)) {
          await subscription.unsubscribe().catch(() => false);
          subscription = null;
        }
        subscription ??= await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(server.publicKey),
        });
        await register(subscription, list, prefs);
        setSubscribed(true);
        // Other `usePush` users on the page (the shell's sync) re-read the state.
        emitPushChanged();
        return true;
      } catch (problem) {
        setError(describe(problem));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [config.data],
  );

  const update = useCallback(async (accounts: readonly PushAccount[], prefs: NotifyPrefs): Promise<boolean> => {
    const subscription = await currentPushSubscription();
    const list = normalizeAccounts(accounts);
    if (!subscription || list.length === 0) return false;
    // Already what the server holds (posted from this page): nothing to send.
    if (registrationKey(subscription.endpoint, list, prefs) === lastRegistered) return true;
    try {
      await register(subscription, list, prefs);
      return true;
    } catch (problem) {
      setError(describe(problem));
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await stopPush();
      setSubscribed(false);
      return true;
    } catch (problem) {
      setError(describe(problem));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const sendTest = useCallback(async (): Promise<boolean> => {
    setError(null);
    const subscription = await currentPushSubscription();
    if (!subscription) {
      setSubscribed(false);
      setError("This browser is not subscribed. Turn push on first.");
      return false;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) {
        if (response.status === 404) {
          await clearRegistration();
          lastRegistered = null;
          setSubscribed(false);
          emitPushChanged();
        }
        setError(await failureText(response));
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    supported: support.supported,
    unsupportedReason: support.reason,
    permission,
    configured: config.data ? config.data.enabled : null,
    configReason: config.data && !config.data.enabled ? (config.data.reason ?? "Push is not available on this server.") : null,
    configStatus: config.data ? "ready" : config.status === "error" ? "error" : "loading",
    retryConfig: config.refetch,
    watching: config.data ? config.data.watching : null,
    subscribed,
    checking,
    busy,
    error,
    subscribe,
    update,
    unsubscribe,
    sendTest,
    clearError,
  };
}

/* -------------------------------------------------------------------------- *
 * Native notifications from an open tab.
 * -------------------------------------------------------------------------- */

export interface NativeNotificationOptions {
  /** Skip the prefs and quiet-hours checks (a "send a test alert" button). */
  readonly force?: boolean;
  readonly now?: number;
  /** SPA navigation for the fallback `new Notification()` click (the worker path uses the bridge). */
  readonly onNavigate?: (url: string) => void;
}

/**
 * Shows `notice` as an OS notification, if the user asked for browser alerts,
 * granted permission, and it is not quiet time.
 *
 * Through the service worker registration when there is one: that is an OS
 * notification even with the tab hidden, the only kind Android allows, and its
 * click is routed by the worker like a push. `tag` is the notice id, so the
 * same event announced by a push and by this tab shows once.
 *
 * With privacy mode on, amounts are masked exactly as the bell masks them
 * (`maskAmounts`): an OS banner is the most exposed place a notice appears.
 */
export async function showNativeNotification(
  notice: Notice,
  prefs: NotifyPrefs,
  options: NativeNotificationOptions = {},
): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (readNotificationPermission() !== "granted") return false;
  if (!options.force) {
    if (!prefs.browserAlerts) return false;
    if (inQuietHours(prefs.quietHours, options.now ?? Date.now())) return false;
  }
  const url = safeNoticeUrl(notice.url, window.location.origin);
  const hide = amountsHidden();
  const title = hide ? maskAmounts(notice.title, notice.kind, notice.data?.amount) : notice.title;
  const details: RichNotificationOptions = {
    body: hide ? maskAmounts(notice.body, notice.kind, notice.data?.amount) : notice.body,
    icon: ICON,
    badge: BADGE,
    tag: notice.id,
    renotify: false,
    timestamp: notice.at,
    data: { url, id: notice.id },
  };
  try {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
    if (registration) {
      await registration.showNotification(title, details);
      return true;
    }
  } catch {
    /* fall through to the page-level API */
  }
  try {
    const shown = new Notification(title, details);
    shown.onclick = () => {
      window.focus();
      shown.close();
      if (options.onNavigate) options.onNavigate(url);
      else window.location.assign(url);
    };
    return true;
  } catch {
    // Android Chrome throws on `new Notification`: only the worker path exists there.
    return false;
  }
}

/** Closes the OS notification for a notice that was just read in the app. */
export async function closeNativeNotification(id: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration("/");
    for (const shown of (await registration?.getNotifications({ tag: id })) ?? []) shown.close();
  } catch {
    /* nothing open */
  }
}

/**
 * Mount once in the app shell: registers the worker, follows its messages and
 * keeps this browser's push registration fresh (`keepRegistrationAlive`).
 * - `zunia:navigate` (a notification click): SPA navigation to the validated
 *   URL, acknowledged so the worker does not fall back to a full navigation;
 * - `zunia:refresh` (a push arrived): re-read every API answer on screen;
 * - `zunia:push-changed` (the worker re-subscribed): refresh push state.
 */
export function useServiceWorkerBridge(): void {
  const router = useRouter();
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void ensureServiceWorker()
      .then(() => keepRegistrationAlive())
      .catch(() => undefined);
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "zunia:navigate") {
        router.push(safeNoticeUrl(data.url, window.location.origin));
        event.ports?.[0]?.postMessage({ ok: true });
      } else if (data.type === "zunia:refresh") {
        revalidateApi("/api/");
      } else if (data.type === "zunia:push-changed") {
        emitPushChanged();
      }
    };
    container.addEventListener("message", onMessage);
    container.startMessages?.();
    return () => container.removeEventListener("message", onMessage);
  }, [router]);
}
