/**
 * Push subscription records: their shape, their limits, and the rules for
 * adding, refreshing and forgetting them. Pure — the file store and the
 * poller own the I/O — so the limits are tested directly.
 *
 * Limits, and what each one protects:
 * - 10,000 subscriptions per server: the store is one JSON file held in
 *   memory and every record is polled;
 * - 32 accounts per subscription: each is a recurring LCD read;
 * - 200 sent ids per subscription: the at-least-once dedupe window (a
 *   restart, an overlapping block range or a second account on the same chain
 *   must not push the same transfer twice);
 * - 50 pending unbondings;
 * - 90 days without the browser checking in: the subscription is dropped (a
 *   dashboard re-posts its subscription on every visit, so a silent one
 *   belongs to someone who left).
 */

import { parseNotifyPrefs } from "@/lib/notifications/prefs";
import type { NotifyPrefs } from "@/lib/notifications/types";
import {
  isAllowedPushEndpoint,
  isP256PublicKey,
  MAX_ACCOUNTS,
  type PushAccount,
  type SubscribeRequest,
} from "@/lib/server/push/validate";

export const PUSH_STORE_LIMITS = {
  subscriptions: 10_000,
  accounts: MAX_ACCOUNTS,
  sentIds: 200,
  pendingUnbondings: 50,
  staleMs: 90 * 86_400_000,
  /** Consecutive non-404/410 failures before a subscription is given up on. */
  maxFailures: 25,
} as const;

/** An unbonding seen on chain, waiting to be announced when it completes. */
export interface PendingUnbonding {
  readonly id: string;
  readonly chainId: string;
  readonly address: string;
  readonly completesAt: number;
  /** "12.5 ATOM", formatted when it was first seen. */
  readonly text: string;
}

export interface PushRecord {
  readonly endpoint: string;
  keys: { p256dh: string; auth: string };
  accounts: PushAccount[];
  prefs: NotifyPrefs;
  locale: string;
  timeZone: string | null;
  readonly createdAt: number;
  /** Last time the browser posted this subscription. */
  lastSeen: number;
  /** Per chain: the block height up to which incoming transfers were checked. */
  lastHeights: Record<string, number>;
  /** Notice ids already pushed (or deliberately skipped), newest first. */
  sentIds: string[];
  pendingUnbondings: PendingUnbonding[];
  failures: number;
  lastPushAt: number | null;
}

export type UpsertResult =
  | { ok: true; record: PushRecord; created: boolean }
  | { ok: false; reason: "full" };

function watchedChains(accounts: readonly PushAccount[]): Set<string> {
  return new Set(accounts.map((account) => account.chainId));
}

/**
 * Adds or refreshes the subscription for `request.subscription.endpoint`.
 *
 * Refreshing keeps what the poller learned (heights, sent ids, pending
 * unbondings) for chains still watched, so re-opening the dashboard never
 * replays old transfers; chains no longer watched are forgotten.
 *
 * `replaces` (the browser rotated its subscription, `pushsubscriptionchange`)
 * is the same browser under a new endpoint: what the old record learned moves
 * to the new one. Dropping it would forget pending unbondings and the sent
 * ids that keep a restarted height range from pushing a transfer twice.
 */
export function upsertRecord(
  records: Map<string, PushRecord>,
  request: SubscribeRequest,
  now: number,
): UpsertResult {
  const previous = request.replaces ? records.get(request.replaces) : undefined;
  if (request.replaces) records.delete(request.replaces);
  const endpoint = request.subscription.endpoint;
  const existing = records.get(endpoint);
  const accounts = request.accounts.slice(0, PUSH_STORE_LIMITS.accounts);
  const chains = watchedChains(accounts);
  const watchedAddress = new Set(accounts.map((account) => `${account.chainId}|${account.address}`));
  const keepHeights = (heights: Record<string, number>) =>
    Object.fromEntries(Object.entries(heights).filter(([chainId]) => chains.has(chainId)));
  const keepPending = (pending: readonly PendingUnbonding[]) =>
    pending.filter((entry) => watchedAddress.has(`${entry.chainId}|${entry.address}`));

  if (existing) {
    existing.keys = { ...request.subscription.keys };
    existing.accounts = accounts;
    existing.prefs = request.prefs;
    existing.locale = request.locale;
    existing.timeZone = request.timeZone;
    existing.lastSeen = now;
    existing.failures = 0;
    existing.lastHeights = keepHeights(existing.lastHeights);
    existing.pendingUnbondings = keepPending(existing.pendingUnbondings);
    if (previous) {
      existing.sentIds = [...new Set([...existing.sentIds, ...previous.sentIds])].slice(0, PUSH_STORE_LIMITS.sentIds);
    }
    return { ok: true, record: existing, created: false };
  }

  if (records.size >= PUSH_STORE_LIMITS.subscriptions) {
    pruneStale(records, now);
    if (records.size >= PUSH_STORE_LIMITS.subscriptions) return { ok: false, reason: "full" };
  }
  const record: PushRecord = {
    endpoint,
    keys: { ...request.subscription.keys },
    accounts,
    prefs: request.prefs,
    locale: request.locale,
    timeZone: request.timeZone,
    createdAt: previous?.createdAt ?? now,
    lastSeen: now,
    lastHeights: previous ? keepHeights(previous.lastHeights) : {},
    sentIds: previous ? previous.sentIds.slice(0, PUSH_STORE_LIMITS.sentIds) : [],
    pendingUnbondings: previous ? keepPending(previous.pendingUnbondings) : [],
    failures: 0,
    lastPushAt: previous?.lastPushAt ?? null,
  };
  records.set(endpoint, record);
  return { ok: true, record, created: true };
}

