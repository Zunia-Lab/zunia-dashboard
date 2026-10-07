/**
 * Axis maths for the chart kit: value ticks, time ticks, and the nearest-point
 * search the crosshair snaps with. Pure functions, no DOM, so they are tested
 * directly (see __tests__/ticks.test.ts).
 */

import { nice, tickStep, ticks as linearTicks } from "d3-array";
import {
  timeDay,
  timeHour,
  timeMinute,
  timeMonth,
  timeWeek,
  timeYear,
  utcDay,
  utcHour,
  utcMinute,
  utcMonth,
  utcWeek,
  utcYear,
  type CountableTimeInterval,
  type TimeInterval,
} from "d3-time";
import { timeFormat, utcFormat } from "d3-time-format";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Ranges up to this long are labelled in hours, longer ones in days and up. */
export const HOURLY_RANGE_MAX_MS = 2 * DAY_MS;

export interface LinearTicks {
  /** The scale domain: the input range, or snapped out to tick multiples with `nice`. */
  domain: [number, number];
  ticks: number[];
  /** Distance between ticks; tick labels take their decimals from it. */
  step: number;
}

export interface NiceTicksOptions {
  /** Preferred tick count; the result lands within [minTicks, maxTicks] when it can. */
  target?: number;
  minTicks?: number;
  maxTicks?: number;
  /**
   * Snap the domain out to the outer ticks. Bars want this (the top gridline
   * becomes a labelled value with headroom above the tallest bar). Lines and
   * areas do not: they keep their padded data range so the shape fills the
   * plot, and the ticks sit inside it.
   */
  nice?: boolean;
}

/**
 * A few round ticks (1, 2 or 5 × 10ⁿ apart) for [min, max]: three or four
 * of them, four when possible (five only when no round step gives fewer). A flat or empty range is widened so it still gets a
 * labelled axis instead of a division by zero.
 */
export function niceTicks(
  min: number,
  max: number,
  options: NiceTicksOptions = {},
): LinearTicks {
  const target = options.target ?? 4;
  const minTicks = options.minTicks ?? 3;
  const maxTicks = options.maxTicks ?? 4;

  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : lo;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }

  let best: { result: LinearTicks; score: number } | null = null;
  for (let count = 1; count <= Math.max(target, maxTicks) * 3; count++) {
    const [a, b] = options.nice ? nice(lo, hi, count) : [lo, hi];
    const t = linearTicks(a, b, count);
    if (t.length < 2) continue;
    const step = Math.abs(tickStep(a, b, count));
    const outside = t.length < minTicks || t.length > maxTicks ? 100 : 0;
    // How much of the plot the data actually uses once the domain is niced.
    const waste = 1 - (hi - lo) / (b - a);
    const score = outside + Math.abs(t.length - target) * 10 + waste * 8;
    if (!best || score < best.score) {
      best = { result: { domain: [a, b], ticks: t, step }, score };
    }
  }
  return best?.result ?? { domain: [lo, hi], ticks: [lo, hi], step: hi - lo };
}

export type TimeTickUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

export interface TimeTicks {
  ticks: number[];
  unit: TimeTickUnit;
  /** How many units apart the ticks are. */
  step: number;
}

export interface TimeOptions {
  /** Use UTC boundaries and labels instead of the viewer's local time. */
  utc?: boolean;
}

/**
 * The clock a time chart labels its data on. `auto` reads the data: daily or
 * coarser samples that all sit on a UTC midnight are calendar days cut in UTC
 * (price APIs, server-side daily buckets), and labelling them on a local
 * clock would name the previous day for every viewer west of Greenwich.
 * Anything finer is a moment, read on the viewer's own clock.
 */
export type TimeZoneMode = "auto" | "local" | "utc";

/** Whether `ts` (ascending epoch ms) should be labelled in UTC under `mode`. */
export function prefersUtc(ts: ArrayLike<number>, mode: TimeZoneMode = "auto"): boolean {
  if (mode !== "auto") return mode === "utc";
  if (ts.length === 0) return false;
  if (ts.length > 1 && typicalStep(ts) < DAY_MS) return false;
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] % DAY_MS !== 0) return false;
  }
  return true;
}

interface Candidate {
  unit: TimeTickUnit;
  step: number;
  local: TimeInterval;
  utc: TimeInterval;
  /** Keep every n-th boundary, counted back from the newest (see dayStep). */
  thin?: number;
}

const every = (interval: CountableTimeInterval, step: number): TimeInterval =>
  interval.every(step) ?? interval;

const candidate = (
  unit: TimeTickUnit,
  step: number,
  local: CountableTimeInterval,
  utc: CountableTimeInterval,
): Candidate => ({ unit, step, local: every(local, step), utc: every(utc, step) });

/**
 * Every `step` days, counted back from the newest midnight in the range, so
 * the latest day always has its label (the one people look for, as with
 * bars) and the gaps stay even across month ends. d3's `timeDay.every(2)`
 * counts from the 1st of each month instead: it ticks the 31st and the 1st,
 * one day apart, and their labels collide.
 */
const dayStep = (step: number): Candidate => ({ unit: "day", step, local: timeDay, utc: utcDay, thin: step });

/** Finest first. Short ranges speak in clock time. */
const SHORT_CANDIDATES: Candidate[] = [
  candidate("minute", 15, timeMinute, utcMinute),
  candidate("minute", 30, timeMinute, utcMinute),
  candidate("hour", 1, timeHour, utcHour),
  candidate("hour", 2, timeHour, utcHour),
  candidate("hour", 3, timeHour, utcHour),
  candidate("hour", 6, timeHour, utcHour),
  candidate("hour", 12, timeHour, utcHour),
];

