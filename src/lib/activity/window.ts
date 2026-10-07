/**
 * Merging per-account tx searches into one honest, paged, newest-first list.
 *
 * Every account is read with two searches (`message.sender` and
 * `transfer.recipient`), each a list of pages ordered newest first. A search
 * that has more pages is only known down to the oldest transaction of its last
 * page: below that, the next page may still hold rows. So:
 *
 * - each unfinished search sets a **watermark** (the time its window reaches);
 * - the merged list is complete only above the highest watermark across all
 *   accounts — showing a Hub row from 3 September while an Osmosis search
 *   stopped at 10 September would hide every Osmosis row in between;
 * - rows are then cut at `limit`, keeping every row of the boundary second,
 *   because a block's transactions share one timestamp and the next page
 *   starts strictly below it.
 *
 * What was consumed moves each account's cursor (./cursor) below its oldest
 * consumed height. Rows filtered out by `kinds` still count as consumed, so
 * a filtered view pages forward instead of re-reading them; so do rows newer
 * than `before` in time-paged mode, which is how continuing such a page with
 * its cursor moves down instead of starting over at the tip.
 *
 * Pure. `bottlenecks` tells the server which search to read further when a
 * page came up short.
 */

import type { AccountCursor } from "./cursor";
import type { ActivityCoverage, ActivityItem, ActivityKind } from "./types";

export interface SearchWindow {
  /** Rows of every page read so far for this search. */
  items: ActivityItem[];
  /** Block time (ms) of the oldest row of the last page; null when the search returned nothing. */
  oldest: number | null;
  /** No further page exists. */
  exhausted: boolean;
  /** The read failed; what it returned before failing is kept. */
  failed: boolean;
}

export interface AccountWindow {
  searches: SearchWindow[];
  cursor: AccountCursor;
}

export interface MergeOptions {
  limit: number;
  /** Only these kinds are returned (all when null). */
  kinds: ReadonlySet<ActivityKind> | null;
  /** Only rows strictly older than this (ms); the `before=` paging mode. */
  before: number | null;
}

export interface AccountMerge {
  cursor: AccountCursor;
  /** Rows exist below this page for the account (fetched or not). */
  remaining: boolean;
  /** Rows this page consumed for the account (filtered ones included). */
  consumed: number;
}

export interface MergeResult {
  items: ActivityItem[];
  /**
   * The merged list is complete down to this time (exclusive of what is
   * next); null when nothing is left. Never later than `before`: when the
   * reads have not reached `before` yet it equals `before`, and only the
   * cursor makes progress.
   */
  boundary: number | null;
  /** The highest watermark (ms), -Infinity when every search is finished. */
  watermark: number;
  accounts: AccountMerge[];
  /** Searches whose next page would lower the watermark. */
  bottlenecks: Array<{ account: number; search: number }>;
}

export function timeOf(item: Pick<ActivityItem, "time">): number {
  return Date.parse(item.time);
}

/** Newest first; ties broken by chain, height and hash so the order is stable. */
export function compareItems(a: ActivityItem, b: ActivityItem): number {
  const dt = timeOf(b) - timeOf(a);
  if (dt !== 0) return dt;
  if (a.chainId !== b.chainId) return a.chainId < b.chainId ? -1 : 1;
  if (a.height !== b.height) return b.height - a.height;
  if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1;
  return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
}

function searchWatermark(search: SearchWindow): number {
  if (search.exhausted || search.failed || search.oldest === null) return Number.NEGATIVE_INFINITY;
  return search.oldest;
}

function uniqueRows(window: AccountWindow): ActivityItem[] {
  const byHash = new Map<string, ActivityItem>();
  for (const search of window.searches) {
    for (const item of search.items) {
      if (!byHash.has(item.hash)) byHash.set(item.hash, item);
    }
  }
  return [...byHash.values()].sort(compareItems);
}

