"use client";

/**
 * The market watchlist: asset keys the viewer starred, kept in this browser
 * only (`localStorage`, key `zunia.dashboard.watchlist`). Nothing about it
 * leaves the device, and it works without a wallet.
 *
 * The stored value is someone's old JSON, or a hand-edited one: it is read
 * defensively (strings that look like asset keys, deduplicated, capped), so
 * a bad entry costs that entry, never the page.
 */

import { useCallback, useMemo } from "react";
import { useStoredValue } from "@/lib/useStoredValue";

export const WATCHLIST_KEY = "zunia.dashboard.watchlist";

/** More stars than any table shows on one screen; keeps the stored value small. */
export const WATCHLIST_MAX = 200;

const ASSET_KEY = /^[^:\s]{1,64}:[A-Za-z0-9/:._-]{1,200}$/;

const EMPTY: string[] = [];

/** The keys a stored value holds, in the order they were starred. */
export function readWatchlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !ASSET_KEY.test(entry) || out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= WATCHLIST_MAX) break;
  }
  return out;
}

/** The list with `key` added (at the end) or removed. */
export function toggleWatch(list: readonly string[], key: string): string[] {
  if (list.includes(key)) return list.filter((entry) => entry !== key);
  if (!ASSET_KEY.test(key)) return [...list];
  return [...list, key].slice(-WATCHLIST_MAX);
}

export interface Watchlist {
  keys: string[];
  set: ReadonlySet<string>;
  has: (key: string) => boolean;
  toggle: (key: string) => void;
}

export function useWatchlist(): Watchlist {
  const [raw, setRaw] = useStoredValue<unknown>(WATCHLIST_KEY, EMPTY);
  const keys = useMemo(() => readWatchlist(raw), [raw]);
  const set = useMemo(() => new Set(keys), [keys]);
  const has = useCallback((key: string) => set.has(key), [set]);
  const toggle = useCallback((key: string) => setRaw((current: unknown) => toggleWatch(readWatchlist(current), key)), [setRaw]);
  return { keys, set, has, toggle };
}
