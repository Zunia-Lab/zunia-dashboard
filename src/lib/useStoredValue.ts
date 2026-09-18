"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

type Listener = () => void;

/** Per-key listeners so a currency write does not thrash every subscriber. */
const listenersByKey = new Map<string, Set<Listener>>();
/** Cache getSnapshot results so React can Object.is-bail when nothing changed. */
const snapshotCache = new Map<string, string | null>();

function subscribeKey(key: string, listener: Listener) {
  let set = listenersByKey.get(key);
  if (!set) {
    set = new Set();
    listenersByKey.set(key, set);
  }
  set.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key !== key && event.key !== null) return;
    snapshotCache.delete(key);
    listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    set!.delete(listener);
    if (set!.size === 0) listenersByKey.delete(key);
    window.removeEventListener("storage", onStorage);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getSnapshot(key: string): string | null {
  const next = readRaw(key);
  if (snapshotCache.has(key) && snapshotCache.get(key) === next) {
    return snapshotCache.get(key)!;
  }
  snapshotCache.set(key, next);
  return next;
}

function emit(key: string) {
  snapshotCache.delete(key);
  const set = listenersByKey.get(key);
  if (!set) return;
  for (const listener of set) listener();
}

export type StoredUpdater<T> = T | ((prev: T) => T);

/**
 * Reads a JSON value out of localStorage without a mount effect, so the server
 * render and the first client render agree and no cascading render is needed.
 * Supports functional updaters so rapid toggles cannot clobber each other.
 */
export function useStoredValue<T>(
  key: string,
  fallback: T,
): [T, (next: StoredUpdater<T>) => void] {
  const raw = useSyncExternalStore(
    (listener) => subscribeKey(key, listener),
    () => getSnapshot(key),
    () => null,
  );

  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
    // `fallback` is intentionally excluded: inline literals would rebuild the
    // value on every render and defeat the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const set = useCallback(
    (next: StoredUpdater<T>) => {
      const current = (() => {
        const stored = readRaw(key);
        if (stored === null) return fallback;
        try {
          return JSON.parse(stored) as T;
        } catch {
          return fallback;
        }
      })();
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(current)
          : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* private mode or quota; still notify so in-tab UI can recover */
      }
      emit(key);
    },
    // fallback is stable for module-level constants used by callers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return [value, set];
}
