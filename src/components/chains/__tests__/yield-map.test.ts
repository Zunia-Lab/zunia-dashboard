/**
 * The yield map's numbers: which chains are plotted, where the axis clips an
 * outlier (and only an outlier), and what the map is allowed to say in words.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChainStats } from "@/lib/chain/types";
import { median, quantile, rankCorrelation, readMap, yieldAxisTop, yieldMapPoints } from "../yield-map";

function stats(chainId: string, extra: Partial<ChainStats> = {}): ChainStats {
  return {
    chainId,
    chainName: chainId.toUpperCase(),
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

test("yieldMapPoints keeps chains with both figures, in percent units", () => {
  const points = yieldMapPoints(
    [
      stats("a", { realYield: 0.0548, bondedRatio: 0.634, apr: { naive: 0.18, actual: 0.1853, source: "lcd", blockTimeFactor: 1.02, excludesFees: true }, inflation: { param: 0.13, actual: 0.1306 } }),
      stats("b", { realYield: null, bondedRatio: 0.5 }),
      stats("c", { realYield: 0.02, bondedRatio: null }),
      stats("d", { realYield: -0.0363, bondedRatio: 0.226 }),
      stats("e", { realYield: 0.01, bondedRatio: 0 }),
    ],
    (id) => id === "d",
  );
  assert.deepEqual(
    points.map((p) => p.chainId),
    ["a", "d"],
  );
  const [a, d] = points;
  assert.ok(Math.abs((a?.staked ?? 0) - 63.4) < 1e-9);
  assert.ok(Math.abs((a?.realYield ?? 0) - 5.48) < 1e-9);
  assert.ok(Math.abs((a?.apr ?? 0) - 18.53) < 1e-9);
  assert.equal(a?.followed, false);
  assert.equal(d?.followed, true);
  assert.equal(d?.apr, null);
});

test("median and quantile", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([0, 10], 0.9), 9);
  assert.equal(quantile([5], 0.9), 5);
});

test("yieldAxisTop clips a lone outlier and nothing else", () => {
  // The Chains table on 2026-10-07: FirmaChain's +80.9 % stands alone.
  const table = [5.48, 6.88, -3.63, 3.23, -0.03, 3.45, 3.82, 4.79, 13.92, 11.46, 28.74, 16.94, 49.76, 10.54, 35.46, 14.34, 80.93, 7.37, 55.36];
  const top = yieldAxisTop(table);
  assert.ok(top > 55.36, `the pack stays on the scale (top ${top})`);
  assert.ok(top < 80.93, `the outlier goes off it (top ${top})`);
  // A tight pack clips nothing: the top is its highest value.
  assert.equal(yieldAxisTop([2, 3, 4, 5, 6, 7]), 10);
  assert.equal(yieldAxisTop([12, 14, 15, 16, 18, 19]), 19);
  // Too few points to call anything an outlier.
  assert.equal(yieldAxisTop([1, 2, 90]), 90);
  assert.equal(yieldAxisTop([]), 10);
});

test("rankCorrelation is Spearman's rho, null on too little data", () => {
  assert.equal(rankCorrelation([1, 2, 3], [3, 2, 1]), null);
  assert.equal(rankCorrelation([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1);
  assert.equal(rankCorrelation([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]), -1);
  // Monotone but not linear: still a perfect rank correlation.
  assert.equal(rankCorrelation([1, 2, 3, 4, 5], [1, 4, 9, 16, 1000]), 1);
  // Ties share their rank; a constant series correlates with nothing.
  assert.equal(rankCorrelation([1, 1, 1, 1, 1], [1, 2, 3, 4, 5]), null);
});

test("readMap names diluting chains (worst first) and only claims a clear link", () => {
  const points = yieldMapPoints(
    [
      stats("a", { realYield: 0.8, bondedRatio: 0.16 }),
      stats("b", { realYield: 0.3, bondedRatio: 0.3 }),
      stats("c", { realYield: 0.05, bondedRatio: 0.6 }),
      stats("d", { realYield: -0.001, bondedRatio: 0.65 }),
      stats("e", { realYield: -0.036, bondedRatio: 0.7 }),
    ],
    () => false,
  );
  const reading = readMap(points);
  assert.equal(reading.count, 5);
  assert.ok(Math.abs((reading.median ?? 0) - 5) < 1e-9);
  assert.deepEqual(
    reading.diluting.map((p) => p.chainId),
    ["e", "d"],
  );
  assert.equal(reading.link, "inverse");

  const noise = yieldMapPoints(
    [
      stats("a", { realYield: 0.05, bondedRatio: 0.1 }),
      stats("b", { realYield: 0.01, bondedRatio: 0.2 }),
      stats("c", { realYield: 0.09, bondedRatio: 0.3 }),
      stats("d", { realYield: 0.02, bondedRatio: 0.4 }),
      stats("e", { realYield: 0.06, bondedRatio: 0.5 }),
    ],
    () => false,
  );
  assert.equal(readMap(noise).link, "none");
  assert.equal(readMap(noise.slice(0, 3)).link, null);
});