export function mergeWindows(windows: readonly AccountWindow[], options: MergeOptions): MergeResult {
  const watermark = windows.reduce(
    (max, window) => Math.max(max, ...window.searches.map(searchWatermark)),
    Number.NEGATIVE_INFINITY,
  );
  const rows = windows.map(uniqueRows);
  const inRange = (item: ActivityItem) => {
    const time = timeOf(item);
    return time > watermark && (options.before === null || time < options.before);
  };

  const candidates = rows
    .flat()
    .filter((item) => inRange(item) && (options.kinds === null || options.kinds.has(item.kind)))
    .sort(compareItems);

  let cut: number | null = null;
  let items = candidates;
  if (candidates.length > options.limit) {
    cut = timeOf(candidates[options.limit - 1]);
    const at = cut;
    items = candidates.filter((item) => timeOf(item) >= at);
  }

  const accounts = windows.map((window, index): AccountMerge => {
    // Used up by this page: every complete row down to the cut, including the
    // ones a kinds filter hid and, in `before` mode, the ones newer than
    // `before` (skipped for good, so the cursor moves below them).
    const consumed = rows[index].filter((item) => {
      const time = timeOf(item);
      return time > watermark && (cut === null || time >= cut);
    });
    const consumedHashes = new Set(consumed.map((item) => item.hash));
    const left = rows[index].some(
      (item) => !consumedHashes.has(item.hash) && (options.before === null || timeOf(item) < options.before),
    );
    // A failed search is not finished: the next page tries it again (unless
    // the caller marked it exhausted too: a chain with nothing to read).
    const open = window.searches.some((search) => !search.exhausted);
    const remaining = left || open;
    // Finished for good: both searches reached the node's end and every row
    // is consumed. Later pages do not read it again.
    const done = !remaining && window.searches.every((search) => !search.failed);
    let cursor = advance(window.cursor, consumed);
    // Moving the bound past rows while one search was unreadable may have
    // stepped over that search's rows: remembered, so coverage says so on
    // every later page instead of only this one.
    if (consumed.length > 0 && window.searches.some((search) => search.failed)) cursor = { ...cursor, gapped: true };
    return { cursor: done ? { ...cursor, done: true } : cursor, remaining, consumed: consumed.length };
  });

  const reached = cut ?? (Number.isFinite(watermark) ? watermark : null);
  const boundary = reached !== null && options.before !== null ? Math.min(reached, options.before) : reached;
  const bottlenecks: MergeResult["bottlenecks"] = [];
  if (cut === null && Number.isFinite(watermark)) {
    windows.forEach((window, account) =>
      window.searches.forEach((search, index) => {
        if (searchWatermark(search) === watermark) bottlenecks.push({ account, search: index });
      }),
    );
  }

  return { items, boundary: accounts.some((account) => account.remaining) ? boundary : null, watermark, accounts, bottlenecks };
}

