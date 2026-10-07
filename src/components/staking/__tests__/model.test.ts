/**
 * Staking view model: exact amounts, honest unknowns, value-weighted
 * cross-chain averages, flags, redelegation locks and the timeline.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChainStats, StakingChain, ValidatorLite } from "@/lib/chain/types";
import {
  buildStakingView,
  feeReserve,
  knownNotStaking,
  pairEntries,
  percentOf,
  stakeable,
  stakeHealth,
  sumBase,
  timelineWindow,
  toBaseUnits,
  toDisplay,
  toWhole,
  unbondingPeriodText,
  validatorFlags,
  wholeText,
} from "../model";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY = 86_400_000;

function lite(over: Partial<ValidatorLite> = {}): ValidatorLite {
  return {
    operatorAddress: "cosmosvaloper1aaa",
    moniker: "Alpha",
    status: "bonded",
    jailed: false,
    tombstoned: false,
    commissionRate: 0.05,
    commissionMaxRate: 0.05,
    commissionReachable30d: 0.05,
    uptime: 1,
    rank: 20,
    votingPower: 0.01,
    inNakamotoSet: false,
    apr: 0.18,
    ...over,
  };
}

function chain(over: Partial<StakingChain> = {}): StakingChain {
  return {
    chainId: "cosmoshub-4",
    address: "cosmos1xyz",
    denom: "uatom",
    symbol: "ATOM",
    decimals: 6,
    delegations: [],
    unbonding: [],
    redelegations: [],
    withdrawAddress: null,
    totals: { staked: "0", rewards: "0", unbonding: "0" },
    rewardsOther: [],
    nextUnbonding: null,
    apr: { chain: 0.2, weighted: null },
    status: "ok",
    ...over,
  };
}

function stats(chainId: string, price: number | null): ChainStats {
  return {
    chainId,
    chainName: chainId === "cosmoshub-4" ? "Cosmos Hub" : "Safrochain",
    network: "mainnet",
    iconUrl: null,
    nativeSymbol: "X",
    nativeDenom: "ux",
    nativeDecimals: 6,
    price: price === null ? null : { price, change24h: null, source: "numia", at: NOW } as ChainStats["price"],
    apr: { naive: 0.1, actual: 0.2, source: "lcd", blockTimeFactor: null, excludesFees: true },
    inflation: { param: null, actual: null },
    realYield: null,
    bondedRatio: null,
    goalBonded: null,
    bondedTokens: null,
    notBondedTokens: null,
    totalSupply: null,
    communityTax: null,
    unbondingDays: 21,
    maxValidators: null,
    minCommission: null,
    activeValidators: null,
    nakamoto: null,
    top10Share: null,
    medianCommission: null,
    blockTimeSec: null,
    paramsBlockTimeSec: null,
    blockTimeWindow: null,
    latestHeight: null,
    latestBlockTime: null,
    halted: null,
    slashing: null,
    gov: null,
  };
}

const meta = (chainId: string) => ({ chainName: chainId, iconUrl: null });

test("toWhole keeps 18-decimal amounts and refuses unknown decimals", () => {
  assert.equal(toWhole("1500000", 6), 1.5);
  assert.equal(toWhole("123456789000000000000", 18), 123.456789);
  assert.equal(toWhole("1500000", null), null);
  assert.equal(toWhole("abc", 6), null);
});

test("base-unit conversion cuts, never rounds up, and round-trips", () => {
  assert.equal(toBaseUnits("1.2345679", 6), "1234567");
  assert.equal(toBaseUnits(".5", 6), "500000");
  assert.equal(toBaseUnits("", 6), null);
  assert.equal(toBaseUnits("1.2.3", 6), null);
  assert.equal(toDisplay("1234567", 6), "1.234567");
  assert.equal(toDisplay("1000000", 6), "1");
  assert.equal(toDisplay("5", 6), "0.000005");
  assert.equal(sumBase(["1", null, "2", "x", "3"]), "6");
});

test("flags name inactive, jailed, low uptime, a commission that can rise, and the Nakamoto set", () => {
  const ids = (v: ValidatorLite) => validatorFlags(v).map((flag) => flag.id).join(",");
  assert.equal(ids(lite()), "");
  assert.equal(ids(lite({ jailed: true, status: "unbonding" })), "jailed");
  assert.equal(ids(lite({ status: "unbonded" })), "inactive");
  assert.equal(ids(lite({ uptime: 0.9 })), "uptime");
  assert.equal(ids(lite({ inNakamotoSet: true })), "nakamoto");
  const rise = validatorFlags(lite({ commissionRate: 0.095, commissionReachable30d: 0.2 }));
  assert.equal(rise[0]?.id, "commission");
  assert.equal(rise[0]?.label, "Can rise to 20%");
  // A rise to a 20% cap is common: a fact, not an alarm. To 50% is steep.
  assert.equal(rise[0]?.tone, "neutral");
  assert.equal(validatorFlags(lite({ commissionRate: 0.089, commissionReachable30d: 0.5 }))[0]?.tone, "warning");
  assert.equal(validatorFlags(lite({ commissionRate: 0.05, commissionReachable30d: 0.2 }))[0]?.tone, "warning");
  assert.equal(validatorFlags(lite({ commissionRate: 0.05, commissionReachable30d: 0.055 }))[0]?.tone, "neutral");
});

test("a chain without a price keeps its tokens but no value, and the totals say so", () => {
  const view = buildStakingView({
    chains: [
      chain({
        chainId: "cosmoshub-4",
        delegations: [
          { validator: lite({ operatorAddress: "v1", moniker: "Big", apr: 0.18 }), amount: "3000000", rewards: [{ denom: "uatom", amount: "100000" }] },
          { validator: lite({ operatorAddress: "v2", moniker: "Small", apr: 0.18 }), amount: "1000000", rewards: [] },
        ],
        totals: { staked: "4000000", rewards: "100000", unbonding: "0" },
        apr: { chain: 0.2, weighted: 0.18 },
      }),
      chain({
        chainId: "safrochain-1",
        denom: "usaf",
        symbol: "SAF",
        delegations: [{ validator: lite({ operatorAddress: "s1", apr: 0.16 }), amount: "5000000", rewards: [] }],
        totals: { staked: "5000000", rewards: "0", unbonding: "0" },
        apr: { chain: 0.185, weighted: 0.16 },
      }),
    ],
    stats: (id) => (id === "cosmoshub-4" ? stats(id, 2) : stats(id, null)),
    chainMeta: meta,
    now: NOW,
  });
  const hub = view.chains[0];
  assert.equal(hub?.chainId, "cosmoshub-4");
  assert.equal(hub?.stakedValue, 8);
  assert.equal(hub?.positions[0]?.validator.moniker, "Big");
  assert.equal(hub?.positions[0]?.share, 0.75);
  assert.equal(view.chains[1]?.stakedValue, null);
  assert.equal(view.totals.stakedValue, 8);
  assert.deepEqual(view.totals.unpricedChains, ["safrochain-1"]);
  // The unpriced chain cannot weigh in a value-weighted average: excluded, and said.
  assert.equal(view.totals.weightedApr, 0.18);
  assert.deepEqual(view.totals.aprExcluded, ["safrochain-1"]);
  assert.equal(view.totals.validators, 3);
  assert.equal(view.claimable.length, 1);
  assert.ok(Math.abs((view.totals.yearlyValue ?? 0) - 8 * 0.18) < 1e-12);
});

test("value-weighted APR across chains", () => {
  const view = buildStakingView({
    chains: [
      chain({ chainId: "cosmoshub-4", totals: { staked: "1000000", rewards: "0", unbonding: "0" }, apr: { chain: 0.2, weighted: 0.2 }, delegations: [{ validator: lite(), amount: "1000000", rewards: [] }] }),
      chain({ chainId: "safrochain-1", totals: { staked: "3000000", rewards: "0", unbonding: "0" }, apr: { chain: 0.1, weighted: 0.1 }, delegations: [{ validator: lite({ operatorAddress: "s" }), amount: "3000000", rewards: [] }] }),
    ],
    stats: (id) => stats(id, 1),
    chainMeta: meta,
    now: NOW,
  });
  // $1 at 20 % and $3 at 10 %: (0.2 + 0.3) / 4.
  assert.ok(Math.abs((view.totals.weightedApr ?? 0) - 0.125) < 1e-12);
});

test("a chain whose delegations failed is unreadable, not empty", () => {
  const view = buildStakingView({
    chains: [chain({ status: "partial", totals: { staked: null, rewards: "5", unbonding: "0" } })],
    stats: () => null,
    chainMeta: meta,
    now: NOW,
  });
  assert.deepEqual(view.totals.unreadable, ["cosmoshub-4"]);
  assert.equal(view.totals.stakedValue, null);
});

test("zero-amount delegations are not positions; flagged positions are counted", () => {
  const view = buildStakingView({
    chains: [
      chain({
        delegations: [
          { validator: lite({ operatorAddress: "dust" }), amount: "0", rewards: [] },
          { validator: lite({ operatorAddress: "jailed", jailed: true, status: "unbonding" }), amount: "10", rewards: [] },
        ],
        totals: { staked: "10", rewards: "0", unbonding: "0" },
      }),
    ],
    stats: () => null,
    chainMeta: meta,
    now: NOW,
  });
  assert.deepEqual(view.chains[0]?.positions.map((p) => p.validator.operatorAddress), ["jailed"]);
  assert.equal(view.totals.attention, 1);
});

test("timeline lists future releases and redelegation locks, soonest first, and finds the next release", () => {
  const view = buildStakingView({
    chains: [
      chain({
        delegations: [{ validator: lite({ operatorAddress: "dst" }), amount: "5", rewards: [] }],
        unbonding: [
          {
            validator: lite({ operatorAddress: "u1" }),
            entries: [
              { balance: "7", initialBalance: "7", completionTime: new Date(NOW + 9 * DAY).toISOString(), creationHeight: 2 },
              { balance: "3", initialBalance: "3", completionTime: new Date(NOW - DAY).toISOString(), creationHeight: 1 },
            ],
          },
        ],
        redelegations: [
          {
            src: lite({ operatorAddress: "src" }),
            dst: lite({ operatorAddress: "dst" }),
            entries: [{ balance: "5", initialBalance: "5", completionTime: new Date(NOW + 2 * DAY).toISOString(), creationHeight: 3 }],
          },
        ],
        totals: { staked: "5", rewards: "0", unbonding: "7" },
      }),
    ],
    stats: () => null,
    chainMeta: meta,
    now: NOW,
  });
  assert.deepEqual(view.timeline.map((item) => item.kind), ["redelegation", "unbonding"]);
  assert.equal(view.nextRelease?.balance, "7");
  // Stake that arrived by redelegation locks its destination until it completes.
  assert.equal(view.chains[0]?.positions[0]?.redelegationLockUntil, new Date(NOW + 2 * DAY).toISOString());
  assert.equal(pairEntries(view.chains[0]!, "src", "dst", NOW), 1);
  assert.equal(pairEntries(view.chains[0]!, "src", "dst", NOW + 3 * DAY), 0);
});

test("fee reserve: three staking transactions at the average price, only in the fee denom", () => {
  const hub = { feeMinimalDenom: "uatom", gasPriceStep: { low: 0.01, average: 0.025, high: 0.03 } };
  assert.equal(feeReserve(hub, "uatom"), "67500");
  assert.equal(feeReserve(hub, "uother"), "0");
  assert.equal(feeReserve({ feeMinimalDenom: "uatom" }, "uatom"), "0");
  assert.equal(stakeable("100000", "67500"), "32500");
  assert.equal(stakeable("1000", "67500"), "0");
  assert.equal(stakeable(null, "0"), "0");
});

test("unbonding periods read in days, with the odd hour kept", () => {
  assert.equal(unbondingPeriodText(14), "14 days");
  assert.equal(unbondingPeriodText(1), "1 day");
  assert.equal(unbondingPeriodText(14.041666666666666), "14 days 1 hour");
  assert.equal(unbondingPeriodText(null), null);
});

test("stake health weighs by value across chains and leaves unpriced positions out", () => {
  const view = buildStakingView({
    chains: [
      chain({
        chainId: "cosmoshub-4",
        delegations: [
          { validator: lite({ operatorAddress: "a", moniker: "Whale", inNakamotoSet: true, commissionRate: 0.1, commissionReachable30d: 0.2, uptime: 0.97 }), amount: "3000000", rewards: [] },
          { validator: lite({ operatorAddress: "b", moniker: "Jail", jailed: true, status: "unbonding", commissionRate: 0.05, commissionReachable30d: 0.05 }), amount: "1000000", rewards: [] },
        ],
        totals: { staked: "4000000", rewards: "0", unbonding: "0" },
      }),
      chain({
        chainId: "safrochain-1",
        delegations: [{ validator: lite({ operatorAddress: "s", moniker: "Unpriced" }), amount: "9000000", rewards: [] }],
        totals: { staked: "9000000", rewards: "0", unbonding: "0" },
      }),
    ],
    stats: (id) => (id === "cosmoshub-4" ? stats(id, 1) : stats(id, null)),
    chainMeta: meta,
    now: NOW,
  });
  const health = stakeHealth(view.chains, "value");
  assert.equal(health.weighed, 2);
  assert.equal(health.excluded, 1);
  assert.equal(health.earningShare, 0.75);
  assert.equal(health.idlePositions, 1);
  assert.equal(health.nakamotoShare, 0.75);
  assert.ok(Math.abs((health.commission ?? 0) - 0.0875) < 1e-12);
  assert.ok(Math.abs((health.commissionReach30d ?? 0) - 0.1625) < 1e-12);
  assert.equal(health.largest?.moniker, "Whale");
  assert.equal(health.largest?.share, 0.75);
  // Uptime counts every active validator, priced or not; the jailed one is out of the set.
  assert.equal(health.lowestUptime?.moniker, "Whale");
  // Within one chain, tokens are the basis and nothing is left out.
  const one = stakeHealth(view.chains.filter((c) => c.chainId === "safrochain-1"), "tokens");
  assert.equal(one.excluded, 0);
  assert.equal(one.largest?.share, 1);
});

test("nothing staked on chains that all answered is a known zero; a failed read is not", () => {
  const empty = buildStakingView({
    chains: [chain(), chain({ chainId: "safrochain-1" })],
    stats: (id) => stats(id, 1),
    chainMeta: meta,
    now: NOW,
  });
  assert.equal(empty.totals.stakedValue, 0);
  assert.equal(empty.totals.yearlyValue, 0);
  assert.equal(empty.totals.weightedApr, null);
  assert.equal(knownNotStaking(empty), true);

  const failed = buildStakingView({
    chains: [chain(), chain({ chainId: "safrochain-1", status: "error", totals: { staked: null, rewards: null, unbonding: null } })],
    stats: (id) => stats(id, 1),
    chainMeta: meta,
    now: NOW,
  });
  assert.equal(failed.totals.stakedValue, null);
  assert.equal(knownNotStaking(failed), false);

  // Rewards still pending (everything unstaked) is not "not staking".
  const rewardsOnly = buildStakingView({
    chains: [chain({ totals: { staked: "0", rewards: "12", unbonding: "0" } })],
    stats: (id) => stats(id, 1),
    chainMeta: meta,
    now: NOW,
  });
  assert.equal(knownNotStaking(rewardsOnly), false);
  assert.equal(knownNotStaking({ chains: [], timeline: [] }), false);
});

test("unpriced or unread pending rewards and unbonding are unknown, never $0 because another chain has none", () => {
  const view = buildStakingView({
    chains: [
      chain({ chainId: "safrochain-1", denom: "usaf", symbol: "SAF" }),
      chain({
        chainId: "cosmoshub-4",
        delegations: [{ validator: lite(), amount: "1000000", rewards: [{ denom: "uatom", amount: "170914" }] }],
        totals: { staked: "1000000", rewards: "170914", unbonding: "5" },
      }),
    ],
    // Priced only where nothing is pending (prices still loading, or failed, for the Hub).
    stats: (id) => (id === "safrochain-1" ? stats(id, 2) : null),
    chainMeta: meta,
    now: NOW,
  });
  assert.equal(view.totals.rewardsValue, null);
  assert.deepEqual(view.totals.unpricedRewards, ["cosmoshub-4"]);
  assert.equal(view.totals.unbondingValue, null);
  assert.deepEqual(view.totals.unpricedUnbonding, ["cosmoshub-4"]);

  // A partial sum stays (flagged by the unpriced lists), like the staked total.
  const partial = buildStakingView({
    chains: [
      chain({ chainId: "safrochain-1", denom: "usaf", symbol: "SAF", totals: { staked: "0", rewards: "2000000", unbonding: "0" } }),
      chain({ chainId: "cosmoshub-4", totals: { staked: "0", rewards: "170914", unbonding: "0" } }),
    ],
    stats: (id) => (id === "safrochain-1" ? stats(id, 2) : null),
    chainMeta: meta,
    now: NOW,
  });
  assert.equal(partial.totals.rewardsValue, 4);
  assert.deepEqual(partial.totals.unpricedRewards, ["cosmoshub-4"]);

  // A chain whose rewards could not be read is not "nothing to claim".
  const unread = buildStakingView({
    chains: [chain(), chain({ chainId: "safrochain-1", status: "partial", totals: { staked: "0", rewards: null, unbonding: null } })],
    stats: (id) => stats(id, 1),
    chainMeta: meta,
    now: NOW,
  });
  assert.equal(unread.totals.rewardsValue, null);
  assert.equal(unread.totals.unbondingValue, null);
  assert.deepEqual(unread.totals.unreadRewards, ["safrochain-1"]);
  assert.deepEqual(unread.totals.unreadUnbonding, ["safrochain-1"]);

  // Nothing pending anywhere is a known zero, priced or not.
  const nothing = buildStakingView({
    chains: [chain(), chain({ chainId: "safrochain-1" })],
    stats: () => null,
    chainMeta: meta,
    now: NOW,
  });
  assert.equal(nothing.totals.rewardsValue, 0);
  assert.equal(nothing.totals.unbondingValue, 0);
});

test("the timeline window fits the entries, at least a week, with readable tick steps", () => {
  const week = timelineWindow(NOW, [NOW + DAY / 2, NOW + 3.5 * DAY]);
  assert.equal(week.start, NOW);
  assert.equal(week.end, NOW + 7 * DAY);
  assert.equal(week.stepDays, 1);
  // A phone-width track (room for three ticks): every other day, not one weekly tick.
  assert.equal(timelineWindow(NOW, [NOW + DAY], 3).stepDays, 2);

  const long = timelineWindow(NOW, [NOW + 20 * DAY]);
  assert.ok(long.end > NOW + 20 * DAY && long.end < NOW + 23 * DAY);
  assert.equal(long.stepDays, 7);
  // Nothing ahead (or junk): still a week.
  assert.equal(timelineWindow(NOW, [Number.NaN]).end, NOW + 7 * DAY);
});

test("percentages of fractions and whole-token text never misread", () => {
  assert.equal(percentOf(0.125), "12.50%");
  assert.equal(percentOf(0.2, 0), "20%");
  assert.equal(percentOf(null), "—");
  assert.equal(percentOf(Number.NaN), "—");
  // 2999.7 as a float is 2999.69999…: the cut must not show "2,999.69".
  assert.equal(wholeText(2999 + 700000 / 1e6, { maxFraction: 2 }), "2,999.7");
  assert.equal(wholeText(0.0000004, { maxFraction: 6 }), "<0.000001");
});