export function hasSent(record: PushRecord, id: string): boolean {
  return record.sentIds.includes(id);
}

/** Records ids as handled, newest first, de-duplicated, capped. */
export function markSent(record: PushRecord, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const fresh = ids.filter((id, index) => ids.indexOf(id) === index);
  record.sentIds = [...fresh, ...record.sentIds.filter((id) => !fresh.includes(id))].slice(
    0,
    PUSH_STORE_LIMITS.sentIds,
  );
}

/** Drops subscriptions the browser has not refreshed in 90 days. Returns how many. */
export function pruneStale(records: Map<string, PushRecord>, now: number): number {
  let removed = 0;
  for (const [endpoint, record] of records) {
    if (now - record.lastSeen > PUSH_STORE_LIMITS.staleMs) {
      records.delete(endpoint);
      removed += 1;
    }
  }
  return removed;
}

/* -------------------------------------------------------------------------- *
 * Persistence shape. Everything read back from disk is validated: the file is
 * ours, but a half-migrated or hand-edited file must not crash the server or
 * smuggle an unchecked endpoint into the sender.
 * -------------------------------------------------------------------------- */

export interface PushStoreFile {
  readonly v: 1;
  readonly savedAt: number;
  readonly subscriptions: readonly PushRecord[];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseAccount(raw: unknown): PushAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return typeof row.chainId === "string" &&
    row.chainId.length <= 64 &&
    typeof row.address === "string" &&
    row.address.length <= 128
    ? { chainId: row.chainId, address: row.address }
    : null;
}

function parsePending(raw: unknown): PendingUnbonding | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return typeof row.id === "string" &&
    typeof row.chainId === "string" &&
    typeof row.address === "string" &&
    finite(row.completesAt) &&
    typeof row.text === "string"
    ? { id: row.id, chainId: row.chainId, address: row.address, completesAt: row.completesAt, text: row.text }
    : null;
}

export function parseRecord(raw: unknown): PushRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const keys = row.keys && typeof row.keys === "object" ? (row.keys as Record<string, unknown>) : {};
  if (!isAllowedPushEndpoint(row.endpoint) || !isP256PublicKey(keys.p256dh) || typeof keys.auth !== "string") {
    return null;
  }
  if (!finite(row.createdAt) || !finite(row.lastSeen)) return null;
  const accounts = Array.isArray(row.accounts)
    ? row.accounts
        .slice(0, PUSH_STORE_LIMITS.accounts)
        .map(parseAccount)
        .filter((account): account is PushAccount => account !== null)
    : [];
  const lastHeights: Record<string, number> = {};
  if (row.lastHeights && typeof row.lastHeights === "object") {
    for (const [chainId, height] of Object.entries(row.lastHeights as Record<string, unknown>)) {
      if (chainId.length <= 64 && finite(height) && height >= 0) lastHeights[chainId] = Math.floor(height);
    }
  }
  return {
    endpoint: row.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    accounts,
    prefs: parseNotifyPrefs(row.prefs),
    locale: typeof row.locale === "string" && row.locale.length <= 35 ? row.locale : "en",
    timeZone: typeof row.timeZone === "string" && row.timeZone.length <= 64 ? row.timeZone : null,
    createdAt: row.createdAt,
    lastSeen: row.lastSeen,
    lastHeights,
    sentIds: Array.isArray(row.sentIds)
      ? row.sentIds
          .filter((id): id is string => typeof id === "string" && id.length <= 300)
          .slice(0, PUSH_STORE_LIMITS.sentIds)
      : [],
    pendingUnbondings: Array.isArray(row.pendingUnbondings)
      ? row.pendingUnbondings
          .slice(0, PUSH_STORE_LIMITS.pendingUnbondings)
          .map(parsePending)
          .filter((entry): entry is PendingUnbonding => entry !== null)
      : [],
    failures: finite(row.failures) && row.failures >= 0 ? Math.floor(row.failures) : 0,
    lastPushAt: finite(row.lastPushAt) ? row.lastPushAt : null,
  };
}

export function parseStoreFile(raw: unknown): Map<string, PushRecord> {
  const records = new Map<string, PushRecord>();
  if (!raw || typeof raw !== "object") return records;
  const list = (raw as Record<string, unknown>).subscriptions;
  if (!Array.isArray(list)) return records;
  for (const entry of list) {
    if (records.size >= PUSH_STORE_LIMITS.subscriptions) break;
    const record = parseRecord(entry);
    if (record) records.set(record.endpoint, record);
  }
  return records;
}

export function serializeStore(records: ReadonlyMap<string, PushRecord>, now: number): string {
  const file: PushStoreFile = { v: 1, savedAt: now, subscriptions: [...records.values()] };
  return JSON.stringify(file);
}
