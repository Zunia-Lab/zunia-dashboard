/**
 * The Overview's arithmetic: allocation keeps an entity's colour across
 * views, chain rows compute shares and moves without inventing zeros, the KPI
 * figures leave out what they cannot price, and the insight row keeps a mix.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProposalRow, StakingChain, StakingDelegation, StakingResponse, ValidatorLite } from "@/lib/chain/types";
import type { Insight } from "@/lib/insights/rules";
import type { TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset, PortfolioChain, PortfolioResponse } from "@/lib/token/wire";

import { groupAssets } from "@/lib/token/holdings";

import {
  TYPE_COLORS,
  allocationByAsset,
  allocationByChain,
  allocationByType,
  assetCounts,
  bucketsBySize,
  chainRowReason,
  chainRows,
  changePct,
  coverageShareText,
  coverageText,
  deadlines,
  historyReadiness,
  pickInsights,
  rewardChainCount,
  seriesChange,
  seriesExtent,
  stakeShare,
  stakedRatio,
  stakingDenomMap,
  unpricedByType,
  unreadByType,
  upcomingReleases,
  validatorsUsed,
  voteSummary,
  yieldEstimate,
} from "../model";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY = 86_400_000;

function identity(chainId: string, denom: string, ticker: string, extra: Partial<TokenIdentity> = {}): TokenIdentity {
  return {
    key: `${chainId}:${denom}`,
    chainId,
    denom,
    kind: "native",
    ticker,
    name: ticker,
    decimals: 6,
    provenance: "native",
    proven: true,
    originChainId: chainId,
    originDenom: denom,
    chainName: chainId,
    ...extra,
  };
}

function asset(chainId: string, denom: string, ticker: string, amounts: Partial<PortfolioAsset["amounts"]>, price: number | null, extra: Partial<TokenIdentity> = {}): PortfolioAsset {
  const full = { liquid: "0", staked: "0", rewards: "0", unbonding: "0", ...amounts };
  const total = Object.values(full).reduce((sum, v) => sum + Number(v), 0) / 1e6;
  return {
    identity: identity(chainId, denom, ticker, extra),
    chainId,
    amounts: full,
    total,
    price: price === null ? null : { price, change24h: null, source: "numia", at: NOW },
    value: price === null ? null : total * price,
    change24hAbs: null,
  };
}

function chain(chainId: string, value: number | null, extra: Partial<PortfolioChain> = {}): PortfolioChain {
  return {
    chainId,
    chainName: chainId.toUpperCase(),
    iconUrl: null,
    address: "a",
    status: "ok",
    value,
    liquid: value,
    staked: 0,
    rewards: 0,
    unbonding: 0,
    change24hAbs: null,
    assetCount: 1,
    nativeSymbol: "X",
    ...extra,
  };
}

function portfolio(assets: PortfolioAsset[], chains: PortfolioChain[]): PortfolioResponse {
  const pricedValue = assets.reduce((sum, a) => sum + (a.value ?? 0), 0);
  return {
    currency: "usd",
    updatedAt: NOW,
    totals: {
      value: pricedValue,
      liquid: 60,
      staked: 30,
      rewards: 10,
      unbonding: 0,
      change24hAbs: null,
      change24hPct: null,
      change7dAbs: null,
      change7dPct: null,
      pricedValue,
      unpricedAssetCount: assets.filter((a) => a.value === null).length,
      assetCount: assets.length,
      chainCount: chains.length,
    },
    chains,
    assets,
  };
}

function stakingChain(chainId: string, denom: string, extra: Partial<StakingChain> = {}): StakingChain {
  return {
    chainId,
    address: "a",
    denom,
    symbol: denom.slice(1).toUpperCase(),
    decimals: 6,
    delegations: [],
    unbonding: [],
    redelegations: [],
    withdrawAddress: null,
    totals: { staked: "0", rewards: "0", unbonding: "0" },
    rewardsOther: [],
    nextUnbonding: null,
    apr: { chain: null, weighted: null },
    status: "ok",
    ...extra,
  };
}

test("allocation by type keeps fixed colours, drops empty buckets", () => {
  const allocation = allocationByType({ liquid: 60, staked: 30, rewards: 10, unbonding: 0 });
  assert.deepEqual(
    allocation.parts.map((p) => p.id),
    ["liquid", "staked", "rewards"],
  );
  assert.equal(allocation.total, 100);
  assert.equal(allocation.colors, TYPE_COLORS);
  assert.equal(TYPE_COLORS.get("liquid"), "var(--viz-1)");
  assert.equal(TYPE_COLORS.get("unbonding"), "var(--viz-4)");
});

test("allocation by chain and by asset: largest first, colours follow the entity", () => {
  const atomHub = asset("cosmoshub-4", "uatom", "ATOM", { liquid: "10000000" }, 2);
  const atomOsmo = asset("osmosis-1", "ibc/atom", "ATOM", { liquid: "5000000" }, 2, { key: "cosmoshub-4:uatom", kind: "ibc", originChainId: "cosmoshub-4" });
  const osmo = asset("osmosis-1", "uosmo", "OSMO", { liquid: "100000000" }, 0.03);
  const fake = asset("osmosis-1", "factory/x/atom", "ATOM", { liquid: "1000000" }, 0.5, { key: "osmosis-1:factory/x/atom", kind: "factory", proven: false, chainName: "Osmosis" });
  const pf = portfolio([atomHub, atomOsmo, osmo, fake], [chain("cosmoshub-4", 20), chain("osmosis-1", 13.5), chain("celestia", null)]);

  const byChain = allocationByChain(pf);
  assert.deepEqual(byChain.parts.map((p) => [p.id, p.value]), [["cosmoshub-4", 20], ["osmosis-1", 13.5]]);
  assert.equal(byChain.colors.get("cosmoshub-4"), "var(--viz-1)");

  const byAsset = allocationByAsset(pf);
  // Proven ATOM merges across chains (30); the unproven factory "ATOM" stays apart, named by its chain.
  assert.deepEqual(
    byAsset.parts.map((p) => [p.id, p.label, p.value]),
    [
      ["cosmoshub-4:uatom", "ATOM · cosmoshub-4", 30],
      ["osmosis-1:uosmo", "OSMO", 3],
      ["osmosis-1:factory/x/atom", "ATOM · Osmosis", 0.5],
    ],
  );
  assert.equal(byAsset.colors.get("osmosis-1:uosmo"), "var(--viz-2)");
});

test("chain rows: share, 24 h move, staked share, APR with its reason, errors last", () => {
  const pf = portfolio(
    [asset("celestia", "utia", "TIA", { liquid: "100000000" }, 0.5)],
    [
      chain("osmosis-1", 10, { staked: 5, change24hAbs: -1 }),
      chain("celestia", 40, { staked: 30, change24hAbs: 4 }),
      chain("juno-1", null, { status: "error", error: "timeout", assetCount: 0 }),
      chain("akashnet-2", null, { assetCount: 2 }),
    ],
  );
  pf.totals.pricedValue = 50;
  const rows = chainRows(pf, [
    {
      chainId: "celestia",
      apr: { naive: 0.055, actual: 0.0551, source: "lcd", blockTimeFactor: 1, excludesFees: true },
      reasons: {},
    } as never,
    { chainId: "osmosis-1", apr: { naive: null, actual: null, source: null, blockTimeFactor: null, excludesFees: true, note: "No mint data" }, reasons: {} } as never,
  ]);
  assert.deepEqual(rows.map((r) => r.chainId), ["celestia", "osmosis-1", "akashnet-2", "juno-1"]);
  const celestia = rows[0];
  assert.equal(celestia?.share, 80);
  assert.ok(Math.abs((celestia?.change24hPct ?? 0) - (4 / 36) * 100) < 1e-9);
  assert.equal(celestia?.stakedShare, 75);
  assert.ok(Math.abs((celestia?.apr ?? 0) - 5.51) < 1e-9);
  assert.equal(rows[1]?.apr, null);
  assert.equal(rows[1]?.aprReason, "No mint data");
  assert.equal(rows[2]?.aprReason, "Chain economics not loaded");
  assert.equal(rows[3]?.share, null);
});

test("changePct refuses a zero or unknown base", () => {
  assert.equal(changePct(10, 10), null);
  assert.equal(changePct(null, 1), null);
  assert.equal(changePct(10, null), null);
  assert.equal(changePct(110, 10), 10);
});

test("yield estimate: staked value × weighted APR, unknown APRs left out and named", () => {
  const pf = portfolio([], [chain("celestia", 100, { staked: 80 }), chain("cosmoshub-4", 50, { staked: 20 }), chain("osmosis-1", 5, { staked: 0 })]);
  const staking: StakingResponse = {
    updatedAt: NOW,
    chains: [stakingChain("celestia", "utia", { apr: { chain: 0.055, weighted: 0.05 } }), stakingChain("cosmoshub-4", "uatom")],
  };
  const estimate = yieldEstimate(pf, staking);
  assert.equal(estimate.yearly, 4);
  assert.equal(estimate.apr, 0.05);
  assert.equal(estimate.coveredValue, 80);
  assert.deepEqual(estimate.missing, ["cosmoshub-4"]);
  assert.deepEqual(yieldEstimate(pf, null).yearly, null);
});

test("staked ratio counts each chain's staking denom only, by value", () => {
  const pf = portfolio(
    [
      asset("celestia", "utia", "TIA", { liquid: "60000000", staked: "40000000" }, 0.5),
      asset("celestia", "ibc/usdc", "USDC", { liquid: "1000000000" }, 1),
      asset("cosmoshub-4", "uatom", "ATOM", { liquid: "0", staked: "10000000", unbonding: "10000000" }, 2),
      asset("akashnet-2", "uakt", "AKT", { liquid: "5000000" }, null),
    ],
    [],
  );
  const denoms = stakingDenomMap(
    { updatedAt: NOW, chains: [stakingChain("celestia", "utia"), stakingChain("cosmoshub-4", "uatom")] },
    [{ chainId: "akashnet-2", nativeDenom: "uakt" } as never],
  );
  const ratio = stakedRatio(pf, denoms);
  // Staked: 20 (TIA) + 20 (ATOM) = 40; liquid 30; unbonding 20; AKT unpriced.
  assert.equal(ratio.stakedValue, 40);
  assert.equal(ratio.liquidValue, 30);
  assert.ok(Math.abs((ratio.ratio ?? 0) - 40 / 90) < 1e-12);
  assert.equal(stakedRatio(pf, new Map()).ratio, null);
});

function proposal(id: string, endsIn: number, extra: Partial<ProposalRow> = {}): ProposalRow {
  return {
    chainId: "cosmoshub-4",
    id,
    api: "v1",
    title: `Proposal ${id}`,
    summary: "",
    type: "Text",
    messageTypes: [],
    status: "voting",
    submitTime: null,
    depositEndTime: null,
    votingStartTime: null,
    votingEndTime: new Date(NOW + endsIn).toISOString(),
    totalDeposit: [],
    minDeposit: null,
    expedited: false,
    tally: null,
    tallyKind: "live",
    turnout: null,
    quorum: null,
    threshold: null,
    vetoThreshold: null,
    passingIfEndedNow: null,
    myVote: null,
    myVoteStatus: "not-voted",
    myVotingPower: "1",
    ...extra,
  };
}

test("vote summary and deadlines: open, eligible, awaiting, soonest first", () => {
  const rows = [
    proposal("3", 5 * DAY),
    proposal("1", 2 * DAY, { myVoteStatus: "voted", myVote: { option: "yes" } }),
    proposal("2", 3 * DAY, { myVotingPower: "0" }),
    proposal("4", -DAY),
    proposal("5", DAY, { status: "deposit" }),
  ];
  const summary = voteSummary(rows, NOW);
  assert.equal(summary.open, 3);
  assert.equal(summary.eligible, 2);
  assert.equal(summary.awaiting, 1);
  assert.equal(summary.next?.id, "3");
  assert.deepEqual(summary.eligibleChains, ["cosmoshub-4"]);
  assert.deepEqual(voteSummary([proposal("9", DAY, { chainId: "osmosis-1" }), ...rows], NOW).eligibleChains, ["osmosis-1", "cosmoshub-4"]);
  assert.deepEqual(deadlines(rows, NOW).map((p) => p.id), ["1", "2", "3"]);
});

test("upcoming releases: soonest first across chains, past and empty entries skipped, valued at the native price", () => {
  const entry = (balance: string, inMs: number) => ({ balance, initialBalance: balance, completionTime: new Date(NOW + inMs).toISOString(), creationHeight: 1 });
  const v = { operatorAddress: "v", moniker: "Val" } as StakingChain["unbonding"][number]["validator"];
  const staking: StakingResponse = {
    updatedAt: NOW,
    chains: [
      stakingChain("celestia", "utia", { unbonding: [{ validator: v, entries: [entry("2000000", 5 * DAY), entry("1000000", -DAY)] }] }),
      stakingChain("cosmoshub-4", "uatom", { unbonding: [{ validator: v, entries: [entry("3000000", 2 * DAY), entry("0", DAY)] }] }),
    ],
  };
  const pf = portfolio([asset("celestia", "utia", "TIA", { unbonding: "2000000" }, 0.5)], []);
  const releases = upcomingReleases(staking, pf, NOW);
  assert.deepEqual(releases.map((r) => [r.chainId, r.amount, r.value]), [["cosmoshub-4", "3000000", null], ["celestia", "2000000", 1]]);
});

test("asset counts go by asset: one asset on two chains counts once, unpriced by reason", () => {
  const atomHub = asset("cosmoshub-4", "uatom", "ATOM", { liquid: "10000000" }, 2);
  const atomOsmo = asset("osmosis-1", "ibc/atom", "ATOM", { liquid: "5000000" }, 2, { key: "cosmoshub-4:uatom", kind: "ibc", originChainId: "cosmoshub-4" });
  const spam = { ...asset("osmosis-1", "factory/x/spam", "SPAM", { liquid: "1" }, null), unpriced: "no-market" as const };
  const dym = { ...asset("safrochain-1", "factory/y/dyma", "DYMA", { liquid: "1" }, null), unpriced: "no-market" as const };
  const odd = { ...asset("juno-1", "ibc/odd", "ODD", { liquid: "1" }, null), unpriced: "unproven" as const };
  const rows = [atomHub, atomOsmo, spam, dym, odd];
  const counts = assetCounts(groupAssets(rows), rows.length);
  assert.equal(counts.assets, 4);
  assert.equal(counts.holdings, 5);
  assert.equal(counts.unpriced, 3);
  assert.deepEqual(counts.unpricedReasons, [
    { reason: "no-market", count: 2 },
    { reason: "unproven", count: 1 },
  ]);
  assert.deepEqual(assetCounts([], 0), { assets: 0, holdings: 0, unpriced: 0, unpricedReasons: [] });
});

test("series extent: high and low points, the earliest of equals, none below two points", () => {
  const points = [
    { t: 1, v: 10 },
    { t: 2, v: 14 },
    { t: 3, v: 8 },
    { t: 4, v: 14 },
    { t: 5, v: Number.NaN },
  ];
  assert.deepEqual(seriesExtent(points), { high: { t: 2, v: 14 }, low: { t: 3, v: 8 } });
  assert.equal(seriesExtent([{ t: 1, v: 3 }]), null);
  assert.equal(seriesExtent([]), null);
});

test("series change and coverage text", () => {
  assert.deepEqual(seriesChange([{ t: 1, v: 100 }, { t: 2, v: 110 }]), { abs: 10, pct: 10 });
  assert.equal(seriesChange([{ t: 1, v: 100 }]), null);
  assert.equal(seriesChange([{ t: 1, v: 0 }, { t: 2, v: 5 }])?.pct, null);
  assert.equal(coverageText({ coverage: { pricedValueShare: 1, missing: [], partial: [] } }), null);
  assert.equal(
    coverageText({ coverage: { pricedValueShare: 0.871, missing: ["a", "b"], partial: [{ key: "k", symbol: "SAF", from: 0 }] } }),
    "Covers 87% of today's value · 2 assets have no price history · SAF held at first known price before history starts",
  );
});

test("pickInsights keeps a mix: at most two of a kind while others wait", () => {
  const item = (id: string, kind: Insight["kind"], severity: Insight["severity"]): Insight => ({ id, kind, severity, title: id, body: "" });
  const items = [
    item("w1", "validator-risk", "warning"),
    item("o1", "claim", "opportunity"),
    item("o2", "claim", "opportunity"),
    item("o3", "claim", "opportunity"),
    item("o4", "claim", "opportunity"),
    item("i1", "unbonding", "info"),
    item("i2", "unpriced", "info"),
  ];
  assert.deepEqual(pickInsights(items, 5).map((i) => i.id), ["w1", "o1", "o2", "i1", "i2"]);
  assert.deepEqual(pickInsights(items, 6).map((i) => i.id), ["w1", "o1", "o2", "o3", "i1", "i2"]);
  assert.deepEqual(pickInsights([], 6), []);
  // One per kind first (the Overview row), the rest only to fill.
  assert.deepEqual(pickInsights(items, 4, 1).map((i) => i.id), ["w1", "o1", "i1", "i2"]);
  assert.deepEqual(pickInsights(items, 5, 1).map((i) => i.id), ["w1", "o1", "o2", "i1", "i2"]);
});

test("type buckets: the legend follows the bar (largest first), empty ones keep their order", () => {
  assert.deepEqual(
    bucketsBySize({ liquid: 2, staked: 40, rewards: 0.31, unbonding: 0 }).map((b) => b.id),
    ["staked", "liquid", "rewards", "unbonding"],
  );
  assert.deepEqual(
    bucketsBySize({ liquid: 0, staked: 0, rewards: 0, unbonding: 0 }).map((b) => b.id),
    ["liquid", "staked", "rewards", "unbonding"],
  );
  assert.deepEqual(bucketsBySize(null).map((b) => b.id), ["liquid", "staked", "rewards", "unbonding"]);
});

test("unpriced holdings per bucket and reward chains count amounts, not priced totals", () => {
  // initiation-2 as read: INIT liquid and rewards, no price (testnet), and a
  // priced dust token elsewhere.
  const init = { ...asset("initiation-2", "uinit", "INIT", { liquid: "12946845", rewards: "1634551" }, null), unpriced: "testnet" as const };
  const other = { ...asset("initiation-2", "uusdc", "USDC", { liquid: "5" }, null), unpriced: "testnet" as const };
  // The same unpriced asset on a second chain counts once.
  const initOsmo = { ...asset("osmosis-1", "ibc/init", "INIT", { liquid: "1" }, null, { key: "initiation-2:uinit" }), unpriced: "testnet" as const };
  const atom = asset("cosmoshub-4", "uatom", "ATOM", { staked: "1000000", rewards: "100" }, 2);
  const rows = [init, other, initOsmo, atom];
  assert.deepEqual(unpricedByType(rows), { liquid: 2, staked: 0, rewards: 1, unbonding: 0 });
  assert.equal(rewardChainCount(rows), 2);
  assert.equal(rewardChainCount([asset("celestia", "utia", "TIA", { rewards: "0", liquid: "1" }, 0.5)]), 0);
  assert.deepEqual(unpricedByType([]), { liquid: 0, staked: 0, rewards: 0, unbonding: 0 });
});

test("unread buckets: a failed read of one part, or of a whole chain, makes that bucket unknown", () => {
  // initiation-2 as read: delegations and unbonding answered HTTP 500.
  const errors = [
    { chainId: "initiation-2", scope: "delegations", message: "rest.testnet.initia.xyz answered HTTP 500" },
    { chainId: "initiation-2", scope: "unbonding", message: "rest.testnet.initia.xyz answered HTTP 500" },
    { scope: "prices:numia", message: "Numia did not answer in time" },
  ];
  assert.deepEqual(unreadByType(errors), { liquid: 0, staked: 1, rewards: 0, unbonding: 1 });
  assert.deepEqual(unreadByType([{ chainId: "juno-1", scope: "chain", message: "Chain unreachable" }]), { liquid: 1, staked: 1, rewards: 1, unbonding: 1 });
  assert.deepEqual(unreadByType(undefined), { liquid: 0, staked: 0, rewards: 0, unbonding: 0 });
});

test("chain row reasons say why a figure is missing: not read, nothing held, unpriced", () => {
  assert.equal(chainRowReason({ status: "error", value: null, assetCount: 0 }, "change"), "Not read");
  // Safrochain holding nothing: its token is priced, so "Unpriced" would be false.
  assert.equal(chainRowReason({ status: "ok", value: 0, assetCount: 0 }, "staked"), "Nothing held");
  assert.equal(chainRowReason({ status: "ok", value: 0, assetCount: 0 }, "change"), "Nothing held");
  assert.equal(chainRowReason({ status: "ok", value: null, assetCount: 3 }, "staked"), "Unpriced");
  assert.equal(chainRowReason({ status: "ok", value: 12, assetCount: 3 }, "change"), "No 24 h price change");
});

function validatorLite(overrides: Partial<ValidatorLite>): ValidatorLite {
  return {
    operatorAddress: "v",
    moniker: "V",
    status: "bonded",
    jailed: false,
    tombstoned: false,
    commissionRate: 0.05,
    commissionMaxRate: 0.2,
    commissionReachable30d: 0.06,
    uptime: 1,
    rank: 1,
    votingPower: 0.01,
    inNakamotoSet: false,
    apr: 0.1,
    ...overrides,
  };
}

function staked(amount: string, overrides: Partial<ValidatorLite>): StakingDelegation {
  return { validator: validatorLite(overrides), amount, rewards: [] };
}

test("stake share counts bonded validators only, as the chain's bonded tokens do", () => {
  // Cosmos Hub as read: 19.579406 ATOM staked, 5.939406 of it with strangelove
  // and Multiplex (unbonded, jailed); bonded tokens 339,830,874.47235 ATOM.
  const hub = stakingChain("cosmoshub-4", "uatom", {
    delegations: [
      staked("13640000", { operatorAddress: "a", moniker: "Active" }),
      staked("3000000", { operatorAddress: "s", moniker: "strangelove", status: "unbonded", jailed: true }),
      staked("2939406", { operatorAddress: "m", moniker: "Multiplex", status: "unbonded", jailed: true }),
    ],
    totals: { staked: "19579406", rewards: "0", unbonding: "0" },
  });
  const share = stakeShare(hub, "339830874472350");
  assert.equal(share?.bonded, BigInt(13640000));
  assert.equal(share?.outside, BigInt(5939406));
  assert.ok(Math.abs((share?.share ?? 0) - 13640000 / 339830874472350) < 1e-18);
  assert.equal(stakeShare(hub, null)?.share, null);
  // A validator whose status could not be read leaves the share unknown.
  const unknown = stakingChain("cosmoshub-4", "uatom", { delegations: [staked("1", { status: null })], totals: { staked: "1", rewards: "0", unbonding: "0" } });
  assert.equal(stakeShare(unknown, "100")?.statusUnknown, true);
  assert.equal(stakeShare(unknown, "100")?.share, null);
  // Delegations not read: unknown, never "0%".
  assert.equal(stakeShare(stakingChain("x", "ux", { totals: { staked: null, rewards: null, unbonding: null } }), "100"), null);
});

test("validators used: largest stake first, idle ones counted, unreadable is null", () => {
  const chain = stakingChain("osmosis-1", "uosmo", {
    delegations: [
      staked("1000", { operatorAddress: "small", moniker: "Small" }),
      staked("9000", { operatorAddress: "big", moniker: "Big" }),
      staked("5000", { operatorAddress: "tomb", moniker: "Tomb", status: "unbonded", jailed: true, tombstoned: true }),
      staked("0", { operatorAddress: "gone", moniker: "Gone" }),
    ],
    totals: { staked: "15000", rewards: "0", unbonding: "0" },
  });
  const used = validatorsUsed(chain);
  assert.deepEqual(used?.validators.map((v) => v.moniker), ["Big", "Tomb", "Small"]);
  assert.equal(used?.idle, 1);
  assert.equal(validatorsUsed(stakingChain("osmosis-1", "uosmo"))?.validators.length, 0);
  assert.equal(validatorsUsed(stakingChain("osmosis-1", "uosmo", { status: "error" })), null);
  assert.equal(validatorsUsed(null), null);
});

/** The /overview answer captured at 05:08Z: every main series missed the budget, dust remained. */
const DEGRADED_HISTORY = {
  coverage: {
    pricedValueShare: 1.076582302176894e-5,
    missing: ["cosmoshub-4:uatom", "celestia:utia", "osmosis-1:uosmo", "akashnet-2:uakt", "stride-1:stucmdx"],
    partial: [],
  },
  errors: [
    { scope: "prices:numia", message: "Numia did not answer in time" },
    { scope: "history:cosmoshub-4:uatom", message: "Price history is still loading; try again shortly" },
    { scope: "history:celestia:utia", message: "Price history is still loading; try again shortly" },
    { scope: "history:osmosis-1:uosmo", message: "Price history is still loading; try again shortly" },
    { scope: "history:akashnet-2:uakt", message: "Price history is still loading; try again shortly" },
  ],
};

