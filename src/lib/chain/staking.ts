/**
 * One account's staking state: delegations, pending rewards, unbonding and
 * redelegation entries, and the stake-weighted APR.
 *
 * The weighted APR counts a jailed or inactive validator at 0 %, because
 * stake there earns nothing until it is back in the active set — the number
 * a "your yield" figure must not hide.
 *
 * Pure: parsing and arithmetic only.
 */

import { arr, coins, intString, parseIntSafe, parseTime, pick, rec, str, toBigInt } from "./parse";
import type { Coin, RedelegationEntry, UnbondingEntry } from "./types";

export interface RawDelegation {
  validator: string;
  denom: string;
  amount: string;
}

/** `cosmos/staking/v1beta1/delegations/{addr}` → one row per validator. */
export function parseDelegations(body: unknown): RawDelegation[] {
  const out: RawDelegation[] = [];
  for (const item of arr(pick(body, ["delegation_responses"]))) {
    const entry = rec(item);
    const validator = str(pick(entry, ["delegation", "validator_address"]));
    const denom = str(pick(entry, ["balance", "denom"]));
    const amount = intString(pick(entry, ["balance", "amount"]));
    if (validator && denom && amount !== null) out.push({ validator, denom, amount });
  }
  return out;
}

/** `cosmos/distribution/v1beta1/delegators/{addr}/rewards` → rewards per validator. */
export function parseRewards(body: unknown): Map<string, Coin[]> {
  const out = new Map<string, Coin[]>();
  for (const item of arr(pick(body, ["rewards"]))) {
    const entry = rec(item);
    const validator = str(entry?.validator_address);
    if (!validator) continue;
    // Dust below one base unit truncates to 0 and is not worth a row.
    out.set(
      validator,
      coins(entry?.reward).filter((coin) => coin.amount !== "0"),
    );
  }
  return out;
}

export interface RawUnbonding {
  validator: string;
  entries: UnbondingEntry[];
}

function entriesOf(value: unknown): UnbondingEntry[] {
  const out: UnbondingEntry[] = [];
  for (const item of arr(value)) {
    // Redelegation entries nest the fields under `redelegation_entry`.
    const raw = rec(item);
    const entry = rec(raw?.redelegation_entry) ?? raw;
    const completionTime = parseTime(entry?.completion_time);
    const balance = intString(raw?.balance) ?? intString(entry?.balance);
    const initialBalance = intString(entry?.initial_balance);
    if (!completionTime || balance === null) continue;
    out.push({
      balance,
      initialBalance: initialBalance ?? balance,
      completionTime,
      creationHeight: parseIntSafe(entry?.creation_height) ?? 0,
    });
  }
  return out.sort((a, b) => Date.parse(a.completionTime) - Date.parse(b.completionTime));
}

/** `cosmos/staking/v1beta1/delegators/{addr}/unbonding_delegations` */
export function parseUnbonding(body: unknown): RawUnbonding[] {
  const out: RawUnbonding[] = [];
  for (const item of arr(pick(body, ["unbonding_responses"]))) {
    const entry = rec(item);
    const validator = str(entry?.validator_address);
    const entries = entriesOf(entry?.entries);
    if (validator && entries.length) out.push({ validator, entries });
  }
  return out;
}

export interface RawRedelegation {
  src: string;
  dst: string;
  entries: RedelegationEntry[];
}

/** `cosmos/staking/v1beta1/delegators/{addr}/redelegations` */
export function parseRedelegations(body: unknown): RawRedelegation[] {
  const out: RawRedelegation[] = [];
  for (const item of arr(pick(body, ["redelegation_responses"]))) {
    const entry = rec(item);
    const src = str(pick(entry, ["redelegation", "validator_src_address"]));
    const dst = str(pick(entry, ["redelegation", "validator_dst_address"]));
    const entries = entriesOf(entry?.entries);
    if (src && dst && entries.length) out.push({ src, dst, entries });
  }
  return out;
}

/** `cosmos/distribution/v1beta1/delegators/{addr}/withdraw_address` */
export function parseWithdrawAddress(body: unknown): string | null {
  return str(pick(body, ["withdraw_address"]));
}

/** Sum of the `denom` amounts in a list of coin lists. */
export function sumDenom(lists: ReadonlyArray<readonly Coin[]>, denom: string): string {
  let total = BigInt(0);
  for (const list of lists) {
    for (const coin of list) {
      if (coin.denom === denom) total += toBigInt(coin.amount) ?? BigInt(0);
    }
  }
  return total.toString();
}

/** Every denom other than `denom`, summed, largest first. */
export function otherDenoms(lists: ReadonlyArray<readonly Coin[]>, denom: string): Coin[] {
  const totals = new Map<string, bigint>();
  for (const list of lists) {
    for (const coin of list) {
      if (coin.denom === denom) continue;
      totals.set(coin.denom, (totals.get(coin.denom) ?? BigInt(0)) + (toBigInt(coin.amount) ?? BigInt(0)));
    }
  }
  return [...totals.entries()]
    .filter(([, amount]) => amount > BigInt(0))
    .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
    .map(([d, amount]) => ({ denom: d, amount: amount.toString() }));
}

/**
 * Stake-weighted APR across positions. Positions whose APR is unknown make
 * the whole figure unknown: averaging only the known ones would overstate it.
 */
export function weightedApr(positions: ReadonlyArray<{ amount: string; apr: number | null }>): number | null {
  let total = 0;
  let weighted = 0;
  for (const position of positions) {
    const amount = Number(position.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (position.apr === null) return null;
    total += amount;
    weighted += amount * position.apr;
  }
  return total > 0 ? weighted / total : null;
}

/** Earliest unbonding completion across positions. */
export function nextRelease(
  positions: ReadonlyArray<{ entries: readonly UnbondingEntry[] }>,
): { completionTime: string; balance: string } | null {
  let best: UnbondingEntry | null = null;
  for (const position of positions) {
    for (const entry of position.entries) {
      if (!best || Date.parse(entry.completionTime) < Date.parse(best.completionTime)) best = entry;
    }
  }
  return best ? { completionTime: best.completionTime, balance: best.balance } : null;
}
