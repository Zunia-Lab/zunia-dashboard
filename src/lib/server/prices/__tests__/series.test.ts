/**
 * History arithmetic: forward fill on a common grid, and the honesty rules of
 * the "value of today's holdings" curve (partial history held flat and named,
 * no history skipped and named, never summed as zero).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  combineHoldings,
  DAY_MS,
  gridFor,
  HOUR_MS,
  rangeSpec,
  resampleOnGrid,
  roundSignificant,
  sampleForwardFill,
  withLatest,
} from "../series";
import { parseNumiaChart } from "../parse";

const NOW = Date.UTC(2026, 9, 6, 23, 12, 0);

describe("grids", () => {
  it("are hourly up to a week and daily beyond, aligned to UTC boundaries", () => {
    assert.equal(rangeSpec("1D").resolution, "hour");
    assert.equal(rangeSpec("7D").resolution, "hour");
    assert.equal(rangeSpec("30D").resolution, "day");
    assert.equal(rangeSpec("1Y").resolution, "day");

    const hourly = gridFor(rangeSpec("7D"), NOW);
    assert.equal(hourly.length, 7 * 24 + 1);
    assert.equal(hourly[hourly.length - 1], Date.UTC(2026, 9, 6, 23, 0, 0));
    assert.ok(hourly.every((t, i) => i === 0 || t - (hourly[i - 1] as number) === HOUR_MS));

    const daily = gridFor(rangeSpec("30D"), NOW);
    assert.equal(daily.length, 31);
    assert.equal(daily[daily.length - 1], Date.UTC(2026, 9, 6));
    assert.equal(daily[0], Date.UTC(2026, 9, 6) - 30 * DAY_MS);
  });

  it("keeps the 1D window inside the last 24 hours, so its change is a 24-hour change", () => {
    const day = gridFor(rangeSpec("1D"), NOW);
    // At 23:12 the last 24 hours start at 23:12 on the 5th, so the first
    // boundary inside them is 00:00 on the 6th, not 23:00 on the 5th.
    assert.equal(day[0], Date.UTC(2026, 9, 6, 0, 0, 0));
    assert.equal(day[day.length - 1], Date.UTC(2026, 9, 6, 23, 0, 0));
    assert.ok(day.every((t) => t >= NOW - DAY_MS && t <= NOW));
    assert.equal(day.length, 24);
    // Exactly on the hour the window is the full 24 h, both ends included.
    const onTheHour = gridFor(rangeSpec("1D"), Date.UTC(2026, 9, 6, 23, 0, 0));
    assert.equal(onTheHour.length, 25);
    assert.equal(onTheHour[0], Date.UTC(2026, 9, 5, 23, 0, 0));
  });
});

describe("forward fill", () => {
  const grid = [0, 10, 20, 30, 40];

  it("holds the last known price, never interpolates, and has none before the first", () => {
    const points = [
      { t: 5, v: 1 },
      { t: 21, v: 3 },
      { t: 22, v: 4 },
    ];
    assert.deepEqual(sampleForwardFill(points, grid), [null, 1, 1, 4, 4]);
    assert.deepEqual(sampleForwardFill([], grid), [null, null, null, null, null]);
    assert.deepEqual(sampleForwardFill([{ t: 0, v: 2 }], grid), [2, 2, 2, 2, 2]);
  });

  it("resamples one asset onto the grid, starting where its data starts", () => {
    assert.deepEqual(resampleOnGrid([{ t: 15, v: 2 }, { t: 35, v: 3 }], grid), [
      { t: 20, v: 2 },
      { t: 30, v: 2 },
      { t: 40, v: 3 },
    ]);
  });

  it("ends on the newest real price after the last grid boundary, and adds nothing to no data", () => {
    const sampled = resampleOnGrid([{ t: 15, v: 2 }], grid);
    assert.deepEqual(withLatest(sampled, [{ t: 15, v: 2 }, { t: 44, v: 5 }], grid, 45), [...sampled, { t: 44, v: 5 }]);
    assert.deepEqual(withLatest(sampled, [{ t: 15, v: 2 }, { t: 40, v: 5 }], grid, 45), sampled, "on the boundary: already there");
    assert.deepEqual(withLatest(sampled, [{ t: 15, v: 2 }, { t: 50, v: 5 }], grid, 45), sampled, "never a future point");
    assert.deepEqual(withLatest([], [{ t: 44, v: 5 }], grid, 45), []);
  });

  it("shows each day's price as of that day: daily closes stamped at their end", () => {
    // Three daily candles opening at Oct 4, 5, 6 with closes 1, 2, 3; read
    // on Oct 6 at 12:00. At Oct 5 00:00 the price was Oct 4's close (1),
    // at Oct 6 00:00 it was Oct 5's (2); "now" is the forming candle's 3.
    const oct4 = Date.UTC(2026, 9, 4);
    const now = oct4 + 2 * DAY_MS + 12 * HOUR_MS;
    const closes = parseNumiaChart(
      [1, 2, 3].map((close, i) => ({ time: (oct4 + i * DAY_MS) / 1000, close })),
      DAY_MS,
      now,
    );
    const dayGrid = [oct4 + DAY_MS, oct4 + 2 * DAY_MS];
    assert.deepEqual(withLatest(resampleOnGrid(closes, dayGrid), closes, dayGrid, now), [
      { t: oct4 + DAY_MS, v: 1 },
      { t: oct4 + 2 * DAY_MS, v: 2 },
      { t: now, v: 3 },
    ]);
  });
});

describe("combineHoldings", () => {
  const grid = [0, 10, 20, 30];

  it("sums units × price on the grid", () => {
    const combined = combineHoldings(
      [
        { key: "a", units: 2, points: [{ t: 0, v: 1 }, { t: 20, v: 2 }] },
        { key: "b", units: 10, points: [{ t: 0, v: 0.5 }] },
      ],
      grid,
    );
    assert.deepEqual(
      combined.points.map((point) => point.v),
      [2 + 5, 2 + 5, 4 + 5, 4 + 5],
    );
    assert.deepEqual(combined.partial, []);
    assert.deepEqual(combined.skipped, []);
  });

  it("holds a late series flat at its first price before it starts, and names it", () => {
    const combined = combineHoldings(
      [
        { key: "old", units: 1, points: [{ t: 0, v: 10 }] },
        { key: "young", units: 1, points: [{ t: 20, v: 3 }, { t: 30, v: 4 }] },
      ],
      grid,
    );
    assert.deepEqual(
      combined.points.map((point) => point.v),
      [13, 13, 13, 14],
    );
    assert.deepEqual(combined.partial, [{ key: "young", from: 20 }]);
  });

  it("leaves out a series with no price in the window, and names it", () => {
    const combined = combineHoldings(
      [
        { key: "priced", units: 1, points: [{ t: 0, v: 1 }] },
        { key: "nothing", units: 1000, points: [] },
        { key: "future", units: 5, points: [{ t: 99, v: 1 }] },
      ],
      grid,
    );
    assert.deepEqual(
      combined.points.map((point) => point.v),
      [1, 1, 1, 1],
    );
    assert.deepEqual(combined.skipped, ["nothing", "future"]);
  });

  it("returns no curve at all rather than a line at zero", () => {
    assert.deepEqual(combineHoldings([{ key: "x", units: 3, points: [] }], grid).points, []);
    assert.deepEqual(combineHoldings([], grid).points, []);
    // Zero units contribute nothing and are not "skipped".
    const zero = combineHoldings([{ key: "z", units: 0, points: [] }], grid);
    assert.deepEqual(zero.skipped, []);
  });
});

describe("roundSignificant", () => {
  it("keeps significant digits for small prices", () => {
    assert.equal(roundSignificant(0.000280123456789), 0.000280123);
    assert.equal(roundSignificant(80787.42006393945), 80787.4);
    assert.equal(roundSignificant(0), 0);
  });
});
