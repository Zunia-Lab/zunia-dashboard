/**
 * Label placement and mark geometry. The promise under test: a label is
 * measured before it is drawn, so it is never clipped, never overlaps its
 * neighbour, and never runs off the frame; and keyboard stepping always lands
 * on a real index.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  columnPath,
  estimateTextWidth,
  fitLabel,
  labelBudget,
  lineCrossesBox,
  placeLabels,
  placeLineLabel,
  stepIndex,
  thinningStep,
} from "../layout";

test("estimateTextWidth grows with the text and the font size", () => {
  assert.ok(estimateTextWidth("Sep 27") > estimateTextWidth("Sep 2"));
  assert.ok(estimateTextWidth("$14k", 13) > estimateTextWidth("$14k", 11));
  assert.equal(estimateTextWidth(""), 0);
});

test("placeLabels keeps every label inside the frame", () => {
  const items = [0, 100, 200].map((x) => ({ item: x, x, label: "Oct 12" }));
  const placed = placeLabels(items, 0, 200);
  assert.equal(placed.length, 3);
  const first = placed[0];
  const last = placed[placed.length - 1];
  assert.equal(first.anchor, "start", "a label at the left edge starts there");
  assert.equal(last.anchor, "end", "a label at the right edge ends there");
  for (const p of placed) {
    const w = estimateTextWidth("Oct 12");
    const left = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
    assert.ok(left >= 0 && left + w <= 200, `label at ${p.x} leaves the frame`);
  }
});

test("placeLabels drops a label rather than overlap the previous one", () => {
  const items = [10, 20, 30, 120].map((x) => ({ item: x, x: x + 40, label: "September 30" }));
  const placed = placeLabels(items, 0, 400);
  assert.deepEqual(
    placed.map((p) => p.item),
    [10, 120],
  );
});

test("labelBudget scales with width and stays within bounds", () => {
  assert.equal(labelBudget(100), 2);
  assert.equal(labelBudget(400), 4);
  assert.equal(labelBudget(5000), 6);
});

test("thinningStep spaces labels so they do not need dropping", () => {
  assert.equal(thinningStep(30, 100, 40), 1);
  assert.equal(thinningStep(30, 25, 38), 3);
  assert.equal(thinningStep(1, 5, 80), 1);
});

test("fitLabel shortens with an ellipsis, or gives up below three letters", () => {
  assert.equal(fitLabel("Akash", 200), "Akash");
  const short = fitLabel("Cosmos Hub", 44);
  assert.ok(short && short.endsWith("…") && estimateTextWidth(short) <= 44);
  assert.equal(fitLabel("Safrochain", 12), null);
});

test("columnPath rounds the data end and keeps the base square", () => {
  const up = columnPath(10, 20, 100, 40);
  assert.ok(up.startsWith("M10,100V44"), up);
  assert.match(up, /A4,4 0 0 1 14,40/);
  assert.ok(up.endsWith("V100Z"));

  const down = columnPath(10, 20, 100, 160);
  assert.match(down, /A4,4 0 0 0 14,160/, "negative bars round their bottom");

  const thin = columnPath(0, 4, 50, 49);
  assert.match(thin, /A1,1/, "the radius shrinks to fit a short, thin bar");

  assert.equal(columnPath(0, 10, 50, 50), "M0,50V50H10V50Z");
});

test("stepIndex walks, jumps and clears", () => {
  assert.equal(stepIndex("ArrowRight", null, 5), 4, "first press lands on the newest point");
  assert.equal(stepIndex("ArrowLeft", null, 5), 4);
  assert.equal(stepIndex("ArrowLeft", 3, 5), 2);
  assert.equal(stepIndex("ArrowLeft", 0, 5), 0);
  assert.equal(stepIndex("ArrowRight", 4, 5), 4);
  assert.equal(stepIndex("Home", 3, 5), 0);
  assert.equal(stepIndex("End", 0, 5), 4);
  assert.equal(stepIndex("PageUp", 40, 100), 30);
  assert.equal(stepIndex("PageDown", 95, 100), 99);
  assert.equal(stepIndex("Escape", 2, 5), null);
  assert.equal(stepIndex("Escape", null, 5), undefined, "Escape with nothing selected is not ours");
  assert.equal(stepIndex("Tab", 2, 5), undefined);
  assert.equal(stepIndex("ArrowLeft", null, 0), undefined);
});

test("lineCrossesBox follows segments between vertices, not just the vertices", () => {
  // A segment from (0, 0) to (100, 100) passes through (50, 50) with no vertex there.
  assert.equal(lineCrossesBox([0, 100], [0, 100], 45, 55, 45, 55), true);
  assert.equal(lineCrossesBox([0, 100], [0, 100], 45, 55, 70, 80), false);
  assert.equal(lineCrossesBox([0, 100], [0, 100], 200, 300, 0, 100), false);
  assert.equal(lineCrossesBox([50], [50], 40, 60, 40, 60), true);
});

const plot = { left: 0, right: 300, top: 0, bottom: 200 };

test("placeLineLabel puts the label on the side of the reference line the data is not", () => {
  // Data runs above the line (smaller y) at the right end: label goes below.
  const xs = [0, 150, 300];
  const ys = [100, 40, 30];
  const spot = placeLineLabel(xs, ys, 100, plot, 60);
  assert.ok(spot);
  assert.equal(spot.anchor, "end");
  assert.ok(spot.y > 100, "below the line");
});

test("placeLineLabel moves to the other end when the right end is crowded", () => {
  // The line zigzags across the reference line on the right, and is far above it on the left.
  const xs = [0, 30, 120, 200, 220, 240, 260, 280, 300];
  const ys = [20, 20, 20, 100, 60, 140, 60, 140, 100];
  const spot = placeLineLabel(xs, ys, 100, plot, 60);
  assert.ok(spot);
  assert.equal(spot.anchor, "start");
});

test("placeLineLabel gives up rather than overprint", () => {
  // A zigzag across the reference line everywhere.
  const xs = Array.from({ length: 61 }, (_, i) => i * 5);
  const ys = xs.map((_, i) => (i % 2 ? 70 : 130));
  assert.equal(placeLineLabel(xs, ys, 100, plot, 60), null);
});
