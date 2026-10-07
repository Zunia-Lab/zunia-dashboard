/**
 * The Activity pages' view model: date ranges, the filters a URL can carry,
 * coverage in words, the chart's honest time window, day headings, per-row
 * amount legs and the small sums the cards print.
 *
 * Pure (no React, no I/O, no chain catalog) so node:test covers it; the
 * components in this folder only lay these results out. The analytics proper
 * (counts, fees, flows, CSV) live in `@/lib/activity/analytics`.
 */

import {
  ACTIVITY_GROUPS,
  bucketStart,
  feeSummary,
  groupOf,
  type ActivityGroup,
  type Bucket,
  type FeeToken,
  type PriceMap,
} from "@/lib/activity/analytics";
import { isActivityKind, type ActivityCoverage, type ActivityItem, type TxMovement, type TxPacket } from "@/lib/activity/types";
import { formatDate } from "@/lib/format";
import type { RoutePlanWire } from "@/lib/interchain/wire";
import { maskAmounts } from "@/lib/notifications/text";
import { cleanChainLog, explainTxError, type ExplainedTxError, type TxErrorKind } from "@/lib/tx/errors";
import type { TokenIdentity } from "@/lib/token/types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Date ranges                                                                 */
/* -------------------------------------------------------------------------- */

export const RANGE_KEYS = ["7d", "30d", "90d", "all"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

/**
 * Thirty days by default: long enough to hold a month of habits (the strip's
 * per-day rate means something), short enough that a busy account is complete
 * after a few pages instead of walking the node's whole window on every visit.
 */
export const DEFAULT_RANGE: RangeKey = "30d";

const RANGE_DAYS: Readonly<Record<RangeKey, number | null>> = { "7d": 7, "30d": 30, "90d": 90, all: null };

export const RANGE_LABELS: Readonly<Record<RangeKey, string>> = { "7d": "7D", "30d": "30D", "90d": "90D", all: "All" };

/** "the last 30 days" / "all loaded history", for captions. */
export function rangePhrase(range: RangeKey): string {
  const days = RANGE_DAYS[range];
  return days === null ? "all loaded history" : `the last ${days} days`;
}

/**
 * Epoch ms a range starts at, floored to the minute so it stays the same for
 * a whole minute of renders (the activity hook keys its auto-loading on it).
 * Null for "All", and while the clock is unknown (server and hydrating render).
 */
export function rangeSince(range: RangeKey, now: number | null): number | null {
  const days = RANGE_DAYS[range];
  if (days === null || now === null || !Number.isFinite(now)) return null;
  return Math.floor((now - days * DAY_MS) / MINUTE_MS) * MINUTE_MS;
}

/**
 * Start of the period just before the range, of the same length (the last 30
 * days are compared with the 30 before them). Null for "All" and while the
 * range start is unknown.
 */
export function previousSince(range: RangeKey, since: number | null): number | null {
  const days = RANGE_DAYS[range];
  if (days === null || since === null || !Number.isFinite(since)) return null;
  return since - days * DAY_MS;
}

/* -------------------------------------------------------------------------- */
/* Filters in the URL                                                          */
/* -------------------------------------------------------------------------- */

export interface ActivityFilters {
  range: RangeKey;
  /** Chip groups to keep; empty means every group. */
  groups: ActivityGroup[];
  failedOnly: boolean;
  /** Free text over hash, addresses, memo and the row's sentence. */
  query: string;
  /**
   * One asset's identity key (`cosmoshub-4:uatom`): only rows that moved it.
   * The asset pages link here with it. Exact where the search is loose: an
   * unproven voucher can carry the ticker "ATOM", never the Hub's key.
   */
  asset: string | null;
}

export const DEFAULT_FILTERS: ActivityFilters = { range: DEFAULT_RANGE, groups: [], failedOnly: false, query: "", asset: null };

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const MAX_QUERY = 128;

/** Longest identity key `asset=` takes: a chain id and a denom (128 at most on Cosmos). */
const MAX_ASSET_KEY = 256;
/** `chainId:denom`, the shape of every identity key; the denom part may hold `/` and `:` (`ibc/…`, `factory/…`). */
const ASSET_KEY = /^[A-Za-z0-9._-]+:[A-Za-z0-9/:._-]+$/;

/** An identity key from the URL, or null for anything that cannot be one (matched exactly, never loosely). */
function parseAssetKey(value: string | undefined): string | null {
  const key = (value ?? "").trim();
  return key.length <= MAX_ASSET_KEY && ASSET_KEY.test(key) ? key : null;
}

/**
 * Filters from the page's search params. Lenient on purpose, because other
 * pages link here: `kind=` takes chip groups (`swaps`, `ibc`) and single kinds
 * (`swap`, `ibc-out`, read as their group), `failed` both as `failed=1` and as
 * a kind (the spec's "Failed" chip), and `asset=` an identity key. Unknown
 * values are dropped.
 */
export function parseFilters(params: SearchParams): ActivityFilters {
  const rawRange = first(params.range)?.toLowerCase();
  const range = (RANGE_KEYS as readonly string[]).includes(rawRange ?? "") ? (rawRange as RangeKey) : DEFAULT_RANGE;

  const groups = new Set<ActivityGroup>();
  let failedOnly = ["1", "true", "yes"].includes(first(params.failed)?.toLowerCase() ?? "");
  const kinds = [params.kind, params.kinds].flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []));
  for (const token of kinds.flatMap((value) => value.split(","))) {
    const name = token.trim().toLowerCase();
    if (!name) continue;
    if (name === "failed") failedOnly = true;
    else if ((ACTIVITY_GROUPS as readonly string[]).includes(name)) groups.add(name as ActivityGroup);
    else if (isActivityKind(name)) groups.add(groupOf(name));
  }

  const query = (first(params.q) ?? "").trim().slice(0, MAX_QUERY);
  // Kept in the chips' order, so the URL a filter produces is stable.
  return { range, groups: ACTIVITY_GROUPS.filter((group) => groups.has(group)), failedOnly, query, asset: parseAssetKey(first(params.asset)) };
}

