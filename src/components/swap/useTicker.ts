"use client";

import { useEffect, useState } from "react";

/**
 * `Date.now()`, refreshed every `intervalMs` while `active`: the swap page's
 * one-second clock for a price's 20-second life (the kit's `useNow` ticks
 * every 30 s, right for "2 min ago", too slow for a countdown).
 */
export function useTicker(intervalMs = 1_000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, active]);
  return now;
}
