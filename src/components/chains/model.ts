/**
 * Pure rules behind the Chains, Chain detail and Networks pages: following
 * (cap, last-chain guard, reordering), catalog ordering, the native asset key
 * a chain's token is priced under, and the "leader" picks the KPI strips
 * show. No React and no I/O, so `node --test` covers them
 * (`__tests__/model.test.ts`).
 *
 * Units follow the chain analytics contract (`@/lib/chain/types`): ratios
 * arrive as fractions 0..1 and leave through `toPct` as percent units, which
 * is what the UI kit's <Percent>/<Delta> expect.
 */

import type { ChainEntry } from "@/lib/chains";
import type { ChainStats } from "@/lib/chain/types";

/**
 * The most networks the dashboard follows at once. Not a style choice: the
 * portfolio route reads at most 32 accounts per request and Zunia Mobile
 * requests at most 32 chains at pairing, so a 33rd followed chain would be
 * silently left out of both.
 */
export const MAX_FOLLOWED = 32;

export type FollowOutcome =
  | { ok: true; next: string[]; following: boolean }
  | { ok: false; reason: "cap" | "last"; message: string };

export const FOLLOW_CAP_MESSAGE = `You follow ${MAX_FOLLOWED} networks, the most the dashboard reads at once. Unfollow one to add another.`;
export const FOLLOW_LAST_MESSAGE = "Keep at least one network followed: every page reads from this list.";

/**
 * Follow or unfollow `chainId`.
 *
 * Ids the catalog no longer knows (a chain removed from the registry) are
 * dropped on the way: they would otherwise hold one of the 32 slots while
 * appearing nowhere. Unfollowing the last network is refused, because an
 * empty list leaves every page with nothing to read.
 */
export function toggleFollow(
  followed: readonly string[],
  chainId: string,
  isKnown: (chainId: string) => boolean = () => true,
): FollowOutcome {
  const current = dedupe(followed.filter(isKnown));
  if (current.includes(chainId)) {
    if (current.length <= 1) return { ok: false, reason: "last", message: FOLLOW_LAST_MESSAGE };
    return { ok: true, following: false, next: current.filter((id) => id !== chainId) };
  }
  if (current.length >= MAX_FOLLOWED) return { ok: false, reason: "cap", message: FOLLOW_CAP_MESSAGE };
  return { ok: true, following: true, next: [...current, chainId] };
}

/**
 * Moves a followed chain one place up (−1) or down (+1). The order is the
 * rail's order and the portfolio's priority when the list is trimmed, so it
 * is the user's to set. Out-of-range moves return the list unchanged (same
 * reference), so callers can skip the write.
 */
