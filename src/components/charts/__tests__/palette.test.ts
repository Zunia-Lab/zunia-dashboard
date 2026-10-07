/**
 * Colour assignment. The rule under test: colour follows the entity, in a
 * fixed slot order, and nothing past the sixth slot ever gets a hue of its
 * own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { colorFor, stableColorMap, VIZ_OTHER, VIZ_SLOT_COUNT, VIZ_SLOTS } from "../palette";

test("slots are handed out in the order given", () => {
  const map = stableColorMap(["cosmoshub-4", "osmosis-1", "celestia"]);
  assert.equal(map.get("cosmoshub-4"), "var(--viz-1)");
  assert.equal(map.get("osmosis-1"), "var(--viz-2)");
  assert.equal(map.get("celestia"), "var(--viz-3)");
  assert.equal(map.size, 3);
});

test("six validated slots, in order", () => {
  assert.equal(VIZ_SLOT_COUNT, 6);
  assert.deepEqual(VIZ_SLOTS, [1, 2, 3, 4, 5, 6].map((n) => `var(--viz-${n})`));
});

test("everything past the sixth entity wears the Other grey, never a new hue", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `chain-${i}`);
  const map = stableColorMap(ids);
  assert.deepEqual(
    ids.slice(0, 6).map((id) => map.get(id)),
    VIZ_SLOTS,
  );
  for (const id of ids.slice(6)) assert.equal(map.get(id), VIZ_OTHER);
});

test("a filtered view keeps the colours of the full list", () => {
  const full = stableColorMap(["a", "b", "c", "d"]);
  // The page hides "b": the survivors must not be repainted.
  const visible = ["a", "c", "d"].map((id) => colorFor(id, undefined, full));
  assert.deepEqual(visible, ["var(--viz-1)", "var(--viz-3)", "var(--viz-4)"]);
});

test("duplicates keep their first slot and do not consume another", () => {
  const map = stableColorMap(["a", "b", "a", "c"]);
  assert.equal(map.get("a"), "var(--viz-1)");
  assert.equal(map.get("c"), "var(--viz-3)");
});

test("colorFor prefers an explicit colour and falls back to grey", () => {
  const map = stableColorMap(["a"]);
  assert.equal(colorFor("a", "var(--viz-accent)", map), "var(--viz-accent)");
  assert.equal(colorFor("a", undefined, map), "var(--viz-1)");
  assert.equal(colorFor("zzz", undefined, map), VIZ_OTHER);
  assert.equal(colorFor("a", undefined, undefined), VIZ_OTHER);
});
