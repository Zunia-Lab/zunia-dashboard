/**
 * Validator set analytics: ranking, voting-power shares, the Nakamoto
 * coefficient, commission headroom and uptime.
 *
 * Shares are computed over the **whole** bonded set. The previous reader kept
 * the first 150 rows the LCD returned and then the top 40, so on the Hub every
 * voting-power figure was a share of a partial total and the Nakamoto
 * coefficient could not be computed at all.
 *
 * Pure: parsing and math only; the I/O lives in `@/lib/server/chain`.
 */

import { validatorApr } from "./apr";
import {
  clip,
  intString,
  parseDec,
  parseIntSafe,
  parseTime,
  pick,
  rec,
  safeWebsite,
  str,
} from "./parse";
import type { ValidatorRow, ValidatorSetSummary, ValidatorStatus } from "./types";
import {
  addressHex,
  bech32Prefix,
  consensusHex,
  consensusPrefixFor,
  operatorAccount,
  valconsAddress,
  type ConsensusPubkey,
} from "./valcons";

const DAY_MS = 86_400_000;

/** One validator as the staking module reports it. */
export interface RawValidator {
  operatorAddress: string;
  consensusPubkey: ConsensusPubkey | null;
  /**
   * Hex of the 20-byte consensus address derived from the key (null when the
   * key type is not derivable). Computed once when the list is parsed, so a
   * cached set is not re-hashed on every request.
   */
  consensusHex: string | null;
  jailed: boolean;
  status: ValidatorStatus;
  tokens: string;
  delegatorShares: string;
  moniker: string;
  identity: string | null;
  website: string | null;
  details: string | null;
  securityContact: string | null;
  unbondingTime: string | null;
  commission: {
    rate: number;
    maxRate: number;
    maxChangeRate: number;
    updatedAt: string | null;
  };
  minSelfDelegation: string;
}

/** `BOND_STATUS_BONDED` (or the numeric enum some gateways emit) → status. */
export function bondStatus(raw: unknown): ValidatorStatus | null {
  const value = String(raw ?? "").trim().toUpperCase().replace(/^BOND_STATUS_/, "");
  if (value === "BONDED" || value === "3") return "bonded";
  if (value === "UNBONDING" || value === "2") return "unbonding";
  if (value === "UNBONDED" || value === "1") return "unbonded";
  return null;
}

/**
 * One entry of `cosmos/staking/v1beta1/validators`, or null when unusable.
 *
 * Commission rates are required: a row with an unreadable rate would have to
 * show a made-up one (0 % looks like the best validator on the chain, and an
 * unknown `max_rate` would hide how far the rate can rise). Such a row is
 * dropped instead and the caller reports how many were (`Pages.dropped`).
 */
export function parseValidator(raw: unknown): RawValidator | null {
  const v = rec(raw);
  const operatorAddress = str(v?.operator_address);
  const tokens = intString(v?.tokens);
  const status = bondStatus(v?.status);
  if (!v || !operatorAddress || tokens === null || !status) return null;

  const pubkey = rec(v.consensus_pubkey);
  const typeUrl = str(pubkey?.["@type"]);
  const key = str(pubkey?.key);
  const rates = rec(pick(v, ["commission", "commission_rates"]));
  const description = rec(v.description);
  const rate = parseDec(rates?.rate);
  const maxRate = parseDec(rates?.max_rate);
  const maxChangeRate = parseDec(rates?.max_change_rate);
  if (rate === null || maxRate === null || maxChangeRate === null) return null;

  const consensusPubkey = typeUrl && key ? { typeUrl, key } : null;
  return {
    operatorAddress,
    consensusPubkey,
    consensusHex: consensusHex(consensusPubkey),
    jailed: v.jailed === true,
    status,
    tokens,
    delegatorShares: intString(v.delegator_shares) ?? tokens,
    // Monikers and details are free text set by anyone who runs a validator;
    // cap them so one validator cannot bloat every list payload.
    moniker: clip(str(description?.moniker), 70) ?? operatorAddress,
    identity: clip(str(description?.identity), 64),
    website: safeWebsite(description?.website),
    details: clip(str(description?.details), 600),
    securityContact: clip(str(description?.security_contact), 120),
    unbondingTime: status === "bonded" ? null : parseTime(v.unbonding_time),
    commission: {
      rate,
      maxRate,
      maxChangeRate,
      updatedAt: parseTime(pick(v, ["commission", "update_time"])),
    },
    minSelfDelegation: intString(v.min_self_delegation) ?? "0",
  };
}

/** One entry of `cosmos/slashing/v1beta1/signing_infos`. */
export interface RawSigningInfo {
  address: string;
  /** Hex of the address bytes: the join key (prefixes differ between chains). */
  hex: string;
  startHeight: number | null;
  indexOffset: number | null;
  jailedUntil: string | null;
  tombstoned: boolean;
  missedBlocks: number | null;
}

