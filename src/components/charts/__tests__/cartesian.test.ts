/**
 * The shared time-chart frame. What it promises: the plot and its axis band
 * fit the height it is given, labels never leave the frame, a lone sample
 * still gets a place and a date, and daily UTC data is labelled on UTC days.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTimeFrame } from "../cartesian";
import { estimateTextWidth, X_AXIS_BAND } from "../layout";
import { DAY_MS } from "../ticks";

const base = {
  width: 600,
  height: 240,
  yMin: 10,
  yMax: 20,
  yAxis: "left" as const,
};

test("the plot and the x-axis band fit inside the given height", () => {
  const frame = buildTimeFrame({ ...base, tStart: 0, tEnd: 30 * DAY_MS, utc: true });
  assert.equal(frame.plot.bottom, base.height - X_AXIS_BAND);
  assert.ok(frame.xLabelY < base.height, "x labels sit inside the frame, not under it");
  for (const label of frame.xLabels) {
    const w = estimateTextWidth(label.label);
    const left = label.anchor === "start" ? label.x : label.anchor === "end" ? label.x - w : label.x - w / 2;
    assert.ok(left >= 0 && left + w <= base.width, `${label.label} leaves the frame`);
  }
  for (const tick of frame.yTicks) {
    assert.ok(tick.y >= frame.plot.top && tick.y <= frame.plot.bottom, `${tick.label} outside the plot`);
  }
});

test("a single sample sits mid-plot with its date under it", () => {
  const t = Date.UTC(2026, 9, 7);
  const frame = buildTimeFrame({ ...base, yMin: 1.79, yMax: 1.79, tStart: t, tEnd: t, utc: true });
  const mid = (frame.plot.left + frame.plot.right) / 2;
  assert.ok(Math.abs(frame.x(t) - mid) < 1e-9);
  assert.deepEqual(
    frame.xLabels.map((l) => l.label),
    ["Oct 7"],
  );
  const y = frame.y(1.79);
  assert.ok(y > frame.plot.top && y < frame.plot.bottom, "a flat value gets a range around it");
});

test("daily UTC buckets are labelled on UTC days", () => {
  const end = Date.UTC(2026, 9, 7);
  const frame = buildTimeFrame({ ...base, tStart: end - 6 * DAY_MS, tEnd: end, utc: true });
  for (const label of frame.xLabels) {
    assert.equal(new Date(label.key as number).getUTCHours(), 0, "ticks on UTC midnights");
  }
  assert.equal(frame.xLabels.at(-1)?.label, "Oct 7");
});

test("compact frames drop the axes and keep the end dot inside", () => {
  const frame = buildTimeFrame({ ...base, height: 56, compact: true, tStart: 0, tEnd: DAY_MS });
  assert.deepEqual(frame.xLabels, []);
  assert.ok(frame.plot.right < base.width, "room for the end dot's ring");
  assert.ok(frame.plot.top > 0 && frame.plot.bottom < 56);
});
