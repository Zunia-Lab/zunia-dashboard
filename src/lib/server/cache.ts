/**
 * Process-wide memo for upstream reads.
 *
 * Production is one long-lived Node process behind nginx (zunia-infra
 * docs/hetzner.md), so an in-memory cache is shared by every visitor: a
 * thousand people opening Markets cost one price read per minute, not a
 * thousand. That matters more than speed here — CoinGecko already answers 429
 * to unauthenticated calls from a shared IP, and public LCDs throttle too.
 *
 * Three behaviours, all keyed by a string the caller builds:
 *
 * - **Single flight.** Concurrent callers for the same key share one promise,
 *   so a cold cache under load still sends one request upstream.
 * - **Stale while revalidate.** Past `ttlMs` an entry is still served for up to
 *   `staleMs` more while one background refresh runs. A slow upstream then
 *   costs freshness, never latency.
 * - **Failures are not cached as values.** A rejected load is remembered for
 *   `errorTtlMs` only (short), so an outage is not hammered by every request
 *   but recovers within seconds once the upstream does.
 *
 * The store lives on `globalThis` so Next's dev HMR, which re-evaluates
 * modules, does not drop it on every edit.
 */

import "server-only";

interface Entry<T> {
  value?: T;
  /** Epoch ms after which the value is stale (served, but refreshed). */
  freshUntil: number;
  /** Epoch ms after which the value is dropped. */
  expiresAt: number;
  error?: unknown;
  errorUntil?: number;
  inflight?: Promise<T>;
}

interface Store {
  entries: Map<string, Entry<unknown>>;
}

const GLOBAL_KEY = "__zuniaDashboardCache";
const MAX_ENTRIES = 5_000;

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  let s = g[GLOBAL_KEY];
  if (!s) {
    s = { entries: new Map() };
    g[GLOBAL_KEY] = s;
  }
  return s;
}

/** Drops expired entries, then the oldest ones, once the map is over budget. */
function prune(entries: Map<string, Entry<unknown>>, now: number) {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [key, entry] of entries) {
    if (!entry.inflight && entry.expiresAt < now) entries.delete(key);
  }
  // Map iteration order is insertion order, so this removes the oldest keys.
  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break;
    const entry = entries.get(key);
    if (entry && !entry.inflight) entries.delete(key);
  }
}

export interface CacheOptions {
  /** How long a value is fresh. */
  ttlMs: number;
  /** How long past `ttlMs` a value may still be served while it refreshes. */
  staleMs?: number;
  /** How long a failure is remembered before the next attempt. */
  errorTtlMs?: number;
}

/**
 * Returns the cached value for `key`, loading it with `load` when absent.
 *
 * `load` must be a pure read: it can run in the background after the request
 * that triggered it has already been answered.
 */
export async function cached<T>(
  key: string,
  options: CacheOptions,
  load: () => Promise<T>,
): Promise<T> {
  const { entries } = store();
  const now = Date.now();
  const staleMs = options.staleMs ?? options.ttlMs * 4;
  const errorTtlMs = options.errorTtlMs ?? 5_000;
  const existing = entries.get(key) as Entry<T> | undefined;

  const start = (entry: Entry<T>): Promise<T> => {
    const promise = load().then(
      (value) => {
        const at = Date.now();
        entry.value = value;
        entry.freshUntil = at + options.ttlMs;
        entry.expiresAt = at + options.ttlMs + staleMs;
        entry.error = undefined;
        entry.errorUntil = undefined;
        entry.inflight = undefined;
        return value;
      },
      (error: unknown) => {
        entry.error = error;
        entry.errorUntil = Date.now() + errorTtlMs;
        entry.inflight = undefined;
        throw error;
      },
    );
    entry.inflight = promise;
    // A background refresh that fails must not surface as an unhandled
    // rejection; the next caller sees `entry.error` instead.
    promise.catch(() => {});
    return promise;
  };

  if (existing) {
    const hasValue = existing.value !== undefined && existing.expiresAt > now;
    if (hasValue && existing.freshUntil > now) return existing.value as T;
    if (hasValue) {
      // Stale: answer now, refresh once in the background.
      if (!existing.inflight && !(existing.errorUntil && existing.errorUntil > now)) {
        void start(existing).catch(() => {});
      }
      return existing.value as T;
    }
    if (existing.inflight) return existing.inflight;
    if (existing.errorUntil && existing.errorUntil > now) {
      throw existing.error;
    }
    return start(existing);
  }

  const entry: Entry<T> = { freshUntil: 0, expiresAt: 0 };
  entries.set(key, entry as Entry<unknown>);
  prune(entries, now);
  return start(entry);
}

/** Forgets one key, so the next read goes upstream (used after a broadcast). */
export function invalidate(key: string): void {
  store().entries.delete(key);
}

/** Forgets every key that starts with `prefix`. */
export function invalidatePrefix(prefix: string): void {
  const { entries } = store();
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
