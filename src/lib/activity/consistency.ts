/**
 * Telling when a chain's public nodes disagree about an account's history.
 *
 * A public LCD is usually a load balancer in front of several nodes, and they
 * keep different windows: two reads of the same Osmosis account seconds apart
 * returned 2 and then 14 sends in 30 days, and both answers claimed the range
 * was complete — the retention probe that dates "complete" had reached a node
 * keeping months, the search a node keeping days. No single answer shows this;
 * two answers to the same question do.
 *
 * The question compared is the account's newest search page, whose `total` is
 * how many matching transactions the answering node indexes. Between two reads
 * minutes apart that number can only grow, and only by transactions newer
 * than everything the first read saw. A total that shrank, or grew by more
 * than the new transactions on the page, came from a node with a different
 * window. Pure, so the rule is tested on its own (`__tests__/consistency.test.ts`);
 * the server keeps the observations (src/lib/server/activity/history.ts).
 */

/** What one read of an account's newest search page showed. */
export interface TipObservation {
  /** Matching transactions the answering node indexes. */
  readonly total: number;
  /** Highest block height on the page (0 when it was empty). */
  readonly maxHeight: number;
}

/** A later read of the same newest page. */
export interface TipRead {
  /** The node's `total`; `null` when it did not say. */
  readonly total: number | null;
  /** Block heights of the page's transactions. */
  readonly heights: readonly number[];
  /** The search's page size: a page this full may hide more new transactions. */
  readonly pageSize: number;
}

/** Whether `next` contradicts `previous`: the two reads were answered by nodes keeping different windows. */
export function tipReadsDisagree(previous: TipObservation, next: TipRead): boolean {
  if (next.total === null) return false;
  // History is not lost in minutes: fewer matches means a node that keeps less.
  if (next.total < previous.total) return true;
  const newer = next.heights.filter((height) => height > previous.maxHeight).length;
  // A full page of new transactions cannot say how many more arrived.
  if (next.heights.length >= next.pageSize && newer === next.heights.length) return false;
  // More matches than new transactions: the earlier node was missing older ones.
  return next.total > previous.total + newer;
}

/** The observation to keep after `next` (the highest height either read saw). */
export function observationAfter(previous: TipObservation | null, next: TipRead): TipObservation | null {
  if (next.total === null) return previous;
  const maxHeight = Math.max(previous?.maxHeight ?? 0, ...next.heights, 0);
  return { total: next.total, maxHeight };
}
