/**
 * Whether a chain's page offers "Claim rewards": the Overview's test (the
 * insights rule `rewardInsights`), so the two pages never disagree about
 * which rewards are worth a claim. Rewards qualify once they are worth
 * `CLAIM_FEE_MULTIPLE` (3) estimated claim fees; below that the page states
 * the fee instead of offering a claim that would mostly pay it (0.033 OSMO
 * of rewards was offered a Claim button against a ~0.08 OSMO fee).
 *
 * The fee is the insights' own estimate: the catalog's average gas price ×
 * the signer's fallback gas limit, one claim message per validator holding
 * rewards. It runs high on purpose (real fees are usually lower), hence
 * "est." in the copy and the 3× margin rather than a verdict at 1×. A chain
 * whose fee cannot be estimated, or is paid in another denom, keeps its
 * button: the Staking review sheet shows the real fee before anything is
 * signed, and a guessed fee would be a guess.
 *
 * Pure (no React), so `node --test` covers it.
 */

import type { StakingChain } from "@/lib/chain/types";
import { CLAIM_FEE_MULTIPLE, claimMessages, estimateFee } from "@/lib/insights/rules";
import type { FeeChain } from "@/lib/tx/fees";

export { CLAIM_FEE_MULTIPLE };

export type ClaimCheck =
  /** Nothing claimable, or the rewards could not be read. */
  | { kind: "none" }
  /** Worth claiming, or the fee cannot be estimated (the review sheet shows it). */
  | { kind: "offer" }
  /** Under the claim-worth line: the estimated fee and its share of the rewards. */
  | { kind: "costly"; fee: bigint; feeShare: number };

function units(value: string | null | undefined): bigint | null {
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

export function claimCheck(chain: FeeChain, staking: Pick<StakingChain, "denom" | "totals" | "delegations"> | null): ClaimCheck {
  const rewards = units(staking?.totals.rewards);
  if (!staking || rewards === null || rewards <= BigInt(0)) return { kind: "none" };
  if (chain.feeMinimalDenom !== staking.denom) return { kind: "offer" };
  // One withdraw message per validator that holds rewards in the staking
  // denom: what the claim transaction will carry.
  const holding = staking.delegations.filter((d) => d.rewards.some((coin) => coin.denom === staking.denom && (units(coin.amount) ?? BigInt(0)) > BigInt(0))).length;
  const fee = estimateFee(chain, claimMessages(Math.max(1, holding)));
  if (fee === null || fee <= BigInt(0)) return { kind: "offer" };
  if (rewards >= BigInt(CLAIM_FEE_MULTIPLE) * fee) return { kind: "offer" };
  return { kind: "costly", fee, feeShare: Number(fee) / Number(rewards) };
}
