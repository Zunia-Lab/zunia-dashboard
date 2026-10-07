/**
 * Rail and scope signals: per-chain value, share and 24 h move from the
 * portfolio; "worth claiming" against an estimated fee; votes waiting; the
 * '[' / ']' cycle; the scope list order.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProposalRow, StakingChain } from "@/lib/chain/types";
import type { PortfolioResponse } from "@/lib/token/wire";
import {
  CLAIM_FEE_MULTIPLE,
  CLAIM_GAS,
  byValue,
  chainAttention,
  cycleScope,
  estimatedClaimFee,
  positionsByChain,
  rewardsSignal,
} from "../signals";

function portfolio(chains: Array<Partial<PortfolioResponse["chains"][number]> & { chainId: string }>, total: number | null): PortfolioResponse {
  return {
    currency: "usd",
    updatedAt: 0,
    totals: {
      value: total,
      liquid: 0,
      staked: 0,
      rewards: 0,
      unbonding: 0,
      change24hAbs: null,
      change24hPct: null,
      change7dAbs: null,
      change7dPct: null,
      pricedValue: total ?? 0,
      unpricedAssetCount: 0,
      assetCount: 0,
      chainCount: chains.length,
    },
    chains: chains.map((chain) => ({
      chainName: chain.chainId,
      iconUrl: null,
      address: "addr",
      status: "ok",
      value: null,
      liquid: null,
      staked: null,
      rewards: null,
      unbonding: null,
      change24hAbs: null,
      assetCount: 1,
      nativeSymbol: "TKN",
      ...chain,
    })),
    assets: [],
  };
}

function staking(partial: Omit<Partial<StakingChain>, "totals"> & { totals?: Partial<StakingChain["totals"]> } = {}): StakingChain {
  const { totals, ...rest } = partial;
  return {
    chainId: "osmosis-1",
    address: "osmo1x",
    denom: "uosmo",
    symbol: "OSMO",
    decimals: 6,
    delegations: [],
    unbonding: [],
    redelegations: [],
    withdrawAddress: null,
    totals: { staked: "0", rewards: "0", unbonding: "0", ...totals },
    rewardsOther: [],
    nextUnbonding: null,
    apr: { chain: null, weighted: null },
    status: "ok",
    ...rest,
  };
}

const OSMO_FEES = { feeMinimalDenom: "uosmo", feeDecimals: 6, gasPriceStep: { low: 0.0025, average: 0.025, high: 0.04 } };

test("positionsByChain: value, share of net worth, 24 h move; failed chains are unknown", () => {
  const map = positionsByChain(
    portfolio(
      [
        { chainId: "a", value: 75, change24hAbs: 5, rewards: 2 },
        { chainId: "b", value: 25, change24hAbs: null },
        { chainId: "c", status: "error", value: 10 },
      ],
      100,
    ),
  );
  const a = map.get("a")!;
  assert.equal(a.value, 75);
  assert.equal(a.share, 75);
  assert.ok(Math.abs((a.change24hPct ?? 0) - (5 / 70) * 100) < 1e-9);
  assert.equal(a.rewardsValue, 2);
  assert.equal(map.get("b")!.change24hPct, null);
  const c = map.get("c")!;
  assert.equal(c.failed, true);
  assert.equal(c.value, null);
  assert.equal(c.share, null);
  assert.equal(positionsByChain(null).size, 0);
});

test("positionsByChain: no share without a positive net worth", () => {
  const map = positionsByChain(portfolio([{ chainId: "a", value: 0 }], 0));
  assert.equal(map.get("a")!.share, null);
});

test("estimatedClaimFee: gas × average price in whole fee tokens", () => {
  assert.equal(estimatedClaimFee(OSMO_FEES), (CLAIM_GAS * 0.025) / 1e6);
  assert.equal(estimatedClaimFee({ ...OSMO_FEES, gasPriceStep: undefined }), null);
  assert.equal(estimatedClaimFee(null), null);
});

test("rewardsSignal: worth claiming from ten times the fee", () => {
  const fee = (CLAIM_GAS * 0.025) / 1e6; // 0.005 OSMO
  const below = Math.floor(fee * CLAIM_FEE_MULTIPLE * 1e6) - 1;
  const above = Math.ceil(fee * CLAIM_FEE_MULTIPLE * 1e6);
  assert.equal(rewardsSignal(staking({ totals: { rewards: String(below) } }), OSMO_FEES, null)?.worthClaiming, false);
  assert.equal(rewardsSignal(staking({ totals: { rewards: String(above) } }), OSMO_FEES, null)?.worthClaiming, true);
  assert.deepEqual(rewardsSignal(staking({ totals: { rewards: "0" } }), OSMO_FEES, 5), { whole: 0, symbol: "OSMO", worthClaiming: false });
});

test("rewardsSignal: unknown stays unknown; other fee tokens fall back to value, then whole tokens", () => {
  assert.equal(rewardsSignal(staking({ totals: { rewards: null } }), OSMO_FEES, 10), null);
  assert.equal(rewardsSignal(staking({ decimals: null, totals: { rewards: "5" } }), OSMO_FEES, 10), null);
  assert.equal(rewardsSignal(null, OSMO_FEES, 10), null);
  const otherFee = { ...OSMO_FEES, feeMinimalDenom: "ibc/USDC" };
  assert.equal(rewardsSignal(staking({ totals: { rewards: "500000" } }), otherFee, 1.5)?.worthClaiming, true);
  assert.equal(rewardsSignal(staking({ totals: { rewards: "500000" } }), otherFee, 0.5)?.worthClaiming, false);
  assert.equal(rewardsSignal(staking({ totals: { rewards: "500000" } }), otherFee, null)?.worthClaiming, false);
  assert.equal(rewardsSignal(staking({ totals: { rewards: "1500000" } }), otherFee, null)?.worthClaiming, true);
});

test("chainAttention: a vote waiting or rewards worth claiming", () => {
  const vote = { chainId: "osmosis-1", id: "9" } as ProposalRow;
  const elsewhere = { chainId: "cosmoshub-4", id: "1" } as ProposalRow;
  const idle = chainAttention("osmosis-1", { staking: staking(), chain: OSMO_FEES, position: null, awaitingVote: [elsewhere] });
  assert.equal(idle.attention, false);
  assert.equal(idle.votes.length, 0);
  const voting = chainAttention("osmosis-1", { staking: null, chain: OSMO_FEES, position: null, awaitingVote: [vote, elsewhere] });
  assert.equal(voting.attention, true);
  assert.deepEqual(voting.votes, [vote]);
  const rich = chainAttention("osmosis-1", {
    staking: staking({ totals: { rewards: "9000000" } }),
    chain: OSMO_FEES,
    position: null,
    awaitingVote: [],
  });
  assert.equal(rich.attention, true);
});

test("cycleScope: All chains, then each chain, wrapping both ways", () => {
  const order = ["a", "b", "c"];
  assert.equal(cycleScope(order, null, 1), "a");
  assert.equal(cycleScope(order, "a", 1), "b");
  assert.equal(cycleScope(order, "c", 1), null);
  assert.equal(cycleScope(order, null, -1), "c");
  assert.equal(cycleScope(order, "a", -1), null);
  assert.equal(cycleScope(order, "elsewhere", 1), "a");
  assert.equal(cycleScope([], null, 1), null);
});

test("byValue: most valuable first, unknown values last in followed order", () => {
  const chains = [{ chainId: "x" }, { chainId: "y" }, { chainId: "z" }, { chainId: "w" }];
  const positions = new Map([
    ["x", { value: null, share: null, change24hPct: null, rewardsValue: null, failed: false }],
    ["y", { value: 10, share: null, change24hPct: null, rewardsValue: null, failed: false }],
    ["z", { value: 30, share: null, change24hPct: null, rewardsValue: null, failed: false }],
  ]);
  assert.deepEqual(
    byValue(chains, positions).map((chain) => chain.chainId),
    ["z", "y", "x", "w"],
  );
});
