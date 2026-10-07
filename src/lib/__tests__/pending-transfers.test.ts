import assert from "node:assert/strict";
import { test } from "node:test";
import type { RouteTraceWire } from "@/lib/interchain/wire";
import {
  countInFlight,
  isInFlight,
  isSettled,
  MAX_PENDING_TRANSFERS,
  ownedBy,
  PENDING_TRANSFER_TTL_MS,
  readPendingTransfers,
  statusFromTrace,
  withoutTransfer,
  withStatus,
  withTransfer,
  type NewPendingTransfer,
} from "../pending-transfers";

const HASH = "a".repeat(64);
const NOW = 1_800_000_000_000;

function plan() {
  return {
    sourceChainId: "cosmoshub-4",
    destChainId: "osmosis-1",
    inputDenom: "uatom",
    outputDenom: "ibc/27394FB0",
    hops: [{ chainId: "cosmoshub-4", channelId: "channel-141", port: "transfer", counterpartyChainId: "osmosis-1", kind: "transfer" as const }],
    memo: "",
    warnings: [],
    estimatedDurationSeconds: 60,
    requiresPfm: false,
    requiresIbcHooks: false,
  };
}

function entry(id: string, createdAt = NOW): NewPendingTransfer {
  return {
    id,
    sourceChainId: "cosmoshub-4",
    destChainId: "osmosis-1",
    plan: plan(),
    amount: "1000000",
    denom: "uatom",
    symbol: "ATOM",
    decimals: 6,
    sender: "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f",
    recipient: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm",
    origin: "bridge",
    createdAt,
  };
}

test("withTransfer adds newest first, upper-cases the hash and replaces by id", () => {
  let list = withTransfer([], entry(HASH, NOW - 10), NOW);
  assert.equal(list[0]?.id, HASH.toUpperCase());
  assert.equal(list[0]?.status, "in-flight");
  list = withTransfer(list, entry("b".repeat(64), NOW), NOW);
  assert.deepEqual(
    list.map((row) => row.id[0]),
    ["B", "A"],
  );
  list = withTransfer(list, { ...entry(HASH.toUpperCase(), NOW - 10), symbol: "ATOM2" }, NOW + 5);
  assert.equal(list.length, 2);
  assert.equal(list.find((row) => row.id === HASH.toUpperCase())?.symbol, "ATOM2");
});

test("the list is capped at 10", () => {
  let list = withTransfer([], entry("0".repeat(64)), NOW);
  for (let i = 1; i <= 12; i += 1) list = withTransfer(list, entry(i.toString(16).padStart(64, "f"), NOW + i), NOW + i);
  assert.equal(list.length, MAX_PENDING_TRANSFERS);
  assert.equal(list.some((row) => row.id === "0".repeat(64)), false, "the oldest went first");
});

test("readPendingTransfers narrows untrusted storage, drops expired and malformed rows", () => {
  const good = withTransfer([], entry(HASH), NOW)[0];
  const rows = readPendingTransfers(
    [
      good,
      { ...good, id: "nope" },
      { ...good, id: "c".repeat(64), plan: { hops: [] } },
      { ...good, id: "d".repeat(64), amount: "1.5" },
      { ...good, id: "e".repeat(64), createdAt: NOW - PENDING_TRANSFER_TTL_MS - 1 },
      { ...good, id: "f".repeat(64), status: "teleported", origin: "?", decimals: 99 },
      { ...good, updatedAt: NOW + 1, symbol: "NEWER" },
      "junk",
    ],
    NOW,
  );
  assert.deepEqual(
    rows.map((row) => row.id[0]),
    ["A", "F"],
  );
  assert.equal(rows[0]?.symbol, "NEWER", "the newest copy of a duplicate wins");
  assert.equal(rows[1]?.status, "in-flight");
  assert.equal(rows[1]?.origin, "bridge");
  assert.equal(rows[1]?.decimals, null);
  assert.deepEqual(readPendingTransfers({ not: "a list" }, NOW), []);
});

test("withStatus keeps the reference when nothing changes; counts and helpers", () => {
  const list = withTransfer(withTransfer([], entry(HASH), NOW), entry("b".repeat(64)), NOW);
  assert.equal(withStatus(list, HASH, "in-flight", NOW + 1), list);
  const next = withStatus(list, HASH.toLowerCase(), "arrived", NOW + 1);
  assert.notEqual(next, list);
  assert.equal(next.find((row) => row.id === HASH.toUpperCase())?.updatedAt, NOW + 1);
  assert.equal(countInFlight(next), 1);
  assert.equal(withoutTransfer(next, HASH).length, 1);
  assert.equal(isSettled("arrived"), true);
  assert.equal(isSettled("recoverable"), false);
  assert.equal(isInFlight("stalled"), true);
});

