"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Reads a JSON value out of localStorage without a mount effect, so the server
 * render and the first client render agree and no cascading render is needed.
 */
export function useStoredValue<T>(
  key: string,
  fallback: T,
): [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
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
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode or quota; keep the in-memory value */
      }
      for (const listener of listeners) listener();
    },
    [key],
  );

  return [value, set];
}