/** The same request once the caches were warm. */
const HEALTHY_HISTORY = {
  coverage: {
    pricedValueShare: 0.999999585998419,
    missing: ["stride-1:stucmdx", "stride-1:stuluna", "stride-1:stuumee"],
    partial: [{ key: "stride-1:stustars", symbol: "stSTARS", from: 1790294400000 }],
  },
};

test("history readiness: a curve of dust while series load is withheld; a lasting gap is drawn down to half", () => {
  const degraded = historyReadiness(DEGRADED_HISTORY);
  assert.equal(degraded.usable, false);
  assert.deepEqual(degraded.loading, ["cosmoshub-4:uatom", "celestia:utia", "osmosis-1:uosmo", "akashnet-2:uakt"]);
  assert.equal(historyReadiness(HEALTHY_HISTORY).usable, true);
  assert.deepEqual(historyReadiness(HEALTHY_HISTORY).loading, []);
  // Some dust still loading next to a nearly whole curve: drawn.
  assert.equal(historyReadiness({ ...DEGRADED_HISTORY, coverage: { ...DEGRADED_HISTORY.coverage, pricedValueShare: 0.97 } }).usable, true);
  // Every series answered, a permanent gap: drawn from half the value, not below.
  assert.equal(historyReadiness({ coverage: { pricedValueShare: 0.6, missing: ["x"], partial: [] } }).usable, true);
  assert.equal(historyReadiness({ coverage: { pricedValueShare: 0.3, missing: ["x"], partial: [] } }).usable, false);
  // A series that failed (not "still loading") is a lasting gap, not a wait.
  assert.deepEqual(historyReadiness({ coverage: { pricedValueShare: 0.6, missing: ["x"], partial: [] }, errors: [{ scope: "history:x", message: "Price history could not be read" }] }).loading, []);
  // No answer yet: nothing to withhold.
  assert.equal(historyReadiness(null).usable, true);
});

test("coverage text says still-loading series are loading, not missing; slivers read <1%", () => {
  assert.equal(
    coverageText(DEGRADED_HISTORY),
    "Covers <1% of today's value · price history still loading for 4 assets · 1 asset has no price history",
  );
  assert.equal(
    coverageText({ coverage: { pricedValueShare: 1, missing: ["a"], partial: [] }, errors: [{ scope: "history:a", message: "Price history is still loading; try again shortly" }] }),
    "Price history still loading for 1 asset",
  );
  assert.equal(
    coverageText(HEALTHY_HISTORY),
    "3 assets have no price history · stSTARS held at first known price before history starts",
  );
  assert.equal(coverageShareText(0.0000108), "<1%");
  assert.equal(coverageShareText(0), "0%");
  assert.equal(coverageShareText(0.871), "87%");
});
