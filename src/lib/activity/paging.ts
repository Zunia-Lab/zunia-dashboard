/**
 * The client side of activity paging, without React: which rows are on
 * screen after the first page refreshed and older pages were loaded, how far
 * back that list is complete, and whether a date range still needs older
 * pages. `useActivity` (lib/useActivity.ts) is a thin shell around these.
 *
 * Pure and client-safe.
 */

import type { ActivityItem, ActivityPage } from "./types";
import { compareItems } from "./window";

/** One row per account and transaction (a transfer between two of your accounts is two rows). */
export function rowKey(item: Pick<ActivityItem, "chainId" | "address" | "hash">): string {
  return `${item.chainId}:${item.address}:${item.hash}`;
}

/**
 * Every row on screen, newest first: the (possibly refreshed) first page,
 * then the first page as it was when older pages were first asked for (rows
 * a refresh pushed off it would otherwise fall into a gap above the older
 * pages), then the older pages. The first copy of a row wins, so a refreshed
 * row replaces its older reading.
 */
export function mergeLoaded(
  first: ActivityPage | null,
  anchor: readonly ActivityItem[],
  pages: readonly ActivityPage[],
): ActivityItem[] {
  const rows = new Map<string, ActivityItem>();
  const add = (list: readonly ActivityItem[]) => {
    for (const item of list) {
      const key = rowKey(item);
      if (!rows.has(key)) rows.set(key, item);
    }
  };
  if (first) add(first.items);
  add(anchor);
  for (const page of pages) add(page.items);
  return [...rows.values()].sort(compareItems);
}

export interface LoadedExtent {
  /**
   * ISO time the loaded list is complete down to while older rows exist; null
   * when everything the nodes keep is loaded (or nothing is loaded yet).
   */
  loadedUntil: string | null;
  /** With `since`: the loaded list is complete back to it. Always true without `since`. */
  reachedSince: boolean;
}

/**
 * How far back the rows on screen are complete. `lastPage` is the deepest
 * page loaded (the first page when no older one was); `rows` the merged list.
 */
export function loadedExtent(lastPage: ActivityPage | null, rows: readonly ActivityItem[], since: number | null): LoadedExtent {
  const more = lastPage !== null && lastPage.nextCursor !== null;
  const loadedUntil = more ? (lastPage.nextBefore ?? rows[rows.length - 1]?.time ?? null) : null;
  if (since === null) return { loadedUntil, reachedSince: true };
  if (lastPage === null) return { loadedUntil, reachedSince: false };
  if (!more) return { loadedUntil, reachedSince: true };
  const until = loadedUntil === null ? Number.NaN : Date.parse(loadedUntil);
  return { loadedUntil, reachedSince: Number.isFinite(until) && until <= since };
}

export interface AutoLoadInput {
  since: number | null;
  reachedSince: boolean;
  /** A "load more" is in flight. */
  loading: boolean;
  /** The last "load more" failed (the user retries, not a loop). */
  failed: boolean;
  /** Older pages loaded so far for this list. */
  pagesLoaded: number;
  maxPages: number;
  /** The deepest page's cursor. */
  nextCursor: string | null;
  /** The rows on screen belong to the previous scope. */
  stale: boolean;
}

/** Whether a date range should fetch its next older page on its own now. */
export function shouldAutoLoad(input: AutoLoadInput): boolean {
  return (
    input.since !== null &&
    !input.reachedSince &&
    !input.loading &&
    !input.failed &&
    input.pagesLoaded < input.maxPages &&
    input.nextCursor !== null &&
    !input.stale
  );
}
