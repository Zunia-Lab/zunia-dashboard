/**
 * Multi-chain activity, read from public LCD tx search.
 *
 * Per account (chain + address) two searches run: `message.sender` (what the
 * account signed) and `transfer.recipient` (what it was paid, including IBC
 * deliveries and rewards). Each page is decoded for that account
 * (lib/activity/decode) with coins named by identity, cached (30 s at the
 * chain's tip, 5 min below it), and merged across accounts by
 * lib/activity/window, which keeps the list complete above the slowest search
 * and pages with per-chain height bounds.
 *
 * Not the Zunia indexer: it stores no amounts, covers six chains and rejects
 * production reads (dash-api report §6). Public nodes are the source; their
 * retention is stated per chain in `coverage`. A public endpoint is often
 * several nodes keeping different windows: retention is probed several times
 * and merged cautiously (`./retention`), and reads of an account's newest page
 * are compared over time, so an account whose nodes answered differently is
 * never called complete (`observeTip`, lib/activity/consistency).
 *
 * Budget per request: the first read of both searches for every account not
 * finished on an earlier page, then at most `MAX_EXTRA_PAGES` more reads while
 * the page is short (a sparse `kinds` filter), none started after
 * `EXTRA_START_MS`, and nothing awaited past `REQUEST_BUDGET_MS`. A read still
 * running at that point is reported as timed out for this answer and keeps
 * going in the background, so its page is cached for the next poll; the
 * answer carries a cursor to continue, never a hang.
 */

import "server-only";
import { cached, invalidate, invalidatePrefix } from "@/lib/server/cache";
import { describeUpstreamError, UpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { identifyDenom, identifyDenoms } from "@/lib/token/identity";
import type { TokenIdentity } from "@/lib/token/types";
import { KeyBudget } from "@/lib/activity/budget";
import { decodeActivity, denomsOf, type DecodeContext } from "@/lib/activity/decode";
import { text, txResponseOf } from "@/lib/activity/events";
import {
  EMPTY_ACCOUNT_CURSOR,
  accountsKey,
  encodeCursor,
  type AccountCursor,
  type ActivityCursor,
} from "@/lib/activity/cursor";
import { observationAfter, tipReadsDisagree, type TipObservation } from "@/lib/activity/consistency";
import { nextRead, readExhausted, SEARCH_PAGE_SIZE, type SearchRead } from "@/lib/activity/tx-search";
import { coverageOf, mergeWindows, type AccountWindow, type MergeResult } from "@/lib/activity/window";
import type { ActivityCoverage, ActivityError, ActivityItem, ActivityKind, ActivityPage } from "@/lib/activity/types";
import { accountFacts } from "./account";
import { canonicalPeer, resolvePeers } from "./channels";
import { nodeRetention } from "./retention";
import { searchPage, type SearchCondition } from "./search";

export interface ActivityAccount {
  chainId: string;
  address: string;
}

export interface ReadActivityInput {
  accounts: ActivityAccount[];
  limit: number;
  kinds: ActivityKind[] | null;
  /** `before=` paging (epoch ms); ignored when `cursor` is given (the cursor carries its own). */
  before: number | null;
  cursor: ActivityCursor | null;
}

/** Every account failed: nothing to answer with. */
export class ActivityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityUnavailableError";
  }
}

/** The catalog lists no REST endpoint for the chain: there is nothing to read. */
class NoEndpointError extends Error {
  constructor() {
    super("The catalog lists no public node for this chain");
    this.name = "NoEndpointError";
  }
}

/** A read that did not finish within this request's budget (it continues in the background). */
class SlowReadError extends Error {
  constructor() {
    super("This chain's node did not answer in time; it is retried on the next refresh");
    this.name = "SlowReadError";
  }
}

const CONDITIONS: readonly SearchCondition[] = ["sender", "recipient"];
const MAX_EXTRA_PAGES = 6;
/** No extra page is started past this. */
const EXTRA_START_MS = 6_000;
/** Nothing is awaited past this; slower reads finish in the background (and land in the cache). */
const REQUEST_BUDGET_MS = 11_000;
const IDENTITY_TIMEOUT_MS = 4_000;
/** Blocks kept clear of a node's pruning edge, which moves while we read. */
const PRUNE_MARGIN = 2_000;
const PRUNE_HINT_TTL_MS = 10 * 60_000;
/** Decoded pages kept in the shared cache, by approximate JSON size (see lib/activity/budget). */
const PAGE_BUDGET_BYTES = 32 * 1024 * 1024;
const PAGE_BUDGET_KEYS = 2_000;

