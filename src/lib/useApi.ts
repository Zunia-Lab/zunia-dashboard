"use client";

/**
 * Client reads of the dashboard's own `/api/*` routes.
 *
 * One store per URL, shared by every component that asks for it, with:
 *
 * - **dedupe**: ten cards reading `/api/portfolio?…` send one request;
 * - **stale-while-revalidate**: a URL seen before renders its last answer at
 *   once and refreshes behind it (memory first, then a short localStorage
 *   copy so a reload paints instantly);
 * - **refetch keeps the frame**: during a refresh `data` stays and
 *   `refreshing` is true, so charts dim instead of flashing a skeleton, and
 *   with `keepPreviousData` a key change (switching the chain scope) keeps the
 *   previous answer on screen, flagged `stale`, until the new one lands;
 * - **polling and focus revalidation**, paused while the tab is hidden;
 * - **server-read first answers** (`initial`): a public page can read a route
 *   on the server and hand the answer down, so its first HTML carries the
 *   data (prices, validators, proposals and the links to their pages) instead
 *   of skeletons, and the client starts from it instead of refetching.
 *
 * Errors are values, never thrown: `status` says which of the four states the
 * read is in, so a page can tell "empty wallet" from "read failed" — the
 * distinction the rest of this codebase is careful about. Their messages are
 * written for the page (`@/lib/api-error`).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { networkError, parseError, readApiError, shapeError, type ApiError } from "@/lib/api-error";
import { clearCopies, readCopy, writeCopy } from "@/lib/api-storage";

export { apiUrl } from "@/lib/api-url";
export type { ApiError } from "@/lib/api-error";

export type ApiStatus = "idle" | "loading" | "ready" | "error";

export interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  status: ApiStatus;
  /** First load for this key with nothing to show yet. */
  loading: boolean;
  /** A request is in flight while `data` is already on screen. */
  refreshing: boolean;
  /** `data` belongs to a previous key (only with `keepPreviousData`). */
  stale: boolean;
  /** Epoch ms of the last successful read. */
  updatedAt: number | null;
  refetch: () => void;
}

/**
 * An answer read on the server for the page's first render. Used only while
 * the hook asks for exactly `url`: another currency, scope or wallet is
 * another URL, and reads as it always did.
 */
export interface ApiInitial {
  /** The URL the client asks for, built with the same `apiUrl` call. */
  url: string;
  /** The route's JSON body, as the route answers it. */
  data: unknown;
  /**
   * When the server read it (its `Date.now()` at render), not the payload's own
   * `updatedAt`: it is what decides whether the client reads again at once.
   */
  at: number;
}

export interface ApiOptions<T> {
  /** Poll interval while the tab is visible. Off by default. */
  refreshMs?: number;
  /** Narrows the JSON body; return null to treat it as unreadable. */
  parse?: (raw: unknown) => T | null;
  /** Keep the previous key's data visible while a new key loads. */
  keepPreviousData?: boolean;
  /** Persist the last answer in localStorage for instant paint (default true). */
  persist?: boolean;
  /** Minimum age before a mount/focus triggers a refetch (default 15 s). */
  dedupeMs?: number;
  /** A server-read answer for the first render (see {@link ApiInitial}). */
  initial?: ApiInitial | null;
}

interface Entry {
  data: unknown;
  error: ApiError | null;
  updatedAt: number | null;
  inflight: Promise<void> | null;
  listeners: Set<() => void>;
  /** Whether answers for this URL may be copied to localStorage. */
  persist: boolean;
  /** Snapshot object handed to React; replaced on every change. */
  snapshot: Snapshot;
}

interface Snapshot {
  data: unknown;
  error: ApiError | null;
  updatedAt: number | null;
  inflight: boolean;
}

const entries = new Map<string, Entry>();

/* -------------------------------------------------------------------------- *
 * The localStorage copy (rules and budget: `@/lib/api-storage`).
 * -------------------------------------------------------------------------- */

/** Whether this page load has swept the copies yet (the first write does). */
let swept = false;
/**
 * Bumped by `clearApiCache`. An answer to a request sent before a clear is not
 * copied to storage: after Disconnect, a read that was already in flight for
 * the departed wallet must not write its balances back.
 */