export function parseSigningInfo(raw: unknown): RawSigningInfo | null {
  const info = rec(raw);
  const address = str(info?.address);
  const hex = address ? addressHex(address) : null;
  if (!info || !address || !hex) return null;
  return {
    address,
    hex,
    startHeight: parseIntSafe(info.start_height),
    indexOffset: parseIntSafe(info.index_offset),
    jailedUntil: parseTime(info.jailed_until),
    tombstoned: info.tombstoned === true,
    missedBlocks: parseIntSafe(info.missed_blocks_counter),
  };
}

/** Signing infos keyed by consensus-address bytes, with the chain's consensus prefix. */
export interface SigningIndex {
  byHex: ReadonlyMap<string, RawSigningInfo>;
  /** The prefix the chain's own signing infos use (`cosmosvalcons`, `crocnclcons`); null when none were read. */
  prefix: string | null;
}

export function signingIndex(infos: readonly RawSigningInfo[]): SigningIndex {
  const byHex = new Map<string, RawSigningInfo>();
  let prefix: string | null = null;
  for (const info of infos) {
    byHex.set(info.hex, info);
    prefix ??= bech32Prefix(info.address);
  }
  return { byHex, prefix };
}

/** Descending by tokens (exact, via bigint), ties by operator address. */
export function sortByTokens<T extends { tokens: string; operatorAddress: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = BigInt(a.tokens);
    const tb = BigInt(b.tokens);
    if (ta !== tb) return ta > tb ? -1 : 1;
    return a.operatorAddress < b.operatorAddress ? -1 : a.operatorAddress > b.operatorAddress ? 1 : 0;
  });
}

/** Each validator's share of the total (input order kept), plus the total. */
export function votingShares(tokens: readonly string[]): { shares: number[]; total: bigint } {
  let total = BigInt(0);
  for (const value of tokens) total += BigInt(value);
  const denominator = Number(total);
  const shares = tokens.map((value) => (denominator > 0 ? Number(value) / denominator : 0));
  return { shares, total };
}

/**
 * Smallest number of validators that together hold more than `threshold` of
 * the voting power (1/3 halts the chain), given shares sorted descending.
 */
export function nakamotoCoefficient(sharesDesc: readonly number[], threshold = 1 / 3): number | null {
  let cumulative = 0;
  for (let index = 0; index < sharesDesc.length; index += 1) {
    cumulative += sharesDesc[index] ?? 0;
    if (cumulative > threshold) return index + 1;
  }
  return null;
}

