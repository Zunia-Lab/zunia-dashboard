import assert from "node:assert/strict";
import { test } from "node:test";
import { buildForwardMemo } from "@zunialab/interchain";
import type { ActivityItem } from "@/lib/activity/types";
import type { TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset } from "@/lib/token/wire";
import {
  addressParts,
  awayFromHome,
  bucketWorth,
  channelFromHistory,
  channelLegs,
  checkRecipient,
  exceeds,
  fallbackDestination,
  feeShare,
  fractionOf,
  frequentRecipients,
  fromBase,
  historySince,
  historyWith,
  ibcCounts,
  isRefund,
  looksLikeExchange,
  maxSendable,
  missingTokenReason,
  moveKind,
  newest,
  pairOwnIbc,
  routeTiming,
  pickDestination,
  plannableOverrides,
  pricedSum,
  pricedSumByChain,
  spendableAssets,
  splitBalanceKey,
  splitIncoming,
  strangerChannels,
  subtractUnits,
  suggestRoutes,
  timingsByRoute,
  toBase,
  toWhole,
  topSenders,
  touchesChain,
  transferIntentProblem,
  withinLoaded,
  transferStats,
  valueOf,
  type PrefixChain,
} from "../logic";

const HUB = "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f";
const OSMO = "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm";
const SAFRO = "addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e";

const CATALOG: PrefixChain[] = [
  { chainId: "cosmoshub-4", chainName: "Cosmos Hub", bech32Prefix: "cosmos", network: "mainnet" },
  { chainId: "osmosis-1", chainName: "Osmosis", bech32Prefix: "osmo", network: "mainnet" },
  { chainId: "osmo-test-5", chainName: "Osmosis Testnet", bech32Prefix: "osmo", network: "testnet" },
  { chainId: "safrochain-1", chainName: "Safrochain", bech32Prefix: "addr_safro", network: "mainnet" },
];
const byPrefix = (prefix: string) => CATALOG.filter((chain) => chain.bech32Prefix === prefix);

test("toBase and fromBase are exact both ways", () => {
  assert.equal(toBase("12.5", 6), "12500000");
  assert.equal(toBase("0.000001", 6), "1");
  assert.equal(toBase(".5", 6), "500000");
  assert.equal(toBase("1.0000001", 6), null, "never truncated silently");
  assert.equal(toBase("1e3", 6), null);
  assert.equal(toBase("", 6), null);
  assert.equal(toBase("00042", null), "42", "unknown decimals: the field already holds base units");
  assert.equal(toBase("4.2", null), null);
  assert.equal(fromBase("12500000", 6), "12.5");
  assert.equal(fromBase("1", 18), "0.000000000000000001");
  assert.equal(fromBase("123", null), "123");
  assert.equal(fromBase("x", 6), "0");
});

test("amount arithmetic stays in base units", () => {
  assert.equal(maxSendable("1000000", "6250"), "993750");
  assert.equal(maxSendable("5000", "6250"), "0", "never negative");
  assert.equal(maxSendable("1000", null), "1000");
  assert.equal(fractionOf("1000001", 50), "500000");
  assert.equal(fractionOf("1000001", 100), "1000001");
  assert.equal(fractionOf("1000001", 0), "0");
  assert.equal(exceeds("1000001", "1000000"), true);
  assert.equal(exceeds("x", "1"), false);
  assert.equal(subtractUnits("5", "7"), "0");
  assert.equal(toWhole("1500000", 6), 1.5);
  assert.equal(toWhole("1", null), null);
  assert.equal(valueOf("2000000", 6, 1.79), 3.58);
  assert.equal(valueOf("2000000", 6, null), null);
});

function identity(partial: Partial<TokenIdentity> & Pick<TokenIdentity, "chainId" | "denom" | "ticker">): TokenIdentity {
  return {
    key: `${partial.chainId}:${partial.denom}`,
    kind: "native",
    name: partial.ticker,
    decimals: 6,
    provenance: "native",
    proven: true,
    originChainId: partial.chainId,
    ...partial,
  };
}

