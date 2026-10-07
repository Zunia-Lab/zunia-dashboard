/**
 * The Chains table's request plan. What matters: rows already loaded are
 * never asked for again, URLs of planned chunks never change (so the cache
 * keeps serving them), retries get a URL of their own, and the plan never
 * exceeds the slots the page holds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { planChunks, timedOutIds } from "../stats-plan";

const opts = { chunkSize: 3, maxSlots: 4 };

test("first plan splits the ids on screen into chunks", () => {
  assert.deepEqual(planChunks([], ["a", "b", "c", "d"], opts), [["a", "b", "c"], ["d"]]);
});

test("nothing new on screen returns the same array (no state change)", () => {
  const chunks = [["a", "b", "c"]];
  assert.equal(planChunks(chunks, ["c", "a"], opts), chunks);
  assert.equal(planChunks(chunks, [], opts), chunks);
});

test("new ids become new chunks; planned chunks keep their ids", () => {
  const first = planChunks([], ["a", "b", "c"], opts);
  const next = planChunks(first, ["a", "b", "c", "d", "e"], opts);
  assert.deepEqual(next, [["a", "b", "c"], ["d", "e"]]);
  assert.equal(next[0], first[0]);
});

test("a search that shows loaded rows asks for nothing", () => {
  const chunks = [["a", "b", "c"], ["d", "e"]];
  assert.equal(planChunks(chunks, ["e", "b"], opts), chunks);
});

test("uncovered ids already planned are retried in reverse order", () => {
  const chunks = [["a", "b", "c"]];
  const covered = (id: string) => id === "a";
  assert.deepEqual(planChunks(chunks, ["a", "b", "c"], opts, covered), [["a", "b", "c"], ["c", "b"]]);
});

test("when slots run out, chunks with nothing on screen go first", () => {
  const chunks = [["a"], ["b"], ["c"], ["d"]];
  const next = planChunks(chunks, ["b", "x"], opts);
  assert.deepEqual(next, [["b"], ["x"]]);
});

test("beyond repair, the plan restarts from what is on screen", () => {
  const chunks = [["a"], ["b"], ["c"], ["d"]];
  const wanted = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"];
  const next = planChunks(chunks, wanted, opts);
  assert.deepEqual(next, [["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"], ["j", "k", "l"]]);
  assert.ok(next.length <= opts.maxSlots);
});

test("duplicates and empty ids in the wanted list are ignored", () => {
  assert.deepEqual(planChunks([], ["a", "", "a", "b"], opts), [["a", "b"]]);
});

test("timedOutIds reads the route's per-chain timeout errors", () => {
  const asked = ["a", "b", "c", "d"];
  const answered = [{ chainId: "a" }, { chainId: "c" }];
  const errors = [
    { chainId: "b", scope: "chain" },
    { chainId: "c", scope: "mint" },
    { scope: "input" },
  ];
  assert.deepEqual(timedOutIds(asked, answered, errors), ["b"]);
  assert.deepEqual(timedOutIds(asked, answered, undefined), []);
});