let clearGeneration = 0;

function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readPersisted(url: string): { data: unknown; at: number } | null {
  const storage = localStore();
  return storage ? readCopy(storage, url) : null;
}

function writePersisted(url: string, data: unknown) {
  const storage = localStore();
  if (!storage) return;
  const sweep = !swept;
  swept = true;
  writeCopy(storage, url, data, { sweep });
}

/* -------------------------------------------------------------------------- *
 * The store.
 * -------------------------------------------------------------------------- */

function entryFor(url: string, persist: boolean): Entry {
  let entry = entries.get(url);
  if (!entry) {
    const persisted = persist && typeof window !== "undefined" ? readPersisted(url) : null;
    entry = {
      data: persisted?.data ?? null,
      error: null,
      updatedAt: persisted?.at ?? null,
      inflight: null,
      listeners: new Set(),
      persist,
      snapshot: {
        data: persisted?.data ?? null,
        error: null,
        updatedAt: persisted?.at ?? null,
        inflight: false,
      },
    };
    entries.set(url, entry);
  }
  return entry;
}

function publish(entry: Entry) {
  entry.snapshot = {
    data: entry.data,
    error: entry.error,
    updatedAt: entry.updatedAt,
    inflight: entry.inflight !== null,
  };
  for (const listener of entry.listeners) listener();
}

function load(url: string, entry: Entry, persist: boolean): Promise<void> {
  if (entry.inflight) return entry.inflight;
  const generation = clearGeneration;
  const run = (async () => {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        entry.error = await readApiError(response);
        return;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch (problem) {
        entry.error = parseError(problem);
        return;
      }
      entry.data = body;
      entry.error = null;
      entry.updatedAt = Date.now();
      if (persist && generation === clearGeneration) writePersisted(url, body);
    } catch (problem) {
      entry.error = networkError(problem);
    } finally {
      entry.inflight = null;
      publish(entry);
    }
  })();
  entry.inflight = run;
  publish(entry);
  return run;
}

/** Re-reads every cached URL that starts with `prefix` (e.g. after a tx). */
export function revalidateApi(prefix: string) {
  for (const [url, entry] of entries) {
    if (url.startsWith(prefix) && entry.listeners.size > 0) {
      void load(url, entry, entry.persist);
    } else if (url.startsWith(prefix)) {
      entry.updatedAt = null;
    }
  }
}

/**
 * Forgets every cached answer (memory and localStorage) whose URL starts with
 * `prefix`, without refetching. Used on disconnect so one wallet's balances
 * never render, even briefly, for the next one; a read still in flight is not
 * copied to storage when it lands.
 */
export function clearApiCache(prefix = "/api/") {
  clearGeneration += 1;
  for (const [url, entry] of entries) {
    if (!url.startsWith(prefix)) continue;
    entry.data = null;
    entry.error = null;
    entry.updatedAt = null;
    if (entry.listeners.size === 0) entries.delete(url);
    else publish(entry);
  }
  const storage = localStore();
  if (storage) clearCopies(storage, prefix);
}

const EMPTY: Snapshot = { data: null, error: null, updatedAt: null, inflight: false };
const noopSubscribe = () => () => {};