function asset(id: TokenIdentity, liquid: string, price: number | null, staked = "0"): PortfolioAsset {
  return {
    identity: id,
    chainId: id.chainId,
    amounts: { liquid, staked, rewards: "0", unbonding: "0" },
    total: null,
    price: price === null ? null : { price, change24h: null, source: "numia", at: 0 },
    value: null,
    change24hAbs: null,
    ...(price === null ? { unpriced: "no-market" as const } : {}),
  };
}

const ATOM = identity({ chainId: "cosmoshub-4", denom: "uatom", ticker: "ATOM" });
const OSMO_NATIVE = identity({ chainId: "osmosis-1", denom: "uosmo", ticker: "OSMO" });
const ATOM_ON_OSMO = identity({
  chainId: "osmosis-1",
  denom: "ibc/27394FB0",
  ticker: "ATOM",
  kind: "ibc",
  key: "cosmoshub-4:uatom",
  originChainId: "cosmoshub-4",
  provenance: "channel-walk",
});
const UNKNOWN = identity({ chainId: "osmosis-1", denom: "ibc/DEAD", ticker: "IBC·DEAD", kind: "ibc", provenance: "unknown", originChainId: undefined, decimals: null });
const CW20 = identity({ chainId: "juno-1", denom: "cw20:juno1abc", ticker: "RAW", kind: "cw20" });

test("spendableAssets keeps positive liquid bank balances, most valuable first", () => {
  const rows = spendableAssets([
    asset(OSMO_NATIVE, "10000000", 0.03),
    asset(ATOM, "2000000", 1.8, "5000000"),
    asset(ATOM_ON_OSMO, "0", 1.8, "0"),
    asset(UNKNOWN, "77", null),
    asset(CW20, "1000", 1),
  ]);
  assert.deepEqual(
    rows.map((row) => row.key),
    ["cosmoshub-4|uatom", "osmosis-1|uosmo", "osmosis-1|ibc/DEAD"],
  );
  assert.equal(rows[0]?.value, 3.6);
  assert.equal(rows[2]?.value, null);
  assert.equal(rows[2]?.unpriced, "no-market");
});

test("moveKind says how a token moves on a pair", () => {
  assert.equal(moveKind(ATOM, "osmosis-1"), "native");
  assert.equal(moveKind(ATOM_ON_OSMO, "cosmoshub-4"), "home");
  assert.equal(moveKind(ATOM_ON_OSMO, "safrochain-1"), "away");
  assert.equal(moveKind(UNKNOWN, "cosmoshub-4"), "native", "an unknown origin is not guessed");
});

test("checkRecipient verifies the checksum and names the chain", () => {
  assert.equal(checkRecipient("", byPrefix).state, "empty");
  assert.equal(checkRecipient("osmo1gv86", byPrefix).state, "partial");
  const typo = checkRecipient(OSMO.slice(0, -1) + "q", byPrefix);
  assert.equal(typo.state, "invalid");
  assert.match(typo.message ?? "", /typo/);
  const ok = checkRecipient(`  ${OSMO} `, byPrefix);
  assert.equal(ok.state, "valid");
  assert.equal(ok.address, OSMO);
  assert.deepEqual(
    ok.chains.map((chain) => chain.chainId),
    ["osmosis-1", "osmo-test-5"],
  );
  assert.equal(checkRecipient(OSMO.toUpperCase(), byPrefix).state, "valid", "an all-caps address is read lower-case");
  assert.equal(checkRecipient(SAFRO, byPrefix).chains[0]?.chainId, "safrochain-1");
  assert.equal(checkRecipient("cosmosvaloper1sjllsnramtg3ewxqwwrwjxfgc4n4ef9u2lcnj0", byPrefix).state, "operator");
  const unknown = checkRecipient("juno1gv86dp8wmnmmatdckgr5xkevnpmy4662wz0lj4", byPrefix);
  assert.equal(unknown.state, "unknown-prefix");
  assert.match(unknown.message ?? "", /juno1/);
});

