/**
 * Roving focus: arrows wrap, Home / End jump to the first / last enabled
 * item, disabled items are skipped, other keys do nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { nextRovingIndex } from "../roving";

test("arrows step and wrap", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextRovingIndex("ArrowDown", 2, 3), 0);
  assert.equal(nextRovingIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextRovingIndex("ArrowUp", 1, 3), 0);
});

test("Home and End jump to the ends", () => {
  assert.equal(nextRovingIndex("Home", 2, 4), 0);
  assert.equal(nextRovingIndex("End", 0, 4), 3);
});

test("disabled items are skipped, all-disabled gives null", () => {
  const disabled = (i: number) => i === 1 || i === 3;
  assert.equal(nextRovingIndex("ArrowRight", 0, 4, disabled), 2);
  assert.equal(nextRovingIndex("ArrowRight", 2, 4, disabled), 0);
  assert.equal(nextRovingIndex("End", 0, 4, disabled), 2);
  assert.equal(nextRovingIndex("Home", 2, 4, (i) => i === 0), 1);
  assert.equal(nextRovingIndex("ArrowRight", 0, 2, () => true), null);
});

test("other keys and empty groups do nothing", () => {
  assert.equal(nextRovingIndex("Enter", 0, 3), null);
  assert.equal(nextRovingIndex("a", 0, 3), null);
  assert.equal(nextRovingIndex("ArrowRight", 0, 0), null);
});
