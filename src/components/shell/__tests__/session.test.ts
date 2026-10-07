/**
 * The session wording the account panel and Live share.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { networksShared, phoneSessionLine } from "../session";

const NOW = 1_800_000_000_000;

test("a live phone session says when it ends, in whole minutes", () => {
  assert.equal(phoneSessionLine("connected", NOW + (22 * 3600 + 46 * 60 + 20) * 1000, NOW), "Connected · ends in 22 h 46 min");
  assert.equal(phoneSessionLine("connected", NOW + 45 * 60_000 + 40_000, NOW), "Connected · ends in 46 min");
  assert.equal(phoneSessionLine("connected", NOW + 30_000, NOW), "Connected · ends in under a minute");
  // Past the end but not yet dropped by the relay: still only "under a minute".
  assert.equal(phoneSessionLine("connected", NOW - 5_000, NOW), "Connected · ends in under a minute");
});

test("without a clock or an expiry the line only says connected", () => {
  assert.equal(phoneSessionLine("connected", NOW + 3_600_000, null), "Connected");
  assert.equal(phoneSessionLine("connected", undefined, NOW), "Connected");
});

test("other phone states", () => {
  assert.equal(phoneSessionLine("reconnecting", NOW + 3_600_000, NOW), "Reconnecting to your phone…");
  assert.equal(phoneSessionLine("idle", undefined, NOW), "Phone not connected");
  assert.equal(phoneSessionLine("error", undefined, NOW), "Phone not connected");
});

test("networks shared", () => {
  assert.equal(networksShared(1), "1 network shared");
  assert.equal(networksShared(5), "5 networks shared");
  assert.equal(networksShared(0), "0 networks shared");
});