test("pickDestination: same prefix is a plain send, otherwise the chain on the same network", () => {
  const hub = { chainId: "cosmoshub-4", bech32Prefix: "cosmos", network: "mainnet" as const };
  const osmosis = { chainId: "osmosis-1", bech32Prefix: "osmo", network: "mainnet" as const };
  assert.equal(pickDestination(checkRecipient(OSMO, byPrefix), osmosis).chainId, "osmosis-1");
  const ibc = pickDestination(checkRecipient(OSMO, byPrefix), hub);
  assert.equal(ibc.chainId, "osmosis-1", "the testnet sharing the prefix is not on the Hub's network");
  assert.deepEqual(
    ibc.options.map((chain) => chain.chainId),
    ["osmosis-1"],
  );
  const testnet = pickDestination(checkRecipient(HUB, byPrefix), { chainId: "osmo-test-5", bech32Prefix: "osmo", network: "testnet" });
  assert.equal(testnet.chainId, null, "no testnet uses cosmos1 in this catalog");
  assert.equal(pickDestination(checkRecipient("osmo1", byPrefix), hub).chainId, null);
});

test("looksLikeExchange reads names only", () => {
  assert.equal(looksLikeExchange("Kraken deposit"), true);
  assert.equal(looksLikeExchange(null, "my binance"), true);
  assert.equal(looksLikeExchange("Mom", undefined), false);
});

test("transferIntentProblem checks the receiver from the memo bytes", () => {
  const direct = { receiver: OSMO, plan: { destChainId: "osmosis-1", memo: "" } };
  assert.equal(transferIntentProblem(direct, { recipient: OSMO, destChainId: "osmosis-1" }), null);
  assert.match(transferIntentProblem(direct, { recipient: HUB, destChainId: "osmosis-1" }) ?? "", /another address/);
  assert.match(transferIntentProblem(direct, { recipient: OSMO, destChainId: "juno-1" }) ?? "", /another network/);

  const memo = buildForwardMemo([{ channelId: "channel-0" }], HUB);
  const forwarded = { receiver: OSMO, plan: { destChainId: "cosmoshub-4", memo } };
  assert.equal(transferIntentProblem(forwarded, { recipient: HUB, destChainId: "cosmoshub-4" }), null);
  assert.match(transferIntentProblem(forwarded, { recipient: SAFRO, destChainId: "cosmoshub-4" }) ?? "", /forwarding memo/);
  const contract = { receiver: OSMO, plan: { destChainId: "osmosis-1", memo: '{"wasm":{"contract":"osmo1x","msg":{}}}' } };
  assert.match(transferIntentProblem(contract, { recipient: OSMO, destChainId: "osmosis-1" }) ?? "", /memo/);
});

function item(partial: Partial<ActivityItem> & Pick<ActivityItem, "kind" | "time">): ActivityItem {
  return {
    chainId: "cosmoshub-4",
    address: HUB,
    hash: "H",
    height: 1,
    success: true,
    summary: "",
    fee: null,
    feePaid: true,
    signed: true,
    amounts: [],
    messages: 1,
    primaryType: "MsgSend",
    ...partial,
  };
}

const ACTIVITY: ActivityItem[] = [
  item({ kind: "send", time: "2026-10-06T10:00:00Z", counterparty: "cosmos1friend" }),
  item({ kind: "send", time: "2026-10-05T10:00:00Z", counterparty: "cosmos1friend" }),
  item({ kind: "send", time: "2026-10-04T10:00:00Z", counterparty: "cosmos1other", success: false }),
  item({ kind: "receive", time: "2026-10-03T10:00:00Z", counterparty: "cosmos1friend", signed: false }),
  item({
    kind: "ibc-out",
    time: "2026-10-02T10:00:00Z",
    counterparty: OSMO,
    ibc: { destChainId: "osmosis-1", sourceChannel: "channel-141" },
    amounts: [{ direction: "out", denom: "uatom", amount: "1000000", identity: ATOM }],
  }),
  item({
    kind: "ibc-out",
    time: "2026-10-01T10:00:00Z",
    counterparty: OSMO,
    ibc: { destChainId: "osmosis-1", sourceChannel: "channel-141" },
    amounts: [{ direction: "out", denom: "uatom", amount: "1000000", identity: ATOM }],
  }),
  item({ kind: "claim", time: "2026-09-30T10:00:00Z" }),
];

test("transferStats counts the loaded transfers and names the coverage start", () => {
  const stats = transferStats(ACTIVITY);
  assert.equal(stats.sent, 4);
  assert.equal(stats.received, 1);
  assert.equal(stats.ibcOut, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.lastSent?.time, "2026-10-06T10:00:00Z");
  assert.equal(stats.lastReceived?.kind, "receive");
  assert.equal(stats.since, Date.parse("2026-09-30T10:00:00Z"));
});

