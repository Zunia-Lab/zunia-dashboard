/**
 * Staking economics. The figures under test are the ones a user acts on
 * ("stake here at 18 %"), so each adapter is pinned to a live reading taken
 * on 2026-10-07 and cross-checked with cosmos.directory:
 *
 * - Safrochain: naive 10.27 %, actual ≈ 18.5 % (cosmos.directory 18.53 %);
 * - Cosmos Hub: naive 15.42 %, actual ≈ 19.6 % (cosmos.directory 19.56 %);
 * - Osmosis (epoch mint): 1.99 % (cosmos.directory 1.99 %);
 * - Celestia (time-based mint, no blocks_per_year): 5.51 %.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLOCK_TIME_WINDOW,
  SECONDS_PER_YEAR,
  computeEconomics,
  isHalted,
  observedBlockTime,
  realYield,
  validatorApr,
  type EconomicsInputs,
} from "../apr";

const NOW = Date.parse("2026-10-06T23:30:00Z");

function close(actual: number | null, expected: number, epsilon = 1e-4) {
  assert.ok(actual !== null, `expected ≈${expected}, got null`);
  assert.ok(Math.abs(actual - expected) < epsilon, `expected ≈${expected}, got ${actual}`);
}

/** Two blocks `blocks` apart, `seconds` apart, ending now. */
function sample(blocks: number, seconds: number) {
  const latestAt = NOW - 2_000;
  return {
    latest: { height: 3_249_254, time: new Date(latestAt).toISOString() },
    earlier: { height: 3_249_254 - blocks, time: new Date(latestAt - seconds * 1000).toISOString() },
  };
}

function safrochain(overrides: Partial<EconomicsInputs> = {}): EconomicsInputs {
  const s = sample(BLOCK_TIME_WINDOW, 27_793.065);
  return {
    now: NOW,
    bonded: "658043304304364",
    totalSupply: "1037800901289961",
    communityTax: 0.1,
    mint: {
      kind: "standard",
      annualProvisions: 75_117_306_271_476.9,
      inflation: 0.072381232181447873,
      blocksPerYear: 6_311_520,
      paramsUnreadable: false,
    },
    latest: s.latest,
    latestReadAt: NOW,
    sample: s,
    ...overrides,
  };
}

test("observed block time is seconds over blocks", () => {
  close(observedBlockTime(sample(10_000, 27_793.065)), 2.7793065, 1e-9);
  assert.equal(observedBlockTime(null), null);
  // Same height or time going backwards: unusable, never a negative APR factor.
  assert.equal(observedBlockTime(sample(0, 10)), null);
  assert.equal(observedBlockTime(sample(100, -10)), null);
});

test("Safrochain: actual APR corrects the 5 s assumption with observed 2.78 s blocks", () => {
  const result = computeEconomics(safrochain());
  close(result.apr.naive, 0.10274, 1e-4);
  close(result.apr.blockTimeFactor, SECONDS_PER_YEAR / 2.7793065 / 6_311_520, 1e-9);
  close(result.apr.actual, 0.18482, 2e-4);
  assert.equal(result.apr.source, "lcd");
  assert.equal(result.apr.excludesFees, true);
  close(result.inflation.param, 0.07238, 1e-5);
  // Issuance happens per block, so actual inflation scales by the same factor.
  close(result.inflation.actual, 0.13021, 2e-4);
  close(result.realYield, (result.apr.actual ?? 0) - (result.inflation.actual ?? 0), 1e-12);
  close(result.bondedRatio, 0.634068, 1e-5);
  close(result.blockTimeSec, 2.7793065, 1e-9);
  close(result.paramsBlockTimeSec, 5, 1e-3);
  assert.equal(result.blockTimeWindow, BLOCK_TIME_WINDOW);
  assert.equal(result.halted, false);
});

test("Cosmos Hub: naive 15.4 % becomes ≈ 19.6 % at 5.70 s blocks", () => {
  const s = sample(10_000, 57_001.283);
  const result = computeEconomics({
    now: NOW,
    bonded: "339785634221068",
    totalSupply: "421000000000000",
    communityTax: 0.02,
    mint: {
      kind: "standard",
      annualProvisions: 53_462_873_244_348.8,
      inflation: 0.1,
      blocksPerYear: 4_360_000,
      paramsUnreadable: false,
    },
    latest: s.latest,
    latestReadAt: NOW,
    sample: s,
  });
  close(result.apr.naive, 0.1542, 1e-4);
  close(result.apr.actual, 0.1958, 3e-4);
});

test("a mint without blocks_per_year (Celestia) reports actual = naive and says why", () => {
  const result = computeEconomics(
    safrochain({
      bonded: "477774420875508",
      totalSupply: "1179049516870743",
      communityTax: 0.02,
      mint: {
        kind: "standard",
        annualProvisions: 26_865_128_712_665.77,
        inflation: null,
        blocksPerYear: null,
        paramsUnreadable: false,
      },
    }),
  );
  close(result.apr.naive, 0.05511, 1e-4);
  assert.equal(result.apr.actual, result.apr.naive);
  assert.equal(result.apr.blockTimeFactor, null);
  assert.match(result.apr.note ?? "", /no blocks_per_year/);
  assert.equal(result.inflation.param, null);
  close(result.inflation.actual, 0.022785, 1e-5);
});

test("unreadable mint params never pass the naive figure off as actual", () => {
  const result = computeEconomics(
    safrochain({
      mint: {
        kind: "standard",
        annualProvisions: 75_117_306_271_476.9,
        inflation: 0.0724,
        blocksPerYear: null,
        paramsUnreadable: true,
      },
    }),
  );
  assert.ok(result.apr.naive !== null);
  assert.equal(result.apr.actual, null);
  assert.ok(result.reasons.apr);
  assert.equal(result.inflation.actual, null);
});

