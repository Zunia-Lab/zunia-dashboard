/**
 * The push watcher's passes against fake chains and a recording sender: what
 * is pushed, what is recorded unsent, what waits, and the bounds that keep a
 * pass from running away. The production wiring (`poller.ts`) only swaps in
 * the real LCD reads, token naming and `web-push`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_NOTIFY_PREFS } from "@/lib/notifications/prefs";
import type { NotifyPrefs } from "@/lib/notifications/types";
import type { TokenIdentity } from "@/lib/token/types";
import { ENGINE_LIMITS, runSlowPass, runTransferPass, type PushDeps } from "@/lib/server/push/engine";
import type { VotingProposal } from "@/lib/server/push/lcd";
import type { PushSender, SendOutcome } from "@/lib/server/push/send";
import { freshPollerState } from "@/lib/server/push/status";
import type { PushStore } from "@/lib/server/push/store";
import { pruneStale, upsertRecord, type PushRecord } from "@/lib/server/push/subscriptions";
import type { PushAccount, SubscribeRequest } from "@/lib/server/push/validate";
import type { PushPayload } from "@/lib/notifications/payload";

const T0 = Date.parse("2026-10-07T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const USER = "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm";
const USER2 = "osmo1k2udl7s6zcyh2qun6077zxwh2vfw7f795clggv";
const STRANGER = "osmo1zva9lk2c4vg8mm2dvmc5wkjxvc3xm4dxwlg8mm";
const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";

const OSMO: TokenIdentity = {
  key: "osmosis-1:uosmo",
  chainId: "osmosis-1",
  denom: "uosmo",
  kind: "native",
  ticker: "OSMO",
  name: "Osmosis",
  decimals: 6,
  provenance: "native",
  proven: true,
  listed: true,
};

/* ------------------------------------------------------------------ fakes */

function memoryStore(): PushStore & { touches(): number } {
  const records = new Map<string, PushRecord>();
  let touches = 0;
  return {
    size: () => records.size,
    all: () => [...records.values()],
    get: (endpoint) => records.get(endpoint),
    upsert: (request, now) => upsertRecord(records, request, now),
    remove: (endpoint) => records.delete(endpoint),
    touch: () => {
      touches += 1;
    },
    prune: (now) => pruneStale(records, now),
    flush: async () => undefined,
    touches: () => touches,
  };
}