test("frequentRecipients and historyWith count only successful sends the user signed", () => {
  const top = frequentRecipients(ACTIVITY);
  assert.deepEqual(
    top.map((row) => [row.address, row.toChainId, row.count]),
    [
      ["cosmos1friend", "cosmoshub-4", 2],
      [OSMO, "osmosis-1", 2],
    ],
  );
  assert.deepEqual(historyWith(ACTIVITY, "cosmos1friend"), { count: 2, lastAt: Date.parse("2026-10-06T10:00:00Z") });
  assert.deepEqual(historyWith(ACTIVITY, "cosmos1other"), { count: 0, lastAt: null });
});

test("suggestRoutes: used routes first, then going home, then to the swap venue", () => {
  const assets = spendableAssets([
    asset(ATOM, "2000000", 1.8),
    asset(ATOM_ON_OSMO, "3000000", 1.8),
    asset(identity({ chainId: "safrochain-1", denom: "usaf", ticker: "SAF" }), "5000000", 0.0002),
    asset(OSMO_NATIVE, "100", 0.03),
  ]);
  const routes = suggestRoutes({ assets, activity: ACTIVITY, followed: ["cosmoshub-4", "osmosis-1", "safrochain-1"] });
  assert.deepEqual(
    routes.map((route) => [route.fromChainId, route.asset.denom, route.toChainId, route.reason, route.uses]),
    [
      ["cosmoshub-4", "uatom", "osmosis-1", "used", 2],
      ["osmosis-1", "ibc/27394FB0", "cosmoshub-4", "home", 0],
    ],
    "SAF is dust at this price, OSMO is already on the venue",
  );
  assert.equal(suggestRoutes({ assets, activity: [], followed: ["cosmoshub-4"] }).length, 1, "only followed destinations");
});

test("awayFromHome sums vouchers held off their origin", () => {
  const assets = spendableAssets([asset(ATOM, "2000000", 1.8), asset(ATOM_ON_OSMO, "3000000", 2), asset(UNKNOWN, "5", null)]);
  assert.deepEqual(awayFromHome(assets), { count: 1, value: 6, unpriced: 0 });
});

test("pricedSum counts unpriced balances and never adds them as zero", () => {
  const assets = spendableAssets([asset(ATOM, "2000000", 1.8), asset(OSMO_NATIVE, "10000000", 0.03), asset(UNKNOWN, "77", null)]);
  const sum = pricedSum(assets);
  assert.equal(sum.count, 3);
  assert.equal(sum.unpriced, 1);
  assert.ok(sum.value !== null && Math.abs(sum.value - 3.9) < 1e-9);
  // Only unpriced: unknown, not $0.00. Nothing at all: a real zero.
  assert.deepEqual(pricedSum(spendableAssets([asset(UNKNOWN, "77", null)])), { value: null, count: 1, unpriced: 1 });
  assert.deepEqual(pricedSum([]), { value: 0, count: 0, unpriced: 0 });

  const byChain = pricedSumByChain(assets);
  assert.deepEqual([...byChain.keys()], ["cosmoshub-4", "osmosis-1"]);
  assert.deepEqual(byChain.get("osmosis-1"), { value: 0.3, count: 2, unpriced: 1 });
});