/**
 * Finest first. Longer ranges speak in calendar dates. Three days sits
 * between two and a week: on a phone (two or three labels) a 7D range fits
 * neither every-other-day (four ticks) nor whole weeks (a single Sunday), and
 * fell to one label for the whole axis.
 */
const LONG_CANDIDATES: Candidate[] = [
  candidate("day", 1, timeDay, utcDay),
  dayStep(2),
  dayStep(3),
  candidate("week", 1, timeWeek, utcWeek),
  candidate("week", 2, timeWeek, utcWeek),
  candidate("month", 1, timeMonth, utcMonth),
  candidate("month", 2, timeMonth, utcMonth),
  candidate("month", 3, timeMonth, utcMonth),
  candidate("month", 6, timeMonth, utcMonth),
  candidate("year", 1, timeYear, utcYear),
  candidate("year", 2, timeYear, utcYear),
  candidate("year", 5, timeYear, utcYear),
  candidate("year", 10, timeYear, utcYear),
];

/**
 * Ticks on calendar boundaries (midnight, the 1st, Sunday, January) for a
 * time range, at most `maxTicks` of them: the finest interval that fits.
 * Ranges up to two days tick in hours; anything longer ticks in days, weeks,
 * months or years. Boundaries are local time unless `utc` is set.
 */
export function timeTicks(
  start: number,
  end: number,
  maxTicks = 6,
  options: TimeOptions = {},
): TimeTicks {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ticks: Number.isFinite(start) ? [start] : [], unit: "day", step: 1 };
  }
  const max = Math.max(1, Math.floor(maxTicks));
  const lists =
    end - start <= HOURLY_RANGE_MAX_MS
      ? [SHORT_CANDIDATES, LONG_CANDIDATES]
      : [LONG_CANDIDATES];
  let last: TimeTicks | null = null;
  for (const list of lists) {
    for (const c of list) {
      const interval = options.utc ? c.utc : c.local;
      // `range` is [start, stop): nudge the stop so a tick on `end` counts.
      const all = interval.range(new Date(start), new Date(end + 1)).map(Number);
      const thin = c.thin ?? 1;
      const ticks = thin > 1 ? all.filter((_, i) => (all.length - 1 - i) % thin === 0) : all;
      last = { ticks, unit: c.unit, step: c.step };
      if (ticks.length <= max) return last;
    }
  }
  // Centuries of data on a phone: thin the coarsest ticks evenly.
  const all = last?.ticks ?? [];
  const keep = Math.ceil(all.length / max);
  return {
    ticks: all.filter((_, i) => i % keep === 0),
    unit: "year",
    step: (last?.step ?? 1) * keep,
  };
}

/**
 * Labels for time ticks. The label names the boundary it sits on: an hourly
 * axis writes "Oct 7" at midnight and "2 PM" between, a daily axis writes the
 * year on January 1st, a monthly axis writes the year in January.
 */
export function timeTickFormatter(
  unit: TimeTickUnit,
  options: TimeOptions = {},
): (t: number) => string {
  const format = options.utc ? utcFormat : timeFormat;
  const day = options.utc ? utcDay : timeDay;
  const year = options.utc ? utcYear : timeYear;
  const dayLabel = format("%b %-d");
  const yearLabel = format("%Y");
  const isDayStart = (d: Date) => +day.floor(d) === +d;
  const isYearStart = (d: Date) => +year.floor(d) === +d;

  switch (unit) {
    case "minute": {
      const clock = format("%-I:%M %p");
      return (t) => {
        const d = new Date(t);
        return isDayStart(d) ? dayLabel(d) : clock(d);
      };
    }
    case "hour": {
      const clock = format("%-I %p");
      return (t) => {
        const d = new Date(t);
        return isDayStart(d) ? dayLabel(d) : clock(d);
      };
    }
    case "day":
    case "week":
      return (t) => {
        const d = new Date(t);
        return isYearStart(d) ? yearLabel(d) : dayLabel(d);
      };
    case "month": {
      const monthLabel = format("%b");
      return (t) => {
        const d = new Date(t);
        return isYearStart(d) ? yearLabel(d) : monthLabel(d);
      };
    }
    case "year":
      return (t) => yearLabel(new Date(t));
  }
}

/**
 * The date line of a tooltip, at the data's own resolution: hourly points
 * show the hour ("Oct 7, 2:00 PM"), daily points show the year instead
 * ("Oct 7, 2026"). `resolutionMs` is the typical gap between points; 0 (a
 * single point) counts as daily when the point is a UTC day, else as a
 * moment.
 */
export function pointDateFormatter(
  resolutionMs: number,
  options: TimeOptions = {},
): (t: number) => string {
  const format = options.utc ? utcFormat : timeFormat;
  const daily = resolutionMs >= DAY_MS || (resolutionMs === 0 && options.utc === true);
  const f = daily ? format("%b %-d, %Y") : format("%b %-d, %-I:%M %p");
  return (t) => f(new Date(t));
}

/** Typical gap between consecutive points (the median), or 0 with fewer than two. */
export function typicalStep(ts: ArrayLike<number>): number {
  if (ts.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * Index of the value in ascending `xs` closest to `x`; ties go to the earlier
 * point. −1 for an empty array or a NaN target. This is what the crosshair
 * snaps with: readers aim at a date, never at a 2px line.
 */
export function nearestIndex(xs: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0 || Number.isNaN(x)) return -1;
  if (x <= xs[0]) return 0;
  if (x >= xs[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  return x - xs[lo] <= xs[hi] - x ? lo : hi;
}

/** First index whose value is ≥ x in ascending `xs`, or `xs.length` when none is. */
export function lowerBound(xs: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
