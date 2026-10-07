"use client";

/**
 * When a figure was read, for a SourceTag.
 *
 * The kit's relative times run on one shared clock that ticks every 30 s, so
 * an answer that landed after the last tick carries a time slightly ahead of
 * that clock and would read "in under a minute". A read time is never in the
 * future: clamp it to the clock.
 */

import { useNow } from "@/components/ui";

export function clampToNow(at: number | null | undefined, now: number | null): number | null {
  if (at === null || at === undefined || !Number.isFinite(at)) return null;
  return now !== null && at > now ? now : at;
}

/** `clampToNow` against the shared clock. */
export function useReadAt(at: number | null | undefined): number | null {
  return clampToNow(at, useNow());
}
