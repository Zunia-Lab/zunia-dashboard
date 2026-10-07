/**
 * Activity analytics: what the Activity page's strip, charts and export show.
 *
 * Pure and client-safe. Every function works on the rows loaded so far, so a
 * page must show their coverage beside any figure ("since 2026-07-13 on
 * Osmosis"): a count over a pruned window is not a lifetime count.
 *
 * Money rules (house rule, no exceptions):
 * - money figures (`value`, `inValue`, `outValue`) exist only when the caller
 *   passes prices, are in the prices' currency (the user's: USD, EUR or GBP),
 *   and are always an estimate at today's price (`estimate: true`, `method`
 *   in words);
 * - an unpriced token is counted (`unpriced`), never valued at 0;
 * - fees count only where the account paid them (`feePaid`);
 * - token amounts are summed in base units per asset key, never through
 *   floats; conversion to money happens once, at the end.
 */

import type { TokenIdentity } from "@/lib/token/types";
import type { ActivityCoverage, ActivityItem, ActivityKind } from "./types";
import { ACTIVITY_KINDS } from "./types";

/* -------------------------------------------------------------------------- */
/* Kinds → chart groups                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Thirteen kinds are too many stacks for one chart (the palette has six
 * categorical slots plus Other), so charts and filter chips use six groups.
 */
export const ACTIVITY_GROUPS = ["transfers", "ibc", "swaps", "staking", "governance", "other"] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

export const GROUP_LABELS: Readonly<Record<ActivityGroup, string>> = {
  transfers: "Transfers",
  ibc: "IBC",
  swaps: "Swaps",
  staking: "Staking",
  governance: "Governance",
  other: "Other",
};

export const GROUP_KINDS: Readonly<Record<ActivityGroup, readonly ActivityKind[]>> = {
  transfers: ["send", "receive"],
  ibc: ["ibc-out", "ibc-in"],
  swaps: ["swap"],
  staking: ["delegate", "undelegate", "redelegate", "claim"],
  governance: ["vote"],
  other: ["contract", "authz", "other"],
};

const GROUP_BY_KIND = new Map<ActivityKind, ActivityGroup>(
  ACTIVITY_GROUPS.flatMap((group) => GROUP_KINDS[group].map((kind) => [kind, group] as [ActivityKind, ActivityGroup])),
);

export function groupOf(kind: ActivityKind): ActivityGroup {
  return GROUP_BY_KIND.get(kind) ?? "other";
}

/** Short labels for kinds, for legends and table cells. */
export const KIND_LABELS: Readonly<Record<ActivityKind, string>> = {
  send: "Send",
  receive: "Receive",
  "ibc-out": "IBC out",
  "ibc-in": "IBC in",
  swap: "Swap",
  delegate: "Delegate",
  undelegate: "Undelegate",
  redelegate: "Redelegate",
  claim: "Claim",
  vote: "Vote",
  contract: "Contract",
  authz: "Authz",
  other: "Other",
};

/* -------------------------------------------------------------------------- */
/* Time buckets                                                                */
/* -------------------------------------------------------------------------- */

export type Bucket = "day" | "week";
export type TimeZoneMode = "local" | "utc";

const DAY_MS = 86_400_000;

function timeOf(item: Pick<ActivityItem, "time">): number {
  return Date.parse(item.time);
}