test("bucketWorth: a bucket worth 0 only because of unpriced or unread holdings is unknown", () => {
  const SAF = identity({ chainId: "safrochain-1", denom: "usaf", ticker: "SAF" });
  const totals = { value: 3.6, liquid: 3.6, staked: 0, rewards: 0, unbonding: 0, change24hAbs: null, change24hPct: null, change7dAbs: null, change7dPct: null, pricedValue: 3.6, unpricedAssetCount: 1, assetCount: 2, chainCount: 2 };
  const chain = (chainId: string, status: "ok" | "error" = "ok") => ({
    chainId,
    chainName: chainId,
    iconUrl: null,
    address: "",
    status,
    value: null,
    liquid: null,
    staked: null,
    rewards: null,
    unbonding: null,
    change24hAbs: null,
    assetCount: 1,
    nativeSymbol: "",
  });
  const atom = { ...asset(ATOM, "2000000", 1.8), value: 3.6 };
  const portfolio = {
    totals,
    assets: [atom, asset(SAF, "0", null, "5000000")],
    chains: [chain("cosmoshub-4"), chain("safrochain-1")],
  };
  // SAF staked without a price: the priced total is 0, the stake is not.
  assert.deepEqual(bucketWorth(portfolio, ["staked", "unbonding"]), { value: null, unpriced: 1, unread: 0 });
  // A positive total stays, saying what it leaves out.
  assert.deepEqual(bucketWorth({ ...portfolio, totals: { ...totals, staked: 9 } }, ["staked", "unbonding"]), { value: 9, unpriced: 1, unread: 0 });
  // Nothing staked anywhere, every read answered: a real zero.
  assert.deepEqual(bucketWorth({ ...portfolio, assets: [atom] }, ["staked"]), { value: 0, unpriced: 0, unread: 0 });
  // A failed rewards read (or a chain that did not answer) makes a 0 unknown.
  const failed = { ...portfolio, assets: [atom], errors: [{ chainId: "cosmoshub-4", scope: "rewards", message: "HTTP 500" }] };
  assert.deepEqual(bucketWorth(failed, ["rewards"]), { value: null, unpriced: 0, unread: 1 });
  assert.deepEqual(bucketWorth(failed, ["staked"]), { value: 0, unpriced: 0, unread: 0 }, "another read's failure says nothing about this bucket");
  const down = { ...portfolio, assets: [], chains: [chain("cosmoshub-4"), chain("safrochain-1", "error")] };
  assert.deepEqual(bucketWorth(down, ["staked", "unbonding"]), { value: null, unpriced: 0, unread: 1 });
});

test("pairOwnIbc folds the receipt of a transfer between your own accounts into its send", () => {
  const out = item({
    kind: "ibc-out",
    time: "2026-10-04T23:08:32Z",
    chainId: "safrochain-1",
    hash: "OUT",
    ibc: { sourceChannel: "channel-1", destChannel: "channel-110497", sequence: "105", destChainId: "osmosis-1" },
  });
  const receipt = item({
    kind: "ibc-in",
    time: "2026-10-04T23:09:02Z",
    chainId: "osmosis-1",
    hash: "IN",
    ibc: { sourceChannel: "channel-1", destChannel: "channel-110497", sequence: "105", sourceChainId: "safrochain-1" },
  });
  const other = item({
    kind: "ibc-in",
    time: "2026-10-03T00:00:00Z",
    chainId: "osmosis-1",
    hash: "IN2",
    ibc: { sourceChannel: "channel-0", sequence: "9", sourceChainId: "cosmoshub-4" },
  });
  const paired = pairOwnIbc([receipt, out, other]);
  assert.deepEqual(
    paired.rows.map((row) => row.hash),
    ["OUT", "IN2"],
  );
  assert.deepEqual([...paired.delivered], ["safrochain-1:OUT"]);
  assert.equal(paired.ownTransfers, 1);
  assert.deepEqual(paired.timings, [{ fromChainId: "safrochain-1", toChainId: "osmosis-1", seconds: 30 }]);
  assert.equal(pairOwnIbc([out]).delivered.size, 0, "no receipt loaded: not claimed as arrived");
});

test("routeTiming takes the median of the observed delivery times on one route", () => {
  const timings = [
    { fromChainId: "a", toChainId: "b", seconds: 40 },
    { fromChainId: "a", toChainId: "b", seconds: 20 },
    { fromChainId: "a", toChainId: "b", seconds: 31 },
    { fromChainId: "b", toChainId: "a", seconds: 300 },
  ];
  assert.deepEqual(routeTiming(timings, "a", "b"), { median: 31, fastest: 20, slowest: 40, count: 3 });
  assert.equal(routeTiming(timings, "a", "c"), null);
  assert.equal(routeTiming(timings.slice(0, 2), "a", "b")?.median, 30);
});

