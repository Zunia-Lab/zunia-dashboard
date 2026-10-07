/**
 * Pure rules of the Compare page: the shareable `?ids=` list, which value in
 * a row is "best", and the risk/return figures computed from a price series.
 * No React, no I/O (`__tests__/model.test.ts`).
 */

/** A chain (its staking token stands in for it on price rows) or an asset by key. */
export type EntityKind = "chain" | "asset";

export interface EntityRef {
  kind: EntityKind;
  /** A catalog chain id, or an asset key (`TokenIdentity.key`, e.g. `cosmoshub-4:uatom`). */
  id: string;
}

/** Side by side stops being readable past four columns on a laptop. */
export const MAX_ENTITIES = 4;

/** The opening comparison: the home chain, the Hub, the swap venue, a data-availability chain. */
export const DEFAULT_REFS: readonly EntityRef[] = [
  { kind: "chain", id: "safrochain-1" },
  { kind: "chain", id: "cosmoshub-4" },
  { kind: "chain", id: "osmosis-1" },
  { kind: "chain", id: "celestia" },
];

export function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function sameRefs(a: readonly EntityRef[], b: readonly EntityRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => refKey(ref) === refKey(b[i] as EntityRef));
}

/**
 * Reads `ids=chain:osmosis-1,asset:cosmoshub-4:uatom`. The kind is the text
 * before the first colon (an asset key has colons of its own); unknown kinds,
 * empty ids, duplicates, entries `isValid` rejects and anything past the
 * fourth are dropped, so a hand-edited or stale link still opens a sensible
 * page instead of an error.
 */
export function parseIds(
  raw: string | null | undefined,
  isValid: (ref: EntityRef) => boolean = () => true,
): EntityRef[] {
  if (!raw) return [];
  const out: EntityRef[] = [];
  const seen = new Set<string>();
  for (const token of raw.split(",")) {
    const text = token.trim();
    const colon = text.indexOf(":");
    if (colon <= 0) continue;
    const kind = text.slice(0, colon);
    const id = text.slice(colon + 1).trim();
    if ((kind !== "chain" && kind !== "asset") || !id) continue;
    const ref: EntityRef = { kind, id };
    const key = refKey(ref);
    if (seen.has(key) || !isValid(ref)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length === MAX_ENTITIES) break;
  }
  return out;
}

/**
 * The `ids` value for a list, readable in the address bar: each entry is
 * percent-encoded except the `:` and `/` asset keys are made of, which are
 * legal in a query string.
 */
export function serializeIds(refs: readonly EntityRef[]): string {
  return refs
    .slice(0, MAX_ENTITIES)
    .map((ref) => encodeURIComponent(refKey(ref)).replace(/%3A/gi, ":").replace(/%2F/gi, "/"))
    .join(",");
}

/** `/compare?ids=…`, or `/compare` for an empty list. */
export function compareHref(refs: readonly EntityRef[]): string {
  return refs.length > 0 ? `/compare?ids=${serializeIds(refs)}` : "/compare";
}

/* ------------------------------------------------------------------ best value */

export type BestRule = "max" | "min";

/**
 * Indexes holding the best value of a row. Needs at least two known values
 * (a "best" of one is not a comparison) and is empty when every known value
 * is the same (three chains with 14-day unbonding have no winner). Ties for
 * best are all returned.
 */
export function bestIndexes(values: readonly (number | null | undefined)[], rule: BestRule): Set<number> {
  const known = values
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => typeof entry.value === "number" && Number.isFinite(entry.value));
  if (known.length < 2) return new Set();
  const best = rule === "max" ? Math.max(...known.map((e) => e.value)) : Math.min(...known.map((e) => e.value));
  const worst = rule === "max" ? Math.min(...known.map((e) => e.value)) : Math.max(...known.map((e) => e.value));
  if (nearlyEqual(best, worst)) return new Set();
  return new Set(known.filter((e) => nearlyEqual(e.value, best)).map((e) => e.index));
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/* ------------------------------------------------------------------ performance */

export interface Sample {
  /** Epoch ms. */
  t: number;
  v: number;
}

export interface Performance {
  /** Change from the first to the last sample, as a fraction (0.124 = +12.4 %). */
  change: number | null;
  /**
   * Deepest fall from a running peak, as a fraction ≤ 0 (−0.31 = −31 %), so
   * "higher is better" holds as for the change.
   */
  maxDrawdown: number | null;
  /** Standard deviation of log returns, annualised from the sampling step. */
  volatility: number | null;
  /** First and last sample used. */
  from: number | null;
  to: number | null;
}

const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Finite, positive (prices), ascending, one per timestamp. */
function usable(points: readonly Sample[]): Sample[] {
  const byTime = new Map<number, number>();
  for (const p of points) {
    if (Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0) byTime.set(p.t, p.v);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
}

/**
 * Risk and return of a price series from `from` on (the chart's common start,
 * so every column covers the same window). Volatility needs three returns at
 * least and is annualised with the median sampling step (hourly series × √8760,
 * daily × √365), which is the convention for close-to-close volatility.
 */
export function performance(points: readonly Sample[], from?: number | null): Performance {
  const all = usable(points);
  const series = typeof from === "number" ? all.filter((p) => p.t >= from) : all;
  const empty: Performance = { change: null, maxDrawdown: null, volatility: null, from: null, to: null };
  if (series.length < 2) return series.length === 1 ? { ...empty, from: series[0]!.t, to: series[0]!.t } : empty;

  const first = series[0] as Sample;
  const last = series[series.length - 1] as Sample;
  const change = last.v / first.v - 1;

  let peak = first.v;
  let maxDrawdown = 0;
  for (const p of series) {
    if (p.v > peak) peak = p.v;
    const fall = p.v / peak - 1;
    if (fall < maxDrawdown) maxDrawdown = fall;
  }

  let volatility: number | null = null;
  if (series.length >= 4) {
    const returns: number[] = [];
    const steps: number[] = [];
    for (let i = 1; i < series.length; i += 1) {
      const a = series[i - 1] as Sample;
      const b = series[i] as Sample;
      returns.push(Math.log(b.v / a.v));
      steps.push(b.t - a.t);
    }
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    const step = median(steps);
    if (step > 0) volatility = Math.sqrt(variance) * Math.sqrt(YEAR_MS / step);
  }

  return { change, maxDrawdown, volatility, from: first.t, to: last.t };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Where an indexed comparison can start: the latest first sample across the
 * series that have data (the chart kit's `rebaseToIndex` uses the same rule).
 * A token listed recently therefore moves everyone's start to its listing,
 * which the page says in words.
 */
export function commonStart(series: readonly (readonly Sample[])[]): number | null {
  const starts = series.map((points) => usable(points)[0]?.t).filter((t): t is number => typeof t === "number");
  return starts.length > 0 ? Math.max(...starts) : null;
}