export function moveFollowed(followed: readonly string[], chainId: string, delta: -1 | 1): readonly string[] {
  const from = followed.indexOf(chainId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= followed.length) return followed;
  const next = [...followed];
  next[from] = followed[to] as string;
  next[to] = chainId;
  return next;
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/* ------------------------------------------------------------------ ordering */

/** What the markets feed says about a chain's staking token, for ordering. */
export interface MarketHint {
  marketCap: number | null;
  volume24h: number | null;
}

/** Chains the product leads with when nothing else decides (same as `@/lib/chains`). */
export const PINNED_CHAINS: readonly string[] = ["safrochain-1", "cosmoshub-4", "osmosis-1"];

function pinnedRank(chainId: string): number {
  const index = PINNED_CHAINS.indexOf(chainId);
  return index === -1 ? PINNED_CHAINS.length : index;
}

function desc(a: number | null | undefined, b: number | null | undefined): number {
  const aKnown = typeof a === "number" && Number.isFinite(a);
  const bKnown = typeof b === "number" && Number.isFinite(b);
  if (aKnown && bKnown) return (b as number) - (a as number);
  if (aKnown) return -1;
  if (bKnown) return 1;
  return 0;
}

/**
 * The catalog in the order the Chains table opens with: followed chains
 * first, in the user's own order; then the rest by market cap, then 24 h
 * volume (a token with a market beats one without), then the pinned trio,
 * then chains listed in the Cosmos registry, then by name. Chains with dead
 * endpoints and no market therefore sink instead of leading a public page.
 */
export function orderChains(
  chains: readonly ChainEntry[],
  followed: readonly string[],
  market: ReadonlyMap<string, MarketHint>,
): ChainEntry[] {
  const followRank = new Map(followed.map((id, index) => [id, index]));
  return [...chains].sort((a, b) => {
    const fa = followRank.get(a.chainId);
    const fb = followRank.get(b.chainId);
    if (fa !== undefined || fb !== undefined) {
      if (fa === undefined) return 1;
      if (fb === undefined) return -1;
      return fa - fb;
    }
    const ma = market.get(a.chainId);
    const mb = market.get(b.chainId);
    return (
      desc(ma?.marketCap, mb?.marketCap) ||
      desc(ma?.volume24h, mb?.volume24h) ||
      pinnedRank(a.chainId) - pinnedRank(b.chainId) ||
      Number(Boolean(b.inCosmosRegistry)) - Number(Boolean(a.inCosmosRegistry)) ||
      a.chainName.localeCompare(b.chainName)
    );
  });
}

/** Case-insensitive match on name, chain id, ticker or registry slug. */
export function matchesChain(chain: ChainEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    chain.chainName.toLowerCase().includes(needle) ||
    chain.chainId.toLowerCase().includes(needle) ||
    chain.coinDenom.toLowerCase().includes(needle) ||
    (chain.registrySlug?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * The asset key a chain's staking token is priced under (`TokenIdentity.key`
 * of a native denom: `<chainId>:<denom>`), e.g. `cosmoshub-4:uatom`. The
 * markets feed, price history and Compare all join on it.
 */
export function nativeAssetKey(chain: Pick<ChainEntry, "chainId" | "coinMinimalDenom">): string {
  return `${chain.chainId}:${chain.coinMinimalDenom}`;
}

/* ------------------------------------------------------------------ units */

/** A fraction (0.1834) as percent units (18.34) for <Percent>/<Delta>; null stays null. */
export function toPct(fraction: number | null | undefined): number | null {
  return typeof fraction === "number" && Number.isFinite(fraction) ? fraction * 100 : null;
}

/**
 * Days as a reader says them: "21 days", and the hours when the parameter is
 * not a whole number of days (Celestia's 14.0417 → "14 days 1 h"). "14.0
 * days" read as equal to Osmosis's 14 while Compare rightly did not call
 * them a tie.
 */
export function formatDays(days: number | null | undefined): string | null {
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) return null;
  let whole = Math.floor(days + 1e-9);
  let hours = Math.round((days - whole) * 24);
  if (hours === 24) {
    whole += 1;
    hours = 0;
  }
  const dayText = `${whole} ${whole === 1 ? "day" : "days"}`;
  if (hours === 0) return dayText;
  return whole === 0 ? `${hours} h` : `${dayText} ${hours} h`;
}

/** "2.77 s", "0.45 s", "6.1 s". */
export function formatSeconds(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const digits = seconds < 10 ? 2 : 1;
  return `${seconds.toFixed(digits)} s`;
}

/**
 * How much of a holder's share of supply inflation takes away per year when
 * the tokens sit unstaked: 1 − 1 ÷ (1 + inflation). At 13 % issuance an
 * idle holder keeps 1/1.13 of their share, i.e. loses 11.5 % of it.
 */
export function dilution(inflation: number | null | undefined): number | null {
  if (typeof inflation !== "number" || !Number.isFinite(inflation) || inflation <= -1) return null;
  return 1 - 1 / (1 + inflation);
}

/* ------------------------------------------------------------------ leaders */

export interface Leader {
  stats: ChainStats;
  value: number;
  /** How many chains had a value for the metric (the "of N" in captions). */
  among: number;
}

/**
 * The chain with the highest (or lowest) value of a metric, among chains
 * that have one. Ties go to the earlier chain in `stats` (the table's
 * order). Null when fewer than `minimum` chains have a value: a "leader"
 * of one is not a comparison.
 */
export function leaderOf(
  stats: readonly ChainStats[],
  pick: (chain: ChainStats) => number | null | undefined,
  direction: "max" | "min",
  minimum = 2,
): Leader | null {
  let best: { stats: ChainStats; value: number } | null = null;
  let among = 0;
  for (const chain of stats) {
    const value = pick(chain);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    among += 1;
    if (!best || (direction === "max" ? value > best.value : value < best.value)) best = { stats: chain, value };
  }
  return best && among >= minimum ? { ...best, among } : null;
}

/** Chains whose latest block is too old (halted, or the public node stalled). */
export function haltedCount(stats: readonly ChainStats[]): { halted: number; known: number } {
  let halted = 0;
  let known = 0;
  for (const chain of stats) {
    if (chain.halted === null) continue;
    known += 1;
    if (chain.halted) halted += 1;
  }
  return { halted, known };
}

/**
 * How many times faster (> 1) or slower (< 1) blocks arrive than the mint
 * parameters assume; null when either side is unknown (epoch- or time-based
 * mints have no assumed block time, so the question does not arise).
 */
export function blockSpeedup(stats: Pick<ChainStats, "blockTimeSec" | "paramsBlockTimeSec">): number | null {
  const { blockTimeSec, paramsBlockTimeSec } = stats;
  if (!blockTimeSec || !paramsBlockTimeSec || blockTimeSec <= 0 || paramsBlockTimeSec <= 0) return null;
  return paramsBlockTimeSec / blockTimeSec;
}

export interface StakeInHaltingSet {
  /** Validators the account has stake with (non-zero delegations). */
  validators: number;
  /** Percent of that stake with validators of the Nakamoto set; null when no membership is known. */
  share: number | null;
  /** Delegations whose validator's set membership is unknown (left out of `share`). */
  unknown: number;
}

/**
 * How much of an account's stake on a chain sits with the validators that
 * could halt it together (the Nakamoto set): the fact behind "delegating to
 * the largest validators concentrates the chain". BigInt sums, because
 * base-unit amounts overflow doubles on 18-decimal chains.
 */
export function stakeInHaltingSet(
  delegations: readonly { amount: string; validator: { inNakamotoSet: boolean | null } }[],
): StakeInHaltingSet {
  const zero = BigInt(0);
  let total = zero;
  let inSet = zero;
  let validators = 0;
  let unknown = 0;
  for (const delegation of delegations) {
    if (!/^\d+$/.test(delegation.amount)) continue;
    const amount = BigInt(delegation.amount);
    if (amount === zero) continue;
    validators += 1;
    if (delegation.validator.inNakamotoSet === null) {
      unknown += 1;
      continue;
    }
    total += amount;
    if (delegation.validator.inNakamotoSet) inSet += amount;
  }
  return { validators, unknown, share: total > zero ? Number((inSet * BigInt(10_000)) / total) / 100 : null };
}

/**
 * Nothing about the chain could be read (its public node is down): the same
 * rule as the server's `statsUnavailable` (`src/lib/server/chain/stats.ts`,
 * server-only, so it is restated here). The page then says so once instead
 * of showing a wall of dashes.
 */
export function statsUnreadable(stats: Pick<ChainStats, "bondedTokens" | "latestHeight" | "activeValidators" | "apr">): boolean {
  return stats.bondedTokens === null && stats.latestHeight === null && stats.activeValidators === null && stats.apr.naive === null;
}

/** The first reason a stats answer gives for a missing figure, for a one-line explanation. */
export function firstReason(stats: Pick<ChainStats, "reasons" | "errors">): string | null {
  const reasons = stats.reasons ?? {};
  return reasons.latestHeight ?? reasons.apr ?? reasons.bondedTokens ?? Object.values(reasons)[0] ?? stats.errors?.[0]?.message ?? null;
}