function trace(partial: Partial<RouteTraceWire>): RouteTraceWire {
  return {
    sourceChainId: "cosmoshub-4",
    destChainId: "osmosis-1",
    sourceTxHash: HASH,
    hops: [],
    status: "pending",
    failure: null,
    stalled: false,
    currentHopIndex: 0,
    elapsedSeconds: null,
    estimatedDurationSeconds: 60,
    updatedAt: NOW,
    notes: [],
    recovery: null,
    ...partial,
  };
}

function hop(status: RouteTraceWire["hops"][number]["status"], sequence: string | null = "7") {
  return {
    index: 0,
    chainId: "cosmoshub-4",
    channelId: "channel-141",
    port: "transfer",
    counterpartyChainId: "osmosis-1",
    kind: "transfer" as const,
    sequence,
    sendTxHash: HASH,
    receiveTxHash: null,
    status,
    error: null,
    stalled: false,
    fundsRefunded: false,
  };
}

test("statusFromTrace folds the engine's reading into the store's terms", () => {
  assert.equal(statusFromTrace(null), null);
  assert.equal(statusFromTrace(trace({ hops: [hop("pending")] })), "in-flight");
  assert.equal(statusFromTrace(trace({ hops: [hop("pending")], stalled: true })), "stalled");
  assert.equal(statusFromTrace(trace({ hops: [hop("received")] })), "arrived");
  assert.equal(statusFromTrace(trace({ hops: [hop("acknowledged"), hop("pending")] })), "in-flight", "a forwarded hop still to go");
  assert.equal(statusFromTrace(trace({ hops: [hop("acknowledged"), hop("received")] })), "arrived");
  assert.equal(statusFromTrace(trace({ hops: [hop("timeout")], failure: "timeout" })), "returned");
  assert.equal(statusFromTrace(trace({ hops: [hop("failed")] })), "returned", "an ack error is refunded");
  assert.equal(statusFromTrace(trace({ hops: [hop("failed", null)] })), "failed", "no packet left: the source tx failed");
  assert.equal(statusFromTrace(trace({ hops: [hop("acknowledged")], failure: "swap-delivery-failed" })), "recoverable");
});

test("ownedBy keeps the transfers the wallet on screen signed", () => {
  const mine = withTransfer([], entry(HASH), NOW);
  const theirs = withTransfer([], { ...entry("b".repeat(64)), sender: "cosmos1qx8te3rzssyj47q2hswzclqc52gp9njuj8rqfv" }, NOW);
  const list = [...mine, ...theirs];
  const walletA = (chainId: string) => (chainId === "cosmoshub-4" ? "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f" : null);
  assert.deepEqual(
    ownedBy(list, walletA).map((row) => row.id),
    [HASH.toUpperCase()],
  );
  assert.deepEqual(ownedBy(list, () => null), [], "no wallet, no entries");
});

test("withStatus records the tracker's progress without moving updatedAt; storage keeps it", () => {
  const list = withTransfer([], entry(HASH), NOW);
  const moved = withStatus(list, HASH, "in-flight", NOW + 5, 1 / 3);
  assert.notEqual(moved, list);
  assert.equal(moved[0]?.progress, 1 / 3);
  assert.equal(moved[0]?.updatedAt, list[0]?.updatedAt, "same status: same updatedAt");
  assert.equal(withStatus(moved, HASH, "in-flight", NOW + 6, 1 / 3), moved, "nothing new: same reference");
  assert.equal(withStatus(moved, HASH, "in-flight", NOW + 6), moved, "no reading: same reference");
  const arrived = withStatus(moved, HASH, "arrived", NOW + 9, 1);
  assert.equal(arrived[0]?.updatedAt, NOW + 9);
  assert.equal(withStatus(list, HASH, "in-flight", NOW, 7)[0]?.progress, 1, "clamped to 0..1");
  const read = readPendingTransfers(JSON.parse(JSON.stringify([...moved, { ...moved[0], id: "c".repeat(64), progress: 4 }])), NOW + 10);
  assert.equal(read.find((row) => row.id === HASH.toUpperCase())?.progress, 1 / 3);
  assert.equal(read.find((row) => row.id === "C".repeat(64))?.progress, undefined, "an out-of-range reading is dropped");
});
