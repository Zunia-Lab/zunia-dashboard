/**
 * Disconnect is told to every tab of the site over a BroadcastChannel (Node
 * has the same API, so the real channel is used here, not a fake).
 *
 * No fixed sleeps: a channel message reaches its listeners through the event
 * loop's poll phase, and under CPU contention (the whole suite runs files in
 * parallel) a 30 ms timer can fire before that phase has run, so a sleep
 * "proves" nothing arrived when it simply had not arrived yet. Each test waits
 * for a message it knows must come (a witness listener, or the handler itself),
 * and messages from one sender arrive in order, so everything posted before
 * that message has been delivered too. Every channel is closed in `finally`:
 * an open BroadcastChannel keeps the test process alive, which turned one
 * failed assertion into a 10-minute hang of the whole run.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { announceDisconnect, onDisconnectAnnounced } from "../walletHint";

const CHANNEL = "zunia.dashboard.wallet";

/** Resolves on the next message `channel` receives; rejects after `ms` so a lost message fails instead of hanging. */
function nextMessage(channel: BroadcastChannel, ms = 5_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no message on ${CHANNEL} within ${ms} ms`)), ms);
    channel.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      channel.onmessage = null;
      resolve(event.data);
    };
  });
}

test("a disconnect announced in one tab reaches the others", async () => {
  let heard = 0;
  let resolveHeard: () => void = () => {};
  const firstHeard = new Promise<void>((resolve) => {
    resolveHeard = resolve;
  });
  const stop = onDisconnectAnnounced(() => {
    heard += 1;
    resolveHeard();
  });
  let witness: BroadcastChannel | null = null;
  try {
    announceDisconnect();
    await firstHeard;
    assert.equal(heard, 1);
    stop();
    // Another tab, opened only now so the one message it gets is the second
    // announcement: once it has that, a still-subscribed handler would have
    // had it as well (one dispatch reaches every open channel).
    witness = new BroadcastChannel(CHANNEL);
    const witnessed = nextMessage(witness);
    announceDisconnect();
    assert.deepEqual(await witnessed, { type: "disconnect" });
    assert.equal(heard, 1, "an unsubscribed tab hears nothing");
  } finally {
    stop();
    witness?.close();
  }
});

test("other messages on the channel are ignored", async () => {
  const heard: number[] = [];
  let resolveHeard: () => void = () => {};
  const disconnectHeard = new Promise<void>((resolve) => {
    resolveHeard = resolve;
  });
  const stop = onDisconnectAnnounced(() => {
    heard.push(Date.now());
    resolveHeard();
  });
  const stranger = new BroadcastChannel(CHANNEL);
  try {
    stranger.postMessage({ type: "connect" });
    stranger.postMessage("disconnect");
    stranger.postMessage(null);
    // Same sender, so this one is delivered after the three above: once the
    // handler has run for it, the strangers' messages were already seen.
    stranger.postMessage({ type: "disconnect" });
    await disconnectHeard;
    assert.equal(heard.length, 1, "only the real disconnect message counts");
  } finally {
    stranger.close();
    stop();
  }
});
