/** The coming-soon "Notify me" flag (src/components/coming-soon/notify.ts). */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { newNotifyFlag, notifyKey, readNotifyFlag } from "../notify";

describe("notify flag", () => {
  test("one storage key per page", () => {
    assert.equal(notifyKey("missions"), "zunia.dashboard.notify.missions");
    assert.equal(notifyKey("apps"), "zunia.dashboard.notify.apps");
  });

  test("round-trips through JSON", () => {
    const flag = newNotifyFlag(new Date("2026-10-07T10:00:00.000Z"));
    assert.deepEqual(readNotifyFlag(JSON.parse(JSON.stringify(flag))), { at: "2026-10-07T10:00:00.000Z" });
  });

  test("anything else reads as not set", () => {
    for (const value of [null, undefined, true, "yes", 1, {}, { at: 5 }, { at: "not a date" }]) {
      assert.equal(readNotifyFlag(value), null);
    }
  });
});
