/**
 * Meter bands. A status colour is a claim ("this is bad"), so the band
 * boundaries must be exactly where the caller put them, in both directions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Meter, meterLevel } from "../Meter";

test("without thresholds every value is ok", () => {
  assert.equal(meterLevel(0.99), "ok");
});

test("higher is worse by default, boundaries inclusive", () => {
  const t = { warning: 10, danger: 20 };
  assert.equal(meterLevel(5, t), "ok");
  assert.equal(meterLevel(10, t), "warning");
  assert.equal(meterLevel(19.9, t), "warning");
  assert.equal(meterLevel(20, t), "danger");
});

test("lower is worse when the direction says so (uptime)", () => {
  const t = { warning: 0.99, danger: 0.95, direction: "down" as const };
  assert.equal(meterLevel(0.999, t), "ok");
  assert.equal(meterLevel(0.972, t), "warning");
  assert.equal(meterLevel(0.95, t), "danger");
});

test("a single threshold and a broken value", () => {
  assert.equal(meterLevel(0.6, { danger: 0.5 }), "danger");
  assert.equal(meterLevel(Number.NaN, { warning: 1 }), "ok");
});

const valueNow = (value: number, max?: number) =>
  renderToStaticMarkup(createElement(Meter, { value, max })).match(/aria-valuenow="([^"]*)"/)?.[1];

test("aria-valuenow is a plain decimal, never exponent notation", () => {
  // A dust holding's share of a wallet: String(9.2e-9) is "9.2e-9".
  assert.equal(valueNow(9.2e-9), "0");
  assert.equal(valueNow(0.5), "0.5");
  assert.equal(valueNow(1.7), "1", "clamped to max");
  assert.equal(valueNow(82.9685, 100), "82.9685");
  assert.equal(valueNow(Number.NaN), undefined, "no value, no attribute");
});