test("feeShare compares the fee with the amount, exactly when it is the same token", () => {
  assert.equal(feeShare({ feeBase: "3071", feeDenom: "uatom", amountBase: "1000000", denom: "uatom", feeValue: null, amountValue: null }), 0.3071);
  assert.equal(feeShare({ feeBase: "5000", feeDenom: "uosmo", amountBase: "1000000", denom: "uatom", feeValue: 0.01, amountValue: 2 }), 0.5);
  assert.equal(feeShare({ feeBase: "5000", feeDenom: "uosmo", amountBase: "1000000", denom: "uatom", feeValue: null, amountValue: 2 }), null);
  assert.equal(feeShare({ feeBase: null, feeDenom: null, amountBase: null, denom: "uatom", feeValue: null, amountValue: null }), null);
});

test("channelFromHistory finds the channel your own transfers used, in either direction", () => {
  const fromSafro = item({
    kind: "ibc-out",
    time: "2026-10-04T23:08:32Z",
    chainId: "safrochain-1",
    ibc: { sourceChannel: "channel-1", destChannel: "channel-110497", sequence: "105", destChainId: "osmosis-1" },
  });
  const arrived = item({
    kind: "ibc-in",
    time: "2026-10-04T23:09:02Z",
    chainId: "osmosis-1",
    ibc: { sourceChannel: "channel-1", destChannel: "channel-110497", sequence: "105", sourceChainId: "safrochain-1" },
  });
  // Osmosis → Safrochain leaves on Osmosis's end of the channel.
  assert.deepEqual(channelFromHistory([fromSafro, arrived], "osmosis-1", "safrochain-1"), {
    channelId: "channel-110497",
    uses: 2,
    lastAt: Date.parse("2026-10-04T23:09:02Z"),
  });
  // Safrochain → Osmosis leaves on Safrochain's end.
  assert.equal(channelFromHistory([fromSafro], "safrochain-1", "osmosis-1")?.channelId, "channel-1");
  assert.equal(channelFromHistory([fromSafro], "osmosis-1", "cosmoshub-4"), null);
});

test("ibcCounts counts a move between your own accounts once", () => {
  assert.deepEqual(ibcCounts({ ibcOut: 8, ibcIn: 8 }, 8), { total: 8, out: 0, in: 0, own: 8 });
  assert.deepEqual(ibcCounts({ ibcOut: 5, ibcIn: 3 }, 2), { total: 6, out: 3, in: 1, own: 2 });
  assert.deepEqual(ibcCounts({ ibcOut: 1, ibcIn: 0 }, 4), { total: 1, out: 1, in: 0, own: 0 }, "never more pairs than either side");
});

test("splitIncoming separates deposits from your own moves and from refunds", () => {
  const deposit = item({ kind: "receive", time: "2026-10-06T10:00:00Z", counterparty: "cosmos1friend", signed: false });
  const move = item({ kind: "ibc-in", time: "2026-10-05T10:00:00Z", chainId: "osmosis-1", counterparty: SAFRO, ibc: { sourceChainId: "safrochain-1" } });
  const refund = item({ kind: "receive", time: "2026-10-04T10:00:00Z", counterparty: "osmo1someone", primaryType: "MsgTimeout" });
  const failed = item({ kind: "ibc-in", time: "2026-10-03T10:00:00Z", counterparty: "cosmos1friend", success: false });
  const sent = item({ kind: "send", time: "2026-10-02T10:00:00Z", counterparty: "cosmos1friend" });
  const split = splitIncoming([deposit, move, refund, failed, sent], new Set([HUB, OSMO, SAFRO]));
  assert.deepEqual(split.fromOthers, [deposit]);
  assert.deepEqual(split.fromOwn, [move]);
  assert.deepEqual(split.refunds, [refund]);
  assert.equal(isRefund(refund), true);
  assert.equal(isRefund(deposit), false);
  assert.equal(newest([move, deposit, refund]), deposit);
  assert.equal(newest([]), null);
});

