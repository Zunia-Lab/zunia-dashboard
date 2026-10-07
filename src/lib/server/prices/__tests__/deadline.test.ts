/**
 * Time budgets: a request stops waiting, the work does not stop, and a late
 * failure never becomes an unhandled rejection.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { within } from "../deadline";

describe("within", () => {
  it("hands over a value that arrives in time", async () => {
    assert.deepEqual(await within(Promise.resolve(7), 50), { done: true, value: 7 });
  });

  it("stops waiting at the budget while the work runs on", async () => {
    let finished = false;
    const work = new Promise<number>((resolve) =>
      setTimeout(() => {
        finished = true;
        resolve(1);
      }, 40),
    );
    assert.deepEqual(await within(work, 5), { done: false });
    assert.equal(finished, false);
    assert.equal(await work, 1, "the work itself still completes (and fills its cache)");
    assert.equal(finished, true);
  });

  it("rejects with a failure inside the budget and swallows one after it", async () => {
    await assert.rejects(within(Promise.reject(new Error("boom")), 50), /boom/);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const late = new Promise<number>((_, reject) => setTimeout(() => reject(new Error("late")), 20));
      assert.deepEqual(await within(late, 1), { done: false });
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
