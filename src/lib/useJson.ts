"use client";

import { useEffect, useMemo, useState } from "react";

/** Why a read produced no payload. Rendered by the caller, never swallowed. */
export interface JsonError {
  kind: "http" | "network" | "parse";
  /** Present when a response arrived; absent when the request never landed. */
  status?: number;
  message: string;
}

export interface JsonState<T> {
  data: T | null;
  error: JsonError | null;
  loading: boolean;
}

const IDLE: JsonState<never> = { data: null, error: null, loading: false };

const CACHE_PREFIX = "zunia.dashboard.json.v1:";
const CACHE_TTL_MS = 60_000;

type CacheRecord<T> = { at: number; data: T };

function readCache<T>(url: string): T | null {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + url);
    if (!raw) return null;
    const record = JSON.parse(raw) as CacheRecord<T>;
    if (!record || typeof record.at !== "number") return null;
    if (Date.now() - record.at > CACHE_TTL_MS) return null;
    return record.data;
  } catch {
    return null;
  }
}

function writeCache<T>(url: string, data: T): void {
  try {
    const record: CacheRecord<T> = { at: Date.now(), data };
    window.localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(record));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Fetches JSON for a url and reports which of the three outcomes happened.
 * Passing null skips the request, which is how callers wait for a connection.
 *
 * Fresh localStorage hits render immediately and revalidate in the background
 * so navigating between pages does not reload the same payload twice.
 */
export function useJsonState<T>(url: string | null): JsonState<T> {
  const [entry, setEntry] = useState<{
    url: string;
    state: JsonState<T>;
  } | null>(null);

  /**
   * What to show for a url whose fetch has not settled yet: a fresh cache hit
   * if there is one, otherwise nothing plus loading. Computed during render
   * rather than seeded by a setState in the effect body, which cost a second
   * render pass on every navigation (react-hooks/set-state-in-effect).
   */
  const pending = useMemo<JsonState<T>>(() => {
    if (!url || typeof window === "undefined") {
      return { data: null, error: null, loading: Boolean(url) };
    }
    return { data: readCache<T>(url), error: null, loading: true };
  }, [url]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    const cached = readCache<T>(url);

    const settle = (state: JsonState<T>) => {
      if (cancelled) return;
      if (state.data !== null) writeCache(url, state.data);
      setEntry({ url, state });
    };

    void fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          settle({
            data: cached,
            error: {
              kind: "http",
              status: response.status,
              message: `Request failed with HTTP ${response.status}`,
            },
            loading: false,
          });
          return;
        }
        try {
          settle({
            data: (await response.json()) as T,
            error: null,
            loading: false,
          });
        } catch {
          settle({
            data: cached,
            error: { kind: "parse", message: "Response was not JSON" },
            loading: false,
          });
        }
      })
      .catch((err: unknown) => {
        settle({
          data: cached,
          error: {
            kind: "network",
            message: err instanceof Error ? err.message : "Request failed",
          },
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url) return IDLE;
  return entry?.url === url ? entry.state : pending;
}

/**
 * Payload, or `onError` once the read has failed, or null while it is in
 * flight. Prefer useJsonState: this shape cannot tell the caller whether it
 * holds a live answer or the fallback.
 */
export function useJson<T>(url: string | null, onError?: T): T | null {
  const { data, error } = useJsonState<T>(url);
  if (data !== null) return data;
  if (error !== null && onError !== undefined) return onError;
  return null;
}
