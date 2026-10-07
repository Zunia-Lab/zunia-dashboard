/**
 * What the browser keeps of a `/api/prices/history` answer, and in
 * particular the `note` a EUR or GBP series carries: the route converts USD
 * history at today's rate, and the asset chart prints that caveat under the
 * chart, so the reader must not drop it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readPriceHistoryResponse } from "../wire";

const BASE = {
  key: "cosmoshub-4:uatom",
  range: "30D",
  currency: "eur",
  resolution: "day",
  points: [
    { t: 1, v: 1.5 },
    { t: 2, v: 1.6 },
  ],
  source: "numia",
  label: "Numia · Osmosis",
  coverage: { from: 1, to: 2, points: 2, complete: true },
  updatedAt: 3,
};

describe("price history narrowing", () => {
  it("keeps the note of a series converted at today's rate", () => {
    const history = readPriceHistoryResponse({ ...BASE, note: "USD price history converted at today's EUR rate" });
    assert.ok(history);
    assert.equal(history.note, "USD price history converted at today's EUR rate");
    assert.equal(history.currency, "eur");
    assert.equal(history.points.length, 2);
  });

  it("has no note in USD, nor for an empty or malformed one", () => {
    assert.equal(readPriceHistoryResponse({ ...BASE, currency: "usd" })?.note, undefined);
    assert.equal(readPriceHistoryResponse({ ...BASE, note: "" })?.note, undefined);
    assert.equal(readPriceHistoryResponse({ ...BASE, note: 42 })?.note, undefined);
    // Absent, not `undefined`-valued: the key itself is left out.
    assert.equal("note" in (readPriceHistoryResponse({ ...BASE, note: null }) ?? {}), false);
  });

  it("still refuses an answer without its key fields", () => {
    assert.equal(readPriceHistoryResponse({ ...BASE, key: undefined }), null);
    assert.equal(readPriceHistoryResponse({ ...BASE, coverage: null }), null);
  });
});