/* -------------------------------------------------------------------------- */
/* Pages                                                                       */
/* -------------------------------------------------------------------------- */

interface DecodedPage {
  items: ActivityItem[];
  /** Block time (ms) of the page's oldest transaction. */
  oldest: number | null;
  /** Lowest block height on the page (where the next keyset read starts). */
  lowestHeight: number | null;
  exhausted: boolean;
  /** The node failed on pruned heights and this page was read above them. */
  pruned: { since: number | null } | null;
  /** Approximate JSON size, for the cache budget. */
  bytes: number;
}

const HINTS_KEY = "__zuniaActivityPruneHints";
const BUDGET_KEY = "__zuniaActivityPageBudget";
const LEDGER_KEY = "__zuniaActivityTipLedger";
/** How long a newest-page observation is compared against, and a disagreement remembered. */
const LEDGER_TTL_MS = 30 * 60_000;
/** The ledger is a safety net, not a store: past this many keys the oldest go. */
const LEDGER_MAX_KEYS = 20_000;
/** A second read of a cold newest page, to compare: late enough to land on another connection. */
const SECOND_READ_DELAY_MS = 750;

/** Chains whose node fails on pruned heights: where to start reading, for a while. */
function pruneHints(): Map<string, { lower: number; since: number | null; until: number }> {
  const g = globalThis as unknown as Record<string, Map<string, { lower: number; since: number | null; until: number }> | undefined>;
  let map = g[HINTS_KEY];
  if (!map) {
    map = new Map();
    g[HINTS_KEY] = map;
  }
  return map;
}

function pageBudget(): KeyBudget {
  const g = globalThis as unknown as Record<string, KeyBudget | undefined>;
  let budget = g[BUDGET_KEY];
  if (!budget) {
    budget = new KeyBudget(PAGE_BUDGET_BYTES, PAGE_BUDGET_KEYS);
    g[BUDGET_KEY] = budget;
  }
  return budget;
}

