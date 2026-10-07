/**
 * The staking page's numbers, derived from `/api/staking` (positions),
 * `/api/chains/stats` (price, APR, unbonding period) and `/api/portfolio`
 * (liquid balances).
 *
 * Pure: no React, no I/O, so `node --test` covers it. The page hooks feed it
 * and render what comes out.
 *
 * House rules this module keeps:
 *
 * - Amounts stay base-unit strings (BigInt maths) until a value is needed;
 *   only then are they turned into floats, and only for fiat.
 * - Unknown is `null`, never 0: a chain whose price is missing has a staked
 *   amount but no staked value, and the totals say which chains they leave
 *   out instead of quietly counting them as nothing.
 * - Across chains, tokens cannot be added, so every cross-chain average is
 *   weighted by value (a value-weighted APR); within one chain, by tokens.
 */

import type {
  ChainStats,
  Coin,
  PartError,
  RedelegationPosition,
  StakingChain,
  ValidatorLite,
  ValidatorRow,
} from "@/lib/chain/types";
import { formatAmount, formatPercent, NO_VALUE } from "@/lib/format";

export const DAY_MS = 86_400_000;

/** Below this share of the signing window a validator is flagged (spec §6). */
export const LOW_UPTIME = 0.95;

/**
 * The SDK default for `max_entries`: pending unbondings per (delegator,
 * validator), and pending redelegations per (delegator, source,
 * destination). Chains can change it; none of the curated ones has.
 */
export const MAX_ENTRIES = 7;

const ZERO = BigInt(0);

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

/** A base-unit integer string as a BigInt; null when it is not one. */
export function toBig(amount: string | null | undefined): bigint | null {
  if (amount === null || amount === undefined) return null;
  const text = amount.trim();
  return /^-?\d+$/.test(text) ? BigInt(text) : null;
}

/** Sum of base-unit strings, skipping unreadable ones. */
export function sumBase(values: ReadonlyArray<string | null | undefined>): string {
  let total = ZERO;
  for (const value of values) {
    const big = toBig(value);
    if (big !== null) total += big;
  }
  return total.toString();
}

/**
 * Whole tokens as a float, for value maths only (never for display: the
 * kit's TokenAmount formats base units exactly). Null when the decimals are
 * unknown, because scaling by a guess could make 12 tokens read as 12 million.
 */
export function toWhole(amount: string | null | undefined, decimals: number | null | undefined): number | null {
  if (decimals === null || decimals === undefined || !Number.isInteger(decimals) || decimals < 0) return null;
  const big = toBig(amount);
  if (big === null) return null;
  // Split at the decimal point in BigInt first so 18-decimal amounts keep
  // their leading digits; the float only ever holds the scaled result.
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = big / scale;
  const fraction = big % scale;
  return Number(whole) + Number(fraction) / Number(scale);
}

/** Whole tokens × price, or null when either is unknown. */
export function valueOf(whole: number | null, price: number | null | undefined): number | null {
  if (whole === null || price === null || price === undefined || !Number.isFinite(price)) return null;
  return whole * price;
}

/** Display units to base units, cut (never rounded up). Null for a malformed amount. */
export function toBaseUnits(display: string, decimals: number): string | null {
  const text = display.trim();
  if (!/^\d*(?:\.\d*)?$/.test(text) || text === "" || text === ".") return null;
  const [whole = "", fraction = ""] = text.split(".");
  const digits = `${whole || "0"}${fraction.slice(0, decimals).padEnd(decimals, "0")}`;
  return BigInt(digits).toString();
}