test("topSenders ranks who deposits most, named by the chain of their address", () => {
  const rows = [
    item({ kind: "receive", time: "2026-10-01T10:00:00Z", counterparty: "cosmos1friend" }),
    item({ kind: "ibc-in", time: "2026-10-03T10:00:00Z", chainId: "osmosis-1", counterparty: "juno1pal", ibc: { sourceChainId: "juno-1" } }),
    item({ kind: "ibc-in", time: "2026-10-02T10:00:00Z", chainId: "osmosis-1", counterparty: "juno1pal", ibc: { sourceChainId: "juno-1" } }),
  ];
  assert.deepEqual(topSenders(rows), [
    { address: "juno1pal", chainId: "juno-1", count: 2, lastAt: Date.parse("2026-10-03T10:00:00Z") },
    { address: "cosmos1friend", chainId: "cosmoshub-4", count: 1, lastAt: Date.parse("2026-10-01T10:00:00Z") },
  ]);
  assert.equal(topSenders(rows, 1).length, 1);
});

test("touchesChain matches the chain a row is on and the far end of an IBC transfer", () => {
  const out = item({ kind: "ibc-out", time: "2026-10-01T10:00:00Z", chainId: "safrochain-1", ibc: { destChainId: "osmosis-1" } });
  assert.equal(touchesChain(out, "safrochain-1"), true);
  assert.equal(touchesChain(out, "osmosis-1"), true);
  assert.equal(touchesChain(out, "cosmoshub-4"), false);
});

test("timingsByRoute summarises each measured route, most measured first", () => {
  const rows = timingsByRoute([
    { fromChainId: "a", toChainId: "b", seconds: 40 },
    { fromChainId: "b", toChainId: "a", seconds: 300 },
    { fromChainId: "a", toChainId: "b", seconds: 20 },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.fromChainId, row.toChainId, row.count, row.median, row.fastest, row.slowest]),
    [
      ["a", "b", 2, 30, 20, 40],
      ["b", "a", 1, 300, 300, 300],
    ],
  );
  assert.deepEqual(timingsByRoute([]), []);
});

test("addressParts cuts an address into checkable pieces and loses nothing", () => {
  const parts = addressParts(SAFRO);
  assert.equal(parts.head, "addr_safro1");
  assert.equal(parts.tail, "qudn7e");
  assert.ok(parts.groups.every((group) => group.length <= 4 && group.length > 0));
  assert.equal(parts.head + parts.groups.join("") + parts.tail, SAFRO);
  const short = addressParts("ab1xyz");
  assert.deepEqual(short, { head: "ab1", groups: [], tail: "xyz" });
  assert.deepEqual(addressParts("nodelimiter").head, "", "no separator: everything is data");
});

test("historySince prefers the loaded boundary over the oldest row", () => {
  assert.equal(historySince("2026-09-22T00:00:00Z", Date.parse("2026-09-16T00:00:00Z")), Date.parse("2026-09-22T00:00:00Z"));
  assert.equal(historySince(null, 42), 42, "everything loaded: the oldest row");
  assert.equal(historySince("not a date", 42), 42);
  assert.equal(historySince(undefined, null), null);
});

test("withinLoaded keeps the rows the caption covers", () => {
  const rows = [item({ kind: "send", time: "2026-10-01T00:00:00Z" }), item({ kind: "send", time: "2026-09-10T00:00:00Z" })];
  assert.equal(withinLoaded(rows, "2026-09-22T00:00:00Z").length, 1);
  assert.equal(withinLoaded(rows, null).length, 2);
});

test("strangerChannels: a hand-entered channel this form did not set blocks; one the user set does not", () => {
  const link = (source: "verified" | "seed" | "manual", channelId = "channel-110497") => ({
    sourceChainId: "osmosis-1",
    destChainId: "safrochain-1",
    channelId,
    source,
  });
  const own = { "osmosis-1>safrochain-1": { fromChainId: "osmosis-1", toChainId: "safrochain-1", channelId: "channel-110497" } };
  assert.equal(strangerChannels([link("manual")], {}).length, 1, "served from the shared registry, typed by nobody here");
  assert.equal(strangerChannels([link("manual")], own).length, 0, "the user typed this very channel");
  assert.equal(strangerChannels([link("manual", "channel-9")], own).length, 1, "another channel on the same leg is still someone else's");
  assert.equal(strangerChannels([link("verified"), link("seed")], {}).length, 0, "discovered or registry links are not hand-entered");
  const reversed = { "safrochain-1>osmosis-1": { fromChainId: "safrochain-1", toChainId: "osmosis-1", channelId: "channel-110497" } };
  assert.equal(strangerChannels([link("manual")], reversed).length, 1, "a channel set for the other direction does not cover this leg");
});

