/**
 * Disconnect is told to every tab of the site over a BroadcastChannel (Node
 * has the same API, so the real channel is used here, not a fake).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { announceDisconnect, onDisconnectAnnounced } from "../walletHint";

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test("a disconnect announced in one tab reaches the others", async () => {
  let heard = 0;
  const stop = onDisconnectAnnounced(() => {
    heard += 1;
  });
  announceDisconnect();
  await settle();
  assert.equal(heard, 1);
  stop();
  announceDisconnect();
  await settle();
  assert.equal(heard, 1, "an unsubscribed tab hears nothing");
});

test("other messages on the channel are ignored", async () => {
  let heard = 0;
  const stop = onDisconnectAnnounced(() => {
    heard += 1;
  });
  const stranger = new BroadcastChannel("zunia.dashboard.wallet");
  stranger.postMessage({ type: "connect" });
  stranger.postMessage("disconnect");
  stranger.postMessage(null);
  stranger.close();
  await settle();
  assert.equal(heard, 0);
  stop();
});