function advance(cursor: AccountCursor, consumed: readonly ActivityItem[]): AccountCursor {
  if (consumed.length === 0) return cursor;
  let minHeight = Number.POSITIVE_INFINITY;
  let oldest: ActivityItem | null = null;
  let signed = 0;
  for (const item of consumed) {
    if (item.height < minHeight) minHeight = item.height;
    if (oldest === null || compareItems(item, oldest) > 0) oldest = item;
    if (item.signed) signed += 1;
  }
  const oldestTime = oldest ? timeOf(oldest) : null;
  const older = oldestTime !== null && (cursor.oldest === null || oldestTime < cursor.oldest);
  return {
    upper: Math.max(0, minHeight - 1),
    oldest: older ? oldestTime : cursor.oldest,
    oldestSigned: older ? Boolean(oldest?.signed) : cursor.oldestSigned,
    signedSeen: cursor.signedSeen + signed,
    ...(cursor.gapped ? { gapped: true } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                    */
/* -------------------------------------------------------------------------- */

/** How much of the chain the node keeps, from the retention probe. */
export interface RetentionFacts {
  /** The node has block 1. Null when unknown. */
  fromGenesis: boolean | null;
  /** Time of the oldest block the node keeps (ms), when known. */
  lowestTime: number | null;
  /**
   * The probes reached nodes keeping different windows (one public endpoint,
   * several nodes behind it). `fromGenesis` and `lowestTime` are then the
   * most cautious of their answers: the window every one of them keeps.
   */
  mixed?: boolean;
}

/** The account's on-chain record, from `/cosmos/auth/v1beta1/accounts/{address}`. */
export interface AccountFacts {
  /** False when the chain has never seen the account. Null when unknown. */
  exists: boolean | null;
  /** Transactions the account has signed, ever. Null when unknown. */
  sequence: number | null;
}

export interface CoverageInput {
  chainId: string;
  address: string;
  /** Neither search could be read. */
  failed: boolean;
  /** One of the two searches failed: `incoming` (transfers to the account) or `outgoing`. */
  partial: "incoming" | "outgoing" | null;
  /** Rows remain below this page. */
  remaining: boolean;
  /** The merged page's boundary (ms). */
  boundary: number | null;
  cursor: AccountCursor;
  /**
   * The node failed on pruned heights and the read was bounded above them;
   * `since` is when the served window starts (ms), when known.
   */
  pruned: { since: number | null } | null;
  retention: RetentionFacts | null;
  account: AccountFacts | null;
  /**
   * Two reads of this account's newest page were answered by nodes keeping
   * different windows (lib/activity/consistency.ts). Nothing about the
   * account's older history can then be claimed: the probe that dates a
   * window, and every page of the search, may each have reached another node.
   */
  inconsistent?: boolean;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * The coverage verdict for one account after a page.
 *
 * `complete` is claimed only with evidence: the node keeps the chain from
 * genesis; or the chain has never seen the account; or the node's window
 * starts before the oldest transaction found, that transaction is one the
 * account received (the funding transfer, not a spend of older funds), and
 * every transaction the account ever signed (its sequence) is in the window.
 */
export function coverageOf(input: CoverageInput): ActivityCoverage {
  const base = { chainId: input.chainId, address: input.address };
  if (input.failed) {
    return { ...base, oldest: null, complete: false, note: "History could not be read from this chain's node." };
  }
  const partialNote =
    input.partial === "incoming"
      ? "Incoming transfers could not be read; the list may miss some."
      : input.partial === "outgoing"
        ? "Transactions you signed could not be read; the list may miss some."
        : null;

  const gapNote = input.cursor.gapped
    ? "Part of this chain's history could not be read while loading older pages; refresh to read it again."
    : null;

  if (input.remaining) {
    const oldest = input.boundary ?? input.cursor.oldest;
    const note = partialNote ?? gapNote;
    return { ...base, oldest: iso(oldest), complete: false, ...(note ? { note } : {}) };
  }

  const { cursor, retention, account } = input;
  if (gapNote) {
    return { ...base, oldest: iso(cursor.oldest), complete: false, note: gapNote };
  }
  if (input.inconsistent) {
    // The list's own oldest row is the only edge that is not another node's
    // claim; "complete" and a probed start date are both off the table.
    return {
      ...base,
      oldest: iso(cursor.oldest),
      complete: false,
      note:
        partialNote ??
        "This chain's public nodes answered differently for your account (they keep different amounts of history); older transactions may be missing.",
    };
  }
  if (input.pruned !== null) {
    const since = input.pruned.since;
    return {
      ...base,
      oldest: iso(since ?? cursor.oldest),
      complete: false,
      note: partialNote ?? (since !== null ? `This node only serves history since ${isoDate(since)}.` : "This node does not serve older history."),
    };
  }
  if (partialNote) {
    return { ...base, oldest: iso(cursor.oldest), complete: false, note: partialNote };
  }
  if (retention?.fromGenesis === true) {
    return { ...base, oldest: iso(cursor.oldest), complete: true };
  }
  if (account?.exists === false && cursor.oldest === null) {
    return { ...base, oldest: null, complete: true };
  }
  if (
    retention?.lowestTime !== null &&
    retention?.lowestTime !== undefined &&
    cursor.oldest !== null &&
    cursor.oldest > retention.lowestTime &&
    !cursor.oldestSigned &&
    account?.sequence !== null &&
    account?.sequence !== undefined &&
    cursor.signedSeen >= account.sequence
  ) {
    return { ...base, oldest: iso(cursor.oldest), complete: true };
  }
  // Nodes behind one load balancer keep different windows: when rows older
  // than the probed window came back, the probe's date would contradict the
  // list, so the list's own oldest row is the honest edge.
  const since = retention?.lowestTime ?? null;
  const probed = since !== null && (cursor.oldest === null || cursor.oldest >= since);
  return {
    ...base,
    oldest: iso(probed ? since : cursor.oldest),
    complete: false,
    note: probed
      ? retention?.mixed
        ? `This chain's public nodes keep different windows; every one of them keeps history since ${isoDate(since)}.`
        : `This node keeps history since ${isoDate(since)}.`
      : "Older history may be missing: this chain's public nodes keep a limited window.",
  };
}
