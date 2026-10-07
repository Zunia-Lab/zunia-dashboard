/**
 * Palette matching: prefix > word start > substring > subsequence; labels
 * outrank keywords and details; every query word must match.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { matchScore, normalize, rankMatches, wordScore } from "../palette-search";

test("normalize folds case, accents and punctuation", () => {
  assert.equal(normalize("  Réseau-Test_1 "), "reseau test 1");
  assert.equal(normalize("USDC.n"), "usdc n");
});

test("wordScore: prefix > word start > inside > subsequence > nothing", () => {
  const prefix = wordScore("cos", "cosmos hub")!;
  const wordStart = wordScore("hub", "cosmos hub")!;
  const inside = wordScore("smo", "cosmos hub")!;
  const sequence = wordScore("cmh", "cosmos hub")!;
  assert.ok(prefix > wordStart, "prefix beats word start");
  assert.ok(wordStart > inside, "word start beats inside");
  assert.ok(inside > sequence, "inside beats subsequence");
  assert.equal(wordScore("xyz", "cosmos hub"), null);
  assert.equal(wordScore("", "anything"), 0);
});

test("wordScore: a tighter label wins among prefixes", () => {
  assert.ok(wordScore("swap", "swap")! > wordScore("swap", "swap any pair osmosis trades")!);
});

test("matchScore: all words must match, labels outrank keywords and details", () => {
  const swapPage = { label: "Swap", keywords: ["exchange", "trade"], detail: "Swap any pair Osmosis trades" };
  const osmosis = { label: "Osmosis", keywords: ["OSMO"], detail: "osmosis-1 · DEX where swaps happen" };
  assert.ok(matchScore("swap", swapPage)! > matchScore("swap", osmosis)!);
  assert.equal(matchScore("swap mars", swapPage), null);
  assert.ok(matchScore("osmo trades", swapPage)! > 0);
  assert.equal(matchScore("   ", swapPage), 0);
});

test("rankMatches: best first, stable ties, limit, empty query keeps order", () => {
  const items = [{ label: "Staking" }, { label: "Settings" }, { label: "Send" }, { label: "Stake more" }];
  assert.deepEqual(
    rankMatches("stak", items, (item) => item).map((item) => item.label),
    ["Staking", "Stake more"],
  );
  // Prefixes first; "Stake more" only matches as a subsequence (s…e).
  assert.deepEqual(
    rankMatches("se", items, (item) => item).map((item) => item.label),
    ["Send", "Settings", "Stake more"],
  );
  assert.deepEqual(rankMatches("", items, (item) => item, 2), items.slice(0, 2));
  assert.deepEqual(
    rankMatches("s", items, (item) => item, 1).map((item) => item.label),
    ["Send"],
  );
});
