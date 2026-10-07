/**
 * Two reads of an account's newest search page, answered by nodes behind one
 * public endpoint: do they describe the same history?
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { observationAfter, tipReadsDisagree, type TipObservation } from "../consistency";

const PAGE = 50;
const before: TipObservation = { total: 14, maxHeight: 1_000 };

describe("tipReadsDisagree", () => {
  it("agrees when nothing changed, or only new transactions arrived", () => {
    assert.equal(tipReadsDisagree(before, { total: 14, heights: [1_000, 990, 980], pageSize: PAGE }), false);
    assert.equal(tipReadsDisagree(before, { total: 16, heights: [1_020, 1_010, 1_000], pageSize: PAGE }), false);
  });

  it("disagrees when a later read knows fewer transactions (a node keeping less)", () => {
    // The reported case: 14 sends, then 2, seconds apart.
    assert.equal(tipReadsDisagree(before, { total: 2, heights: [1_000, 990], pageSize: PAGE }), true);
  });

  it("disagrees when more appeared than the new transactions explain (the first node kept less)", () => {
    const small: TipObservation = { total: 2, maxHeight: 1_000 };
    assert.equal(tipReadsDisagree(small, { total: 14, heights: [1_000, 990, 980], pageSize: PAGE }), true);
  });

  it("cannot judge a page made entirely of new transactions, or a node that gave no total", () => {
    const full = Array.from({ length: PAGE }, (_, i) => 2_000 - i);
    assert.equal(tipReadsDisagree(before, { total: 500, heights: full, pageSize: PAGE }), false);
    assert.equal(tipReadsDisagree(before, { total: null, heights: [1_000], pageSize: PAGE }), false);
  });
});

describe("observationAfter", () => {
  it("keeps the latest total and the highest height either read saw", () => {
    assert.deepEqual(observationAfter(before, { total: 15, heights: [1_010, 900], pageSize: PAGE }), { total: 15, maxHeight: 1_010 });
    assert.deepEqual(observationAfter(before, { total: 15, heights: [], pageSize: PAGE }), { total: 15, maxHeight: 1_000 });
    assert.deepEqual(observationAfter(null, { total: 3, heights: [7, 9], pageSize: PAGE }), { total: 3, maxHeight: 9 });
    assert.equal(observationAfter(before, { total: null, heights: [5], pageSize: PAGE }), before);
  });
});
