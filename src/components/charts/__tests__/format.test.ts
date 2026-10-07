/**
 * Default chart formatting. Small numbers are the norm in this ecosystem
 * (OSMO trades around three cents), so the fallbacks must keep meaning at
 * both ends: 0.0287 stays 0.0287, 12,400 becomes 12.4k, and an axis never
 * mixes "12k" with "12.5k".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  affixUnit,
  formatCompact,
  formatShare,
  formatSignedPercent,
  formatValue,
  makeTickFormat,
  MINUS,
} from "../format";

test("formatCompact keeps three significant digits across units", () => {
  assert.equal(formatCompact(0), "0");
  assert.equal(formatCompact(0.028734), "0.0287");
  assert.equal(formatCompact(1.7912), "1.79");
  assert.equal(formatCompact(124.4), "124");
  assert.equal(formatCompact(12_431), "12.4k");
  assert.equal(formatCompact(1_240_000), "1.24M");
  assert.equal(formatCompact(3_100_000_000), "3.1B");
  assert.equal(formatCompact(-12_431), `${MINUS}12.4k`);
  assert.equal(formatCompact(Number.NaN), "—");
});

test("formatCompact moves up a unit when rounding crosses it", () => {
  assert.equal(formatCompact(999.96), "1k");
  assert.equal(formatCompact(999_960), "1M");
  assert.equal(formatCompact(999_400), "999k");
});

test("formatValue gives hovered values their full meaning", () => {
  assert.equal(formatValue(12_431.519), "12,431.52");
  assert.equal(formatValue(1.79), "1.79");
  assert.equal(formatValue(0.0287341), "0.02873");
  assert.equal(formatValue(-3.5), `${MINUS}3.5`);
  assert.equal(formatValue(2_500_000), "2.5M");
});

test("formatShare and formatSignedPercent", () => {
  assert.equal(formatShare(0.234), "23.4%");
  assert.equal(formatShare(1), "100%");
  assert.equal(formatShare(0), "0%");
  assert.equal(formatShare(0.0004), "<0.1%");
  assert.equal(formatShare(0.9999), ">99.9%");
  assert.equal(formatSignedPercent(0.124), "+12.4%");
  assert.equal(formatSignedPercent(-0.03), `${MINUS}3.0%`);
  assert.equal(formatSignedPercent(0.00001), "0.0%");
});

test("makeTickFormat uses one unit and one precision per axis", () => {
  const k = makeTickFormat([12_000, 12_500, 13_000], 500);
  assert.deepEqual([12_000, 12_500, 13_000].map(k), ["12.0k", "12.5k", "13.0k"]);

  const small = makeTickFormat([0.026, 0.028, 0.03], 0.002);
  assert.deepEqual([0.026, 0.028, 0.03].map(small), ["0.026", "0.028", "0.030"]);

  const plain = makeTickFormat([0, 500, 1000, 1500], 500);
  assert.deepEqual([0, 500, 1000, 1500].map(plain), ["0", "500", "1,000", "1,500"]);

  const index = makeTickFormat([90, 100, 110], 10);
  assert.deepEqual([90, 100, 110].map(index), ["90", "100", "110"]);

  const signed = makeTickFormat([-2_000_000, 0, 2_000_000], 2_000_000);
  assert.deepEqual([-2_000_000, 0, 2_000_000].map(signed), [`${MINUS}2M`, "0", "2M"]);
});

test("defaults keep their meaning at crypto extremes", () => {
  // A token at a hundred-thousandth of a dollar, a market cap in billions.
  assert.equal(formatValue(0.0000123), "0.0000123");
  assert.equal(formatCompact(0.0000123), "0.0000123");
  assert.equal(formatValue(12_400_000_000), "12.4B");
  assert.equal(formatCompact(12_400_000_000), "12.4B");
  assert.equal(formatCompact(4.2e12), "4.2T");

  const billions = makeTickFormat([0, 5e9, 10e9, 15e9], 5e9);
  assert.deepEqual([0, 5e9, 10e9, 15e9].map(billions), ["0", "5B", "10B", "15B"]);

  const tiny = makeTickFormat([0.000012, 0.0000125, 0.000013], 0.0000005);
  assert.deepEqual([0.000012, 0.0000125, 0.000013].map(tiny), ["0.0000120", "0.0000125", "0.0000130"]);
});

test("affixUnit puts the unit inside the sign", () => {
  assert.equal(affixUnit(`${MINUS}50`, "$"), `${MINUS}$50`);
  assert.equal(affixUnit("-1.2k", "$"), "-$1.2k");
  assert.equal(affixUnit("+12.4", "", "%"), "+12.4%");
  assert.equal(affixUnit("0", "$"), "$0");
  assert.equal(affixUnit("1,500", "", " ATOM"), "1,500 ATOM");
});