/** Base units to an exact display string ("12.5"), for prefilling an amount field. */
export function toDisplay(amount: string, decimals: number): string {
  const big = toBig(amount);
  if (big === null || big < ZERO) return "0";
  if (decimals <= 0) return big.toString();
  const text = big.toString().padStart(decimals + 1, "0");
  const whole = text.slice(0, -decimals);
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/* -------------------------------------------------------------------------- */
/* Validator flags                                                             */
/* -------------------------------------------------------------------------- */

export type FlagTone = "danger" | "warning" | "neutral" | "info";

export interface ValidatorFlag {
  id: "tombstoned" | "jailed" | "inactive" | "uptime" | "commission" | "nakamoto" | "unknown";
  tone: FlagTone;
  /** Two or three words for a badge. */
  label: string;
  /** One sentence for the tooltip and screen readers. */
  detail: string;
}

function pct(fraction: number, digits = 1): string {
  const value = fraction * 100;
  const fixed = value.toFixed(digits);
  // "20%" rather than "20.0%"; "9.5%" stays.
  return `${fixed.replace(/\.0+$/, "")}%`;
}

/**
 * A commission rise worth a warning colour: it could reach 25% or more, or
 * climb 15 points or more, within 30 days. Smaller headroom is shown as a
 * plain fact: on most chains nearly every validator can raise its rate some
 * way (Safrochain's all cap at 20%), and colouring every row would bury the
 * ones that matter.
 */
export function steepCommissionRise(rate: number, reach30d: number): boolean {
  return reach30d >= 0.25 - 1e-9 || reach30d - rate >= 0.15 - 1e-9;
}

/** The staking-row view of a full validator row (client-safe twin of the server's `liteOf`). */
export function toLite(row: ValidatorRow): ValidatorLite {
  return {
    operatorAddress: row.operatorAddress,
    moniker: row.moniker,
    ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
    status: row.status,
    jailed: row.jailed,
    tombstoned: row.tombstoned,
    commissionRate: row.commission.rate,
    commissionMaxRate: row.commission.maxRate,
    commissionReachable30d: row.commission.reachable30d,
    uptime: row.uptime,
    rank: row.rank,
    votingPower: row.status === "bonded" ? row.votingPower : null,
    inNakamotoSet: row.inNakamotoSet,
    apr: row.apr,
  };
}

/**
 * What a delegator should know about a validator, worst first: tombstoned,
 * jailed, inactive (all three earn nothing), low uptime, commission that can
 * legally rise within 30 days, membership of the Nakamoto set.
 */
export function validatorFlags(v: ValidatorLite): ValidatorFlag[] {
  const flags: ValidatorFlag[] = [];
  if (v.tombstoned) {
    flags.push({
      id: "tombstoned",
      tone: "danger",
      label: "Tombstoned",
      detail: "Permanently removed after double-signing. Stake here earns nothing; move it.",
    });
  }
  if (v.jailed) {
    flags.push({
      id: "jailed",
      tone: "danger",
      label: "Jailed",
      detail: "Removed from the active set for downtime or misbehaviour. Stake here earns nothing while it is jailed.",
    });
  } else if (v.status !== null && v.status !== "bonded") {
    flags.push({
      id: "inactive",
      tone: "warning",
      label: "Inactive",
      detail: "Outside the active validator set, so stake here earns no rewards.",
    });
  } else if (v.status === null) {
    flags.push({
      id: "unknown",
      tone: "neutral",
      label: "Status unknown",
      detail: "This validator could not be read just now, so its status is not known.",
    });
  }
  if (v.uptime !== null && v.uptime < LOW_UPTIME && v.status === "bonded") {
    flags.push({
      id: "uptime",
      tone: "warning",
      label: `Uptime ${pct(v.uptime)}`,
      detail: `Signed ${pct(v.uptime, 2)} of the recent block window. Validators that keep missing blocks get jailed.`,
    });
  }
  const rate = v.commissionRate;
  const reach = v.commissionReachable30d;
  if (rate !== null && reach !== null && reach > rate + 1e-9) {
    flags.push({
      id: "commission",
      tone: steepCommissionRise(rate, reach) ? "warning" : "neutral",
      label: `Can rise to ${pct(reach)}`,
      detail: `Commission is ${pct(rate)} today. The validator's own limits let it raise it to ${pct(reach)} within 30 days${
        v.commissionMaxRate !== null ? ` (hard cap ${pct(v.commissionMaxRate)})` : ""
      }.`,
    });
  }
  if (v.inNakamotoSet) {
    flags.push({
      id: "nakamoto",
      tone: "info",
      label: "Nakamoto set",
      detail:
        "One of the few validators that together hold over a third of voting power, enough to halt the chain. Stake here adds to that concentration.",
    });
  }
  return flags;
}

/**
 * Flags that call for action: the stake earns nothing (tombstoned, jailed,
 * inactive) or is at risk of it (low uptime). A commission that *can* rise
 * is a risk worth showing, not something to act on today, so it is left out.
 */
export function attentionFlags(flags: readonly ValidatorFlag[]): ValidatorFlag[] {
  return flags.filter((flag) => flag.tone === "danger" || (flag.tone === "warning" && flag.id !== "commission"));
}

/* -------------------------------------------------------------------------- */
/* Positions                                                                   */
/* -------------------------------------------------------------------------- */

export interface PositionView {
  /** `chainId:valoper`. */
  key: string;
  chainId: string;
  validator: ValidatorLite;
  /** Staked amount, base units of the staking denom. */
  amount: string;
  whole: number | null;
  value: number | null;
  /** Pending rewards in the staking denom (base units). */
  rewards: string;
  rewardsWhole: number | null;
  rewardsValue: number | null;
  /** What this position earns: chain actual APR × (1 − commission), 0 when inactive. */
  apr: number | null;
  /** Share of your stake on this chain (tokens). */
  share: number | null;
  flags: ValidatorFlag[];
  /**
   * Stake you redelegated *to* this validator that is still within its
   * unbonding period: until then nothing can be redelegated away from it
   * (the SDK refuses "transitive" redelegations). ISO time of the last such
   * entry, or null.
   */
  redelegationLockUntil: string | null;
  /** Pending unbonding entries with this validator (at most `MAX_ENTRIES`). */
  unbondingEntries: number;
}

export interface ChainView {
  chainId: string;
  chainName: string;
  iconUrl: string | null;
  address: string;
  symbol: string;
  decimals: number | null;
  denom: string;
  status: StakingChain["status"];
  error?: string;
  errors: PartError[];
  /** Spot price of the staking token in the stats currency; null when unpriced. */
  price: number | null;
  priceLabel: string | null;
  priceAt: number | null;
  positions: PositionView[];
  staked: string | null;
  stakedWhole: number | null;
  stakedValue: number | null;
  rewards: string | null;
  rewardsWhole: number | null;
  rewardsValue: number | null;
  unbonding: string | null;
  unbondingWhole: number | null;
  unbondingValue: number | null;
  /** Stake-weighted APR after commission (tokens weighted). */
  aprWeighted: number | null;
  /** Chain actual APR before commission. */
  aprChain: number | null;
  /** Expected rewards over a year at today's APR, in tokens and value. */
  yearlyWhole: number | null;
  yearlyValue: number | null;
  unbondingDays: number | null;
  rewardsOther: Coin[];
  redelegations: RedelegationPosition[];
}

export interface UnbondingItem {
  key: string;
  kind: "unbonding" | "redelegation";
  chainId: string;
  chainName: string;
  symbol: string;
  decimals: number | null;
  /** For unbonding: the validator left; for a redelegation lock: the destination. */
  validator: ValidatorLite;
  /** For a redelegation lock: where the stake came from. */
  from?: ValidatorLite;
  balance: string;
  whole: number | null;
  value: number | null;
  completionTime: string;
  at: number;
}

export interface StakingTotals {
  stakedValue: number | null;
  rewardsValue: number | null;
  unbondingValue: number | null;
  yearlyValue: number | null;
  /** Value-weighted APR over chains with priced stake and a known APR. */
  weightedApr: number | null;
  /** Chains with stake left out of the APR average (APR or price unknown). */
  aprExcluded: string[];
  /** Chains with stake but no price: their stake is in tokens only. */
  unpricedChains: string[];
  /** Chains whose delegations could not be read: their stake is unknown, not zero. */
  unreadable: string[];
  /** Chains with pending rewards / unbonding but no price (left out of those sums). */
  unpricedRewards: string[];
  unpricedUnbonding: string[];
  /**
   * Chains whose pending rewards / unbonding could not be read: those sums
   * leave them out (a floor), and "nothing pending" cannot be said.
   */
  unreadRewards: string[];
  unreadUnbonding: string[];
  /** Distinct validators with stake. */
  validators: number;
  chainsWithStake: number;
  /** Positions with a danger or warning flag. */
  attention: number;
}

export interface StakingView {
  chains: ChainView[];
  totals: StakingTotals;
  /** Chains with claimable rewards in the staking denom, largest value first. */
  claimable: ChainView[];
  /** Unbonding releases and redelegation locks still ahead, soonest first. */
  timeline: UnbondingItem[];
  /** The next unbonding release (not a lock). */
  nextRelease: UnbondingItem | null;
}

export interface BuildInput {
  chains: readonly StakingChain[];
  stats: (chainId: string) => ChainStats | null;
  /** Display name and icon from the catalog when stats are missing. */
  chainMeta: (chainId: string) => { chainName: string; iconUrl: string | null };
  now: number;
}

/** True when an amount string is a positive integer. */
export function positive(amount: string | null | undefined): boolean {
  const big = toBig(amount);
  return big !== null && big > ZERO;
}

function stakingDenomRewards(rewards: readonly Coin[], denom: string): string {
  return sumBase(rewards.filter((coin) => coin.denom === denom).map((coin) => coin.amount));
}

/**
 * When stake redelegated *to* `valoper` finishes maturing (ISO, latest entry
 * still ahead), or null: until then the SDK refuses any redelegation away
 * from it ("no transitive redelegation").
 */
export function lockFor(redelegations: readonly RedelegationPosition[], valoper: string, now: number): string | null {
  let latest: string | null = null;
  let latestAt = -Infinity;
  for (const position of redelegations) {
    if (position.dst.operatorAddress !== valoper) continue;
    for (const entry of position.entries) {
      const at = Date.parse(entry.completionTime);
      if (Number.isFinite(at) && at > now && at > latestAt) {
        latest = entry.completionTime;
        latestAt = at;
      }
    }
  }
  return latest;
}

/** Pending redelegation entries from `src` to `dst` (the SDK caps them at `MAX_ENTRIES`). */
export function pairEntries(chain: Pick<StakingChain, "redelegations">, src: string, dst: string, now: number): number {
  let count = 0;
  for (const position of chain.redelegations) {
    if (position.src.operatorAddress !== src || position.dst.operatorAddress !== dst) continue;
    count += position.entries.filter((entry) => Date.parse(entry.completionTime) > now).length;
  }
  return count;
}

/** Builds the page's whole view. Chains are ordered by staked value (unpriced after, by name). */
export function buildStakingView(input: BuildInput): StakingView {
  const { now } = input;
  const chains: ChainView[] = input.chains.map((chain) => {
    const stats = input.stats(chain.chainId);
    const meta = input.chainMeta(chain.chainId);
    const price = stats?.price?.price ?? null;
    const decimals = chain.decimals ?? stats?.nativeDecimals ?? null;

    const stakedTotal = toBig(chain.totals.staked);
    const positions: PositionView[] = chain.delegations
      // A delegation whose shares are worth less than one base unit reads as
      // "0": nothing a delegator can act on, so it is not a position.
      .filter((d) => positive(d.amount) || positive(stakingDenomRewards(d.rewards, chain.denom)))
      .map((d) => {
        const whole = toWhole(d.amount, decimals);
        const rewards = stakingDenomRewards(d.rewards, chain.denom);
        const rewardsWhole = toWhole(rewards, decimals);
        const amount = toBig(d.amount) ?? ZERO;
        return {
          key: `${chain.chainId}:${d.validator.operatorAddress}`,
          chainId: chain.chainId,
          validator: d.validator,
          amount: amount.toString(),
          whole,
          value: valueOf(whole, price),
          rewards,
          rewardsWhole,
          rewardsValue: valueOf(rewardsWhole, price),
          apr: d.validator.apr,
          share:
            stakedTotal !== null && stakedTotal > ZERO
              ? Number((amount * BigInt(1_000_000)) / stakedTotal) / 1_000_000
              : null,
          flags: validatorFlags(d.validator),
          redelegationLockUntil: lockFor(chain.redelegations, d.validator.operatorAddress, now),
          unbondingEntries: chain.unbonding
            .filter((u) => u.validator.operatorAddress === d.validator.operatorAddress)
            .reduce((count, u) => count + u.entries.filter((entry) => Date.parse(entry.completionTime) > now).length, 0),
        };
      })
      .sort((a, b) => {
        const left = toBig(a.amount) ?? ZERO;
        const right = toBig(b.amount) ?? ZERO;
        return left === right ? a.validator.moniker.localeCompare(b.validator.moniker) : left > right ? -1 : 1;
      });

    const stakedWhole = toWhole(chain.totals.staked, decimals);
    const rewardsWhole = toWhole(chain.totals.rewards, decimals);
    const unbondingWhole = toWhole(chain.totals.unbonding, decimals);
    const aprWeighted = chain.apr.weighted;
    const yearlyWhole = stakedWhole !== null && aprWeighted !== null ? stakedWhole * aprWeighted : null;
    return {
      chainId: chain.chainId,
      chainName: stats?.chainName ?? meta.chainName,
      iconUrl: stats?.iconUrl ?? meta.iconUrl,
      address: chain.address,
      symbol: chain.symbol || stats?.nativeSymbol || "",
      decimals,
      denom: chain.denom,
      status: chain.status,
      ...(chain.error ? { error: chain.error } : {}),
      errors: chain.errors ?? [],
      price,
      priceLabel: stats?.price?.label ?? null,
      priceAt: stats?.price?.at ?? null,
      positions,
      staked: chain.totals.staked,
      stakedWhole,
      stakedValue: valueOf(stakedWhole, price),
      rewards: chain.totals.rewards,
      rewardsWhole,
      rewardsValue: valueOf(rewardsWhole, price),
      unbonding: chain.totals.unbonding,
      unbondingWhole,
      unbondingValue: valueOf(unbondingWhole, price),
      aprWeighted,
      aprChain: chain.apr.chain ?? stats?.apr.actual ?? null,
      yearlyWhole,
      yearlyValue: valueOf(yearlyWhole, price),
      unbondingDays: stats?.unbondingDays ?? null,
      rewardsOther: chain.rewardsOther,
      redelegations: chain.redelegations,
    };
  });

  chains.sort((a, b) => {
    const av = a.stakedValue ?? -1;
    const bv = b.stakedValue ?? -1;
    if (av !== bv) return bv - av;
    const ap = positive(a.staked) ? 1 : 0;
    const bp = positive(b.staked) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return a.chainName.localeCompare(b.chainName);
  });

  const timeline = timelineOf(input.chains, chains, now);
  return {
    chains,
    totals: totalsOf(chains),
    claimable: chains
      .filter((chain) => positive(chain.rewards))
      .sort((a, b) => (b.rewardsValue ?? -1) - (a.rewardsValue ?? -1)),
    timeline,
    nextRelease: timeline.find((item) => item.kind === "unbonding") ?? null,
  };
}

function sumKnown(values: ReadonlyArray<number | null>): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    total += value;
    any = true;
  }
  return any ? total : null;
}

