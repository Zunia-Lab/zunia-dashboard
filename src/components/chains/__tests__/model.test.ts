/**
 * Following and ordering rules. The cap is load-bearing (the portfolio route
 * and phone pairing stop at 32 chains), and the order is what a visitor to
 * the public Chains page sees first, so both are pinned here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChainEntry } from "@/lib/chains";
import type { ChainStats } from "@/lib/chain/types";
import {
  MAX_FOLLOWED,
  blockSpeedup,
  dilution,
  firstReason,
  formatDays,
  formatSeconds,
  haltedCount,
  leaderOf,
  matchesChain,
  moveFollowed,
  nativeAssetKey,
  orderChains,
  stakeInHaltingSet,
  statsUnreadable,
  toPct,
  toggleFollow,
  type MarketHint,
} from "../model";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `chain-${i}`);

test("toggleFollow adds at the end and removes in place", () => {
  const added = toggleFollow(["a", "b"], "c");
  assert.deepEqual(added, { ok: true, following: true, next: ["a", "b", "c"] });
  const removed = toggleFollow(["a", "b", "c"], "b");
  assert.deepEqual(removed, { ok: true, following: false, next: ["a", "c"] });
});

test("toggleFollow refuses a 33rd network and the last one", () => {
  const full = ids(MAX_FOLLOWED);
  const capped = toggleFollow(full, "one-more");
  assert.equal(capped.ok, false);
  assert.equal(capped.ok === false && capped.reason, "cap");
  // Removing is still allowed at the cap.
  assert.equal(toggleFollow(full, "chain-3").ok, true);

  const last = toggleFollow(["only"], "only");
  assert.equal(last.ok === false && last.reason, "last");
});

test("toggleFollow drops ids the catalog no longer knows, freeing their slot", () => {
  const stale = [...ids(MAX_FOLLOWED - 1), "gone-1"];
  const known = (id: string) => id !== "gone-1";
  const result = toggleFollow(stale, "new", known);
  assert.equal(result.ok, true);
  assert.ok(result.ok && !result.next.includes("gone-1") && result.next.includes("new"));
  assert.equal(result.ok && result.next.length, MAX_FOLLOWED);
});

test("moveFollowed swaps neighbours and ignores moves past the ends", () => {
  const list = ["a", "b", "c"];
  assert.deepEqual(moveFollowed(list, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveFollowed(list, "b", 1), ["a", "c", "b"]);
  assert.equal(moveFollowed(list, "a", -1), list);
  assert.equal(moveFollowed(list, "c", 1), list);
  assert.equal(moveFollowed(list, "zz", 1), list);
});

function entry(chainId: string, extra: Partial<ChainEntry> = {}): ChainEntry {
  return {
    chainId,
    chainName: chainId.replace(/-\d+$/, ""),
    bech32Prefix: "x",
    coinType: 118,
    network: "mainnet",
    coinDenom: chainId.slice(0, 3).toUpperCase(),
    coinMinimalDenom: `u${chainId.slice(0, 3)}`,
    coinDecimals: 6,
    feeDenom: "X",
    feeMinimalDenom: "ux",
    feeDecimals: 6,
    ...extra,
  };
}

test("orderChains: followed first in the user's order, then market cap, volume, pinned, registry, name", () => {
  const chains = [
    entry("zeta-1", { inCosmosRegistry: true }),
    entry("alpha-1"),
    entry("osmosis-1"),
    entry("bigcap-1"),
    entry("volume-1"),
    entry("followed-b"),
    entry("followed-a"),
    entry("beta-1", { inCosmosRegistry: true }),
  ];
  const market = new Map<string, MarketHint>([
    ["bigcap-1", { marketCap: 9e8, volume24h: 1 }],
    ["volume-1", { marketCap: null, volume24h: 5e5 }],
    ["osmosis-1", { marketCap: 2.8e7, volume24h: 1e5 }],
  ]);
  const order = orderChains(chains, ["followed-a", "followed-b"], market).map((c) => c.chainId);
  assert.deepEqual(order, ["followed-a", "followed-b", "bigcap-1", "osmosis-1", "volume-1", "beta-1", "zeta-1", "alpha-1"]);
});

test("matchesChain looks at name, id, ticker and registry slug", () => {
  const chain = entry("cosmoshub-4", { chainName: "Cosmos Hub", coinDenom: "ATOM", registrySlug: "cosmoshub" });
  assert.ok(matchesChain(chain, "  atom "));
  assert.ok(matchesChain(chain, "hub-4"));
  assert.ok(matchesChain(chain, "Cosmos"));
  assert.ok(matchesChain(chain, ""));
  assert.ok(!matchesChain(chain, "juno"));
});

test("nativeAssetKey is chainId:denom", () => {
  assert.equal(nativeAssetKey(entry("cosmoshub-4", { coinMinimalDenom: "uatom" })), "cosmoshub-4:uatom");
});

test("units: percent, days, seconds, dilution", () => {
  assert.equal(toPct(0.1834), 18.34);
  assert.equal(toPct(null), null);
  assert.equal(toPct(Number.NaN), null);
  assert.equal(formatDays(21), "21 days");
  // Celestia: 14 days and an hour, never "14.0 days" (which reads as 14).
  assert.equal(formatDays(14.041666), "14 days 1 h");
  assert.equal(formatDays(1), "1 day");
  assert.equal(formatDays(0.5), "12 h");
  assert.equal(formatDays(20.999), "21 days");
  assert.equal(formatDays(null), null);
  assert.equal(formatSeconds(2.7749), "2.77 s");
  assert.equal(formatSeconds(12.34), "12.3 s");
  assert.equal(formatSeconds(0), null);
  // 13 % issuance takes 11.5 % of an idle holder's share.
  assert.equal(Math.round((dilution(0.13) ?? 0) * 1000) / 1000, 0.115);
  assert.equal(dilution(null), null);
});

function stats(chainId: string, extra: Partial<ChainStats> = {}): ChainStats {
  return {
    chainId,
    chainName: chainId,
    network: "mainnet",
    iconUrl: null,
    nativeSymbol: "X",
    nativeDenom: "ux",
    nativeDecimals: 6,
    price: null,
    apr: { naive: null, actual: null, source: null, blockTimeFactor: null, excludesFees: true },
    inflation: { param: null, actual: null },
    realYield: null,
    bondedRatio: null,
    goalBonded: null,
    bondedTokens: null,
    notBondedTokens: null,
    totalSupply: null,
    communityTax: null,
    unbondingDays: null,
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
    ...extra,
  };
}

test("leaderOf picks the best known value and needs a real comparison", () => {
  const list = [stats("a", { realYield: 0.05 }), stats("b", { realYield: 0.068 }), stats("c"), stats("d", { realYield: -0.03 })];
  const best = leaderOf(list, (s) => s.realYield, "max");
  assert.equal(best?.stats.chainId, "b");
  assert.equal(best?.among, 3);
  const worst = leaderOf(list, (s) => s.realYield, "min");
  assert.equal(worst?.stats.chainId, "d");
  assert.equal(leaderOf([stats("a", { realYield: 0.05 })], (s) => s.realYield, "max"), null);
  // Ties go to the first in table order.
  const tie = leaderOf([stats("x", { unbondingDays: 14 }), stats("y", { unbondingDays: 14 })], (s) => s.unbondingDays, "min");
  assert.equal(tie?.stats.chainId, "x");
});

test("haltedCount separates unknown from producing blocks", () => {
  const counts = haltedCount([stats("a", { halted: false }), stats("b", { halted: true }), stats("c")]);
  assert.deepEqual(counts, { halted: 1, known: 2 });
});

test("blockSpeedup: Safrochain's 2.77 s blocks against a 5 s assumption", () => {
  const speedup = blockSpeedup({ blockTimeSec: 2.7749332, paramsBlockTimeSec: 5 });
  assert.equal(Math.round((speedup ?? 0) * 100) / 100, 1.8);
  assert.equal(blockSpeedup({ blockTimeSec: 1.38, paramsBlockTimeSec: null }), null);
});

test("statsUnreadable matches the server rule; firstReason picks the most telling reason", () => {
  const dead = stats("chihuahua-1", {
    reasons: { latestHeight: "lcd-chihuahua.keplr.app is unreachable", apr: "Mint unreadable right now" },
  });
  assert.equal(statsUnreadable(dead), true);
  assert.equal(firstReason(dead), "lcd-chihuahua.keplr.app is unreachable");
  const alive = stats("osmosis-1", { latestHeight: 72045384 });
  assert.equal(statsUnreadable(alive), false);
  assert.equal(firstReason(alive), null);
  assert.equal(firstReason(stats("x", { errors: [{ scope: "mint", message: "timed out" }] })), "timed out");
});

test("stakeInHaltingSet weighs stake by amount and leaves unknown membership out", () => {
  const d = (amount: string, inNakamotoSet: boolean | null) => ({ amount, validator: { inNakamotoSet } });
  assert.deepEqual(stakeInHaltingSet([]), { validators: 0, unknown: 0, share: null });
  assert.deepEqual(stakeInHaltingSet([d("3000000", true), d("1000000", false)]), { validators: 2, unknown: 0, share: 75 });
  // Zero and malformed delegations are not validators the account stakes with.
  assert.deepEqual(stakeInHaltingSet([d("0", true), d("abc", true), d("500", false)]), { validators: 1, unknown: 0, share: 0 });
  // 18-decimal amounts stay exact.
  assert.deepEqual(stakeInHaltingSet([d("1000000000000000000000000", true), d("1000000000000000000000000", null)]), { validators: 2, unknown: 1, share: 100 });
});