test("channelLegs offers the stranger legs (with their own heading), after discovery failures, else the direct pair", () => {
  const stranger = { sourceChainId: "cosmoshub-4", destChainId: "osmosis-1", channelId: "channel-141", source: "manual" as const };
  const legs = channelLegs("cosmoshub-4", "osmosis-1", [], [stranger]);
  assert.equal(legs.length, 1);
  assert.equal(legs[0]?.key, "cosmoshub-4>osmosis-1");
  assert.match(legs[0]?.note ?? "", /channel-141/);
  assert.equal(legs[0]?.noteTitle, "Set this channel yourself");
  const failed = channelLegs("cosmoshub-4", "osmosis-1", [{ fromChainId: "cosmoshub-4", toChainId: "osmosis-1", message: "LCD timed out" }], [stranger]);
  assert.equal(failed.length, 1, "one field per leg");
  assert.equal(failed[0]?.note, "LCD timed out", "a discovery failure keeps its own words");
  assert.deepEqual(
    channelLegs("a", "b", []).map((leg) => leg.key),
    ["a>b"],
  );
});

test("missingTokenReason says why a picked token is not on the form", () => {
  const context = { scoped: ["celestia"], followed: ["cosmoshub-4", "celestia"], chainStatus: null };
  assert.equal(missingTokenReason("cosmoshub-4", context), "scope");
  assert.equal(missingTokenReason("juno-1", context), "unfollowed");
  assert.equal(missingTokenReason("celestia", { ...context, chainStatus: "error" }), "unread");
  assert.equal(missingTokenReason("celestia", { ...context, chainStatus: "ok" }), "empty");
  assert.equal(missingTokenReason("celestia", context), "empty", "a chain absent from the read is not a failed read");
});

test("splitBalanceKey undoes balanceKey, ibc/ denoms included", () => {
  assert.deepEqual(splitBalanceKey("osmosis-1|ibc/27394FB0"), { chainId: "osmosis-1", denom: "ibc/27394FB0" });
  assert.deepEqual(splitBalanceKey("cosmoshub-4|uatom"), { chainId: "cosmoshub-4", denom: "uatom" });
  assert.deepEqual(splitBalanceKey("weird"), { chainId: "weird", denom: "" });
});

test("fallbackDestination: a voucher's home, else where you hold most, never the source", () => {
  const followed = ["safrochain-1", "cosmoshub-4", "osmosis-1", "celestia"];
  const values: Record<string, number | null> = { "safrochain-1": null, "cosmoshub-4": 0.4, celestia: 0.9 };
  const value = (chainId: string) => values[chainId] ?? null;
  const atomOnOsmo = spendableAssets([asset(ATOM_ON_OSMO, "9498", 1.8)])[0] ?? null;
  const osmo = spendableAssets([asset(OSMO_NATIVE, "100", 0.03)])[0] ?? null;
  const unknown = spendableAssets([asset(UNKNOWN, "77", null)])[0] ?? null;
  assert.equal(fallbackDestination("osmosis-1", atomOnOsmo, followed, value), "cosmoshub-4", "the voucher's own chain");
  assert.equal(fallbackDestination("osmosis-1", osmo, followed, value), "celestia", "a native token: the chain holding the most");
  assert.equal(fallbackDestination("osmosis-1", unknown, followed, value), "celestia", "an unknown origin is not followed");
  assert.equal(fallbackDestination("osmosis-1", null, followed, () => null), "safrochain-1", "nothing priced: the first other followed chain");
  assert.equal(fallbackDestination("osmosis-1", atomOnOsmo, ["osmosis-1", "celestia"], value), "celestia", "an unfollowed home is not a default");
  assert.equal(fallbackDestination("osmosis-1", null, ["osmosis-1"], value), null);
});

test("plannableOverrides keeps channel ids, not the half of one still being typed", () => {
  const leg = (channelId: string) => ({ fromChainId: "osmosis-1", toChainId: "safrochain-1", channelId });
  assert.deepEqual(plannableOverrides({ a: leg("c"), b: leg("channel-"), c: leg("channel-1") }), [leg("channel-1")]);
  assert.deepEqual(plannableOverrides({}), []);
});
