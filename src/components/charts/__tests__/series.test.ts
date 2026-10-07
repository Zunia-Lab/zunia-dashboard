/**
 * Series shaping. Indexing is the kit's answer to "two units on one chart"
 * (never a second y-axis), so it has to be exact: every series starts at 100
 * on the same date, and a series that cannot be indexed is reported, not
 * quietly drawn wrong.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { OTHER_ID, stableColorMap, VIZ_OTHER } from "../palette";
import {
  cleanSeries,
  colouredParts,
  foldOther,
  mergeHuelessParts,
  rebaseToIndex,
  relativeChange,
  valueExtent,
  type TimePoint,
} from "../series";

const pts = (...pairs: Array<[number, number]>): TimePoint[] =>
  pairs.map(([t, v]) => ({ t, v }));

test("cleanSeries returns clean input as is", () => {
  const input = pts([1, 10], [2, 11], [3, 12]);
  assert.equal(cleanSeries(input), input);
});

test("cleanSeries sorts, drops non-finite samples and dedupes timestamps", () => {
  const input = pts([3, 12], [1, 10], [2, Number.NaN], [3, 13], [Number.NaN, 1]);
  assert.deepEqual(cleanSeries(input), pts([1, 10], [3, 13]));
});

test("valueExtent and relativeChange", () => {
  assert.deepEqual(valueExtent(pts([1, 4], [2, -2], [3, 9])), [-2, 9]);
  assert.equal(valueExtent([]), null);
  assert.equal(relativeChange(80, 100), 0.25);
  assert.equal(relativeChange(-50, -25), 0.5);
  assert.equal(relativeChange(0, 5), null);
});

test("rebaseToIndex starts every series at 100 on the first common date", () => {
  const atom = { id: "atom", points: pts([1, 2], [2, 2.2], [3, 2.4], [4, 1.8]) };
  const osmo = { id: "osmo", points: pts([2, 0.04], [3, 0.03], [4, 0.05]) };
  const { series, start, skipped } = rebaseToIndex([atom, osmo]);

  assert.equal(start, 2, "the later of the two first samples");
  assert.deepEqual(skipped, []);
  const [a, o] = series;
  assert.equal(a.id, "atom");
  assert.equal(a.baseValue, 2.2);
  assert.deepEqual(a.points.map((p) => p.t), [2, 3, 4], "samples before the common start are dropped");
  assert.equal(a.points[0].v, 100);
  assert.ok(Math.abs(a.points[2].v - (1.8 / 2.2) * 100) < 1e-9);
  assert.equal(o.points[0].v, 100);
  assert.ok(Math.abs(o.points[2].v - 125) < 1e-9);
});

test("rebaseToIndex uses the first sample at or after the start when dates differ", () => {
  const daily = { id: "d", points: pts([0, 10], [100, 20], [200, 30]) };
  const late = { id: "l", points: pts([50, 4], [150, 8]) };
  const { series, start } = rebaseToIndex([daily, late]);
  assert.equal(start, 50);
  assert.equal(series[0].baseValue, 20, "daily is based on its sample at t=100");
  assert.deepEqual(series[0].points, pts([100, 100], [200, 150]));
});

test("rebaseToIndex reports what it cannot index", () => {
  const ok = { id: "ok", points: pts([1, 5], [2, 6]) };
  const zero = { id: "zero", points: pts([1, 0], [2, 3]) };
  const empty = { id: "empty", points: [] };
  const ended = { id: "ended", points: pts([0, 1]) };
  const { series, skipped } = rebaseToIndex([ok, zero, empty, ended]);
  assert.deepEqual(series.map((s) => s.id), ["ok"]);
  assert.deepEqual(skipped.map((s) => s.id).sort(), ["empty", "ended", "zero"]);
  assert.deepEqual(rebaseToIndex([]), { series: [], start: null, skipped: [] });
});

test("rebaseToIndex accepts another base", () => {
  const { series } = rebaseToIndex([{ id: "x", points: pts([1, 4], [2, 5]) }], 1);
  assert.deepEqual(series[0].points.map((p) => p.v), [1, 1.25]);
});

const part = (id: string, value: number) => ({ id, label: id.toUpperCase(), value });

test("foldOther keeps the five largest and folds the tail into Other", () => {
  const items = [5, 40, 1, 12, 3, 8, 20, 2, 9].map((v, i) => part(`c${i}`, v));
  const { parts, folded, total } = foldOther(items);
  assert.equal(parts.length, 6);
  assert.deepEqual(parts.slice(0, 5).map((p) => p.value), [40, 20, 12, 9, 8]);
  const other = parts[5];
  assert.equal(other.id, OTHER_ID);
  assert.equal(other.label, "Other");
  assert.equal(other.value, 11);
  assert.deepEqual(folded.map((f) => f.value), [5, 3, 2, 1]);
  assert.equal(total, 100);
});

test("foldOther shows a single leftover as itself", () => {
  const items = [1, 2, 3, 4, 5, 6, 7].map((v) => part(`c${v}`, v));
  const { parts, folded } = foldOther(items, 6);
  assert.equal(parts.length, 7);
  assert.ok(parts.every((p) => p.id !== OTHER_ID));
  assert.deepEqual(folded, []);
});

test("foldOther drops what cannot be a share and keeps ties in input order", () => {
  const items = [part("a", 0), part("b", 5), part("c", -3), part("d", Number.NaN), part("e", 5)];
  const { parts, total } = foldOther(items, 2, "Rest");
  assert.deepEqual(parts.map((p) => p.id), ["b", "e"]);
  assert.equal(total, 10);
});

test("foldOther honours a custom size and label", () => {
  const items = [9, 8, 7, 6, 5].map((v) => part(`c${v}`, v));
  const { parts } = foldOther(items, 2, "Everything else");
  assert.deepEqual(parts.map((p) => p.value), [9, 8, 18]);
  assert.equal(parts[2].label, "Everything else");
});

test("mergeHuelessParts leaves parts alone when every one has a hue", () => {
  const folded = foldOther([part("a", 5), part("b", 3)]);
  assert.equal(mergeHuelessParts(folded, () => true), folded);
});

test("mergeHuelessParts keeps a lone grey part when there is no Other to join", () => {
  const folded = foldOther([part("a", 5), part("b", 3), part("z", 1)]);
  const merged = mergeHuelessParts(folded, (p) => p.id !== "z");
  assert.equal(merged, folded, "one grey, named in the legend, is not ambiguous");
});

test("mergeHuelessParts moves a grey part into an existing Other", () => {
  const items = [40, 30, 20, 10, 6, 3, 2].map((v, i) => part(`c${i}`, v));
  const folded = foldOther(items, 5);
  // c3 (10) made the cut but the page's map has no hue left for it.
  const merged = mergeHuelessParts(folded, (p) => p.id !== "c3");
  assert.deepEqual(merged.parts.map((p) => p.id), ["c0", "c1", "c2", "c4", OTHER_ID]);
  assert.equal(merged.parts[4].value, 15);
  assert.deepEqual(merged.folded.map((f) => f.id), ["c3", "c5", "c6"], "largest first");
  assert.equal(merged.total, folded.total);
});

test("mergeHuelessParts gathers two grey parts into a new Other", () => {
  const folded = foldOther([part("a", 5), part("y", 2), part("z", 1)]);
  const merged = mergeHuelessParts(folded, (p) => p.id === "a", "Rest");
  assert.deepEqual(merged.parts.map((p) => [p.id, p.label, p.value]), [
    ["a", "A", 5],
    [OTHER_ID, "Rest", 3],
  ]);
});

test("mergeHuelessParts never merges everything away", () => {
  const folded = foldOther([part("a", 5), part("b", 3)]);
  assert.equal(mergeHuelessParts(folded, () => false), folded);
});

test("colouredParts gives every named part a slot by default, largest first", () => {
  const { parts, colorOf } = colouredParts([part("small", 1), part("big", 9), part("mid", 4)], 5, "Other");
  assert.deepEqual(parts.map((p) => p.id), ["big", "mid", "small"]);
  assert.deepEqual(parts.map(colorOf), ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"]);
});

test("colouredParts follows the page map and folds parts it has no hue for", () => {
  // The page's map was built from ten followed chains; "late" is the eighth.
  const ids = ["a", "b", "c", "d", "e", "f", "g", "late", "i", "j"];
  const colors = stableColorMap(ids);
  const data = [part("a", 50), part("late", 20), part("b", 10), part("c", 8), part("d", 6), part("e", 4), part("f", 2)];
  const { parts, folded, colorOf } = colouredParts(data, 5, "Other", colors);
  assert.deepEqual(parts.map((p) => p.id), ["a", "b", "c", "d", OTHER_ID]);
  assert.deepEqual(folded.map((f) => f.id), ["late", "e", "f"]);
  assert.equal(colorOf(parts[1]), "var(--viz-2)", "b keeps its page-wide slot");
  assert.equal(colorOf(parts[4]), VIZ_OTHER);
});
