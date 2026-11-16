/**
 * The post-swap balance watch (../balance-watch.ts) and the retry runner
 * (../../retry-run.ts), with a fake clock: no real waiting.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { liquidBalance, watchBalance, WATCH_INTERVAL_MS, WATCH_WINDOW_MS } from "../balance-watch";
import { runRetry } from "../../retry-run";

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("liquidBalance", () => {
  const assets = [{ chainId: "osmosis-1", identity: { denom: "uosmo" }, amounts: { liquid: "42" } }];
  test("reads the liquid amount, 0 for a token not held", () => {
    assert.equal(liquidBalance(assets, "osmosis-1", "uosmo"), "42");
    assert.equal(liquidBalance(assets, "cosmoshub-4", "uatom"), "0");
  });
});

describe("watchBalance", () => {
  test("stops as soon as the balance changes", async () => {
    const c = clock();
    const reads = ["10", "10", "25", "99"];
    let calls = 0;
    const end = await watchBalance({
      read: async () => reads[calls++] ?? null,
      baseline: "10",
      isFinished: () => false,
      isCancelled: () => false,
      ...c,
    });
    assert.equal(end, "changed");
    assert.equal(calls, 3);
    assert.equal(c.now(), 2 * WATCH_INTERVAL_MS);
  });

  test("stops when the tracker reports the swap over, even if nothing moved", async () => {
    const c = clock();
    let finished = false;
    let calls = 0;
    const end = await watchBalance({
      read: async () => {
        calls += 1;
        if (calls === 2) finished = true;
        return "10";
      },
      baseline: "10",
      isFinished: () => finished,
      isCancelled: () => false,
      ...c,
    });
    assert.equal(end, "finished");
    assert.equal(calls, 2);
  });

  test("gives up after the window, reading every interval", async () => {
    const c = clock();
    let calls = 0;
    const end = await watchBalance({
      read: async () => {
        calls += 1;
        return "10";
      },
      baseline: "10",
      isFinished: () => false,
      isCancelled: () => false,
      ...c,
    });
    assert.equal(end, "timeout");
    // One read at 0 s, then one per interval while another interval still fits.
    assert.equal(calls, Math.floor(WATCH_WINDOW_MS / WATCH_INTERVAL_MS) + 1);
    assert.ok(c.now() <= WATCH_WINDOW_MS);
  });

  test("a failed read is not a change and is tried again", async () => {
    const c = clock();
    const reads: (string | null)[] = [null, null, "7"];
    let calls = 0;
    const end = await watchBalance({
      read: async () => {
        const value = reads[calls];
        calls += 1;
        return value === undefined ? "7" : value;
      },
      baseline: "5",
      isFinished: () => false,
      isCancelled: () => false,
      ...c,
    });
    assert.equal(end, "changed");
    assert.equal(calls, 3);
  });

  test("without a baseline the first read becomes one", async () => {
    const c = clock();
    const reads = ["3", "3", "4"];
    let calls = 0;
    const end = await watchBalance({
      read: async () => reads[calls++] ?? "4",
      baseline: null,
      isFinished: () => false,
      isCancelled: () => false,
      ...c,
    });
    assert.equal(end, "changed");
    assert.equal(calls, 3);
  });

  test("cancelling ends it", async () => {
    const c = clock();
    const end = await watchBalance({ read: async () => "1", baseline: "1", isFinished: () => false, isCancelled: () => true, ...c });
    assert.equal(end, "cancelled");
  });
});

describe("runRetry", () => {
  test("lasts at least minMs even when the action fails at once", async () => {
    const slept: number[] = [];
    let ran = false;
    await runRetry(
      () => {
        ran = true;
        throw new Error("down");
      },
      { minMs: 600, sleep: async (ms) => void slept.push(ms) },
    );
    assert.ok(ran);
    assert.deepEqual(slept, [600]);
  });

  test("waits for the action's promise", async () => {
    let settled = false;
    await runRetry(async () => {
      await Promise.resolve();
      settled = true;
    }, { minMs: 0, sleep: async () => {} });
    assert.ok(settled);
  });
});
