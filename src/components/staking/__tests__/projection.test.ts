/**
 * Compounding simulator: the simple line is P(1 + rt), restakes compound
 * minus their fee, unprofitable restakes are skipped, and the optimal
 * threshold matches √(2fP).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bestOption, closestOption, project, restakeIntervalDays, restakeThreshold } from "../projection";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("never restaking is the simple line", () => {
  const p = project({ principal: 1000, apr: 0.1, years: 2, restakesPerYear: 0, feePerRestake: 1 });
  close(p.simpleEnd, 1200);
  close(p.compoundEnd, 1200);
  assert.equal(p.restakes, 0);
  assert.equal(p.points.length, 25);
  close(p.points[12]?.simple ?? 0, 1100);
});

test("free monthly restakes match monthly compounding", () => {
  const p = project({ principal: 1000, apr: 0.12, years: 1, restakesPerYear: 12, feePerRestake: 0 });
  close(p.compoundEnd, 1000 * (1 + 0.01) ** 12, 1e-6);
  assert.equal(p.restakes, 12);
  assert.ok(p.gain > 0);
});

test("fees come off every restake", () => {
  const free = project({ principal: 1000, apr: 0.12, years: 1, restakesPerYear: 12, feePerRestake: 0 });
  const paid = project({ principal: 1000, apr: 0.12, years: 1, restakesPerYear: 12, feePerRestake: 0.5 });
  close(paid.fees, 6);
  assert.ok(paid.compoundEnd < free.compoundEnd);
});

test("a restake that would not cover its fee is skipped", () => {
  // Daily rewards on $10 at 10 % are ~0.27 cents: a 5-cent fee never pays.
  const p = project({ principal: 10, apr: 0.1, years: 1, restakesPerYear: 365, feePerRestake: 0.05 });
  assert.ok(p.skipped > 300);
  assert.ok(p.restakes < 65);
  assert.ok(p.compoundEnd <= p.simpleEnd + 1e-9);
});

test("bad input projects nothing rather than NaN", () => {
  const p = project({ principal: Number.NaN, apr: -1, years: 1, restakesPerYear: 12, feePerRestake: 0 });
  close(p.simpleEnd, 0);
  close(p.compoundEnd, 0);
});

test("optimal threshold is √(2fP) and the interval follows from the APR", () => {
  close(restakeThreshold(1000, 0.01) ?? 0, Math.sqrt(20));
  assert.equal(restakeThreshold(0, 1), null);
  assert.equal(restakeThreshold(1000, 0), null);
  close(restakeIntervalDays(1000, 0.2, 0.01) ?? 0, (Math.sqrt(20) / 200) * 365);
  assert.equal(restakeIntervalDays(1000, 0, 0.01), null);
});

test("the suggested interval maps to the nearest offered frequency", () => {
  assert.equal(closestOption(1), "365");
  assert.equal(closestOption(6), "52");
  assert.equal(closestOption(25), "12");
  assert.equal(closestOption(400), "12");
  assert.equal(closestOption(null), "12");
});

test("the default cadence is the one that pays best, and never when restaking loses", () => {
  // ~$45 at 10 % with a $0.20 fee per restake: every cadence costs more than it adds.
  assert.equal(bestOption({ principal: 45, apr: 0.1, years: 2, feePerRestake: 0.2 }), "0");
  // A large stake with a small fee: compounding pays, weekly best (daily fees outrun it).
  assert.equal(bestOption({ principal: 100_000, apr: 0.15, years: 2, feePerRestake: 0.5 }), "52");
  // Free restakes: the most frequent wins.
  assert.equal(bestOption({ principal: 1000, apr: 0.12, years: 1, feePerRestake: 0 }), "365");
  // Nothing to compound: never.
  assert.equal(bestOption({ principal: 0, apr: 0.12, years: 1, feePerRestake: 0.1 }), "0");
  assert.equal(bestOption({ principal: 1000, apr: 0, years: 1, feePerRestake: 0 }), "0");
});