/** Filters from a query string (`?range=7d&kind=swaps&kind=ibc`), a repeated key read as its list. */
export function filtersFromSearch(search: string): ActivityFilters {
  const params = new URLSearchParams(search);
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length > 1 ? values : values[0];
  }
  return parseFilters(record);
}

/** The query string for `filters` ("" when every filter is at its default), defaults left out. */
export function filtersToSearch(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  if (filters.range !== DEFAULT_RANGE) params.set("range", filters.range);
  const groups = ACTIVITY_GROUPS.filter((group) => filters.groups.includes(group));
  if (groups.length > 0 && groups.length < ACTIVITY_GROUPS.length) params.set("kind", groups.join(","));
  if (filters.failedOnly) params.set("failed", "1");
  if (filters.asset) params.set("asset", filters.asset);
  const query = filters.query.trim().slice(0, MAX_QUERY);
  if (query) params.set("q", query);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * A second `#` line for the CSV export saying which slice it holds ("last 30
 * days; types: Swaps, IBC; failed only; asset: ATOM (cosmoshub-4:uatom);
 * search: osmo1…"), so a file read a month later still says what it is. Like
 * the coverage line it carries no separator, quote or line break, so no CSV
 * reader splits or quotes it. `assetName` is the asset's ticker, when known.
 */
export function csvViewLine(filters: ActivityFilters, labels: Readonly<Record<ActivityGroup, string>>, assetName?: string | null): string {
  const clean = (value: string) => value.replace(/[",;\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = [filters.range === "all" ? "all loaded history" : `last ${RANGE_DAYS[filters.range]} days`];
  if (filters.groups.length > 0) parts.push(`types: ${filters.groups.map((group) => labels[group]).join(" + ")}`);
  if (filters.failedOnly) parts.push("failed only");
  if (filters.asset) {
    const name = assetName ? clean(assetName).slice(0, 40) : "";
    parts.push(`asset: ${name ? `${name} (${clean(filters.asset)})` : clean(filters.asset)}`);
  }
  const query = clean(filters.query).slice(0, 80);
  if (query) parts.push(`search: ${query}`);
  return `# view: ${parts.join("; ")}`;
}

/** `csv` with `line` inserted after its first line (the coverage comment). */
export function withSecondLine(csv: string, line: string): string {
  const end = csv.indexOf("\r\n");
  return end === -1 ? `${csv}\r\n${line}` : `${csv.slice(0, end)}\r\n${line}${csv.slice(end)}`;
}

/** Whether any filter narrows the rows (the range does not count: it is a window, not a filter). */
export function hasNarrowingFilters(filters: ActivityFilters): boolean {
  return filters.groups.length > 0 || filters.failedOnly || filters.query.trim().length > 0 || filters.asset !== null;
}

/**
 * Whether a row moved the asset `key` (an amount of it went in or out), the
 * same test the asset page's own activity card makes. A fee paid in it does
 * not count: on the Hub that would be every transaction, votes included.
 */
export function movesAsset(item: Pick<ActivityItem, "amounts">, key: string): boolean {
  return item.amounts.some((amount) => amount.identity.key === key);
}

/** The identity the loaded rows know for `key` (its ticker and logo for the filter chip), or null. */
export function assetIdentityIn(items: readonly Pick<ActivityItem, "amounts">[], key: string): TokenIdentity | null {
  for (const item of items) {
    for (const amount of item.amounts) if (amount.identity.key === key) return amount.identity;
  }
  return null;
}

/**
 * A name for an asset no loaded row holds yet: the denom part of its key,
 * shortened ("uatom", "ibc/27394F…"). The chip must still say what it filters.
 */
export function assetKeyLabel(key: string): string {
  const separator = key.indexOf(":");
  const denom = separator === -1 ? key : key.slice(separator + 1);
  return denom.length > 14 ? `${denom.slice(0, 11)}…` : denom;
}

/**
 * The chip group's next selection. "All" is a chip of its own that means no
 * group selected: picking it clears the others, picking a group drops it, and
 * clearing the last group falls back to it.
 */
export function nextGroups(previous: readonly ActivityGroup[], toggled: readonly string[]): ActivityGroup[] {
  const addedAll = toggled.includes("all") && previous.length > 0;
  if (addedAll) return [];
  return ACTIVITY_GROUPS.filter((group) => toggled.includes(group));
}

/* -------------------------------------------------------------------------- */
/* Hashes and links                                                            */
/* -------------------------------------------------------------------------- */

/** A Cosmos transaction hash: 64 hex characters, optionally 0x-prefixed. */
export function isTxHash(value: string): boolean {
  return /^(0x)?[0-9a-f]{64}$/i.test(value.trim());
}

/** Upper-case hex without 0x, the way chains spell hashes. */
export function normalizeHash(value: string): string {
  return value.trim().replace(/^0x/i, "").toUpperCase();
}

/** The transaction page for a row. `chainId` travels as `?chainId=` (what notifications link with too). */
export function txHref(chainId: string, hash: string): string {
  return `/activity/${encodeURIComponent(normalizeHash(hash))}?chainId=${encodeURIComponent(chainId)}`;
}

/* -------------------------------------------------------------------------- */
/* Coverage                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * - `complete`: every transaction of the account on this chain is loaded;
 * - `empty`: complete, and the chain has never seen the account;
 * - `retention`: the node keeps no older history (a hard edge, not a page);
 * - `loaded`: older pages exist and have not been loaded yet;
 * - `partial`: one of the searches failed or a page was stepped over;
 * - `unreadable`: nothing could be read from this chain.
 */
export type CoverageState = "complete" | "empty" | "retention" | "loaded" | "partial" | "unreadable";

export interface CoverageView {
  chainId: string;
  state: CoverageState;
  /** `YYYY-MM-DD` the list is complete from, when that is the story. */
  from: string | null;
  /** The same edge as epoch ms (the exact boundary when the server gave one). */
  edge: number | null;
  /** The server's sentence, for a tooltip. */
  note?: string;
}

const RETENTION_NOTE = /(keeps history since|only serves history since|does not serve older history|keep a limited window)/i;
const NOTE_DATE = /(\d{4}-\d{2}-\d{2})/;

function edgeOf(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(ms) ? ms : null;
}

/** One account's coverage, classified for the banner and the chart caption. */
export function coverageView(entry: ActivityCoverage): CoverageView {
  const base = { chainId: entry.chainId, ...(entry.note ? { note: entry.note } : {}) };
  const day = entry.oldest ? entry.oldest.slice(0, 10) : null;
  if (entry.complete) return { ...base, state: entry.oldest === null ? "empty" : "complete", from: null, edge: null };
  if (entry.oldest === null) return { ...base, state: "unreadable", from: null, edge: null };
  if (entry.note && RETENTION_NOTE.test(entry.note)) {
    const noted = NOTE_DATE.exec(entry.note)?.[1] ?? null;
    return { ...base, state: "retention", from: noted ?? day, edge: noted ? edgeOf(noted) : edgeOf(entry.oldest) };
  }
  if (entry.note) return { ...base, state: "partial", from: day, edge: edgeOf(entry.oldest) };
  return { ...base, state: "loaded", from: day, edge: edgeOf(entry.oldest) };
}

/**
 * Whether a chain's list is complete for a date range: the whole history is
 * loaded, or what is loaded (or what the node keeps) reaches back past the
 * range's start. A partial or unreadable chain never is.
 */
export function coversRange(view: CoverageView, since: number | null): boolean {
  if (view.state === "complete" || view.state === "empty") return true;
  if (since === null || view.edge === null) return false;
  return (view.state === "loaded" || view.state === "retention") && view.edge <= since;
}

/**
 * One row per chain. The same chain can be listed under two of the wallet's
 * addresses only in theory (the hook reads one address per chain); the most
 * limiting reading wins so the banner never claims more than the worst case.
 */
export function coverageViews(coverage: readonly ActivityCoverage[]): CoverageView[] {
  const rank: Record<CoverageState, number> = { unreadable: 5, partial: 4, retention: 3, loaded: 2, complete: 1, empty: 0 };
  const byChain = new Map<string, CoverageView>();
  for (const entry of coverage) {
    const view = coverageView(entry);
    const current = byChain.get(view.chainId);
    if (!current || rank[view.state] > rank[current.state]) byChain.set(view.chainId, view);
  }
  return [...byChain.values()];
}

/** The latest hard edge (node retention) inside a window: where the chart stops being complete. */
export function retentionEdge(views: readonly CoverageView[], from: number): { chainIds: string[]; at: number } | null {
  let at = Number.NEGATIVE_INFINITY;
  const chainIds: string[] = [];
  for (const view of views) {
    if (view.state !== "retention" || view.edge === null) continue;
    const edge = view.edge;
    if (edge <= from) continue;
    if (edge > at) {
      at = edge;
      chainIds.length = 0;
    }
    if (edge === at) chainIds.push(view.chainId);
  }
  return Number.isFinite(at) ? { chainIds, at } : null;
}

/** How a chain's coverage reads in the banner: the tone of its dot and the words after its name. */
export type CoverageTone = "good" | "pending" | "limited" | "bad";

/** "Jul 26" from a `YYYY-MM-DD`: a calendar date, so formatted in UTC rather than shifted by the viewer's zone. */
function shortDay(day: string | null): string {
  if (!day) return "";
  const ms = Date.parse(`${day.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(ms) ? formatDate(ms, "short", { timeZone: "UTC" }) : day;
}

/** One chain's coverage in words, judged against the date range on screen. */
export function coverageLine(view: CoverageView, since: number | null): { tone: CoverageTone; text: string } {
  const covered = coversRange(view, since);
  switch (view.state) {
    case "complete":
      return { tone: "good", text: "complete history" };
    case "empty":
      return { tone: "good", text: "no transactions" };
    case "loaded":
      return covered
        ? { tone: "good", text: "complete for this range" }
        : { tone: "pending", text: view.from ? `loaded back to ${shortDay(view.from)}` : "older history available" };
    case "retention":
      return covered
        ? { tone: "good", text: `complete for this range · node keeps since ${shortDay(view.from)}` }
        : { tone: "limited", text: view.from ? `since ${shortDay(view.from)} · node retention` : "recent history only · node retention" };
    case "partial":
      return { tone: "limited", text: view.from ? `partial since ${shortDay(view.from)}` : "partial" };
    case "unreadable":
      return { tone: "bad", text: "couldn't be read" };
  }
}

export interface CoverageGroup {
  tone: CoverageTone;
  text: string;
  chainIds: string[];
  /** The server's sentence per chain, where it gave one. */
  notes: { chainId: string; note: string }[];
}

const TONE_ORDER: Readonly<Record<CoverageTone, number>> = { bad: 0, limited: 1, pending: 2, good: 3 };

/**
 * Chains that read the same, together ("Cosmos Hub, Celestia, Akash: no
 * transactions"), worst news first. Five chains saying "complete" one per
 * line is a column of repetition; the banner says each verdict once.
 */
export function coverageGroups(views: readonly CoverageView[], since: number | null): CoverageGroup[] {
  const groups = new Map<string, CoverageGroup>();
  for (const view of views) {
    const { tone, text } = coverageLine(view, since);
    const key = `${tone}|${text}`;
    const group = groups.get(key) ?? { tone, text, chainIds: [], notes: [] };
    group.chainIds.push(view.chainId);
    if (view.note) group.notes.push({ chainId: view.chainId, note: view.note });
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

/**
 * Whether the history behind a view is complete on every network in scope:
 * each chain read covers the range (its verdict is "good") and none was left
 * unread (`notRead`: no address shared, past the account cap). The banner
 * titles itself "Complete for …" exactly then, so a zero the strip prints
 * under it is a known zero rather than a read that never happened.
 */
export function historyComplete(views: readonly CoverageView[], since: number | null, notRead: number): boolean {
  return views.length > 0 && notRead === 0 && views.every((view) => coverageLine(view, since).tone === "good");
}

/**
 * Whether history older than the range is known to exist, so the list's last
 * step can offer all time: more pages to load, rows loaded for the comparison
 * period, or an account whose whole history is loaded and starts before the
 * range (its `oldest` is then a real transaction, not a node's edge).
 */
export function olderHistoryExists(input: {
  since: number | null;
  hasMore: boolean;
  /** Loaded rows older than `since` (the comparison period's). */
  olderLoaded: number;
  coverage: readonly Pick<ActivityCoverage, "complete" | "oldest">[];
}): boolean {
  const { since } = input;
  if (since === null) return input.hasMore;
  if (input.hasMore || input.olderLoaded > 0) return true;
  return input.coverage.some((entry) => entry.complete && entry.oldest !== null && Date.parse(entry.oldest) < since);
}

/* -------------------------------------------------------------------------- */
/* Chart window                                                                */
/* -------------------------------------------------------------------------- */

export interface ChartWindow {
  /** Epoch ms, inclusive. */
  from: number;
  to: number;
  bucket: Bucket;
  /** Length in days (fractional), for "per day" rates. */
  days: number;
  /**
   * The range asked for more than is loaded: bars start where the loaded list
   * is complete instead of drawing zeros for days nobody has read.
   */
  clipped: boolean;
}

/** Daily bars up to this many days, weekly beyond (a year of days is 365 slivers). */
const DAILY_LIMIT_DAYS = 100;

/**
 * The time span the charts and the per-day rate may honestly cover: from the
 * range start (or the oldest loaded row for "All") to now, but never earlier
 * than the point the loaded list is complete down to.
 */
export function chartWindow(input: {
  since: number | null;
  now: number;
  rows: readonly Pick<ActivityItem, "time">[];
  /** From the hook: ISO time the list is complete down to while older rows exist. */
  loadedUntil: string | null;
}): ChartWindow | null {
  const { since, now, rows, loadedUntil } = input;
  if (!Number.isFinite(now)) return null;
  const loadedEdge = loadedUntil ? Date.parse(loadedUntil) : Number.NaN;
  let from: number;
  let clipped = false;
  if (since !== null) {
    from = since;
    if (Number.isFinite(loadedEdge) && loadedEdge > since) {
      from = loadedEdge;
      clipped = true;
    }
  } else {
    let oldest = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const time = Date.parse(row.time);
      if (Number.isFinite(time) && time < oldest) oldest = time;
    }
    if (!Number.isFinite(oldest)) return null;
    from = Number.isFinite(loadedEdge) ? Math.max(oldest, loadedEdge) : oldest;
  }
  from = Math.min(from, now);
  const days = Math.max((now - from) / DAY_MS, 1 / 24);
  return { from, to: now, bucket: days <= DAILY_LIMIT_DAYS ? "day" : "week", days, clipped };
}

/* -------------------------------------------------------------------------- */
/* Days                                                                        */
/* -------------------------------------------------------------------------- */

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const DAY_FORMAT_YEAR = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** "Today", "Yesterday", "Mon, Oct 5", or "Mon, Oct 5, 2025" in another year (local calendar). */
export function dayHeading(start: number, now: number | null): string {
  if (now !== null && Number.isFinite(now)) {
    const today = bucketStart(now, "day", "local");
    if (start === today) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (start === yesterday.getTime()) return "Yesterday";
    if (new Date(start).getFullYear() !== new Date(now).getFullYear()) return DAY_FORMAT_YEAR.format(start);
  }
  return DAY_FORMAT.format(start);
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rows the list shows at first, and adds per "Load more". A wallet page, not
 * an explorer: the latest few, then more when the user asks for them (a
 * button on purpose, not a scroll that loads by itself).
 */
export const LIST_STEP = 10;

const RANGE_SPANS: Readonly<Record<RangeKey, string>> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };

/**
 * The list's caption: what it spans and in which order ("Last 30 days ·
 * newest first"). No count: a total over a list that shows ten at a time
 * reads as an explorer's pager, and the chips already count each type.
 */
export function listCaption(range: RangeKey, filtered: boolean): string {
  const span = RANGE_SPANS[range];
  return filtered ? `Filtered · ${span.toLowerCase()} · newest first` : `${span} · newest first`;
}

export type ListFooter =
  /** Reveal the next rows; with `fetch`, every loaded row is on screen and an older page loads first. */
  | { kind: "more"; fetch: boolean }
  /** The range is all on screen and older history exists: the next step is all time. */
  | { kind: "all-time" }
  /** Nothing older to show: a quiet end line, no button. */
  | { kind: "end" };

/**
 * What the foot of the list offers. Loaded rows are revealed before anything
 * is fetched; a range already complete never fetches (older pages would only
 * hold rows the range hides) and offers all time instead.
 */
export function listFooter(input: {
  /** Rows on screen. */
  shown: number;
  /** Rows loaded for the view (filters applied). */
  total: number;
  /** Older pages exist. */
  hasMore: boolean;
  /** A date range is on screen and the loaded list reaches back past its start. */
  rangeDone: boolean;
  /** History older than the range is known to exist (`olderHistoryExists`). */
  olderExists: boolean;
}): ListFooter {
  if (input.shown < input.total) return { kind: "more", fetch: false };
  if (input.hasMore && !input.rangeDone) return { kind: "more", fetch: true };
  if (input.rangeDone && input.olderExists) return { kind: "all-time" };
  return { kind: "end" };
}

/* -------------------------------------------------------------------------- */
/* Privacy and own addresses                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A sentence from the activity read ("Sent 12.5 OSMO to osmo1…") for privacy
 * mode: every free-standing number masked, the way Overview and the Live
 * popover mask theirs. A vote keeps its words: "#12" is a proposal, not money.
 */
export function privateText(text: string, hidden: boolean, isVote = false): string {
  return hidden && !isVote ? maskAmounts(text, "transfer") : text;
}

/**
 * The key part of a bech32 address: what sits between the separator and the
 * six-character checksum. The same key on two chains differs only in prefix
 * and checksum ("addr_safro1jz4f…" and "osmo1jz4f…"), so equal parts mean the
 * same owner. Null for anything that is not bech32-shaped.
 */
export function bech32Body(address: string): string | null {
  const separator = address.lastIndexOf("1");
  if (separator < 1 || address.length - separator < 8) return null;
  return address.slice(separator + 1, -6).toLowerCase();
}

/** The prefix of a bech32 address ("osmo", "addr_safrovaloper"); null when there is none. */
export function bech32Prefix(address: string): string | null {
  const separator = address.lastIndexOf("1");
  return separator > 0 ? address.slice(0, separator) : null;
}

/**
 * Who a counterparty is when it is the viewer: "you" (an account of theirs on
 * another chain, e.g. the sender of an IBC transfer to themselves) or "your
 * validator" (an operator address of the same key). Null for anyone else.
 */
export function ownRole(address: string, ownBodies: ReadonlySet<string>): "you" | "validator" | null {
  const body = bech32Body(address);
  if (!body || !ownBodies.has(body)) return null;
  return bech32Prefix(address)?.endsWith("valoper") ? "validator" : "you";
}

/**
 * A transfer between two of the wallet's own accounts (its Safrochain address
 * sending to its Osmosis address over IBC). Each side is a real row, but
 * counted in "sent vs received" it would show the same tokens as both spent
 * and earned; flows leave these out and say how many they left out.
 */
export function isOwnTransfer(item: Pick<ActivityItem, "kind" | "counterparty">, ownBodies: ReadonlySet<string>): boolean {
  const group = groupOf(item.kind);
  if (group !== "transfers" && group !== "ibc") return false;
  return item.counterparty !== undefined && ownRole(item.counterparty, ownBodies) === "you";
}

/* -------------------------------------------------------------------------- */
/* Amounts and money                                                           */
/* -------------------------------------------------------------------------- */

export interface AmountLeg {
  key: string;
  direction: "in" | "out";
  /** Base units. */
  amount: string;
  decimals: number | null;
  ticker: string;
  identity: TokenIdentity;
}

/**
 * What moved for the account, in reading order: what left first, then what
 * arrived ("−10 OSMO, +4.32 USDC" reads as the swap it was). Zero amounts are
 * dropped (a self-send nets out to nothing).
 */
export function rowLegs(item: Pick<ActivityItem, "amounts" | "hash">): AmountLeg[] {
  const legs = item.amounts
    .filter((amount) => /^\d+$/.test(amount.amount) && BigInt(amount.amount) > BigInt(0))
    .map((amount, index) => ({
      key: `${item.hash}:${amount.direction}:${amount.denom}:${index}`,
      direction: amount.direction,
      amount: amount.amount,
      decimals: amount.identity.decimals,
      ticker: amount.identity.ticker,
      identity: amount.identity,
    }));
  return [...legs.filter((leg) => leg.direction === "out"), ...legs.filter((leg) => leg.direction === "in")];
}

const TEN = BigInt(10);

/** Base units × price, or null when the decimals or the price are unknown. */
export function amountValue(amount: string, decimals: number | null, price: number | undefined): number | null {
  if (price === undefined || !Number.isFinite(price) || decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    return null;
  }
  if (!/^\d+$/.test(amount)) return null;
  const units = BigInt(amount);
  const scale = TEN ** BigInt(decimals);
  return (Number(units / scale) + Number(units % scale) / Number(scale)) * price;
}

/** A leg's value at today's price, signed by direction. */
export function legValue(leg: AmountLeg, prices: PriceMap): number | null {
  const value = amountValue(leg.amount, leg.decimals, prices.get(leg.identity.key));
  return value === null ? null : leg.direction === "out" ? -value : value;
}

/** Net value of a set of legs; null unless every leg is priced (a partial sum would read as the whole). */
export function legsValue(legs: readonly AmountLeg[], prices: PriceMap): number | null {
  if (legs.length === 0) return null;
  let sum = 0;
  for (const leg of legs) {
    const value = legValue(leg, prices);
    if (value === null) return null;
    sum += value;
  }
  return sum;
}

/** In minus out; null when neither side has a priced entry. */
export function netFlow(inValue: number | null, outValue: number | null): number | null {
  if (inValue === null && outValue === null) return null;
  return (inValue ?? 0) - (outValue ?? 0);
}

export type NetFlowReading =
  /** Some transfer is priced: in minus out, with the sums it came from. */
  | { state: "priced"; net: number; inValue: number; outValue: number }
  /** No transfer in the view and its history is complete: a known zero. */
  | { state: "none" }
  /** Transfers exist and none of them has a price. */
  | { state: "unpriced" }
  /** No transfer among the rows read, but the history is not complete: unknown, not zero. */
  | { state: "unknown" };

/**
 * What the strip's net-flow figure can honestly say. A view without a single
 * transfer nets to exactly zero once its history is complete, and says so
 * ($0.00, as the fee tile does for "no fees"); "—" is kept for what is
 * unknown: transfers nobody can price, or a history with holes in it.
 */
export function netFlowReading(flows: { inValue: number | null; outValue: number | null; unpriced: number }, complete: boolean): NetFlowReading {
  const net = netFlow(flows.inValue, flows.outValue);
  if (net !== null) return { state: "priced", net, inValue: flows.inValue ?? 0, outValue: flows.outValue ?? 0 };
  if (flows.unpriced > 0) return { state: "unpriced" };
  return complete ? { state: "none" } : { state: "unknown" };
}

/** Asset keys to price for a set of rows: every amount and every fee token, deduplicated. */
export function priceKeysOf(items: readonly ActivityItem[]): string[] {
  const keys = new Set<string>();
  for (const item of items) {
    for (const amount of item.amounts) keys.add(amount.identity.key);
    if (item.fee?.key) keys.add(item.fee.key);
  }
  return [...keys].sort();
}

/* -------------------------------------------------------------------------- */
/* Fees by type                                                                */
/* -------------------------------------------------------------------------- */

export interface GroupFees {
  group: ActivityGroup;
  /** Transactions of this group whose fee the account paid. */
  count: number;
  value: number | null;
  /** Fee tokens without a price in this group. */
  unpriced: number;
  tokens: FeeToken[];
}

/** What each kind of activity cost in fees (est. at today's prices), most expensive first. */
export function feesByGroup(items: readonly ActivityItem[], prices: PriceMap): GroupFees[] {
  const out: GroupFees[] = [];
  for (const group of ACTIVITY_GROUPS) {
    const rows = items.filter((item) => groupOf(item.kind) === group);
    if (rows.length === 0) continue;
    const summary = feeSummary(rows, prices);
    if (summary.count === 0) continue;
    out.push({ group, count: summary.count, value: summary.value, unpriced: summary.unpriced, tokens: summary.byToken });
  }
  return out.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || b.count - a.count);
}

/**
 * Fees the account paid per chart bucket (`starts`: the buckets' local start
 * times, oldest first), at today's prices, zero-filled so the line has every
 * day. Only priced fees count; null when none in the window has a price,
 * because a flat zero line would claim "no fees" instead of "no price".
 */
export function feeSeries(
  items: readonly ActivityItem[],
  prices: PriceMap,
  starts: readonly number[],
  bucket: Bucket,
): { t: number; v: number }[] | null {
  if (starts.length === 0) return null;
  const index = new Map(starts.map((start, i) => [start, i]));
  const values = starts.map(() => 0);
  let priced = false;
  for (const item of items) {
    if (!item.feePaid || !item.fee?.key) continue;
    const time = Date.parse(item.time);
    if (!Number.isFinite(time)) continue;
    const slot = index.get(bucketStart(time, bucket, "local"));
    if (slot === undefined) continue;
    const value = amountValue(item.fee.amount, item.fee.decimals ?? null, prices.get(item.fee.key));
    if (value === null) continue;
    priced = true;
    values[slot] += value;
  }
  return priced ? starts.map((t, i) => ({ t, v: values[i] })) : null;
}

/* -------------------------------------------------------------------------- */
/* This period vs the one before                                               */
/* -------------------------------------------------------------------------- */

export interface PeriodFigures {
  transactions: number;
  swaps: number;
  ibc: number;
  /**
   * Fees the account paid, at today's prices. Null unless every fee token is
   * priced: a sum missing one token would compare unlike with unlike.
   */
  fees: number | null;
}

/** The figures two periods are compared on: the strip's counts and its fee total. */
export function periodFigures(items: readonly ActivityItem[], prices: PriceMap): PeriodFigures {
  let swaps = 0;
  let ibc = 0;
  for (const item of items) {
    const group = groupOf(item.kind);
    if (group === "swaps") swaps += 1;
    else if (group === "ibc") ibc += 1;
  }
  const fees = feeSummary(items, prices);
  return { transactions: items.length, swaps, ibc, fees: fees.count === 0 ? 0 : fees.unpriced === 0 ? fees.value : null };
}

/**
 * Change from `before` to `now` in percent units (12.5 is +12.5 %). Null when
 * there is nothing honest to say: a side is unknown, or there was nothing
 * before (from zero every rise is infinite).
 */
export function percentChange(now: number | null, before: number | null): number | null {
  if (now === null || before === null || !Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return ((now - before) / before) * 100;
}

export interface PeriodComparison {
  /** The previous period, epoch ms: `from` inclusive, `to` exclusive (where the range starts). */
  from: number;
  to: number;
  before: PeriodFigures;
  change: { transactions: number | null; swaps: number | null; ibc: number | null; fees: number | null };
}

/** The range's figures against the period before it (both already filtered alike). */
export function comparePeriods(
  current: readonly ActivityItem[],
  previous: readonly ActivityItem[],
  prices: PriceMap,
  period: { from: number; to: number },
): PeriodComparison {
  const now = periodFigures(current, prices);
  const before = periodFigures(previous, prices);
  return {
    ...period,
    before,
    change: {
      transactions: percentChange(now.transactions, before.transactions),
      swaps: percentChange(now.swaps, before.swaps),
      ibc: percentChange(now.ibc, before.ibc),
      fees: percentChange(now.fees, before.fees),
    },
  };
}

export type ComparisonState =
  /** Every chain is complete back to the previous period's start. */
  | { state: "ready" }
  /** Loaded back far enough, but these chains' history does not cover the previous period. */
  | { state: "uncovered"; chainIds: string[] }
  /** Not loaded that far (yet, or the page budget ran out): say nothing. */
  | { state: "pending" };

/**
 * Whether the period before the range can honestly be compared with it. A
 * node that keeps less history would turn "fewer kept" into "fewer made", so
 * every chain read must be complete for the previous period too. (A chain
 * that was not read at all is missing from both periods alike; the banner
 * names it.)
 */
export function comparisonState(input: {
  previousSince: number | null;
  /** The loaded list reaches back to `previousSince`. */
  reached: boolean;
  views: readonly CoverageView[];
}): ComparisonState {
  const { previousSince } = input;
  if (previousSince === null || !input.reached) return { state: "pending" };
  const uncovered = input.views.filter((view) => !coversRange(view, previousSince)).map((view) => view.chainId);
  return uncovered.length > 0 ? { state: "uncovered", chainIds: uncovered } : { state: "ready" };
}

/* -------------------------------------------------------------------------- */
/* When: weekday × hour                                                        */
/* -------------------------------------------------------------------------- */

export interface HourMatrix {
  /** [weekday Monday = 0 … Sunday = 6][hour 0–23] → transactions. */
  cells: number[][];
  max: number;
  /** The busiest slot; null with no rows. */
  peak: { weekday: number; hour: number; count: number } | null;
  total: number;
}

/** Transactions per weekday and hour of the viewer's local clock (the "when you transact" heatmap). */
export function hourMatrix(items: readonly Pick<ActivityItem, "time">[]): HourMatrix {
  const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  let total = 0;
  let peak: HourMatrix["peak"] = null;
  for (const item of items) {
    const date = new Date(Date.parse(item.time));
    if (!Number.isFinite(date.getTime())) continue;
    const weekday = (date.getDay() + 6) % 7;
    const hour = date.getHours();
    const count = (cells[weekday][hour] += 1);
    total += 1;
    if (count > max) max = count;
    if (!peak || count > peak.count) peak = { weekday, hour, count };
  }
  return { cells, max, peak, total };
}

/* -------------------------------------------------------------------------- */
/* Transaction detail                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Kinds that describe the trip to the chain (a wallet prompt, a slow node, a
 * mempool duplicate). A transaction found in a block got there, so its
 * failure can never be one of them, whatever words its log contains.
 */
const CLIENT_SIDE_KINDS: ReadonlySet<TxErrorKind> = new Set(["network-timeout", "wallet-timeout", "wallet-disconnected", "user-rejected", "already-in-mempool"]);

/**
 * Why a transaction that is in a block failed, in words.
 *
 * `explainTxError` is written for the moment of sending, where "timed out"
 * means the node did not answer; on a recorded failure the same word is the
 * chain's own verdict. The commonest one in IBC history is a transfer whose
 * expiry was already in the past ("invalid packet timeout … timeout
 * elapsed"): the client built it with a stale clock or the wrong unit. Any
 * other client-side reading falls back to the chain's own words.
 */
export function explainOnChainFailure(rawLog: string | null | undefined, code?: number | null, codespace?: string | null): ExplainedTxError {
  const explained = explainTxError(rawLog, { code: code ?? null, codespace: codespace ?? null });
  const text = rawLog ?? "";
  if (/invalid packet timeout|packet timeout .*elapsed|timeout elapsed/i.test(text)) {
    return {
      ...explained,
      kind: "expired",
      title: "Expired before it left",
      message:
        "The transfer's expiry time had already passed when the chain ran it, so no packet was sent and the tokens never left; only the network fee was spent. The app that built it set a timeout in the past: send it again from an up-to-date wallet.",
      retryable: true,
    };
  }
  if (!CLIENT_SIDE_KINDS.has(explained.kind)) return explained;
  const words = cleanChainLog(text);
  return {
    ...explained,
    kind: "unknown",
    title: "Refused by the chain",
    message: words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.`.replace(/\.\.$/, ".") : "The chain refused this transaction.",
    retryable: false,
  };
}

/** Gas used as a share of the limit (0–1, can exceed 1 on a failed out-of-gas tx); null when unknown. */
export function gasRatio(used: number | null, wanted: number | null): number | null {
  if (used === null || wanted === null || !Number.isFinite(used) || !Number.isFinite(wanted) || wanted <= 0) return null;
  return used / wanted;
}

/** A packet's timeout (ICS nanoseconds) as epoch ms; null when unset or decades away (a "never" in practice). */
export function packetTimeout(timestamp: string | undefined, now: number): number | null {
  if (!timestamp || !/^\d+$/.test(timestamp) || timestamp === "0") return null;
  const ms = Number(BigInt(timestamp) / BigInt(1_000_000));
  if (!Number.isFinite(ms) || ms - now > 50 * 365 * DAY_MS) return null;
  return ms;
}

/**
 * The token a packet carried, read from the transaction's own coin movements:
 * the packet names the ICS20 path ("transfer/channel-1/uosmo"), the bank
 * moved the local denom; the same base amount from (or to) the same address
 * ties them together. Null when nothing matches: the page then prints the
 * packet's raw denom in base units rather than guessing an exponent.
 */
export function packetIdentity(packet: TxPacket, movements: readonly TxMovement[]): TokenIdentity | null {
  if (!packet.amount) return null;
  const sameAmount = movements.filter((movement) => movement.amount === packet.amount);
  const party = packet.stage === "send" || packet.stage === "timeout" ? packet.sender : packet.receiver;
  const match =
    sameAmount.find((movement) => party && (movement.from === party || movement.to === party)) ?? (sameAmount.length === 1 ? sameAmount[0] : undefined);
  return match?.identity ?? null;
}

/**
 * A one-hop route plan for following a packet this transaction sent, in the
 * shape `/api/interchain/track` takes. The tracker only uses the plan to
 * address its reads (which channel, which counterparty); every status it
 * returns comes from the chains. Null when the packet cannot be followed from
 * here (not a send, no counterparty chain, a failed transaction).
 */
export function trackPlanFor(tx: { chainId: string; success: boolean }, packet: TxPacket): RoutePlanWire | null {
  if (!tx.success || packet.stage !== "send" || !packet.counterpartyChainId || !packet.sourceChannel) return null;
  return {
    sourceChainId: tx.chainId,
    destChainId: packet.counterpartyChainId,
    inputDenom: packet.denom ?? "",
    outputDenom: "",
    hops: [
      {
        chainId: tx.chainId,
        channelId: packet.sourceChannel,
        port: packet.sourcePort || "transfer",
        counterpartyChainId: packet.counterpartyChainId,
        kind: "transfer",
      },
    ],
    memo: "",
    warnings: [],
    estimatedDurationSeconds: 0,
    requiresPfm: false,
    requiresIbcHooks: false,
  };
}