let endpoints = 0;
function subscribe(
  store: PushStore,
  accounts: PushAccount[],
  prefs: Partial<NotifyPrefs> = {},
  options: { timeZone?: string | null; now?: number } = {},
): PushRecord {
  endpoints += 1;
  const request: SubscribeRequest = {
    subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/test-${endpoints}`, keys: { p256dh: P256DH, auth: AUTH } },
    accounts,
    prefs: { ...DEFAULT_NOTIFY_PREFS, ...prefs },
    locale: "en",
    timeZone: options.timeZone === undefined ? "UTC" : options.timeZone,
    replaces: null,
  };
  const result = store.upsert(request, options.now ?? T0 - HOUR);
  assert.ok(result.ok);
  return result.record;
}

const hash = (n: number) => n.toString(16).toUpperCase().padStart(64, "A");

/** An LCD `tx_responses` row: `from` sends `amount` to `to` with a MsgSend. */
function sendTx(n: number, height: number, to: string, amount = "500000uosmo", at = T0 - 2 * MIN, from = STRANGER) {
  return {
    txhash: hash(n),
    height: String(height),
    code: 0,
    timestamp: new Date(at).toISOString().replace(".000", ""),
    tx: { body: { messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend" }] } },
    events: [
      { type: "message", attributes: [{ key: "sender", value: from }] },
      {
        type: "transfer",
        attributes: [
          { key: "recipient", value: to },
          { key: "sender", value: from },
          { key: "amount", value: amount },
        ],
      },
    ],
  };
}

interface Sent {
  endpoint: string;
  payload: PushPayload;
  urgency: string | undefined;
}

function recorder(outcome: () => SendOutcome = () => ({ status: "sent" })) {
  const sent: Sent[] = [];
  const send: PushSender = async (target, payload, options) => {
    sent.push({ endpoint: target.endpoint, payload, urgency: options?.urgency });
    return outcome();
  };
  return { sent, send };
}

/** One fake chain (osmosis-1): a height and the incoming txs per address. */
function chain(send: PushSender, overrides: Partial<PushDeps> = {}) {
  let height = 1_000;
  const txs: Array<{ address: string; height: number; row: unknown }> = [];
  const deps: PushDeps = {
    latestHeight: async () => height,
    searchIncoming: async (_chainId, address, after) =>
      txs.filter((tx) => tx.address === address && tx.height > after).map((tx) => tx.row),
    votingProposals: async () => [],
    hasDelegation: async () => false,
    voteStatus: async () => "unknown",
    unbondingEntries: async () => [],
    bondDenom: async () => "uosmo",
    counterpartyChainId: async () => null,
    identifyDenoms: async (_chainId, denoms) =>
      new Map(denoms.filter((denom) => denom === "uosmo").map((denom) => [denom, OSMO] as const)),
    chainName: (chainId) => (chainId === "osmosis-1" ? "Osmosis" : chainId),
    send,
    ...overrides,
  };
  return {
    deps,
    advance(blocks: number) {
      height += blocks;
    },
    receive(address: string, row: ReturnType<typeof sendTx>) {
      txs.push({ address, height: Number(row.height), row });
    },
    get height() {
      return height;
    },
  };
}

const OSMOSIS = (address = USER): PushAccount => ({ chainId: "osmosis-1", address });

/* ------------------------------------------------------------------ transfers */

test("first pass seeds silently; a later transfer is pushed once, high urgency, with honest words", async () => {
  const store = memoryStore();
  const { sent, send } = recorder();
  const fake = chain(send);
  const state = freshPollerState();
  const record = subscribe(store, [OSMOSIS()]);
  fake.receive(USER, sendTx(1, 990, USER)); // history before the subscription

  const seed = await runTransferPass({ deps: fake.deps, store, now: T0, state });
  assert.equal(seed.seeded, 1);
  assert.equal(sent.length, 0, "history is not news");
  assert.equal(record.lastHeights["osmosis-1"], 1_000);

  fake.advance(10);
  fake.receive(USER, sendTx(2, 1_005, USER, "500000uosmo"));
  const pass = await runTransferPass({ deps: fake.deps, store, now: T0 + MIN, state });
  assert.equal(pass.pushed, 1);
  assert.equal(sent[0].urgency, "high");
  assert.equal(sent[0].payload.title, "Received 0.5 OSMO on Osmosis");
  assert.equal(sent[0].payload.url, `/activity/${hash(2)}?chainId=osmosis-1`);
  assert.equal(sent[0].payload.tag, `transfer:${hash(2)}`);
  assert.equal(record.lastHeights["osmosis-1"], 1_010);

  // The overlap re-reads the same block next time; the sent id stops a repeat.
  await runTransferPass({ deps: fake.deps, store, now: T0 + 2 * MIN, state });
  assert.equal(sent.length, 1);
});

test("at most four pushes per device per pass; the rest are recorded, not sent", async () => {
  const store = memoryStore();
  const { sent, send } = recorder();
  const fake = chain(send);
  const state = freshPollerState();
  subscribe(store, [OSMOSIS()]);
  await runTransferPass({ deps: fake.deps, store, now: T0, state });
  fake.advance(10);
  for (let n = 0; n < 6; n += 1) fake.receive(USER, sendTx(10 + n, 1_001 + n, USER));
  const pass = await runTransferPass({ deps: fake.deps, store, now: T0 + MIN, state });
  assert.equal(pass.pushed, ENGINE_LIMITS.maxPushesPerPass);
  assert.equal(pass.suppressed, 2);
  await runTransferPass({ deps: fake.deps, store, now: T0 + 2 * MIN, state });
  assert.equal(sent.length, ENGINE_LIMITS.maxPushesPerPass, "recorded ones never go out later");
});

test("quiet hours drop a transfer push (the feed shows it); no zone means no quiet hours", async () => {
  const store = memoryStore();
  const { sent, send } = recorder();
  const fake = chain(send);
  const state = freshPollerState();
  // 12:00 UTC is inside 10:00–14:00 UTC.
  const quiet = subscribe(store, [OSMOSIS()], { quietHours: { start: 10, end: 14 } }, { timeZone: "UTC" });
  // Same window, but the browser never said its zone: the server's clock is a guess, so it is ignored.
  const unknownZone = subscribe(store, [OSMOSIS()], { quietHours: { start: 0, end: 23 } }, { timeZone: null });
  await runTransferPass({ deps: fake.deps, store, now: T0, state });
  fake.advance(5);
  fake.receive(USER, sendTx(20, 1_002, USER));
  const pass = await runTransferPass({ deps: fake.deps, store, now: T0 + MIN, state });
  assert.deepEqual(
    sent.map((push) => push.endpoint),
    [unknownZone.endpoint],
  );
  assert.equal(pass.suppressed, 1);
  assert.ok(quiet.sentIds.includes(`transfer:${hash(20)}`), "recorded, so it is not pushed after quiet hours");
});

test("a push service that answers 410 drops the subscription", async () => {
  const store = memoryStore();
  const { send } = recorder(() => ({ status: "gone" }));
  const fake = chain(send);
  const state = freshPollerState();
  subscribe(store, [OSMOSIS()]);
  await runTransferPass({ deps: fake.deps, store, now: T0, state });
  fake.advance(5);
  fake.receive(USER, sendTx(30, 1_003, USER));
  const pass = await runTransferPass({ deps: fake.deps, store, now: T0 + MIN, state });
  assert.equal(pass.removed, 1);
  assert.equal(store.size(), 0);
});

test("a failed send holds the watermark, so the next pass retries it; a throwing sender is a failure, not a crash", async () => {
  const store = memoryStore();
  let mode: "throw" | "ok" = "throw";
  const sent: string[] = [];
  const send: PushSender = async (_target, payload) => {
    if (mode === "throw") throw new Error("socket hang up");
    sent.push(payload.id);
    return { status: "sent" };
  };
  const fake = chain(send);
  const state = freshPollerState();
  const record = subscribe(store, [OSMOSIS()]);
  await runTransferPass({ deps: fake.deps, store, now: T0, state });
  fake.advance(5);
  fake.receive(USER, sendTx(40, 1_004, USER));
  await runTransferPass({ deps: fake.deps, store, now: T0 + MIN, state });
  assert.equal(record.lastHeights["osmosis-1"], 1_000, "held");
  assert.equal(record.failures, 1);
  mode = "ok";
  await runTransferPass({ deps: fake.deps, store, now: T0 + 2 * MIN, state });
  assert.deepEqual(sent, [`transfer:${hash(40)}`]);
  assert.equal(record.lastHeights["osmosis-1"], 1_005);
});

test("poll times of watches nobody holds any more are forgotten", async () => {
  const store = memoryStore();
  const { send } = recorder();
  const fake = chain(send);
  const state = freshPollerState();
  state.lastPolled.set("osmosis-1|osmo1gone", T0 - HOUR);
  subscribe(store, [OSMOSIS()]);
  await runTransferPass({ deps: fake.deps, store, now: T0, state });
  assert.deepEqual([...state.lastPolled.keys()], [`osmosis-1|${USER}`]);
});

test("watermark-only passes save the store only when asked; a recorded push always saves", async () => {
  const store = memoryStore();
  const { send } = recorder();
  const fake = chain(send);
  const state = freshPollerState();
  subscribe(store, [OSMOSIS()]);
  await runTransferPass({ deps: fake.deps, store, now: T0, state, saveHeights: false });
  assert.equal(store.touches(), 1, "a new watch's starting height is saved at once");
  fake.advance(5);
  await runTransferPass({ deps: fake.deps, store, now: T0 + MIN, state, saveHeights: false });
  assert.equal(store.touches(), 1, "blocks went by, nothing else: no write");
  fake.advance(5);
  fake.receive(USER, sendTx(50, 1_009, USER));
  await runTransferPass({ deps: fake.deps, store, now: T0 + 2 * MIN, state, saveHeights: false });
  assert.equal(store.touches(), 2, "a sent id must survive a restart");
});

/* ------------------------------------------------------------------ unbonding */

test("an unbonding deferred by quiet hours still goes out when they end, hours later", async () => {
  const store = memoryStore();
  const { sent, send } = recorder();
  const fake = chain(send);
  const state = freshPollerState();
  const completesAt = Date.parse("2026-10-07T23:00:00Z");
  const record = subscribe(
    store,
    [OSMOSIS()],
    { transfers: false, unbonding: true, quietHours: { start: 22, end: 7 } },
    { timeZone: "UTC", now: completesAt - 3 * 86_400_000 },
  );
  record.pendingUnbondings = [
    { id: `unbonding:osmosis-1:osmovaloper1x:${completesAt}`, chainId: "osmosis-1", address: USER, completesAt, text: "5 OSMO" },
  ];
  await runTransferPass({ deps: fake.deps, store, now: completesAt + 30 * MIN, state });
  assert.equal(sent.length, 0, "quiet: wait");
  assert.equal(record.pendingUnbondings.length, 1);
  // 07:05, eight hours after completion: past the six-hour transfer cap, still delivered.
  await runTransferPass({ deps: fake.deps, store, now: Date.parse("2026-10-08T07:05:00Z"), state });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.title, "Unbonding complete");
  assert.equal(sent[0].payload.body, "5 OSMO is liquid again on Osmosis.");
  assert.equal(record.pendingUnbondings.length, 0);
});

test("slow pass: every account's unbondings are remembered, none lost to a slow read", async () => {
  const store = memoryStore();
  const { send } = recorder();
  const completesAt = T0 + 5 * 86_400_000;
  const fake = chain(send, {
    unbondingEntries: async (_chainId, address) => [
      { validator: address === USER ? "osmovaloper1a" : "osmovaloper1b", completesAt, balance: "2500000" },
    ],
    // A slow denom read: the words are awaited before each entry is appended.
    bondDenom: () => new Promise((resolve) => setTimeout(() => resolve("uosmo"), 5)),
  });
  const record = subscribe(store, [OSMOSIS(USER), OSMOSIS(USER2)], { transfers: false, unbonding: true });
  const report = await runSlowPass({ deps: fake.deps, store, now: T0, state: freshPollerState() });
  assert.equal(report.pendingUnbondings, 2);
  assert.deepEqual(
    record.pendingUnbondings.map((row) => [row.address, row.text]),
    [
      [USER, "2.5 OSMO"],
      [USER2, "2.5 OSMO"],
    ],
  );
});

/* ------------------------------------------------------------------ governance */

const PROPOSAL: VotingProposal = { id: "1049", title: "Withdraw liquidity", votingEndTime: T0 + 5 * HOUR, api: "v1" };

test("governance: one reminder per vote in its last 24 h, only to a delegator who has not voted", async () => {
  const store = memoryStore();
  const { sent, send } = recorder();
  const status = new Map<string, "voted" | "not-voted" | "unknown">([
    [USER, "not-voted"],
    [USER2, "voted"],
    [STRANGER, "unknown"],
  ]);
  const fake = chain(send, {
    votingProposals: async () => [PROPOSAL, { ...PROPOSAL, id: "1050", votingEndTime: T0 + 3 * 86_400_000 }],
    hasDelegation: async () => true,
    voteStatus: async (_chainId, _proposal, address) => status.get(address) ?? "unknown",
  });
  const notVoted = subscribe(store, [OSMOSIS(USER)], { governance: true });
  subscribe(store, [OSMOSIS(USER2)], { governance: true });
  subscribe(store, [OSMOSIS(STRANGER)], { governance: true });
  subscribe(store, [OSMOSIS(USER)], { governance: false });

  const report = await runSlowPass({ deps: fake.deps, store, now: T0, state: freshPollerState() });
  assert.equal(report.proposalsEnding, 1, "only the vote inside its last 24 h");
  assert.deepEqual(
    sent.map((push) => [push.endpoint, push.payload.id, push.payload.title]),
    [[notVoted.endpoint, "gov:osmosis-1:1049:24h", "Vote ends in 5 h"]],
  );
  // The proposal's canonical page (lib/notifications/ids.ts); the old
  // `/governance/<id>?chain=` form only redirects there.
  assert.equal(sent[0].payload.url, "/governance/osmosis-1/1049");
  await runSlowPass({ deps: fake.deps, store, now: T0 + 10 * MIN, state: freshPollerState() });
  assert.equal(sent.length, 1, "once per vote");
});

test("slow pass stops at its deadline and the next one resumes where it stopped", async () => {
  const store = memoryStore();
  let clock = 0;
  const sent: string[] = [];
  const send: PushSender = async (target) => {
    sent.push(target.endpoint);
    clock += 20_000; // each push takes "20 s"
    return { status: "sent" };
  };
  const fake = chain(send, {
    votingProposals: async () => [PROPOSAL],
    hasDelegation: async () => true,
    voteStatus: async () => "not-voted",
  });
  const records = Array.from({ length: 6 }, () => subscribe(store, [OSMOSIS()], { governance: true }));
  const state = freshPollerState();
  const first = await runSlowPass({ deps: fake.deps, store, now: T0, state, clock: () => clock, deadlineMs: 30_000 });
  assert.equal(first.deferred, 6 - ENGINE_LIMITS.recordConcurrency);
  assert.equal(sent.length, ENGINE_LIMITS.recordConcurrency);
  const second = await runSlowPass({ deps: fake.deps, store, now: T0 + MIN, state, clock: () => clock, deadlineMs: 30_000 });
  assert.equal(second.pushed, 2, "the two left over, first");
  assert.deepEqual(new Set(sent), new Set(records.map((record) => record.endpoint)), "everyone, exactly once");
  assert.equal(sent.length, 6);
});
