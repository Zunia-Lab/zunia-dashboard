/**
 * Compare's shareable list and its figures. A shared link must open the same
 * comparison (or the closest sensible one when it is stale), "best" must
 * never crown a lone value or a tie of everyone, and the risk numbers must
 * match the textbook definitions on series we can check by hand.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_REFS,
  MAX_ENTITIES,
  bestIndexes,
  commonStart,
  compareHref,
  parseIds,
  performance,
  refKey,
  sameRefs,
  serializeIds,
} from "../model";

test("parseIds reads chains and assets whose keys contain colons and slashes", () => {
  const refs = parseIds("chain:osmosis-1,asset:cosmoshub-4:uatom,asset:osmosis-1:factory/osmo1abc/alloyed/allUSDC");
  assert.deepEqual(refs, [
    { kind: "chain", id: "osmosis-1" },
    { kind: "asset", id: "cosmoshub-4:uatom" },
    { kind: "asset", id: "osmosis-1:factory/osmo1abc/alloyed/allUSDC" },
  ]);
});

test("parseIds drops junk, duplicates, rejected entries and anything past four", () => {
  const raw = "chain:a,,nope:b,chain:,chain:a, chain:b ,asset:x,chain:c,chain:d,chain:e";
  const refs = parseIds(raw, (ref) => ref.id !== "x");
  assert.deepEqual(refs.map(refKey), ["chain:a", "chain:b", "chain:c", "chain:d"]);
  assert.equal(refs.length, MAX_ENTITIES);
  assert.deepEqual(parseIds(null), []);
  assert.deepEqual(parseIds(""), []);
});

test("serializeIds round-trips and stays readable", () => {
  const refs = parseIds("chain:osmosis-1,asset:osmosis-1:factory/osmo1abc/alloyed/allUSDC");
  const text = serializeIds(refs);
  assert.equal(text, "chain:osmosis-1,asset:osmosis-1:factory/osmo1abc/alloyed/allUSDC");
  assert.ok(sameRefs(parseIds(text), refs));
  assert.equal(compareHref(DEFAULT_REFS), "/compare?ids=chain:safrochain-1,chain:cosmoshub-4,chain:osmosis-1,chain:celestia");
  assert.equal(compareHref([]), "/compare");
  // A comma inside an id would split it: it is encoded instead.
  assert.equal(serializeIds([{ kind: "asset", id: "a,b" }]), "asset:a%2Cb");
});

test("bestIndexes needs two known values and a difference", () => {
  assert.deepEqual([...bestIndexes([0.05, 0.068, null, -0.03], "max")], [1]);
  assert.deepEqual([...bestIndexes([21, 14, 14, null], "min")], [1, 2]);
  assert.deepEqual([...bestIndexes([14, 14, 14], "min")], []);
  assert.deepEqual([...bestIndexes([0.2, null, undefined], "max")], []);
  assert.deepEqual([...bestIndexes([], "max")], []);
});

const DAY = 24 * 3600 * 1000;

test("performance: change, drawdown from the running peak, annualised volatility", () => {
  const series = [100, 120, 90, 110, 130].map((v, i) => ({ t: i * DAY, v }));
  const perf = performance(series);
  assert.equal(Math.round((perf.change ?? 0) * 1000) / 1000, 0.3);
  // Peak 120 → trough 90 is −25 %.
  assert.equal(perf.maxDrawdown, 90 / 120 - 1);
  assert.equal(perf.from, 0);
  assert.equal(perf.to, 4 * DAY);

  const logs = [120 / 100, 90 / 120, 110 / 90, 130 / 110].map(Math.log);
  const mean = logs.reduce((s, r) => s + r, 0) / logs.length;
  const sd = Math.sqrt(logs.reduce((s, r) => s + (r - mean) ** 2, 0) / (logs.length - 1));
  assert.ok(Math.abs((perf.volatility ?? 0) - sd * Math.sqrt(365)) < 1e-9);
});

test("performance starts at the common start and ignores bad samples", () => {
  const series = [
    { t: 0, v: 50 },
    { t: DAY, v: 100 },
    { t: 2 * DAY, v: Number.NaN },
    { t: 3 * DAY, v: 0 },
    { t: 4 * DAY, v: 80 },
  ];
  const perf = performance(series, DAY);
  assert.equal(perf.change, 80 / 100 - 1);
  assert.equal(perf.maxDrawdown, 80 / 100 - 1);
  // Two usable samples: a change, but too few returns for a volatility.
  assert.equal(perf.volatility, null);
  assert.equal(performance([]).change, null);
  assert.equal(performance([{ t: 1, v: 2 }]).from, 1);
});

test("commonStart is the latest first sample, as the indexed chart uses", () => {
  const a = [{ t: 10, v: 1 }, { t: 20, v: 1 }];
  const b = [{ t: 15, v: 2 }];
  assert.equal(commonStart([a, b, []]), 15);
  assert.equal(commonStart([[], []]), null);
});