async function identities(chainId: string, denoms: string[]): Promise<(denom: string) => TokenIdentity> {
  let known = new Map<string, TokenIdentity>();
  if (denoms.length > 0) {
    try {
      known = await identifyDenoms(chainId, denoms, { signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    } catch {
      // Named from the bundled tables only; unknown vouchers stay IBC·XXXX.
    }
  }
  return (denom) => known.get(denom) ?? identifyDenom(chainId, denom);
}

/* -------------------------------------------------------------------------- */
/* Do the nodes agree?                                                         */
/* -------------------------------------------------------------------------- */

interface TipLedger {
  /** Last newest-page observation per account search (and read bound). */
  seen: Map<string, { observation: TipObservation; at: number }>;
  /** Account (chain + address) → until when its nodes are known to disagree. */
  disagree: Map<string, number>;
}

function tipLedger(): TipLedger {
  const g = globalThis as unknown as Record<string, TipLedger | undefined>;
  let ledger = g[LEDGER_KEY];
  if (!ledger) {
    ledger = { seen: new Map(), disagree: new Map() };
    g[LEDGER_KEY] = ledger;
  }
  return ledger;
}

function accountKey(account: ActivityAccount): string {
  return `${account.chainId}:${account.address}`;
}

/**
 * Record one read of an account's newest search page, and flag the account
 * when it contradicts the previous read (lib/activity/consistency.ts): the
 * endpoint's nodes keep different windows, so no answer may claim the
 * account's history complete or date its window by a probe.
 */
function observeTip(account: ActivityAccount, key: string, total: number | null, heights: readonly number[]): void {
  const ledger = tipLedger();
  const now = Date.now();
  const previous = ledger.seen.get(key);
  const live = previous && now - previous.at < LEDGER_TTL_MS ? previous.observation : null;
  const read = { total, heights, pageSize: SEARCH_PAGE_SIZE };
  if (live && tipReadsDisagree(live, read)) ledger.disagree.set(accountKey(account), now + LEDGER_TTL_MS);
  const next = observationAfter(live, read);
  if (next) {
    ledger.seen.delete(key);
    ledger.seen.set(key, { observation: next, at: now });
  }
  for (const map of [ledger.seen, ledger.disagree] as Map<string, unknown>[]) {
    for (const oldest of map.keys()) {
      if (map.size <= LEDGER_MAX_KEYS) break;
      map.delete(oldest);
    }
  }
}

/** Whether this account's nodes were seen to disagree recently. */
function nodesDisagree(account: ActivityAccount): boolean {
  const until = tipLedger().disagree.get(accountKey(account));
  return until !== undefined && until > Date.now();
}

async function rawPage(account: ActivityAccount, condition: SearchCondition, read: SearchRead) {
  const hint = pruneHints().get(account.chainId);
  const active = hint && hint.until > Date.now() ? hint : null;
  const params = { address: account.address, condition, upper: read.upper, page: read.page, lower: active?.lower ?? null };
  const tip = read.upper === null && read.page === 1;
  // Keyed by the read bound too: a prune hint changes `total` without any node disagreeing.
  const tipKey = `${accountKey(account)}:${condition}:${params.lower ?? "-"}`;
  const observe = (found: { txs: Record<string, unknown>[]; total: number | null }) => {
    if (tip) observeTip(account, tipKey, found.total, found.txs.map(heightOf));
  };
  // A newest page nobody has compared yet is read a second time, shortly and
  // in the background, so a disagreement shows on the next refresh instead of
  // only after a second visitor's read half an hour later.
  const compareLater = () => {
    if (!tip || tipLedger().seen.has(tipKey)) return;
    setTimeout(() => {
      void searchPage(account.chainId, params).then(observe, () => undefined);
    }, SECOND_READ_DELAY_MS);
  };
  try {
    compareLater();
    const result = await searchPage(account.chainId, params);
    observe(result);
    return { result, pruned: active ? { since: active.since } : null };
  } catch (error) {
    // Nodes on CometBFT ≤ 0.37 keep the tx index after pruning blocks, so a
    // search whose page reaches a pruned height fails as a whole ("height N
    // is not available, lowest height is M"). Read above the pruning edge.
    if (!(error instanceof UpstreamError && error.kind === "http" && (error.status ?? 0) >= 500) || active) throw error;
    const retention = await nodeRetention(account.chainId);
    if (retention.fromGenesis !== false || retention.lowestHeight === null) throw error;
    const lower = retention.lowestHeight + PRUNE_MARGIN;
    pruneHints().set(account.chainId, { lower, since: retention.lowestTime, until: Date.now() + PRUNE_HINT_TTL_MS });
    return { result: await searchPage(account.chainId, { ...params, lower }), pruned: { since: retention.lowestTime } };
  }
}

function pageKey(account: ActivityAccount, condition: SearchCondition, read: SearchRead): string {
  return `activity:pagev2:${account.chainId}:${account.address}:${condition}:${read.upper ?? "tip"}:${read.page}`;
}

/**
 * One decoded page for one account and search, cached: 30 s at the chain's
 * tip (served at most 10 s past that while it refreshes, so a list is never
 * more than ~40 s behind the chain), 5 min below it (a fixed height range
 * only changes when the node prunes it).
 */
async function decodedPage(account: ActivityAccount, condition: SearchCondition, read: SearchRead): Promise<DecodedPage> {
  const key = pageKey(account, condition, read);
  const tip = read.upper === null;
  const ttlMs = tip ? 30_000 : 5 * 60_000;
  const page = await cached(key, { ttlMs, staleMs: tip ? 10_000 : ttlMs, errorTtlMs: 5_000 }, async (): Promise<DecodedPage> => {
    const { result, pruned } = await rawPage(account, condition, read);
    const txs = [...result.txs].sort((a, b) => heightOf(b) - heightOf(a));
    const denoms = new Set<string>();
    for (const tx of txs) for (const denom of denomsOf(tx, account.address)) denoms.add(denom);
    const identify = await identities(account.chainId, [...denoms]);
    const ctx: DecodeContext = {
      chainId: account.chainId,
      identify,
      channelPeer: (channel) => canonicalPeer(account.chainId, channel),
    };
    const items: ActivityItem[] = [];
    for (const tx of txs) {
      const item = decodeActivity(tx, account.address, ctx);
      if (item) items.push(item);
    }
    let oldest: number | null = null;
    let lowestHeight: number | null = null;
    for (const tx of txs) {
      const time = Date.parse(text(txResponseOf(tx)?.timestamp));
      if (Number.isFinite(time) && (oldest === null || time < oldest)) oldest = time;
      const height = heightOf(tx);
      if (height > 0 && (lowestHeight === null || height < lowestHeight)) lowestHeight = height;
    }
    const fresh: DecodedPage = {
      items,
      oldest,
      lowestHeight,
      exhausted: readExhausted(txs.length, result.total, read.page) || lowestHeight === null,
      pruned,
      bytes: JSON.stringify(items).length,
    };
    return tip && read.page === 1 ? withEarlierTip(account, key, fresh) : fresh;
  });
  for (const evicted of pageBudget().touch(key, page.bytes)) invalidate(evicted);
  return page;
}

/** The newest page each account search last showed, so a node that keeps less cannot make rows vanish. */
const TIPS_KEY = "__zuniaActivityTipPages";
/** Remembered newest pages (two per account); a bounded safety net, not a store. */
const TIP_PAGES_MAX = 2_000;

function tipPages(): Map<string, { page: DecodedPage; at: number }> {
  const g = globalThis as unknown as Record<string, Map<string, { page: DecodedPage; at: number }> | undefined>;
  let map = g[TIPS_KEY];
  if (!map) {
    map = new Map();
    g[TIPS_KEY] = map;
  }
  return map;
}

/**
 * The newest page, merged with the one the previous read showed.
 *
 * Nodes behind one endpoint keep different windows, so the same newest-page
 * search answers 1 row, then 0, then 1 (seen on the Hub, Osmosis and Celestia
 * for one account within seconds). A transaction any node returned is
 * committed — Cosmos chains do not fork — so a row the last read had and this
 * one lacks is kept rather than dropped, and the list stops flickering
 * between polls. The account is flagged as answered differently, which keeps
 * its coverage from claiming anything the list cannot show.
 */
function withEarlierTip(account: ActivityAccount, key: string, fresh: DecodedPage): DecodedPage {
  const pages = tipPages();
  const now = Date.now();
  const earlier = pages.get(key);
  let page = fresh;
  if (earlier && now - earlier.at < LEDGER_TTL_MS) {
    const hashes = new Set(fresh.items.map((item) => item.hash));
    const missing = earlier.page.items.filter((item) => !hashes.has(item.hash));
    if (missing.length > 0) {
      tipLedger().disagree.set(accountKey(account), now + LEDGER_TTL_MS);
      const items = [...fresh.items, ...missing].sort((a, b) => b.height - a.height || a.hash.localeCompare(b.hash));
      const min = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
      page = {
        items,
        oldest: min(fresh.oldest, earlier.page.oldest),
        lowestHeight: min(fresh.lowestHeight, earlier.page.lowestHeight),
        // Older rows may remain on whichever node kept more.
        exhausted: fresh.exhausted && earlier.page.exhausted,
        pruned: fresh.pruned ?? earlier.page.pruned,
        bytes: JSON.stringify(items).length,
      };
    }
  }
  pages.delete(key);
  pages.set(key, { page, at: now });
  for (const oldest of pages.keys()) {
    if (pages.size <= TIP_PAGES_MAX) break;
    pages.delete(oldest);
  }
  return page;
}

function heightOf(tx: Record<string, unknown>): number {
  const height = Number(text(txResponseOf(tx)?.height));
  return Number.isFinite(height) ? height : 0;
}

/** Drops cached pages for an account (after it broadcasts, so its new transaction shows at once). */
export function invalidateActivity(chainId: string, address: string): void {
  const prefix = `activity:pagev2:${chainId}:${address}:`;
  pageBudget().forgetPrefix(prefix);
  invalidatePrefix(prefix);
}

/* -------------------------------------------------------------------------- */
/* One request                                                                 */
/* -------------------------------------------------------------------------- */

interface SearchState {
  condition: SearchCondition;
  pages: DecodedPage[];
  /** The next read (keyset after the first, see lib/activity/tx-search). */
  read: SearchRead;
  exhausted: boolean;
  error: unknown;
}

interface AccountState {
  account: ActivityAccount;
  cursor: AccountCursor;
  searches: SearchState[];
}

/** `promise`, or `SlowReadError` once `deadline` (epoch ms) passes; the promise keeps running. */
function within<T>(promise: Promise<T>, deadline: number, now: () => number): Promise<T> {
  const wait = deadline - now();
  if (wait <= 0) {
    promise.catch(() => undefined);
    return Promise.reject(new SlowReadError());
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SlowReadError()), wait);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** `promise`, or `fallback` once `deadline` passes or when it fails. */
async function settleWithin<T>(promise: Promise<T>, deadline: number, now: () => number, fallback: T): Promise<T> {
  try {
    return await within(promise, deadline, now);
  } catch {
    return fallback;
  }
}

/** Post-processing (peers, coverage facts) gets what is left of the budget, and never less than this. */
const FINISH_GRACE_MS = 1_500;

async function advance(state: AccountState, index: number, deadline: number, now: () => number): Promise<void> {
  const search = state.searches[index];
  if (search.exhausted || search.error !== null) return;
  try {
    const page = await within(decodedPage(state.account, search.condition, search.read), deadline, now);
    search.pages.push(page);
    search.exhausted = page.exhausted;
    if (!page.exhausted && page.lowestHeight !== null) search.read = nextRead(search.read, page.lowestHeight);
  } catch (error) {
    search.error = error;
  }
}

function windowsOf(states: readonly AccountState[]): AccountWindow[] {
  return states.map((state) => ({
    cursor: state.cursor,
    searches: state.searches.map((search) => ({
      items: search.pages.flatMap((page) => page.items),
      oldest: search.pages.length > 0 ? search.pages[search.pages.length - 1].oldest : null,
      exhausted: search.exhausted,
      failed: search.error !== null,
    })),
  }));
}

function reason(error: unknown): string {
  if (error instanceof UpstreamError) return describeUpstreamError(error);
  if (error instanceof NoEndpointError || error instanceof SlowReadError) return error.message;
  return "The chain's node could not be read";
}

function prunedOf(state: AccountState): { since: number | null } | null {
  return state.searches.flatMap((search) => search.pages).find((page) => page.pruned !== null)?.pruned ?? null;
}

async function coverageFor(
  state: AccountState,
  merged: MergeResult,
  index: number,
  finishBy: number,
  now: () => number,
): Promise<ActivityCoverage> {
  const [sender, recipient] = state.searches;
  const failed = sender.error !== null && recipient.error !== null;
  const partial = failed ? null : recipient.error !== null ? "incoming" : sender.error !== null ? "outgoing" : null;
  const { cursor, remaining } = merged.accounts[index];
  const pruned = prunedOf(state);
  const done = !failed && !remaining && pruned === null && partial === null;
  // Facts that cannot be read in time are unknown, which only ever makes the
  // verdict more cautious ("complete" needs them).
  const retention = done ? await settleWithin(nodeRetention(state.account.chainId), finishBy, now, null) : null;
  const account =
    done && retention?.fromGenesis !== true
      ? await settleWithin(accountFacts(state.account.chainId, state.account.address), finishBy, now, null)
      : null;
  return coverageOf({
    chainId: state.account.chainId,
    address: state.account.address,
    failed,
    partial,
    remaining,
    boundary: merged.boundary,
    cursor,
    pruned,
    retention,
    account,
    inconsistent: nodesDisagree(state.account),
  });
}

/** Fills `destChainId` / `sourceChainId` for channels the canonical table does not know. */
async function withPeers(items: ActivityItem[]): Promise<ActivityItem[]> {
  const pairs: Array<{ chainId: string; channel: string }> = [];
  for (const item of items) {
    if (!item.ibc) continue;
    if (item.kind === "ibc-in" && !item.ibc.sourceChainId && item.ibc.destChannel) {
      pairs.push({ chainId: item.chainId, channel: item.ibc.destChannel });
    } else if (!item.ibc.destChainId && item.ibc.sourceChannel && item.kind !== "ibc-in") {
      pairs.push({ chainId: item.chainId, channel: item.ibc.sourceChannel });
    }
  }
  if (pairs.length === 0) return items;
  const peers = await resolvePeers(pairs);
  return items.map((item) => {
    if (!item.ibc) return item;
    if (item.kind === "ibc-in" && !item.ibc.sourceChainId && item.ibc.destChannel) {
      const found = peers.get(`${item.chainId}|${item.ibc.destChannel}`);
      return found ? { ...item, ibc: { ...item.ibc, sourceChainId: found.chainId } } : item;
    }
    if (!item.ibc.destChainId && item.ibc.sourceChannel && item.kind !== "ibc-in") {
      const found = peers.get(`${item.chainId}|${item.ibc.sourceChannel}`);
      return found ? { ...item, ibc: { ...item.ibc, destChainId: found.chainId } } : item;
    }
    return item;
  });
}

export async function readActivity(input: ReadActivityInput, now: () => number = Date.now): Promise<ActivityPage> {
  const started = now();
  const deadline = started + REQUEST_BUDGET_MS;
  const kinds = input.kinds && input.kinds.length > 0 ? new Set(input.kinds) : null;
  const before = input.cursor ? (input.cursor.before ?? null) : input.before;
  const states: AccountState[] = input.accounts.map((account, index) => {
    const cursor = input.cursor?.accounts[index] ?? EMPTY_ACCOUNT_CURSOR;
    return {
      account,
      cursor,
      searches: CONDITIONS.map((condition) => ({
        condition,
        pages: [],
        read: { upper: cursor.upper, page: 1 },
        // A finished account is not read again (its coverage comes from the
        // cursor); a chain without a public node has nothing to read, ever.
        exhausted: cursor.done === true || !restOf(account.chainId),
        error: cursor.done || restOf(account.chainId) ? null : new NoEndpointError(),
      })),
    };
  });

  // Every first read at once; the per-host cap in lib/server/http keeps any
  // one node from seeing more than a handful of them.
  await Promise.all(
    states.flatMap((state) => CONDITIONS.map((_, search) => advance(state, search, deadline, now))),
  );

  let extra = 0;
  let merged = mergeWindows(windowsOf(states), { limit: input.limit, kinds, before });
  while (merged.bottlenecks.length > 0 && extra < MAX_EXTRA_PAGES && now() - started < EXTRA_START_MS) {
    const batch = merged.bottlenecks.slice(0, MAX_EXTRA_PAGES - extra);
    extra += batch.length;
    await Promise.all(batch.map(({ account, search }) => advance(states[account], search, deadline, now)));
    merged = mergeWindows(windowsOf(states), { limit: input.limit, kinds, before });
  }

  const errors: ActivityError[] = [];
  states.forEach((state) => {
    const [sender, recipient] = state.searches;
    const chainId = state.account.chainId;
    if (sender.error !== null && recipient.error !== null) {
      errors.push({ chainId, scope: "history", message: reason(sender.error) });
    } else if (recipient.error !== null) {
      errors.push({ chainId, scope: "incoming", message: reason(recipient.error) });
    } else if (sender.error !== null) {
      errors.push({ chainId, scope: "outgoing", message: reason(sender.error) });
    }
  });
  if (states.length > 0 && states.every((state) => state.searches.every((search) => search.error !== null))) {
    throw new ActivityUnavailableError(errors[0]?.message ?? "No chain could be read");
  }

  const finishBy = Math.max(deadline, now() + FINISH_GRACE_MS);
  const [items, coverage] = await Promise.all([
    settleWithin(withPeers(merged.items), finishBy, now, merged.items),
    Promise.all(states.map((state, index) => coverageFor(state, merged, index, finishBy, now))),
  ]);
  const hasMore = merged.accounts.some((account) => account.remaining);
  // An account read above a pruned node's edge stays readable (not `done`):
  // its coverage must keep saying where the node's window starts, which only
  // a read of that window reports.
  const cursors = merged.accounts.map((account, index) => {
    if (!account.cursor.done || prunedOf(states[index]) === null) return account.cursor;
    const { done: _done, ...rest } = account.cursor;
    void _done;
    return rest;
  });
  const nextCursor = hasMore ? encodeCursor({ key: accountsKey(input.accounts), accounts: cursors, before }) : null;
  const nextBefore = hasMore && merged.boundary !== null ? new Date(merged.boundary).toISOString() : null;

  return {
    updatedAt: now(),
    items,
    coverage,
    nextBefore,
    nextCursor,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
