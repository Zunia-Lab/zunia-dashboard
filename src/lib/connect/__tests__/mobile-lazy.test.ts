/**
 * `MobileConnect` with no injected transport: the SDK is imported on first
 * use (it is not in the page bundle), and that load is a wait like any other —
 * a cancel, a disconnect or a second `start()` during it must leave no relay
 * session behind and no second attempt running.
 *
 * `fetch` is stubbed: the only request the real transport makes before a
 * socket exists is `POST /v1/connect/sessions`, so "no call" means "no relay
 * session was created". Its own process (node --test runs each file apart), so
 * the stub touches nothing else.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MobileConnect } from "../mobile";

const META = { name: "Zunia Dashboard", url: "https://wallet.zunialab.com" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const calls: string[] = [];
globalThis.fetch = (async (url: string | URL) => {
  calls.push(String(url));
  throw new TypeError("fetch failed");
}) as typeof fetch;

test("cancel while the SDK loads: no relay session is created", async () => {
  calls.length = 0;
  const mobile = new MobileConnect({ apiBase: "https://relay.example" });
  const started = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.equal(mobile.getSnapshot().status, "creating");
  const again = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.equal(started, again, "a second start during the load joins the first");
  await mobile.cancel();
  await started;
  await settle();
  assert.equal(mobile.getSnapshot().status, "idle");
  assert.deepEqual(calls, [], "no POST /v1/connect/sessions after a cancel");
});

test("without a cancel, the loaded transport asks the relay once", async () => {
  calls.length = 0;
  const mobile = new MobileConnect({ apiBase: "https://relay.example" });
  const first = mobile.start({ chains: ["safrochain-1"], metadata: META });
  const second = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.equal(first, second);
  await assert.rejects(first);
  assert.equal(calls.length, 1, String(calls));
  assert.match(calls[0], /relay\.example\/v1\/connect\/sessions/);
  assert.equal(mobile.getSnapshot().status, "error");
});

test("disconnect while the SDK loads: nothing is created", async () => {
  calls.length = 0;
  const mobile = new MobileConnect({ apiBase: "https://relay.example" });
  const started = mobile.start({ chains: ["safrochain-1"], metadata: META });
  await mobile.disconnect();
  await started;
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(mobile.getSnapshot().status, "idle");
});

test("restore through the loader with nothing saved: false, idle", async () => {
  const mobile = new MobileConnect({ apiBase: "https://relay.example" });
  assert.equal(await mobile.restore(), false);
  assert.equal(mobile.getSnapshot().status, "idle");
});
