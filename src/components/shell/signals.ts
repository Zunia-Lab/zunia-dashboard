/**
 * What the shell says about each followed chain: your value there, its share
 * of net worth, its 24 h move, and whether something is waiting for you
 * (rewards worth claiming, a vote you have not cast). The chain rail's hover
 * cards and amber dots, the scope popover and the phone's chain chips all
 * read these, so they never disagree.
 *
 * Pure: types in, plain objects out, `node --test` covers it.
 */

import type { ProposalRow, StakingChain } from "@/lib/chain/types";
import type { ChainEntry } from "@/lib/chains";
import type { PortfolioResponse } from "@/lib/token/wire";

/* ------------------------------------------------------------------ positions */

export interface ChainPosition {
  /** Priced value held on the chain, in the portfolio's currency; null when unknown. */
  value: number | null;
  /** Share of net worth in percent units (12.3 = 12.3 %); null when unknown. */
  share: number | null;
  /** Change of this chain's value over 24 h at today's amounts, in percent units. */
  change24hPct: number | null;
  /** Value of the claimable rewards on the chain; null when unpriced. */
  rewardsValue: number | null;
  /** The chain's read failed (its figures are unknown, not zero). */
  failed: boolean;
}

/** Per-chain figures from a portfolio answer, keyed by chain id. */
export function positionsByChain(portfolio: PortfolioResponse | null | undefined): Map<string, ChainPosition> {
  const out = new Map<string, ChainPosition>();
  if (!portfolio) return out;
  const total = portfolio.totals.value;
  for (const chain of portfolio.chains) {
    const failed = chain.status === "error";
    const value = failed ? null : chain.value;
    const share = value !== null && total !== null && total > 0 ? (value / total) * 100 : null;
    let change24hPct: number | null = null;
    if (value !== null && chain.change24hAbs !== null) {
      // Today's value minus the change is what the same holdings were worth a
      // day ago; a base at or under zero has no meaningful percentage.
      const before = value - chain.change24hAbs;
      change24hPct = before > 0 ? (chain.change24hAbs / before) * 100 : null;
    }
    out.set(chain.chainId, { value, share, change24hPct, rewardsValue: failed ? null : chain.rewards, failed });
  }
  return out;
}

/* ------------------------------------------------------------------ rewards */

/** Gas a single claim transaction is assumed to use (withdraw from a few validators). */
export const CLAIM_GAS = 200_000;

/** Rewards count as "worth claiming" from this many times the estimated claim fee. */
export const CLAIM_FEE_MULTIPLE = 10;

/**
 * Without a usable fee estimate: rewards worth at least this much in the
 * portfolio's currency, or (unpriced) at least one whole token.
 */
export const CLAIM_MIN_VALUE = 1;

type FeeFacts = Pick<ChainEntry, "feeMinimalDenom" | "feeDecimals" | "gasPriceStep">;

/** One claim's fee in whole fee tokens at the catalog's average gas price; null when unknown. */
export function estimatedClaimFee(chain: FeeFacts | null | undefined): number | null {
  const price = chain?.gasPriceStep?.average;
  if (!chain || price === undefined || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isInteger(chain.feeDecimals) || chain.feeDecimals < 0) return null;
  return (CLAIM_GAS * price) / 10 ** chain.feeDecimals;
}

export interface RewardsSignal {
  /** Claimable rewards in whole staking tokens. */
  whole: number;
  symbol: string;
  /** Worth a claim transaction (see the module constants for the rule). */
  worthClaiming: boolean;
}

/**
 * Claimable rewards on one chain from its staking read. Null when unknown
 * (no read, the rewards read failed, decimals unknown): an unknown amount is
 * never a reason to nudge anyone.
 */
export function rewardsSignal(
  staking: StakingChain | null | undefined,
  chain: FeeFacts | null | undefined,
  rewardsValue: number | null | undefined,
): RewardsSignal | null {
  if (!staking || staking.totals.rewards === null || staking.decimals === null) return null;
  if (!/^\d+$/.test(staking.totals.rewards)) return null;
  const whole = Number(staking.totals.rewards) / 10 ** staking.decimals;
  if (!Number.isFinite(whole)) return null;
  if (whole <= 0) return { whole: 0, symbol: staking.symbol, worthClaiming: false };
  const fee = chain && chain.feeMinimalDenom === staking.denom ? estimatedClaimFee(chain) : null;
  let worthClaiming: boolean;
  if (fee !== null) worthClaiming = whole >= fee * CLAIM_FEE_MULTIPLE;
  else if (rewardsValue !== null && rewardsValue !== undefined && Number.isFinite(rewardsValue)) worthClaiming = rewardsValue >= CLAIM_MIN_VALUE;
  else worthClaiming = whole >= 1;
  return { whole, symbol: staking.symbol, worthClaiming };
}

/* ------------------------------------------------------------------ attention */

export interface ChainAttention {
  rewards: RewardsSignal | null;
  /** Voting proposals on the chain where you have stake and have not voted, ending soonest first. */
  votes: ProposalRow[];
  /** Something here is worth a look: the rail's amber dot. */
  attention: boolean;
}

export function chainAttention(
  chainId: string,
  inputs: {
    staking: StakingChain | null | undefined;
    chain: FeeFacts | null | undefined;
    position: ChainPosition | null | undefined;
    awaitingVote: readonly ProposalRow[];
  },
): ChainAttention {
  const rewards = rewardsSignal(inputs.staking, inputs.chain, inputs.position?.rewardsValue);
  const votes = inputs.awaitingVote.filter((proposal) => proposal.chainId === chainId);
  return { rewards, votes, attention: Boolean(rewards?.worthClaiming) || votes.length > 0 };
}

/* ------------------------------------------------------------------ scope order */

/**
 * The scope after `step` from `current` in the rail's order: All chains
 * first, then each followed chain of the slice, wrapping around ('[' / ']').
 * A selection outside `order` counts as All chains.
 */
export function cycleScope(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  const stops: Array<string | null> = [null, ...order];
  const at = current === null ? 0 : stops.indexOf(current);
  const from = at === -1 ? 0 : at;
  return stops[(((from + step) % stops.length) + stops.length) % stops.length] ?? null;
}

/**
 * Chains for the scope list, most valuable first. Unknown values go last,
 * in the user's followed order (a stable list beats a shuffling one when
 * nothing is priced yet).
 */
export function byValue<T extends { chainId: string }>(
  chains: readonly T[],
  positions: ReadonlyMap<string, ChainPosition>,
): T[] {
  const order = new Map(chains.map((chain, index) => [chain.chainId, index]));
  return [...chains].sort((a, b) => {
    const va = positions.get(a.chainId)?.value ?? null;
    const vb = positions.get(b.chainId)?.value ?? null;
    if (va !== null && vb !== null && va !== vb) return vb - va;
    if (va !== null && vb === null) return -1;
    if (va === null && vb !== null) return 1;
    return (order.get(a.chainId) ?? 0) - (order.get(b.chainId) ?? 0);
  });
}