test("without a block-time sample the actual APR is unknown, not naive", () => {
  const result = computeEconomics(safrochain({ sample: null }));
  assert.ok(result.apr.naive !== null);
  assert.equal(result.apr.actual, null);
  assert.equal(result.blockTimeSec, null);
  assert.ok(result.reasons.blockTimeSec);
  assert.ok(result.reasons.realYield);
});

test("missing community tax or bonded tokens leaves the APR unknown", () => {
  assert.equal(computeEconomics(safrochain({ communityTax: null })).apr.naive, null);
  const noBonded = computeEconomics(safrochain({ bonded: null }));
  assert.equal(noBonded.apr.naive, null);
  assert.equal(noBonded.bondedRatio, null);
  assert.ok(noBonded.reasons.bondedRatio);
});

test("Osmosis adapter: epoch provisions × epochs/year × staking share ÷ bonded", () => {
  const result = computeEconomics(
    safrochain({
      bonded: "178826151247149",
      totalSupply: "791367419340511",
      communityTax: 0,
      mint: {
        kind: "osmosis",
        epochProvisions: 121_765_601_217.656,
        epochSeconds: 86_400,
        stakingProportion: 0.08,
      },
    }),
  );
  close(result.apr.naive, 0.019896, 1e-5);
  assert.equal(result.apr.actual, result.apr.naive);
  assert.equal(result.apr.source, "osmosis-mint");
  assert.match(result.apr.note ?? "", /epoch/);
  // Full issuance (not only the staking share) dilutes holders.
  close(result.inflation.actual, 0.0562, 1e-4);
  assert.equal(result.inflation.param, null);
  assert.ok((result.realYield ?? 0) < 0, "Osmosis stakers lose share of supply at 2 % vs 5.6 %");
});

test("Osmosis adapter needs the epoch length and the staking share", () => {
  const noEpoch = computeEconomics(
    safrochain({ mint: { kind: "osmosis", epochProvisions: 1e11, epochSeconds: null, stakingProportion: 0.08 } }),
  );
  assert.equal(noEpoch.apr.actual, null);
  const noShare = computeEconomics(
    safrochain({ mint: { kind: "osmosis", epochProvisions: 1e11, epochSeconds: 86_400, stakingProportion: null } }),
  );
  assert.equal(noShare.apr.actual, null);
});

test("cosmos.directory fallback is labelled and adjusts inflation with its block counts", () => {
  const result = computeEconomics(
    safrochain({
      mint: {
        kind: "directory",
        directory: {
          naive: 0.2991,
          actual: 0.3668,
          inflation: 0.07,
          blocksPerYear: 10_096_186,
          actualBlocksPerYear: 12_382_466,
        },
      },
    }),
  );
  assert.equal(result.apr.source, "cosmos.directory");
  assert.equal(result.apr.actual, 0.3668);
  close(result.inflation.actual, 0.07 * (12_382_466 / 10_096_186), 1e-9);
});

test("a directory with no APR (rewards not from a mint) yields null, never 0 %", () => {
  const result = computeEconomics(
    safrochain({
      mint: {
        kind: "directory",
        directory: { naive: null, actual: null, inflation: null, blocksPerYear: null, actualBlocksPerYear: null },
      },
    }),
  );
  assert.equal(result.apr.naive, null);
  assert.equal(result.apr.actual, null);
  assert.equal(result.apr.source, "cosmos.directory");
  assert.ok(result.reasons.apr);
  // Kava: the same record's 0 % inflation is not shown either.
  const kava = computeEconomics(
    safrochain({
      mint: {
        kind: "directory",
        directory: { naive: null, actual: null, inflation: 0, blocksPerYear: 5_256_000, actualBlocksPerYear: 5_516_763 },
      },
    }),
  );
  assert.deepEqual(kava.inflation, { param: null, actual: null });
  assert.ok(kava.reasons.inflation);
});

test("an APR inflated by an almost-empty bonded pool is withheld, with the reason", () => {
  const result = computeEconomics(safrochain({ bonded: "1000000", totalSupply: "1037800901289961" }));
  assert.equal(result.apr.naive, null);
  assert.equal(result.apr.actual, null);
  assert.match(result.apr.note ?? "", /So little is staked/);
  assert.ok(result.reasons.apr);
  assert.equal(result.realYield, null);
});

test("no mint at all: APR null with the reason", () => {
  const result = computeEconomics(safrochain({ mint: { kind: "none", reason: "No mint data" } }));
  assert.equal(result.apr.actual, null);
  assert.equal(result.apr.source, null);
  assert.equal(result.reasons.apr, "No mint data");
});

test("halt detection compares the block time with when it was read", () => {
  const fresh = new Date(NOW - 20_000).toISOString();
  const old = new Date(NOW - 6 * 60_000).toISOString();
  assert.equal(isHalted(fresh, NOW), false);
  assert.equal(isHalted(old, NOW), true);
  assert.equal(isHalted(null, NOW), null);
  // A cached reading served four minutes later is still judged at read time.
  const result = computeEconomics(
    safrochain({ latest: { height: 1, time: fresh }, latestReadAt: NOW, now: NOW + 4 * 60_000 }),
  );
  assert.equal(result.halted, false);
});

test("validator APR = chain APR × (1 − commission), clamped", () => {
  close(validatorApr(0.18, 0.1), 0.162, 1e-12);
  assert.equal(validatorApr(0.18, 1.5), 0);
  assert.equal(validatorApr(null, 0.05), null);
  assert.equal(validatorApr(0.18, null), null);
  assert.equal(realYield(0.18, null), null);
  close(realYield(0.18, 0.13), 0.05, 1e-12);
});