/**
 * Value of what is pending (rewards, unbonding), summed over the chains that
 * hold some: a chain with none must not turn unpriced amounts into a known
 * $0 (four unpriced reward chains beside one chain with nothing to claim
 * read "$0.00" before this). Null when none of those is priced — the tile
 * then says "—" and names them; a partial sum stays, flagged like the staked
 * total. Nothing pending is a known zero only where every chain was read.
 */
function pendingValue(
  chains: readonly ChainView[],
  amount: (chain: ChainView) => string | null,
  value: (chain: ChainView) => number | null,
): number | null {
  const holding = chains.filter((chain) => positive(amount(chain)));
  if (holding.length === 0) return chains.length > 0 && chains.every((chain) => amount(chain) !== null) ? 0 : null;
  return sumKnown(holding.map(value));
}

function totalsOf(chains: readonly ChainView[]): StakingTotals {
  const withStake = chains.filter((chain) => positive(chain.staked));
  const unpricedChains = withStake.filter((chain) => chain.stakedValue === null).map((chain) => chain.chainId);
  const unreadable = chains.filter((chain) => chain.status === "error" || chain.staked === null).map((chain) => chain.chainId);
  // Every chain answered and none holds stake: the total is a known zero,
  // not an unknown ("—" would suggest a failed read).
  const knownNothing = withStake.length === 0 && unreadable.length === 0 && chains.length > 0;

  let aprWeight = 0;
  let aprSum = 0;
  const aprExcluded: string[] = [];
  for (const chain of withStake) {
    if (chain.stakedValue === null || chain.aprWeighted === null) {
      aprExcluded.push(chain.chainId);
      continue;
    }
    aprWeight += chain.stakedValue;
    aprSum += chain.stakedValue * chain.aprWeighted;
  }

  const validators = new Set<string>();
  let attention = 0;
  for (const chain of chains) {
    for (const position of chain.positions) {
      if (positive(position.amount)) validators.add(position.key);
      if (positive(position.amount) && attentionFlags(position.flags).length > 0) attention += 1;
    }
  }

  return {
    stakedValue: knownNothing ? 0 : sumKnown(withStake.map((chain) => chain.stakedValue)),
    rewardsValue: pendingValue(chains, (chain) => chain.rewards, (chain) => chain.rewardsValue),
    unbondingValue: pendingValue(chains, (chain) => chain.unbonding, (chain) => chain.unbondingValue),
    yearlyValue: knownNothing ? 0 : sumKnown(withStake.map((chain) => chain.yearlyValue)),
    weightedApr: aprWeight > 0 ? aprSum / aprWeight : null,
    aprExcluded,
    unpricedChains,
    unreadable,
    unpricedRewards: chains.filter((chain) => positive(chain.rewards) && chain.rewardsValue === null).map((chain) => chain.chainId),
    unpricedUnbonding: chains.filter((chain) => positive(chain.unbonding) && chain.unbondingValue === null).map((chain) => chain.chainId),
    unreadRewards: chains.filter((chain) => chain.rewards === null).map((chain) => chain.chainId),
    unreadUnbonding: chains.filter((chain) => chain.unbonding === null).map((chain) => chain.chainId),
    validators: validators.size,
    chainsWithStake: withStake.length,
    attention,
  };
}

