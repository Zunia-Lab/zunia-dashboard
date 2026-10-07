/**
 * The toast queue: ids, in-place updates (loading → success), the cap, and
 * dismissal through the leaving phase.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_DURATION, MAX_TOASTS, createToastStore } from "../toast-store";

test("show appends with default durations per kind", () => {
  const store = createToastStore(0);
  const a = store.show("success", "Sent");
  const b = store.show("loading", "Submitting");
  const list = store.getSnapshot();
  assert.deepEqual(
    list.map((t) => [t.id, t.kind, t.duration]),
    [
      [a, "success", DEFAULT_DURATION.success],
      [b, "loading", null],
    ],
  );
});

test("reusing an id updates in place and bumps the version", () => {
  const store = createToastStore(0);
  store.show("info", "Other");
  const id = store.show("loading", "Submitting…", { id: "tx-1" });
  const before = store.getSnapshot().find((t) => t.id === id);
  store.show("success", "Confirmed", { id: "tx-1", action: { label: "View", href: "/activity/ABC" } });
  const list = store.getSnapshot();
  assert.equal(list.length, 2);
  const after = list.find((t) => t.id === "tx-1");
  assert.equal(after?.kind, "success");
  assert.equal(after?.message, "Confirmed");
  assert.equal(after?.action?.href, "/activity/ABC");
  assert.equal(after?.duration, DEFAULT_DURATION.success);
  assert.ok((after?.version ?? 0) > (before?.version ?? 0));
  assert.equal(list[1]?.id, "tx-1", "position kept");
});

test("the queue keeps the newest MAX_TOASTS", () => {
  const store = createToastStore(0);
  for (let i = 0; i < MAX_TOASTS + 2; i += 1) store.show("info", `n${i}`);
  const list = store.getSnapshot();
  assert.equal(list.length, MAX_TOASTS);
  assert.equal(list[0]?.message, "n2");
  assert.equal(list[list.length - 1]?.message, `n${MAX_TOASTS + 1}`);
});

test("the cap drops settled toasts before a pending (loading) one", () => {
  const store = createToastStore(0);
  store.show("loading", "Waiting for confirmation…", { id: "tx" });
  for (let i = 0; i < MAX_TOASTS + 1; i += 1) store.show("info", `n${i}`);
  const list = store.getSnapshot();
  assert.equal(list.length, MAX_TOASTS);
  assert.equal(list[0]?.id, "tx", "the pending transaction is still shown");
  assert.equal(list[list.length - 1]?.message, `n${MAX_TOASTS}`, "the newest is shown");
});

test("the cap never drops the toast just added, even among loading ones", () => {
  const store = createToastStore(0);
  for (let i = 0; i < MAX_TOASTS; i += 1) store.show("loading", `tx${i}`);
  store.show("success", "Done");
  const list = store.getSnapshot();
  assert.equal(list.length, MAX_TOASTS);
  assert.equal(list[list.length - 1]?.message, "Done");
  assert.equal(list[0]?.message, "tx1", "the oldest loading toast made room");
});

test("dismiss removes one or all, notifying subscribers", () => {
  const store = createToastStore(0);
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  const a = store.show("info", "a");
  store.show("info", "b");
  store.dismiss(a);
  assert.deepEqual(
    store.getSnapshot().map((t) => t.message),
    ["b"],
  );
  store.dismiss();
  assert.equal(store.getSnapshot().length, 0);
  off();
  store.show("info", "c");
  assert.ok(calls >= 4);
});

test("dismiss with an exit delay marks leaving first", async () => {
  const store = createToastStore(10);
  const id = store.show("error", "Failed", { duration: null });
  store.dismiss(id);
  assert.equal(store.getSnapshot()[0]?.leaving, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(store.getSnapshot().length, 0);
});

test("an update during the exit cancels the removal", async () => {
  const store = createToastStore(10);
  store.show("loading", "Submitting", { id: "x" });
  store.dismiss("x");
  store.show("success", "Done", { id: "x" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(store.getSnapshot()[0]?.message, "Done");
  assert.equal(store.getSnapshot()[0]?.leaving, false);
});