export function useApi<T = unknown>(url: string | null, options: ApiOptions<T> = {}): ApiState<T> {
  const { refreshMs, parse, keepPreviousData = false, persist = true, dedupeMs = 15_000, initial } = options;

  // The server-read answer, only for the URL it was read for.
  const seedUrl = initial && url && initial.url === url ? initial.url : null;
  const seedData = seedUrl ? initial?.data : undefined;
  const seedAt = seedUrl ? initial?.at : undefined;
  const seed = useMemo<Snapshot | null>(
    () => (seedUrl && seedData !== undefined && seedData !== null && typeof seedAt === "number" ? { data: seedData, error: null, updatedAt: seedAt, inflight: false } : null),
    [seedUrl, seedData, seedAt],
  );

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!url) return () => {};
      const entry = entryFor(url, persist);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [url, persist],
  );

  // The server never touches the module store (it is shared by every request
  // the process serves): its snapshot is the seed, or nothing.
  const getServerSnapshot = useCallback(() => seed ?? EMPTY, [seed]);
  const stored = useSyncExternalStore(
    url ? subscribe : noopSubscribe,
    () => (url ? entryFor(url, persist).snapshot : EMPTY),
    getServerSnapshot,
  );
  // Until the seed is in the store (first client render of a navigation), it
  // stands in for it, so a server-rendered list never flashes a skeleton.
  const snapshot = stored.data === null && stored.updatedAt === null && seed ? seed : stored;

  // Seed the store before any fetch effect runs (layout effects run first),
  // unless it already holds something as new.
  useLayoutEffect(() => {
    if (!url || !seed) return;
    const entry = entryFor(url, persist);
    if (entry.updatedAt !== null && entry.updatedAt >= (seed.updatedAt ?? 0)) return;
    entry.data = seed.data;
    entry.error = null;
    entry.updatedAt = seed.updatedAt;
    publish(entry);
  }, [url, persist, seed]);

  // Fetch on mount / key change when the cached answer is missing or old.
  useEffect(() => {
    if (!url) return;
    const entry = entryFor(url, persist);
    const age = entry.updatedAt === null ? Infinity : Date.now() - entry.updatedAt;
    if (age > dedupeMs) void load(url, entry, persist);
  }, [url, persist, dedupeMs]);

  // Polling + focus revalidation, paused while hidden.
  useEffect(() => {
    if (!url) return;
    const entry = entryFor(url, persist);
    const revalidate = () => {
      if (document.visibilityState !== "visible") return;
      const age = entry.updatedAt === null ? Infinity : Date.now() - entry.updatedAt;
      if (age > Math.min(dedupeMs, refreshMs ?? dedupeMs)) void load(url, entry, persist);
    };
    const timer = refreshMs ? window.setInterval(revalidate, refreshMs) : undefined;
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      if (timer) window.clearInterval(timer);
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [url, persist, refreshMs, dedupeMs]);

  const refetch = useCallback(() => {
    if (!url) return;
    void load(url, entryFor(url, persist), persist);
  }, [url, persist]);

  // Parse once per payload, not once per render. Callers pass module-level
  // parse functions, so the memo holds across renders.
  const parsed = useMemo<T | null>(() => {
    if (snapshot.data === null || snapshot.data === undefined) return null;
    return parse ? parse(snapshot.data) : (snapshot.data as T);
  }, [snapshot.data, parse]);
  const parseFailed = parsed === null && snapshot.data !== null && snapshot.data !== undefined;

  // Last good answer, kept across key changes for keepPreviousData. Updated
  // with a guarded render-time setState (React's "information from previous
  // renders" pattern) rather than a ref written during render.
  const [previous, setPrevious] = useState<{ url: string; updatedAt: number | null; data: T } | null>(null);
  if (
    keepPreviousData &&
    url &&
    parsed !== null &&
    (previous === null || previous.url !== url || previous.updatedAt !== snapshot.updatedAt)
  ) {
    setPrevious({ url, updatedAt: snapshot.updatedAt, data: parsed });
  }

  if (!url) {
    return {
      data: null,
      error: null,
      status: "idle",
      loading: false,
      refreshing: false,
      stale: false,
      updatedAt: null,
      refetch,
    };
  }

  if (parsed !== null) {
    return {
      data: parsed,
      error: snapshot.error,
      status: "ready",
      loading: false,
      refreshing: snapshot.inflight,
      stale: false,
      updatedAt: snapshot.updatedAt,
      refetch,
    };
  }

  const error: ApiError | null = parseFailed ? shapeError() : snapshot.error;

  if (error && !snapshot.inflight) {
    return {
      data: null,
      error,
      status: "error",
      loading: false,
      refreshing: false,
      stale: false,
      updatedAt: snapshot.updatedAt,
      refetch,
    };
  }

  const keep = keepPreviousData ? previous : null;
  return {
    data: keep?.data ?? null,
    error: null,
    status: "loading",
    loading: keep === null,
    refreshing: keep !== null,
    stale: keep !== null,
    updatedAt: keep?.updatedAt ?? null,
    refetch,
  };
}