function timelineOf(raw: readonly StakingChain[], chains: readonly ChainView[], now: number): UnbondingItem[] {
  const items: UnbondingItem[] = [];
  for (const chain of raw) {
    const view = chains.find((c) => c.chainId === chain.chainId);
    if (!view) continue;
    for (const position of chain.unbonding) {
      position.entries.forEach((entry, index) => {
        const at = Date.parse(entry.completionTime);
        if (!Number.isFinite(at) || at <= now || !positive(entry.balance)) return;
        const whole = toWhole(entry.balance, view.decimals);
        items.push({
          key: `u:${chain.chainId}:${position.validator.operatorAddress}:${entry.creationHeight}:${index}`,
          kind: "unbonding",
          chainId: chain.chainId,
          chainName: view.chainName,
          symbol: view.symbol,
          decimals: view.decimals,
          validator: position.validator,
          balance: entry.balance,
          whole,
          value: valueOf(whole, view.price),
          completionTime: entry.completionTime,
          at,
        });
      });
    }
    for (const position of chain.redelegations) {
      position.entries.forEach((entry, index) => {
        const at = Date.parse(entry.completionTime);
        if (!Number.isFinite(at) || at <= now || !positive(entry.balance)) return;
        const whole = toWhole(entry.balance, view.decimals);
        items.push({
          key: `r:${chain.chainId}:${position.src.operatorAddress}:${position.dst.operatorAddress}:${entry.creationHeight}:${index}`,
          kind: "redelegation",
          chainId: chain.chainId,
          chainName: view.chainName,
          symbol: view.symbol,
          decimals: view.decimals,
          validator: position.dst,
          from: position.src,
          balance: entry.balance,
          whole,
          value: valueOf(whole, view.price),
          completionTime: entry.completionTime,
          at,
        });
      });
    }
  }
  return items.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/* -------------------------------------------------------------------------- */
/* Stake health                                                                */
/* -------------------------------------------------------------------------- */

export interface StakeHealth {
  /** What the shares are of: fiat value across chains, tokens within one. */
  basis: "value" | "tokens";
  /** Positions that could be weighed (priced, or in one chain's tokens). */
  weighed: number;
  /** Positions left out of the shares (no price across chains). */
  excluded: number;
  /** Share of stake on validators that are active and not jailed (earning). */
  earningShare: number | null;
  /** Positions on jailed or inactive validators, however small (they earn nothing). */
  idlePositions: number;
  /** Share of stake with validators of the Nakamoto set. */
  nakamotoShare: number | null;
  /** Stake-weighted commission today, and the most it can reach within 30 days. */
  commission: number | null;
  commissionReach30d: number | null;
  /** The weakest uptime among your validators. */
  lowestUptime: { uptime: number; moniker: string; chainId: string } | null;
  /** Your largest single validator and its share of your stake. */
  largest: { share: number; moniker: string; chainId: string } | null;
}

/**
 * Health of the stake as a whole. Across chains every share is of value
 * (tokens of different chains cannot be added), so unpriced positions are
 * left out and counted in `excluded`; within one chain, shares are of tokens.
 */
export function stakeHealth(chains: readonly ChainView[], basis: "value" | "tokens"): StakeHealth {
  let total = 0;
  let earning = 0;
  let nakamoto = 0;
  let commissionSum = 0;
  let commissionWeight = 0;
  let reachSum = 0;
  let reachWeight = 0;
  let weighed = 0;
  let excluded = 0;
  let idlePositions = 0;
  let lowest: StakeHealth["lowestUptime"] = null;
  let largest: { weight: number; moniker: string; chainId: string } | null = null;

  for (const chain of chains) {
    for (const position of chain.positions) {
      if (!positive(position.amount)) continue;
      const weight = basis === "value" ? position.value : position.whole;
      const v = position.validator;
      if (v.status !== "bonded" || v.jailed === true) idlePositions += 1;
      if (v.uptime !== null && v.status === "bonded" && (lowest === null || v.uptime < lowest.uptime)) {
        lowest = { uptime: v.uptime, moniker: v.moniker, chainId: chain.chainId };
      }
      if (weight === null || !Number.isFinite(weight) || weight <= 0) {
        excluded += 1;
        continue;
      }
      weighed += 1;
      total += weight;
      if (v.status === "bonded" && v.jailed !== true) earning += weight;
      if (v.inNakamotoSet) nakamoto += weight;
      if (v.commissionRate !== null) {
        commissionSum += weight * v.commissionRate;
        commissionWeight += weight;
      }
      if (v.commissionReachable30d !== null) {
        reachSum += weight * v.commissionReachable30d;
        reachWeight += weight;
      }
      if (!largest || weight > largest.weight) largest = { weight, moniker: v.moniker, chainId: chain.chainId };
    }
  }

  return {
    basis,
    weighed,
    excluded,
    earningShare: total > 0 ? earning / total : null,
    idlePositions,
    nakamotoShare: total > 0 ? nakamoto / total : null,
    commission: commissionWeight > 0 ? commissionSum / commissionWeight : null,
    commissionReach30d: reachWeight > 0 ? reachSum / reachWeight : null,
    lowestUptime: lowest,
    largest: largest && total > 0 ? { share: largest.weight / total, moniker: largest.moniker, chainId: largest.chainId } : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Idle balance                                                                */
/* -------------------------------------------------------------------------- */

export interface FeeChainLike {
  feeMinimalDenom: string;
  gasPriceStep?: { low: number; average: number; high: number };
}

/**
 * Gas a staking transaction is budgeted at when nothing was measured: the
 * dashboard's own fallback for a delegate (`FALLBACK_GAS.delegate`), which is
 * high on purpose (the Hub's staking hooks simulate at ~834k).
 */
export const RESERVE_GAS_PER_TX = 900_000;
/** Transactions the reserve should cover: stake now, claim later, unstake one day. */
export const RESERVE_TXS = 3;

/**
 * Native balance kept back for fees when suggesting how much to stake:
 * three staking transactions at the chain's average gas price, rounded up.
 * Zero when fees are paid in another denom (nothing to keep back from this
 * one) or the chain publishes no gas price.
 */
export function feeReserve(chain: FeeChainLike | null | undefined, stakingDenom: string): string {
  if (!chain || chain.feeMinimalDenom !== stakingDenom) return "0";
  const price = chain.gasPriceStep?.average;
  if (price === undefined || !Number.isFinite(price) || price <= 0) return "0";
  return Math.ceil(RESERVE_GAS_PER_TX * RESERVE_TXS * price).toString();
}

/** `liquid − reserve`, floored at zero. */
export function stakeable(liquid: string | null | undefined, reserve: string): string {
  const big = toBig(liquid);
  const keep = toBig(reserve) ?? ZERO;
  if (big === null) return "0";
  const rest = big - keep;
  return rest > ZERO ? rest.toString() : "0";
}

/**
 * Every chain answered and none holds stake, pending rewards, or a release
 * or move lock still ahead: the wallet is known not to be staking. A failed
 * or partial read never passes for "not staking".
 */
export function knownNotStaking(view: Pick<StakingView, "chains" | "timeline">): boolean {
  if (view.chains.length === 0 || view.timeline.length > 0) return false;
  return view.chains.every(
    (chain) =>
      chain.status === "ok" &&
      chain.staked !== null &&
      !positive(chain.staked) &&
      !positive(chain.rewards) &&
      !positive(chain.unbonding),
  );
}

/* -------------------------------------------------------------------------- */
/* Unbonding timeline                                                          */
/* -------------------------------------------------------------------------- */

export interface TimelineWindow {
  start: number;
  end: number;
  /** Days between axis ticks. */
  stepDays: number;
}

/**
 * The span the timeline draws: from now to just past the last entry, never
 * shorter than a week. Fitted to the entries rather than to the longest
 * unbonding period, so releases due this week spread out instead of piling
 * up against "today" with three empty weeks after them.
 */
export function timelineWindow(now: number, times: readonly number[], maxTicks = 6): TimelineWindow {
  const last = times.reduce((latest, at) => (Number.isFinite(at) && at > latest ? at : latest), now);
  const span = last - now;
  const end = now + Math.max(7 * DAY_MS, span * 1.1 + DAY_MS / 2);
  const days = (end - now) / DAY_MS;
  const steps = [1, 2, 7, 14, 28];
  // At most `maxTicks` + 1 intervals: a narrow card keeps a few dated ticks
  // (every other day) instead of jumping to a single weekly one.
  const stepDays = steps.find((step) => days / step <= Math.max(2, maxTicks) + 1) ?? 28;
  return { start: now, end, stepDays };
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                                */
/* -------------------------------------------------------------------------- */

/** A fraction (0.125) as "12.50%"; "—" when unknown. */
export function percentOf(fraction: number | null | undefined, digits = 2): string {
  return fraction === null || fraction === undefined || !Number.isFinite(fraction)
    ? NO_VALUE
    : formatPercent(fraction * 100, { digits });
}

/**
 * Whole tokens for display, cut like every amount on screen. Goes through
 * the number's shortest decimal form: `formatAmount(2999.7)` reads the
 * binary expansion (2999.69999…) and cuts it to "2,999.69".
 */
export function wholeText(whole: number, options: { maxFraction?: number; compact?: boolean } = {}): string {
  return formatAmount(Number.isFinite(whole) ? String(whole) : null, options);
}

/** "14 days", "21 days", "14 days 1 hour" for an unbonding period; null when unknown. */
export function unbondingPeriodText(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days) || days <= 0) return null;
  const totalHours = Math.round(days * 24);
  const d = Math.floor(totalHours / 24);
  const h = totalHours - d * 24;
  const dayText = `${d} day${d === 1 ? "" : "s"}`;
  return h > 0 ? `${dayText} ${h} hour${h === 1 ? "" : "s"}` : dayText;
}

/** Explorer-free link to the dashboard's own transaction page. */
export function txHref(chainId: string, hash: string): string {
  return `/activity/${encodeURIComponent(hash.toUpperCase())}?chainId=${encodeURIComponent(chainId)}`;
}

/** The validator page of an operator. */
export function validatorHref(chainId: string, operatorAddress: string): string {
  return `/validators/${encodeURIComponent(operatorAddress)}?chain=${encodeURIComponent(chainId)}`;
}