/** Combined share of the `n` largest validators (shares sorted descending). */
export function topShare(sharesDesc: readonly number[], n: number): number | null {
  if (sharesDesc.length === 0) return null;
  return sharesDesc.slice(0, n).reduce((sum, share) => sum + share, 0);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * The highest commission a validator can legally reach within `days`.
 *
 * The staking module allows one change per 24 h, by at most `maxChangeRate`,
 * never above `maxRate`. The first change is possible 24 h after the last one
 * (`updatedAt`); then one per day. Counts the change slots inside
 * [now, now + days) and adds `maxChangeRate` for each.
 */
export function reachableCommission(
  commission: { rate: number; maxRate: number; maxChangeRate: number; updatedAt: string | null },
  days: number,
  now: number,
): number {
  const { rate, maxRate, maxChangeRate } = commission;
  if (!(maxChangeRate > 0) || rate >= maxRate || days <= 0) return rate;
  const last = commission.updatedAt ? Date.parse(commission.updatedAt) : Number.NaN;
  const firstSlot = Number.isFinite(last) ? Math.max(now, last + DAY_MS) : now;
  const end = now + days * DAY_MS;
  const changes = firstSlot < end ? Math.floor((end - 1 - firstSlot) / DAY_MS) + 1 : 0;
  // Rounded to 12 decimals so 0.05 + 0.01 reads 0.06, not 0.060000000000000005.
  return Math.round(Math.min(maxRate, rate + changes * maxChangeRate) * 1e12) / 1e12;
}

/**
 * Signed share of the uptime window.
 *
 * `indexOffset` counts the blocks the validator has been in the set for; a
 * newcomer's window is not full yet, so the denominator is the smaller of the
 * two. Returns the window actually used so the UI can say "1 missed of 2,431".
 */
export function uptimeOf(
  info: Pick<RawSigningInfo, "missedBlocks" | "indexOffset"> | null,
  window: number | null,
): { uptime: number | null; missed: number | null; window: number | null } {
  if (!info || info.missedBlocks === null || window === null || window <= 0) {
    return { uptime: null, missed: info?.missedBlocks ?? null, window: null };
  }
  const counted =
    info.indexOffset !== null && info.indexOffset > 0 ? Math.min(window, info.indexOffset) : window;
  const missed = Math.min(info.missedBlocks, counted);
  return { uptime: counted > 0 ? 1 - missed / counted : null, missed, window: counted };
}

export interface BuildOptions {
  /** Account prefix of the chain (`cosmos`, `addr_safro`…). */
  accountPrefix: string;
  /** Slashing `signed_blocks_window`; null when unknown. */
  window: number | null;
  /** Chain actual APR before commission; null when unknown. */
  chainApr: number | null;
  now: number;
}

/**
 * Joins validators with their signing info and ranks them.
 *
 * Bonded validators come first, by tokens, with shares of the bonded total;
 * inactive ones follow (by tokens) with no rank and zero voting power.
 * `signing` is null when the signing infos could not be read, so uptime and
 * tombstone state are null rather than looking like "never missed a block".
 *
 * Uptime is only reported for bonded validators. x/slashing resets the
 * missed-blocks counter when it jails a validator and stops counting once it
 * leaves the set, so an inactive validator's counter reads "0 missed" — a
 * validator jailed for downtime would show 100 % uptime.
 */
export function buildValidatorRows(
  validators: readonly RawValidator[],
  signing: SigningIndex | null,
  options: BuildOptions,
): ValidatorRow[] {
  const bonded = sortByTokens(validators.filter((v) => v.status === "bonded"));
  const inactive = sortByTokens(validators.filter((v) => v.status !== "bonded"));
  const { shares } = votingShares(bonded.map((v) => v.tokens));
  const nakamoto = nakamotoCoefficient(shares);

  let cumulative = 0;
  const toRow = (v: RawValidator, index: number | null): ValidatorRow => {
    const share = index === null ? 0 : (shares[index] ?? 0);
    if (index !== null) cumulative += share;
    const consensusPrefix = signing?.prefix ?? consensusPrefixFor(v.operatorAddress, options.accountPrefix);
    const consensusAddress = valconsAddress(v.consensusPubkey, options.accountPrefix, consensusPrefix);
    const info = v.consensusHex && signing ? (signing.byHex.get(v.consensusHex) ?? null) : null;
    const counted = v.status === "bonded" ? uptimeOf(info, options.window) : null;
    const active = v.status === "bonded" && !v.jailed;
    return {
      operatorAddress: v.operatorAddress,
      accountAddress: operatorAccount(v.operatorAddress, options.accountPrefix),
      consensusAddress,
      moniker: v.moniker,
      ...(v.identity ? { identity: v.identity } : {}),
      ...(v.website ? { website: v.website } : {}),
      ...(v.details ? { details: v.details } : {}),
      ...(v.securityContact ? { securityContact: v.securityContact } : {}),
      rank: index === null ? null : index + 1,
      status: v.status,
      jailed: v.jailed,
      tombstoned: info ? info.tombstoned : null,
      jailedUntil: info?.jailedUntil ?? null,
      unbondingTime: v.unbondingTime,
      tokens: v.tokens,
      delegatorShares: v.delegatorShares,
      minSelfDelegation: v.minSelfDelegation,
      votingPower: share,
      cumulative: index === null ? null : cumulative,
      inNakamotoSet: index !== null && nakamoto !== null && index < nakamoto,
      commission: {
        ...v.commission,
        reachable30d: reachableCommission(v.commission, 30, options.now),
        reachable90d: reachableCommission(v.commission, 90, options.now),
      },
      uptime: counted?.uptime ?? null,
      missedBlocks: counted?.missed ?? null,
      signedWindow: counted?.window ?? null,
      apr: active ? validatorApr(options.chainApr, v.commission.rate) : options.chainApr === null ? null : 0,
    };
  };

  return [...bonded.map((v, i) => toRow(v, i)), ...inactive.map((v) => toRow(v, null))];
}

/** Summary of the bonded set (rows from `buildValidatorRows`). */
export function summariseValidators(
  rows: readonly ValidatorRow[],
  options: { maxValidators: number | null; aprActual: number | null; signedBlocksWindow: number | null },
): ValidatorSetSummary {
  const bonded = rows.filter((row) => row.status === "bonded");
  const sharesDesc = bonded.map((row) => row.votingPower);
  let bondedTokens = BigInt(0);
  for (const row of bonded) bondedTokens += BigInt(row.tokens);
  const full = options.maxValidators !== null ? bonded.length >= options.maxValidators : null;
  const last = bonded[bonded.length - 1];
  return {
    active: bonded.length,
    maxValidators: options.maxValidators,
    activeSetFull: full,
    cutoffTokens: full && last ? last.tokens : null,
    nakamoto: nakamotoCoefficient(sharesDesc),
    top10Share: topShare(sharesDesc, 10),
    medianCommission: median(bonded.map((row) => row.commission.rate)),
    bondedTokens: bonded.length ? bondedTokens.toString() : null,
    aprActual: options.aprActual,
    signedBlocksWindow: options.signedBlocksWindow,
  };
}
