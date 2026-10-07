import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { drawdownText, priceDomain, rangeStats } from "../price-stats";

const DAY = 86_400_000;

describe("rangeStats", () => {
  it("reads change, high and low", () => {
    const stats = rangeStats(
      [
        { t: 2 * DAY, v: 12 },
        { t: 0, v: 10 },
        { t: DAY, v: 8 },
        { t: 3 * DAY, v: 11 },
      ],
      "day",
    );
    assert.ok(stats);
    assert.equal(stats.first.v, 10);
    assert.equal(stats.last.v, 11);
    assert.ok(Math.abs((stats.change ?? 0) - 10) < 1e-9);
    assert.equal(stats.high.v, 12);
    assert.equal(stats.low.v, 8);
  });

  it("finds the deepest fall from a running peak", () => {
    const stats = rangeStats(
      [10, 12, 6, 9, 13, 11].map((v, i) => ({ t: i * DAY, v })),
      "day",
    );
    assert.ok(stats && Math.abs((stats.maxDrawdown ?? 0) - -50) < 1e-9);
    const rising = rangeStats([1, 2, 3].map((v, i) => ({ t: i * DAY, v })), "day");
    assert.equal(rising?.maxDrawdown, 0);
  });

  it("annualises volatility and skips the partial last step", () => {
    const flat = rangeStats([1, 1, 1, 1].map((v, i) => ({ t: i * DAY, v })), "day");
    assert.equal(flat?.volatility, 0);
    const alternating = [100, 110, 100, 110, 100].map((v, i) => ({ t: i * DAY, v }));
    const withNow = [...alternating, { t: 4 * DAY + 3_600_000, v: 200 }];
    const a = rangeStats(alternating, "day")?.volatility ?? 0;
    const b = rangeStats(withNow, "day")?.volatility ?? 0;
    const r = Math.log(1.1);
    const expected = Math.sqrt((4 * r * r) / 3) * Math.sqrt(365) * 100;
    assert.ok(Math.abs(a - expected) < 1e-9);
    assert.equal(a, b);
    assert.ok((rangeStats(alternating, "hour")?.volatility ?? 0) > a);
  });

  it("refuses what it cannot measure", () => {
    assert.equal(rangeStats([], "day"), null);
    const one = rangeStats([{ t: 0, v: 5 }], "day");
    assert.equal(one?.volatility, null);
    assert.equal(one?.maxDrawdown, null);
    assert.equal(rangeStats([{ t: 0, v: 0 }, { t: 1, v: Number.NaN }], "day"), null);
  });
});

describe("priceDomain", () => {
  it("frames a quiet series in a ±1% window around its middle", () => {
    const stable = [1.00001, 1.00004, 0.99998, 1].map((v, i) => ({ t: i * DAY, v }));
    const domain = priceDomain(stable);
    assert.ok(Array.isArray(domain));
    const [lo, hi] = domain as [number, number];
    const mid = (0.99998 + 1.00004) / 2;
    assert.ok(Math.abs(lo - mid * 0.99) < 1e-12 && Math.abs(hi - mid * 1.01) < 1e-12);
    assert.ok(lo < 0.99998 && hi > 1.00004);
  });

  it("leaves a moving series to the chart", () => {
    assert.equal(priceDomain([1.5, 1.8, 1.6].map((v, i) => ({ t: i * DAY, v }))), "auto");
    assert.equal(priceDomain([]), "auto");
    assert.equal(priceDomain([{ t: 0, v: 0 }, { t: DAY, v: 0 }]), "auto");
  });
});

describe("drawdownText", () => {
  const format = (v: number) => `${v.toFixed(1)}%`;
  it("never prints a sign in front of a less-than", () => {
    assert.equal(drawdownText(-0.0001, format), "<0.1%");
    assert.equal(drawdownText(0, format), "0%");
    assert.equal(drawdownText(-18.62, format), "-18.6%");
    assert.equal(drawdownText(null, format), null);
  });
});