/** Start of the day (or ISO week, Monday) containing `ms`. */
export function bucketStart(ms: number, bucket: Bucket, zone: TimeZoneMode = "local"): number {
  const date = new Date(ms);
  if (zone === "utc") {
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    if (bucket === "day") return day;
    const weekday = (date.getUTCDay() + 6) % 7;
    return day - weekday * DAY_MS;
  }
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (bucket === "week") day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

function nextBucket(start: number, bucket: Bucket, zone: TimeZoneMode): number {
  if (zone === "utc") return start + (bucket === "day" ? DAY_MS : 7 * DAY_MS);
  // Local calendar arithmetic, so a DST change does not shift the bucket edge.
  const date = new Date(start);
  date.setDate(date.getDate() + (bucket === "day" ? 1 : 7));
  return date.getTime();
}

function dateLabel(ms: number, zone: TimeZoneMode): string {
  const date = new Date(ms);
  const y = zone === "utc" ? date.getUTCFullYear() : date.getFullYear();
  const m = (zone === "utc" ? date.getUTCMonth() : date.getMonth()) + 1;
  const d = zone === "utc" ? date.getUTCDate() : date.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface PeriodRow {
  /** Bucket start, epoch ms. */
  start: number;
  /** `YYYY-MM-DD` of the bucket start, in the chosen zone. */
  label: string;
  total: number;
  failed: number;
  byGroup: Record<ActivityGroup, number>;
  byKind: Record<ActivityKind, number>;
}

function zeroGroups(): Record<ActivityGroup, number> {
  return { transfers: 0, ibc: 0, swaps: 0, staking: 0, governance: 0, other: 0 };
}

function zeroKinds(): Record<ActivityKind, number> {
  const out = {} as Record<ActivityKind, number>;
  for (const kind of ACTIVITY_KINDS) out[kind] = 0;
  return out;
}

const MAX_BUCKETS = 3_700;

/**
 * Transaction counts per day or week, by group and kind, for a stacked bar
 * chart. Empty buckets between `from` (or the oldest row) and `to` (or the
 * newest) are filled with zeros so the time axis is continuous.
 */
export function activityByPeriod(
  items: readonly ActivityItem[],
  options: { bucket: Bucket; zone?: TimeZoneMode; from?: number; to?: number } = { bucket: "day" },
): PeriodRow[] {
  const zone = options.zone ?? "local";
  const rows = new Map<number, PeriodRow>();
  const make = (start: number): PeriodRow => ({
    start,
    label: dateLabel(start, zone),
    total: 0,
    failed: 0,
    byGroup: zeroGroups(),
    byKind: zeroKinds(),
  });
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const time = timeOf(item);
    if (!Number.isFinite(time)) continue;
    if (options.from !== undefined && time < options.from) continue;
    if (options.to !== undefined && time > options.to) continue;
    const start = bucketStart(time, options.bucket, zone);
    let row = rows.get(start);
    if (!row) {
      row = make(start);
      rows.set(start, row);
    }
    row.total += 1;
    if (!item.success) row.failed += 1;
    row.byGroup[groupOf(item.kind)] += 1;
    row.byKind[item.kind] += 1;
    min = Math.min(min, start);
    max = Math.max(max, start);
  }
  const first = options.from !== undefined ? bucketStart(options.from, options.bucket, zone) : min;
  const last = options.to !== undefined ? bucketStart(options.to, options.bucket, zone) : max;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const out: PeriodRow[] = [];
  for (let start = first; start <= last && out.length < MAX_BUCKETS; start = nextBucket(start, options.bucket, zone)) {
    out.push(rows.get(start) ?? make(start));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Filtering and grouping (the Activity page's filter row and day table)      */
/* -------------------------------------------------------------------------- */

export interface ActivityFilter {
  /** Chart / chip groups to keep; all when absent or empty. */
  groups?: readonly ActivityGroup[];
  /** Kinds to keep (combined with `groups` as OR); all when absent or empty. */
  kinds?: readonly ActivityKind[];
  /** Only failed transactions (the "Failed" chip). */
  failedOnly?: boolean;
  chains?: readonly string[];
  /** Epoch ms, inclusive. */
  since?: number;
  /** Epoch ms, exclusive. */
  until?: number;
  /**
   * Free text, case-insensitive: part of a hash, an address the row names
   * (the account, the counterparty, an authz grantee), the memo, the sentence
   * or a token ticker.
   */
  query?: string;
  /** Rows that moved this asset (`TokenIdentity.key`) or paid their fee in it. */
  assetKey?: string;
}

/** Whether one row passes `filter` (see {@link filterActivity}). */
export function matchesActivity(item: ActivityItem, filter: ActivityFilter): boolean {
  const time = timeOf(item);
  if (filter.since !== undefined && !(time >= filter.since)) return false;
  if (filter.until !== undefined && !(time < filter.until)) return false;
  if (filter.failedOnly && item.success) return false;
  if (filter.chains && filter.chains.length > 0 && !filter.chains.includes(item.chainId)) return false;
  const byGroup = filter.groups && filter.groups.length > 0;
  const byKind = filter.kinds && filter.kinds.length > 0;
  if (byGroup || byKind) {
    const inGroup = byGroup ? (filter.groups as readonly ActivityGroup[]).includes(groupOf(item.kind)) : false;
    const inKind = byKind ? (filter.kinds as readonly ActivityKind[]).includes(item.kind) : false;
    if (!inGroup && !inKind) return false;
  }
  if (filter.assetKey) {
    const key = filter.assetKey;
    if (!item.amounts.some((amount) => amount.identity.key === key) && item.fee?.key !== key) return false;
  }
  const query = filter.query?.trim().toLowerCase();
  if (query) {
    const haystack = [
      item.hash,
      item.address,
      item.counterparty ?? "",
      item.via ?? "",
      item.memo ?? "",
      item.summary,
      ...item.amounts.map((amount) => amount.identity.ticker),
    ];
    if (!haystack.some((value) => value.toLowerCase().includes(query))) return false;
  }
  return true;
}

/** The rows that pass every condition of `filter`, order kept. */
export function filterActivity(items: readonly ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  return items.filter((item) => matchesActivity(item, filter));
}

export interface ActivityDay {
  /** `YYYY-MM-DD` in the chosen zone. */
  label: string;
  /** Start of the day, epoch ms. */
  start: number;
  items: ActivityItem[];
}

/** Rows grouped by calendar day for the "grouped by day" table, newest day first, row order kept. */
export function activityByDay(items: readonly ActivityItem[], zone: TimeZoneMode = "local"): ActivityDay[] {
  const days = new Map<number, ActivityDay>();
  for (const item of items) {
    const time = timeOf(item);
    if (!Number.isFinite(time)) continue;
    const start = bucketStart(time, "day", zone);
    let day = days.get(start);
    if (!day) {
      day = { label: dateLabel(start, zone), start, items: [] };
      days.set(start, day);
    }
    day.items.push(item);
  }
  return [...days.values()].sort((a, b) => b.start - a.start);
}

/* -------------------------------------------------------------------------- */
/* Counts                                                                      */
/* -------------------------------------------------------------------------- */

export function kindCounts(items: readonly ActivityItem[]): Record<ActivityKind, number> {
  const out = zeroKinds();
  for (const item of items) out[item.kind] += 1;
  return out;
}

export function groupCounts(items: readonly ActivityItem[]): Record<ActivityGroup, number> {
  const out = zeroGroups();
  for (const item of items) out[groupOf(item.kind)] += 1;
  return out;
}

export interface SuccessRate {
  total: number;
  succeeded: number;
  failed: number;
  /** 0–1; null with no rows. */
  rate: number | null;
}

export function successRate(items: readonly ActivityItem[]): SuccessRate {
  const failed = items.filter((item) => !item.success).length;
  const total = items.length;
  return { total, succeeded: total - failed, failed, rate: total === 0 ? null : (total - failed) / total };
}

export interface ChainUsage {
  chainId: string;
  count: number;
  failed: number;
  /** Newest row, epoch ms. */
  lastTime: number;
}

/** Rows per chain, most used first: the "Most-used chains" bar list. */
export function chainUsage(items: readonly ActivityItem[]): ChainUsage[] {
  const out = new Map<string, ChainUsage>();
  for (const item of items) {
    const row = out.get(item.chainId) ?? { chainId: item.chainId, count: 0, failed: 0, lastTime: 0 };
    row.count += 1;
    if (!item.success) row.failed += 1;
    row.lastTime = Math.max(row.lastTime, timeOf(item));
    out.set(item.chainId, row);
  }
  return [...out.values()].sort((a, b) => b.count - a.count || b.lastTime - a.lastTime);
}

export interface Counterparty {
  address: string;
  chainId: string;
  count: number;
  lastTime: number;
  kinds: Partial<Record<ActivityKind, number>>;
}

/** Addresses, validators and contracts you deal with most. */
export function topCounterparties(items: readonly ActivityItem[], limit = 5): Counterparty[] {
  const out = new Map<string, Counterparty>();
  for (const item of items) {
    if (!item.counterparty) continue;
    const key = `${item.chainId}|${item.counterparty}`;
    const row = out.get(key) ?? { address: item.counterparty, chainId: item.chainId, count: 0, lastTime: 0, kinds: {} };
    row.count += 1;
    row.lastTime = Math.max(row.lastTime, timeOf(item));
    row.kinds[item.kind] = (row.kinds[item.kind] ?? 0) + 1;
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => b.count - a.count || b.lastTime - a.lastTime).slice(0, Math.max(0, limit));
}

export interface BusiestTimes {
  /** Monday = 0 … Sunday = 6. */
  byWeekday: number[];
  byHour: number[];
  /** Index of the busiest weekday / hour; null with no rows. */
  weekday: number | null;
  hour: number | null;
}

export function busiestTimes(items: readonly ActivityItem[], zone: TimeZoneMode = "local"): BusiestTimes {
  const byWeekday = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  for (const item of items) {
    const date = new Date(timeOf(item));
    if (!Number.isFinite(date.getTime())) continue;
    const weekday = ((zone === "utc" ? date.getUTCDay() : date.getDay()) + 6) % 7;
    const hour = zone === "utc" ? date.getUTCHours() : date.getHours();
    byWeekday[weekday] += 1;
    byHour[hour] += 1;
  }
  const argmax = (values: number[]) => {
    let best = -1;
    let index: number | null = null;
    values.forEach((value, i) => {
      if (value > best && value > 0) {
        best = value;
        index = i;
      }
    });
    return index;
  };
  return { byWeekday, byHour, weekday: argmax(byWeekday), hour: argmax(byHour) };
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Price of one whole token in the display currency, keyed by
 * `TokenIdentity.key` (the asset key). Build it from `useSpotPrices` with
 * {@link priceMapFrom}.
 */
export type PriceMap = ReadonlyMap<string, number>;

/** A {@link PriceMap} from `/api/prices`' `prices` record (unpriced keys left out, never 0). */
export function priceMapFrom(prices: Readonly<Record<string, { price: number } | null | undefined>> | null | undefined): PriceMap {
  const out = new Map<string, number>();
  for (const [key, spot] of Object.entries(prices ?? {})) {
    if (spot && Number.isFinite(spot.price) && spot.price >= 0) out.set(key, spot.price);
  }
  return out;
}

const ESTIMATE_METHOD = "Token amounts × today's price; not the value at the time of each transaction.";

const TEN = BigInt(10);

/** Base units → whole tokens as a float, for money only (amounts stay exact elsewhere). */
function toWhole(amount: bigint, decimals: number): number {
  const scale = TEN ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  return Number(whole) + Number(fraction) / Number(scale);
}

function valueOf(amount: bigint, decimals: number | null, key: string, prices: PriceMap | undefined): number | null {
  if (!prices || decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 77) return null;
  const price = prices.get(key);
  if (price === undefined || !Number.isFinite(price)) return null;
  return toWhole(amount, decimals) * price;
}

export interface FeeToken {
  key: string;
  denom: string;
  symbol: string;
  decimals: number | null;
  /** Base units. */
  amount: string;
  count: number;
  /** Estimate at today's price; null when unpriced. */
  value: number | null;
}

export interface FeeChain {
  chainId: string;
  count: number;
  tokens: FeeToken[];
  /** Sum of priced fees; null when none is priced. */
  value: number | null;
  /** Fee tokens without a price on this chain. */
  unpriced: number;
}

export interface FeeSummary {
  byChain: FeeChain[];
  byToken: FeeToken[];
  /** Transactions whose fee this account paid. */
  count: number;
  value: number | null;
  unpriced: number;
  estimate: true;
  method: string;
}

/** Fees this account paid, by chain and by token. */
export function feeSummary(items: readonly ActivityItem[], prices?: PriceMap): FeeSummary {
  const chains = new Map<string, { count: number; tokens: Map<string, { token: Omit<FeeToken, "amount" | "value">; amount: bigint }> }>();
  const tokens = new Map<string, { token: Omit<FeeToken, "amount" | "value" | "count">; amount: bigint; count: number }>();
  let count = 0;
  for (const item of items) {
    if (!item.feePaid || !item.fee || !/^\d+$/.test(item.fee.amount)) continue;
    count += 1;
    const fee = item.fee;
    const key = fee.key ?? `${item.chainId}:${fee.denom}`;
    const decimals = fee.decimals ?? null;
    const symbol = fee.symbol ?? fee.denom;
    const amount = BigInt(fee.amount);
    const chain = chains.get(item.chainId) ?? { count: 0, tokens: new Map() };
    chain.count += 1;
    const row = chain.tokens.get(key) ?? { token: { key, denom: fee.denom, symbol, decimals, count: 0 }, amount: BigInt(0) };
    row.amount += amount;
    row.token.count += 1;
    chain.tokens.set(key, row);
    chains.set(item.chainId, chain);
    const total = tokens.get(key) ?? { token: { key, denom: fee.denom, symbol, decimals }, amount: BigInt(0), count: 0 };
    total.amount += amount;
    total.count += 1;
    tokens.set(key, total);
  }

  const byChain: FeeChain[] = [...chains].map(([chainId, chain]) => {
    const rows: FeeToken[] = [...chain.tokens.values()].map(({ token, amount }) => ({
      ...token,
      amount: amount.toString(),
      value: valueOf(amount, token.decimals, token.key, prices),
    }));
    const priced = rows.filter((row) => row.value !== null);
    return {
      chainId,
      count: chain.count,
      tokens: rows,
      value: priced.length > 0 ? priced.reduce((sum, row) => sum + (row.value ?? 0), 0) : null,
      unpriced: rows.length - priced.length,
    };
  });
  byChain.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || b.count - a.count);

  const byToken: FeeToken[] = [...tokens.values()].map(({ token, amount, count: n }) => ({
    ...token,
    count: n,
    amount: amount.toString(),
    value: valueOf(amount, token.decimals, token.key, prices),
  }));
  byToken.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || b.count - a.count);
  const priced = byToken.filter((token) => token.value !== null);

  return {
    byChain,
    byToken,
    count,
    value: priced.length > 0 ? priced.reduce((sum, token) => sum + (token.value ?? 0), 0) : null,
    unpriced: byToken.length - priced.length,
    estimate: true,
    method: ESTIMATE_METHOD,
  };
}

export interface TokenFlow {
  key: string;
  symbol: string;
  decimals: number | null;
  /** Base units in and out. */
  in: string;
  out: string;
  inValue: number | null;
  outValue: number | null;
  chains: string[];
}

export interface ChainFlow {
  chainId: string;
  /** Sum of the priced entries; null when none of them is priced (never a made-up 0). */
  inValue: number | null;
  outValue: number | null;
  /** Amount entries in / out (priced or not). */
  inCount: number;
  outCount: number;
  /** Entries that could not be valued. */
  unpriced: number;
}

export interface FlowSummary {
  byToken: TokenFlow[];
  byChain: ChainFlow[];
  /**
   * Priced totals; null when no entry in that direction is priced. The
   * unpriced entries are counted in `unpricedIn` / `unpricedOut`, never as 0.
   */
  inValue: number | null;
  outValue: number | null;
  unpriced: number;
  unpricedIn: number;
  unpricedOut: number;
  estimate: true;
  method: string;
}

/**
 * Value in and out, by token and by chain. By default only transfers and IBC
 * count ("sent vs received"); pass `groups` to include swaps or staking.
 * Failed transactions moved nothing and have no amounts.
 */
export function flowSummary(
  items: readonly ActivityItem[],
  options: { prices?: PriceMap; groups?: readonly ActivityGroup[] } = {},
): FlowSummary {
  const groups = new Set<ActivityGroup>(options.groups ?? ["transfers", "ibc"]);
  const tokens = new Map<string, { identity: TokenIdentity; in: bigint; out: bigint; chains: Set<string> }>();
  const chains = new Map<string, ChainFlow>();
  let inValue: number | null = null;
  let outValue: number | null = null;
  let unpricedIn = 0;
  let unpricedOut = 0;
  const plus = (sum: number | null, value: number) => (sum ?? 0) + value;
  for (const item of items) {
    if (!groups.has(groupOf(item.kind))) continue;
    for (const amount of item.amounts) {
      if (!/^\d+$/.test(amount.amount)) continue;
      const units = BigInt(amount.amount);
      const key = amount.identity.key;
      const token = tokens.get(key) ?? { identity: amount.identity, in: BigInt(0), out: BigInt(0), chains: new Set<string>() };
      token[amount.direction] += units;
      token.chains.add(item.chainId);
      tokens.set(key, token);

      const chain = chains.get(item.chainId) ?? { chainId: item.chainId, inValue: null, outValue: null, inCount: 0, outCount: 0, unpriced: 0 };
      const value = valueOf(units, amount.identity.decimals, key, options.prices);
      if (amount.direction === "in") chain.inCount += 1;
      else chain.outCount += 1;
      if (value === null) {
        chain.unpriced += 1;
        if (amount.direction === "in") unpricedIn += 1;
        else unpricedOut += 1;
      } else if (amount.direction === "in") {
        chain.inValue = plus(chain.inValue, value);
        inValue = plus(inValue, value);
      } else {
        chain.outValue = plus(chain.outValue, value);
        outValue = plus(outValue, value);
      }
      chains.set(item.chainId, chain);
    }
  }
  const byToken = [...tokens].map(([key, token]): TokenFlow => ({
    key,
    symbol: token.identity.ticker,
    decimals: token.identity.decimals,
    in: token.in.toString(),
    out: token.out.toString(),
    inValue: valueOf(token.in, token.identity.decimals, key, options.prices),
    outValue: valueOf(token.out, token.identity.decimals, key, options.prices),
    chains: [...token.chains],
  }));
  byToken.sort((a, b) => (b.inValue ?? 0) + (b.outValue ?? 0) - ((a.inValue ?? 0) + (a.outValue ?? 0)) || a.symbol.localeCompare(b.symbol));
  const byChain = [...chains.values()].sort(
    (a, b) =>
      (b.inValue ?? 0) + (b.outValue ?? 0) - ((a.inValue ?? 0) + (a.outValue ?? 0)) || b.inCount + b.outCount - (a.inCount + a.outCount),
  );
  return {
    byToken,
    byChain,
    inValue,
    outValue,
    unpriced: unpricedIn + unpricedOut,
    unpricedIn,
    unpricedOut,
    estimate: true,
    method: ESTIMATE_METHOD,
  };
}

export interface ActivityStats {
  count: number;
  failed: number;
  swaps: number;
  ibcTransfers: number;
  /** Sent vs received at today's prices (transfers + IBC). */
  flows: FlowSummary;
  fees: FeeSummary;
  success: SuccessRate;
}

/** The Activity page's strip, in one pass of the loaded rows. */
export function activityStats(items: readonly ActivityItem[], prices?: PriceMap): ActivityStats {
  const groups = groupCounts(items);
  return {
    count: items.length,
    failed: items.filter((item) => !item.success).length,
    swaps: groups.swaps,
    ibcTransfers: groups.ibc,
    flows: flowSummary(items, prices ? { prices } : {}),
    fees: feeSummary(items, prices),
    success: successRate(items),
  };
}

/* -------------------------------------------------------------------------- */
/* CSV export                                                                  */
/* -------------------------------------------------------------------------- */

export const CSV_COLUMNS = ["date", "chain", "hash", "kind", "direction", "amount", "token", "fee", "fee token", "memo", "success"] as const;

/** Base units → an exact decimal, no grouping and no rounding ("0.000123", "17000"). */
export function exactUnits(base: string, decimals: number): string {
  if (!/^\d+$/.test(base) || !Number.isInteger(decimals) || decimals <= 0) return base;
  const padded = base.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * One CSV cell. Quoted when it holds a separator, quote or line break; a cell
 * that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab, CR at
 * the start — memos are anyone's text) is prefixed with `'`.
 */
export function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * The first line: a `#` comment (no separator, quote or line break, so no
 * CSV reader quotes it and it never starts a formula) saying how far back
 * each chain's rows go.
 */
function coverageLine(coverage: readonly ActivityCoverage[], now: number): string {
  const clean = (value: string) => value.replace(/[",\r\n]+/g, " ").trim();
  const parts = coverage.map((entry) => {
    if (entry.complete) return `${clean(entry.chainId)} complete`;
    const since = entry.oldest ? `since ${entry.oldest.slice(0, 10)}` : "unavailable";
    return `${clean(entry.chainId)} ${since} (partial${entry.note ? `: ${clean(entry.note)}` : ""})`;
  });
  return `# Zunia activity export ${new Date(now).toISOString()} · coverage: ${parts.length > 0 ? parts.join("; ") : "none"}`;
}

/**
 * The loaded rows as CSV: a coverage line, the header, then one line per
 * amount (a swap is two lines), the fee only on the transaction's first line
 * and only when this account paid it. Amounts are exact decimals; a token
 * with unknown decimals is written in base units and says so in `token`.
 *
 * `bom: true` starts the file with a UTF-8 byte order mark, which is what
 * makes Excel read tickers such as "IBC·498A" and non-Latin memos correctly;
 * pass it for a downloaded file.
 */
export function activityCsv(
  items: readonly ActivityItem[],
  coverage: readonly ActivityCoverage[],
  options: { now?: number; bom?: boolean } = {},
): string {
  const lines = [coverageLine(coverage, options.now ?? Date.now()), CSV_COLUMNS.join(",")];
  for (const item of items) {
    const fee = item.feePaid && item.fee ? item.fee : null;
    const feeAmount = fee ? (fee.decimals !== undefined ? exactUnits(fee.amount, fee.decimals) : fee.amount) : "";
    const feeToken = fee ? `${fee.symbol ?? fee.denom}${fee.decimals === undefined ? " (base units)" : ""}` : "";
    const legs = item.amounts.length > 0 ? item.amounts : [null];
    legs.forEach((leg, index) => {
      const amount = leg ? (leg.identity.decimals !== null ? exactUnits(leg.amount, leg.identity.decimals) : leg.amount) : "";
      const token = leg ? `${leg.identity.ticker}${leg.identity.decimals === null ? " (base units)" : ""}` : "";
      const row = [
        item.time,
        item.chainId,
        item.hash,
        item.kind,
        leg?.direction ?? "",
        amount,
        token,
        index === 0 ? feeAmount : "",
        index === 0 ? feeToken : "",
        index === 0 ? (item.memo ?? "") : "",
        item.success ? "true" : "false",
      ];
      lines.push(row.map(csvCell).join(","));
    });
  }
  const csv = `${lines.join("\r\n")}\r\n`;
  return options.bom ? `${String.fromCharCode(0xfeff)}${csv}` : csv;
}
