/**
 * Axis maths. An axis that lies is worse than no axis: ticks must be round,
 * inside the range they label, few enough to read, and the crosshair must
 * land on the point the reader is closest to, not the one before it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DAY_MS,
  HOUR_MS,
  lowerBound,
  nearestIndex,
  niceTicks,
  pointDateFormatter,
  prefersUtc,
  timeTickFormatter,
  timeTicks,
  typicalStep,
} from "../ticks";

const isRound = (step: number) => {
  const mantissa = step / 10 ** Math.floor(Math.log10(step));
  return [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9);
};

test("niceTicks returns 3 to 5 round ticks inside a padded data range", () => {
  for (const [min, max] of [
    [11_680, 14_820],
    [0.0251, 0.0319],
    [1.62, 1.83],
    [-40, 120],
    [97.3, 131.8],
    [0, 1],
  ]) {
    const { ticks, step, domain } = niceTicks(min, max);
    assert.ok(ticks.length >= 3 && ticks.length <= 5, `${min}..${max}: ${ticks}`);
    assert.ok(isRound(step), `${min}..${max}: step ${step}`);
    assert.deepEqual(domain, [min, max], "without nice the domain is the input");
    for (const t of ticks) assert.ok(t >= min && t <= max, `${t} outside ${min}..${max}`);
  }
});

test("niceTicks with nice snaps the domain out to labelled ticks", () => {
  const { domain, ticks } = niceTicks(0, 1234, { nice: true });
  assert.deepEqual(domain, [0, 1500]);
  assert.deepEqual(ticks, [0, 500, 1000, 1500]);
  // The top of a bar chart is always a labelled gridline.
  assert.equal(ticks[ticks.length - 1], domain[1]);
  assert.equal(ticks[0], domain[0]);
});

test("niceTicks prefers four ticks", () => {
  assert.deepEqual(niceTicks(0, 3, { nice: true }).ticks, [0, 1, 2, 3]);
  // 25 is not a round step, so 0–100 gets three ticks rather than six.
  assert.deepEqual(niceTicks(0, 100, { nice: true }).ticks, [0, 50, 100]);
});

test("niceTicks survives flat, reversed and non-finite input", () => {
  const flat = niceTicks(5, 5);
  assert.ok(flat.domain[0] < 5 && flat.domain[1] > 5, "a flat series gets a range around it");
  assert.ok(flat.ticks.length >= 2);

  const zero = niceTicks(0, 0);
  assert.deepEqual(zero.domain, [-1, 1]);

  const reversed = niceTicks(10, 0, { nice: true });
  assert.deepEqual(reversed.domain, [0, 10]);

  const broken = niceTicks(Number.NaN, Number.POSITIVE_INFINITY);
  assert.ok(broken.ticks.every(Number.isFinite));
});

test("timeTicks speaks in hours for ranges up to two days", () => {
  const start = Date.UTC(2026, 9, 6, 13, 20);
  const end = start + DAY_MS;
  const { ticks, unit, step } = timeTicks(start, end, 6, { utc: true });
  assert.equal(unit, "hour");
  assert.equal(step, 6);
  assert.ok(ticks.length >= 3 && ticks.length <= 6);
  for (const t of ticks) {
    assert.equal(new Date(t).getUTCMinutes(), 0);
    assert.equal(new Date(t).getUTCHours() % 6, 0);
    assert.ok(t >= start && t <= end);
  }
});

test("timeTicks speaks in days, weeks and months for longer ranges", () => {
  const end = Date.UTC(2026, 9, 7);
  const week = timeTicks(end - 7 * DAY_MS, end, 6, { utc: true });
  assert.equal(week.unit, "day");
  assert.ok(week.ticks.length <= 6);

  const month = timeTicks(end - 30 * DAY_MS, end, 6, { utc: true });
  assert.equal(month.unit, "week");
  for (const t of month.ticks) assert.equal(new Date(t).getUTCDay(), 0, "weeks start on Sunday");

  const year = timeTicks(end - 365 * DAY_MS, end, 6, { utc: true });
  assert.equal(year.unit, "month");
  for (const t of year.ticks) assert.equal(new Date(t).getUTCDate(), 1);
  assert.ok(year.ticks.length <= 6);
});

test("timeTicks never exceeds the budget, however narrow the chart", () => {
  const end = Date.UTC(2026, 9, 7);
  for (const span of [HOUR_MS * 3, DAY_MS, DAY_MS * 2, DAY_MS * 90, DAY_MS * 365 * 3]) {
    for (const max of [2, 3, 4, 6]) {
      const { ticks } = timeTicks(end - span, end, max, { utc: true });
      assert.ok(ticks.length <= max, `${span}ms / ${max}: ${ticks.length}`);
      for (const t of ticks) assert.ok(t >= end - span && t <= end);
    }
  }
});

test("a 7D axis on a phone keeps three day labels, not a lone Sunday", () => {
  // labelBudget gives 3 slots to a ~300px plot: every other day is 4 ticks,
  // whole weeks a single Sunday; every third day fits.
  for (const endDay of [7, 8, 9, 10, 11, 12, 13]) {
    for (const hour of [0, 15]) {
      const end = Date.UTC(2026, 9, endDay, hour);
      const { ticks, unit, step } = timeTicks(end - 7 * DAY_MS, end, 3, { utc: true });
      assert.equal(unit, "day", `Oct ${endDay} ${hour}h`);
      assert.equal(step, 3);
      assert.equal(ticks.length, 3, `Oct ${endDay} ${hour}h`);
      assert.equal(ticks.at(-1), Date.UTC(2026, 9, endDay), "the newest day is labelled");
    }
  }
});

test("day steps stay even across a month's end and end on the newest day", () => {
  // Oct 26 to Nov 9: d3's every(2) restarts on the 1st and ticks Oct 31 and Nov 1.
  const start = Date.UTC(2026, 9, 26);
  const end = Date.UTC(2026, 10, 9);
  for (const max of [5, 6]) {
    const { ticks, unit, step } = timeTicks(start, end, max, { utc: true });
    assert.equal(unit, "day");
    assert.ok(step > 1);
    for (let i = 1; i < ticks.length; i++) assert.equal(ticks[i] - ticks[i - 1], step * DAY_MS, `max ${max}`);
    assert.equal(ticks.at(-1), end);
  }
});

test("timeTicks returns no ticks for an empty or reversed range", () => {
  assert.deepEqual(timeTicks(10, 10).ticks, [10]);
  assert.deepEqual(timeTicks(Number.NaN, 10).ticks, []);
});

test("time tick labels name the boundary they sit on", () => {
  const hour = timeTickFormatter("hour", { utc: true });
  assert.equal(hour(Date.UTC(2026, 9, 7, 0)), "Oct 7");
  assert.equal(hour(Date.UTC(2026, 9, 7, 14)), "2 PM");

  const day = timeTickFormatter("day", { utc: true });
  assert.equal(day(Date.UTC(2026, 9, 7)), "Oct 7");
  assert.equal(day(Date.UTC(2027, 0, 1)), "2027");

  const month = timeTickFormatter("month", { utc: true });
  assert.equal(month(Date.UTC(2026, 9, 1)), "Oct");
  assert.equal(month(Date.UTC(2027, 0, 1)), "2027");
});

test("tooltip dates follow the data's resolution", () => {
  const t = Date.UTC(2026, 9, 7, 14, 0);
  assert.equal(pointDateFormatter(HOUR_MS, { utc: true })(t), "Oct 7, 2:00 PM");
  assert.equal(pointDateFormatter(DAY_MS, { utc: true })(t), "Oct 7, 2026");
  // A single sample has no resolution: a UTC day reads as a day, else as a moment.
  assert.equal(pointDateFormatter(0, { utc: true })(Date.UTC(2026, 9, 7)), "Oct 7, 2026");
  assert.equal(pointDateFormatter(0, { utc: true })(t), "Oct 7, 2026");
  assert.match(pointDateFormatter(0)(t), /^Oct 7, \d{1,2}:00 (AM|PM)$/);
});

test("prefersUtc spots daily data cut at UTC midnight", () => {
  const days = [0, 1, 2, 3].map((i) => Date.UTC(2026, 8, 20 + i));
  assert.equal(prefersUtc(days), true, "daily candles are UTC calendar days");
  assert.equal(prefersUtc([Date.UTC(2026, 8, 1), Date.UTC(2026, 9, 1)]), true, "monthly too");
  assert.equal(prefersUtc([Date.UTC(2026, 9, 7)]), true, "a single UTC day");

  const hours = [0, 1, 2].map((i) => Date.UTC(2026, 9, 7, i));
  assert.equal(prefersUtc(hours), false, "hourly samples are moments, read locally");
  const offDays = days.map((t) => t + 12 * HOUR_MS);
  assert.equal(prefersUtc(offDays), false, "daily samples at noon are not UTC buckets");
  assert.equal(prefersUtc([]), false);

  assert.equal(prefersUtc(hours, "utc"), true, "an explicit mode wins");
  assert.equal(prefersUtc(days, "local"), false);
});

test("typicalStep is the median gap, robust to one missing sample", () => {
  assert.equal(typicalStep([0, 10, 20, 40, 50]), 10);
  assert.equal(typicalStep([5]), 0);
});

test("nearestIndex snaps to the closest point, ties to the earlier one", () => {
  const xs = [0, 10, 20, 30];
  assert.equal(nearestIndex(xs, -5), 0);
  assert.equal(nearestIndex(xs, 0), 0);
  assert.equal(nearestIndex(xs, 4), 0);
  assert.equal(nearestIndex(xs, 5), 0);
  assert.equal(nearestIndex(xs, 6), 1);
  assert.equal(nearestIndex(xs, 24), 2);
  assert.equal(nearestIndex(xs, 26), 3);
  assert.equal(nearestIndex(xs, 99), 3);
  assert.equal(nearestIndex([], 3), -1);
  assert.equal(nearestIndex(xs, Number.NaN), -1);
  assert.equal(nearestIndex([7], 1000), 0);
});

test("nearestIndex agrees with a linear scan on uneven spacing", () => {
  const xs = [1, 2, 4, 8, 16, 32, 33, 90, 91, 200];
  for (let x = -3; x <= 210; x += 0.5) {
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    }
    assert.equal(nearestIndex(xs, x), best, `x=${x}`);
  }
});

test("lowerBound finds the first value at or after x", () => {
  const xs = [1, 3, 3, 5];
  assert.equal(lowerBound(xs, 0), 0);
  assert.equal(lowerBound(xs, 3), 1);
  assert.equal(lowerBound(xs, 4), 3);
  assert.equal(lowerBound(xs, 6), 4);
});
