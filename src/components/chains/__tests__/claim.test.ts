/**
 * The chain page's claim offer follows the Overview's rule: rewards worth 3
 * estimated claim fees get the button, smaller ones get the fee stated. A
 * drift here would have the two pages disagree about the same rewards.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { StakingChain, StakingDelegation } from "@/lib/chain/types";
import { findChain } from "@/lib/chains";
import { CLAIM_FEE_MULTIPLE, claimMessages, estimateFee } from "@/lib/insights/rules";
import { claimCheck } from "../claim";

const osmosis = findChain("osmosis-1");
assert.ok(osmosis, "osmosis-1 is in the catalog");

function delegation(rewards: string, denom = "uosmo"): StakingDelegation {
  return { rewards: [{ denom, amount: rewards }] } as unknown as StakingDelegation;
}

function position(rewards: string | null, delegations: StakingDelegation[] = [delegation(rewards ?? "0")]): Pick<StakingChain, "denom" | "totals" | "delegations"> {
  return { denom: "uosmo", totals: { staked: "1000000", rewards, unbonding: "0" }, delegations };
}

test("rewards under three claim fees state the fee instead of offering a claim", () => {
  const fee = estimateFee(osmosis, claimMessages(1));
  assert.ok(fee !== null && fee > BigInt(0), "the catalog prices Osmosis gas");
  // The reported case: 0.032978 OSMO of rewards against a ~0.08 OSMO fee.
  const small = claimCheck(osmosis, position("32978"));
  assert.equal(small.kind, "costly");
  assert.ok(small.kind === "costly" && small.fee === fee && small.feeShare > 1);

  const twice = (BigInt(2) * fee).toString();
  const mid = claimCheck(osmosis, position(twice));
  assert.ok(mid.kind === "costly" && Math.abs(mid.feeShare - 0.5) < 1e-9, JSON.stringify(mid, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

  const enough = (BigInt(CLAIM_FEE_MULTIPLE) * fee).toString();
  assert.equal(claimCheck(osmosis, position(enough)).kind, "offer");
});

test("the fee counts one claim message per validator holding rewards", () => {
  const three = estimateFee(osmosis, claimMessages(3));
  assert.ok(three !== null);
  const each = (three * BigInt(CLAIM_FEE_MULTIPLE) / BigInt(3)).toString();
  const check = claimCheck(osmosis, position(null, [delegation(each), delegation(each), delegation(each), delegation("0")]));
  // totals.rewards is what a claim pays; the delegations only size the fee.
  assert.equal(check.kind, "none");
  const sum = (BigInt(each) * BigInt(3)).toString();
  const withTotals = { ...position(sum), delegations: [delegation(each), delegation(each), delegation(each), delegation("0")] };
  assert.equal(claimCheck(osmosis, withTotals).kind, "offer");
  const short = (BigInt(each) * BigInt(3) - BigInt(1)).toString();
  const costly = claimCheck(osmosis, { ...withTotals, totals: { ...withTotals.totals, rewards: short } });
  assert.ok(costly.kind === "costly" && costly.fee === three);
});

test("nothing to claim, an unreadable read, or an unknowable fee", () => {
  assert.equal(claimCheck(osmosis, null).kind, "none");
  assert.equal(claimCheck(osmosis, position("0")).kind, "none");
  assert.equal(claimCheck(osmosis, position(null)).kind, "none");
  assert.equal(claimCheck(osmosis, position("not-a-number")).kind, "none");
  // Fees paid in another denom: no comparison, the review sheet shows the fee.
  assert.equal(claimCheck({ ...osmosis, feeMinimalDenom: "uother" }, position("1")).kind, "offer");
  // No gas price in the catalog: no fee is guessed.
  assert.equal(claimCheck({ ...osmosis, gasPriceStep: undefined }, position("1")).kind, "offer");
});
