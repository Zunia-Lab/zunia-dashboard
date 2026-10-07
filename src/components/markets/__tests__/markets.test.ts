/**
 * Markets arithmetic: sums say what they add, movers need a market behind
 * them, the breadth histogram puts every change in one bucket.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MarketAsset } from "@/lib/token/wire";

import {
  changeBuckets,
  familyOf,
  hasMarketDepth,
  liquidityLeaders,
  liquidityRanks,
  marketCapReason,
  marketSummary,
  matchesMarketQuery,
  tabRows,
} from "../markets";
import { readWatchlist, toggleWatch, WATCHLIST_MAX } from "../watchlist";

function asset(overrides: Partial<MarketAsset> & Pick<MarketAsset, "key" | "symbol">): MarketAsset {
  return {
    name: overrides.symbol,
    price: 1,
    change24h: 0,
    change7d: 0,
    volume24h: 50_000,
    liquidity: 100_000,
    marketCap: null,
    sparkline7d: null,
    tradable: true,
    verified: true,
    source: "numia",
    ...overrides,
  };
}

const ATOM = asset({ key: "cosmoshub-4:uatom", symbol: "ATOM", change24h: -1, marketCap: 900, liquidity: 2_000_000, chainId: "cosmoshub-4" });
const OSMO = asset({ key: "osmosis-1:uosmo", symbol: "OSMO", change24h: 4, marketCap: 100, liquidity: 1_000_000, chainId: "osmosis-1" });
const USDC = asset({ key: "noble-1:uusdc", symbol: "USDC.n", change24h: 0, coinGeckoId: "usd-coin", liquidity: 900_000 });
const THIN = asset({ key: "osmosis-1:factory/x/MEME", symbol: "MEME", change24h: 48, liquidity: 900, volume24h: 10 });
const SAF = asset({ key: "safrochain-1:usaf", symbol: "SAF", change24h: -30, liquidity: null, volume24h: 17_000, source: "coinstore", tradable: false });
const NONE = asset({ key: "osmosis-1:factory/y/X", symbol: "X", change24h: null, liquidity: 20_000 });

const all = [ATOM, OSMO, USDC, THIN, NONE, SAF];

describe("market depth", () => {
  it("uses liquidity, else volume off Osmosis", () => {
    assert.equal(hasMarketDepth(ATOM), true);
    assert.equal(hasMarketDepth(THIN), false);
    assert.equal(hasMarketDepth(SAF), true);
    assert.equal(hasMarketDepth({ liquidity: null, volume24h: null }), false);
  });
});

describe("summary", () => {
  const summary = marketSummary(all);

  it("sums caps of assets that have one, and weights the 24 h change by cap", () => {
    assert.equal(summary.capSum, 1000);
    assert.equal(summary.capCount, 2);
    const then = 900 / 0.99 + 100 / 1.04;
    assert.ok(summary.cap24hPct !== null && Math.abs(summary.cap24hPct - (1000 / then - 1) * 100) < 1e-9);
  });

  it("sums liquidity and volume, and counts breadth", () => {
    assert.equal(summary.liquiditySum, 2_000_000 + 1_000_000 + 900_000 + 900 + 20_000);
    assert.equal(summary.liquidityCount, 5);
    assert.equal(summary.volumeSum, 50_000 * 4 + 10 + 17_000);
    assert.deepEqual([summary.up, summary.down, summary.flat, summary.unknown], [2, 2, 1, 1]);
  });

  it("ranks best and worst among assets with a market", () => {
    assert.equal(summary.best?.symbol, "OSMO"); // MEME +48% has $900 behind it
    assert.equal(summary.worst?.symbol, "SAF");
  });

  it("has no best when nothing rose", () => {
    assert.equal(marketSummary([ATOM]).best, null);
    assert.equal(marketSummary([ATOM]).worst?.symbol, "ATOM");
    assert.equal(marketSummary([]).cap24hPct, null);
  });
});

describe("breadth histogram", () => {
  it("puts each change in one bucket, edges away from zero", () => {
    const buckets = changeBuckets([-12, -10, -5, -4.9, -0.1, 0, 0.1, 2, 5, 9.99, 10, 40, null].map((change24h) => ({ change24h })));
    assert.deepEqual(
      buckets.map((b) => b.count),
      [2, 1, 1, 1, 1, 1, 1, 2, 2],
    );
    assert.equal(buckets.reduce((s, b) => s + b.count, 0), 12);
    assert.deepEqual(
      buckets.map((b) => b.side),
      ["down", "down", "down", "down", "flat", "up", "up", "up", "up"],
    );
  });
});

describe("tabs and search", () => {
  it("filters the watchlist and ranks gainers and losers with depth", () => {
    assert.deepEqual(tabRows(all, "watchlist", new Set([SAF.key, "nope:x"])).map((a) => a.symbol), ["SAF"]);
    assert.deepEqual(tabRows(all, "gainers", new Set()).map((a) => a.symbol), ["OSMO"]);
    assert.deepEqual(tabRows(all, "losers", new Set()).map((a) => a.symbol), ["SAF", "ATOM"]);
    assert.equal(tabRows(all, "all", new Set()).length, all.length);
  });

  it("searches symbol, name, key and chain", () => {
    assert.equal(matchesMarketQuery(ATOM, "hub"), true);
    assert.equal(matchesMarketQuery(USDC, "usdc"), true);
    assert.equal(matchesMarketQuery(USDC, "atom"), false);
    assert.equal(matchesMarketQuery(USDC, ""), true);
  });

  it("ranks by liquidity and leaves off-Osmosis assets unranked", () => {
    const ranks = liquidityRanks(all);
    assert.equal(ranks.get(ATOM.key), 1);
    assert.equal(ranks.get(SAF.key), null);
    assert.equal(ranks.get(NONE.key), 5);
  });

  it("explains a missing market cap", () => {
    assert.match(marketCapReason(USDC), /USDC\.n is one form of USDC/);
    assert.match(marketCapReason({ symbol: "allBTC", verified: true }), /one form of BTC/);
    assert.match(marketCapReason({ symbol: "ETH.axl", verified: true, family: "ETH" }), /one form of ETH/);
    assert.match(marketCapReason({ symbol: "milkTIA", verified: true }), /No source/);
    assert.match(marketCapReason({ symbol: "ATOM", verified: true, family: "ATOM" }), /No source/);
    assert.match(marketCapReason({ symbol: "FOST", verified: false }), /Unverified/);
  });

  it("blames an outage, not the asset, when the market read failed", () => {
    // ATOM has a cap; a failed read must not say no source reports one.
    assert.equal(marketCapReason({ symbol: "ATOM", verified: true, family: "ATOM", sourceFailed: true }), "Unavailable right now");
    // Identity policy stays true whatever the sources did.
    assert.match(marketCapReason({ symbol: "USDC.n", verified: true, family: "USDC", sourceFailed: true }), /one form of USDC/);
    assert.match(marketCapReason({ symbol: "FOST", verified: false, sourceFailed: true }), /Unverified/);
  });

  it("names the asset a ticker is one form of", () => {
    assert.equal(familyOf("USDC.n"), "USDC");
    assert.equal(familyOf("WBTC.osmo"), "WBTC");
    assert.equal(familyOf("allUSDT"), "USDT");
    assert.equal(familyOf("ATOM"), null);
    assert.equal(familyOf("allora"), null);
  });

  it("lists the deepest markets with their share", () => {
    const leaders = liquidityLeaders(all, 2);
    assert.deepEqual(leaders.map((l) => l.asset.symbol), ["ATOM", "OSMO"]);
    const total = 2_000_000 + 1_000_000 + 900_000 + 900 + 20_000;
    assert.ok(Math.abs(leaders[0].share - (2_000_000 / total) * 100) < 1e-9);
  });
});

describe("watchlist storage", () => {
  it("reads only asset keys, deduplicated", () => {
    assert.deepEqual(readWatchlist(["a:b", "a:b", 3, "no key", "c:ibc/27"]), ["a:b", "c:ibc/27"]);
    assert.deepEqual(readWatchlist("x"), []);
    assert.equal(readWatchlist(Array.from({ length: 500 }, (_, i) => `c:d${i}`)).length, WATCHLIST_MAX);
  });

  it("toggles a key in and out", () => {
    assert.deepEqual(toggleWatch([], "a:b"), ["a:b"]);
    assert.deepEqual(toggleWatch(["a:b"], "a:b"), []);
    assert.deepEqual(toggleWatch(["a:b"], "bad key"), ["a:b"]);
  });
});
