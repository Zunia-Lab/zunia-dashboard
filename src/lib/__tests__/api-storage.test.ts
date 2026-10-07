/** The localStorage copy of API answers: fresh copies read, stale ones deleted, a budget kept. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PERSIST_MAX_CHARS,
  PERSIST_PREFIX,
  PERSIST_TOTAL_MAX,
  PERSIST_TTL_MS,
  clearCopies,
  pruneCopies,
  readCopy,
  writeCopy,
  type CopyStorage,
} from "../api-storage";

class FakeStorage implements CopyStorage {
  readonly map = new Map<string, string>();
  quota = Infinity;
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    let used = 0;
    for (const [k, v] of this.map) if (k !== key) used += k.length + v.length;
    if (used + key.length + value.length > this.quota) {
      throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError", code: 22 });
    }
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const NOW = 1_800_000_000_000;

test("a fresh copy reads back; an expired one is deleted when found", () => {
  const storage = new FakeStorage();
  assert.equal(writeCopy(storage, "/api/markets?currency=usd", { a: 1 }, { now: NOW }), true);
  assert.deepEqual(readCopy(storage, "/api/markets?currency=usd", NOW + 1_000), { data: { a: 1 }, at: NOW });
  assert.equal(readCopy(storage, "/api/markets?currency=usd", NOW + PERSIST_TTL_MS + 1), null);
  assert.equal(storage.length, 0, "the expired copy is gone");
});

test("the first write of a load sweeps expired copies and keeps others", () => {
  const storage = new FakeStorage();
  writeCopy(storage, "/api/old", { x: 1 }, { now: NOW - PERSIST_TTL_MS - 5 });
  writeCopy(storage, "/api/recent", { x: 2 }, { now: NOW - 1_000 });
  storage.setItem(`${PERSIST_PREFIX}/api/garbled`, "not json");
  storage.setItem("zunia.dashboard.currency", JSON.stringify("eur"));
  writeCopy(storage, "/api/new", { x: 3 }, { now: NOW, sweep: true });
  assert.deepEqual([...storage.map.keys()].sort(), [
    `${PERSIST_PREFIX}/api/new`,
    `${PERSIST_PREFIX}/api/recent`,
    "zunia.dashboard.currency",
  ]);
});

test("over the budget, the oldest copies go first", () => {
  const storage = new FakeStorage();
  const big = "y".repeat(PERSIST_MAX_CHARS - 100);
  for (let i = 0; i < 4; i += 1) writeCopy(storage, `/api/big/${i}`, big, { now: NOW + i });
  assert.equal(storage.length, 4, "a write without the sweep never prunes");
  const freed = pruneCopies(storage, PERSIST_MAX_CHARS, null, NOW + 10);
  assert.ok(freed > 0);
  assert.equal(storage.getItem(`${PERSIST_PREFIX}/api/big/0`), null, "the oldest went");
  assert.ok(storage.getItem(`${PERSIST_PREFIX}/api/big/3`), "the newest stayed");
  let total = 0;
  for (const [k, v] of storage.map) total += k.length + v.length;
  assert.ok(total + PERSIST_MAX_CHARS <= PERSIST_TOTAL_MAX);
});

test("a write the quota refuses evicts old copies and is tried once more", () => {
  const storage = new FakeStorage();
  writeCopy(storage, "/api/a", "a".repeat(5_000), { now: NOW - 2_000 });
  writeCopy(storage, "/api/b", "b".repeat(5_000), { now: NOW - 1_000 });
  storage.quota = 12_000;
  assert.equal(writeCopy(storage, "/api/c", "c".repeat(5_000), { now: NOW }), true);
  assert.ok(storage.getItem(`${PERSIST_PREFIX}/api/c`));
  assert.equal(storage.getItem(`${PERSIST_PREFIX}/api/a`), null);
});

test("an answer too large, or one the quota still refuses, is simply not kept", () => {
  const storage = new FakeStorage();
  assert.equal(writeCopy(storage, "/api/huge", "z".repeat(PERSIST_MAX_CHARS + 1), { now: NOW }), false);
  storage.quota = 10;
  assert.equal(writeCopy(storage, "/api/tiny", "z", { now: NOW }), false);
  assert.equal(storage.length, 0);
});

test("clearing a prefix removes only those copies", () => {
  const storage = new FakeStorage();
  writeCopy(storage, "/api/portfolio?accounts=x", 1, { now: NOW });
  writeCopy(storage, "/api/markets", 2, { now: NOW });
  storage.setItem("zunia.dashboard.walletHint", "{}");
  clearCopies(storage, "/api/portfolio");
  assert.deepEqual([...storage.map.keys()].sort(), [`${PERSIST_PREFIX}/api/markets`, "zunia.dashboard.walletHint"]);
});
