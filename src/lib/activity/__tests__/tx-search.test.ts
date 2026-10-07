/**
 * The tx search rules: the URL every node accepts, keyset paging that cannot
 * open a gap, and when a search is over.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextRead, readExhausted, searchClauses, searchUrl, SEARCH_PAGE_SIZE } from "../tx-search";
import { KeyBudget } from "../budget";

const ADDRESS = "lava@1q9xyutm3888xarak5zy8x95qkqhzece4v8a0j0";

describe("searchUrl", () => {
  it("orders by number (Lava's SDK 0.47 gateway refuses the enum name) and pages by limit/page", () => {
    const url = searchUrl("https://lcd.example", { address: ADDRESS, condition: "sender", upper: 1200, lower: null, page: 1 }, "query");
    assert.equal(
      url,
      `https://lcd.example/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(`message.sender='${ADDRESS}' AND tx.height<=1200`)}&order_by=2&limit=${SEARCH_PAGE_SIZE}&page=1`,
    );
    assert.ok(!url.includes("ORDER_BY_DESC"));
    assert.ok(!url.includes("pagination.limit"));
  });

  it("spells SDK 0.47 searches as one `events=` per clause", () => {
    const url = searchUrl("https://lcd.example", { address: "kava1x", condition: "recipient", upper: null, lower: 900, page: 2 }, "events");
    assert.equal(
      url,
      `https://lcd.example/cosmos/tx/v1beta1/txs?events=${encodeURIComponent("transfer.recipient='kava1x'")}&events=${encodeURIComponent("tx.height>=900")}&order_by=2&limit=${SEARCH_PAGE_SIZE}&page=2`,
    );
    assert.deepEqual(searchClauses({ address: "kava1x", condition: "recipient", upper: null, lower: null, page: 1 }), ["transfer.recipient='kava1x'"]);
  });
});

describe("nextRead", () => {
  it("continues by height from the lowest row, never by offset", () => {
    assert.deepEqual(nextRead({ upper: null, page: 1 }, 900), { upper: 900, page: 1 });
    assert.deepEqual(nextRead({ upper: 1000, page: 1 }, 950), { upper: 950, page: 1 });
  });

  it("falls back to the next offset page only when a whole page sits at the bound", () => {
    assert.deepEqual(nextRead({ upper: 950, page: 1 }, 950), { upper: 950, page: 2 });
    assert.deepEqual(nextRead({ upper: 950, page: 2 }, 950), { upper: 950, page: 3 });
    assert.deepEqual(nextRead({ upper: 950, page: 3 }, 940), { upper: 940, page: 1 });
  });
});

describe("readExhausted", () => {
  it("trusts the node's total only when it agrees with what came back", () => {
    assert.equal(readExhausted(0, null, 1), true);
    assert.equal(readExhausted(12, null, 1), true);
    assert.equal(readExhausted(50, null, 1), false);
    assert.equal(readExhausted(50, 50, 1), true);
    assert.equal(readExhausted(50, 51, 1), false);
    assert.equal(readExhausted(50, 100, 2), true);
    // A node answering "0" beside a full page: the page wins.
    assert.equal(readExhausted(50, 0, 1), false);
    // A node capping pages below our limit: 20 of 30 is not the end.
    assert.equal(readExhausted(20, 30, 1), false);
  });
});

describe("KeyBudget", () => {
  it("evicts least recently used keys past the byte or key budget, never the one just used", () => {
    const budget = new KeyBudget(100, 3);
    assert.deepEqual(budget.touch("a", 40), []);
    assert.deepEqual(budget.touch("b", 40), []);
    assert.deepEqual(budget.touch("a", 40), [], "touching refreshes recency");
    assert.deepEqual(budget.touch("c", 40), ["b"]);
    assert.equal(budget.bytes, 80);
    assert.deepEqual(budget.touch("d", 10), []);
    assert.deepEqual(budget.touch("e", 10), ["a"], "key budget");
    assert.deepEqual(budget.touch("huge", 500), ["c", "d", "e"]);
    assert.equal(budget.keys, 1);
    assert.deepEqual(budget.forgetPrefix("hu"), ["huge"]);
    assert.equal(budget.bytes, 0);
  });
});
