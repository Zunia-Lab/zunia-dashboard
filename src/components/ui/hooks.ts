"use client";

/**
 * Small hooks the kit shares. All of them read browser state through
 * `useSyncExternalStore`, so the server render and the hydrating render agree
 * (each has an explicit server value) and nothing needs a mount effect that
 * sets state, which the React Compiler lint rules forbid.
 */

import { useCallback, useSyncExternalStore, type Ref, type RefObject } from "react";

/* -------------------------------------------------------------- media */

/**
 * Whether a media query matches. `serverValue` is what the server render (and
 * the hydrating client render) assume; pick the layout that should paint
 * first.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Phones: under the 640px breakpoint (spec §2). */
export const PHONE_QUERY = "(max-width: 639px)";

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

/** True when the user asked the OS for less motion: no tweens, no shimmer. */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/* -------------------------------------------------------------- clock */

/**
 * One shared clock for every relative time on screen.
 *
 * A single 30 s interval serves all subscribers (a table of 200 "2 min ago"
 * cells is one timer, not 200), and every cell reads the same "now", so two
 * rows stamped the same second never disagree. The value refreshes lazily on
 * read when it is older than a tick, so a component mounting between ticks
 * does not start from a stale minute.
 */
const TICK_MS = 30_000;
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function readClock(): number {
  const current = Date.now();
  if (current - clockNow >= TICK_MS) clockNow = current;
  return clockNow;
}

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, TICK_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/**
 * Epoch ms, refreshed every 30 s. Null during the server render and the
 * hydrating render: "now" differs between the two machines, so components
 * render a stable fallback first and the relative text right after.
 */
export function useNow(): number | null {
  return useSyncExternalStore<number | null>(subscribeClock, readClock, () => null);
}

/* -------------------------------------------------------------- refs */

/** Sets a callback or object ref. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as RefObject<T | null>).current = value;
}

/** One callback ref that feeds several refs (a forwarded one and our own). */
export function composeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) assignRef(ref, node);
  };
}
