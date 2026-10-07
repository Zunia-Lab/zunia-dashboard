/**
 * Everything that comes back from storage or a request body is untrusted:
 * prefs, state and read ids are parsed field by field, bounded, and a bad
 * field never resets the good ones.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseChainTime } from "@/lib/notifications/ids";
import { DEFAULT_NOTIFY_PREFS, parseNotifyPrefs, parseQuietHours, wantsKind } from "@/lib/notifications/prefs";
import { INITIAL_NOTICE_STATE, parseNoticeState } from "@/lib/notifications/state";
import {
  dropLegacyKeys,
  LEGACY_READ_KEY,
  loadDismissedIds,
  loadNoticeState,
  loadNotifyPrefs,
  loadReadIds,
  MAX_READ_IDS,
  NOTICE_STORAGE_KEYS,
  saveDismissedIds,
  saveNoticeState,
  saveNotifyPrefs,
  saveReadIds,
  withRead,
  type KeyValueStorage,
} from "@/lib/notifications/store";
import { durationText, joinNames, percentText, shortAddress } from "@/lib/notifications/text";

class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

class BrokenStorage implements KeyValueStorage {
  getItem(): string | null {
    throw new Error("SecurityError");
  }
  setItem(): void {
    throw new Error("QuotaExceededError");
  }
  removeItem(): void {
    throw new Error("SecurityError");
  }
}

test("prefs: defaults are quiet, bad fields keep their default one by one", () => {
  assert.deepEqual(parseNotifyPrefs(undefined), DEFAULT_NOTIFY_PREFS);
  assert.deepEqual(DEFAULT_NOTIFY_PREFS, {
    transfers: true,
    rewards: "once",
    governance: false,
    unbonding: false,
    validator: true,
    browserAlerts: false,
  });
  const parsed = parseNotifyPrefs({
    transfers: "yes",
    rewards: "hourly",
    governance: true,
    unbonding: 1,
    validator: false,
    browserAlerts: true,
    quietHours: { start: 22, end: 7 },
    extra: "ignored",
  });
  assert.deepEqual(parsed, {
    transfers: true,
    rewards: "once",
    governance: true,
    unbonding: false,
    validator: false,
    browserAlerts: true,
    quietHours: { start: 22, end: 7 },
  });
});

test("quiet hours must be two different whole hours", () => {
  assert.deepEqual(parseQuietHours({ start: 0, end: 23 }), { start: 0, end: 23 });
  assert.equal(parseQuietHours({ start: 7, end: 7 }), undefined);
  assert.equal(parseQuietHours({ start: 24, end: 7 }), undefined);
  assert.equal(parseQuietHours({ start: 6.5, end: 7 }), undefined);
  assert.equal(parseQuietHours("22-7"), undefined);
});

test("wantsKind maps every kind to its switch; system always shows", () => {
  const off = { ...DEFAULT_NOTIFY_PREFS, transfers: false, rewards: "off" as const, validator: false };
  for (const kind of ["transfer", "ibc", "swap", "rewards", "governance", "unbonding", "validator"] as const) {
    assert.equal(wantsKind(off, kind), false, kind);
  }
  assert.equal(wantsKind(off, "system"), true);
});

test("read ids: de-duplicated, newest kept past the cap", () => {
  assert.deepEqual(withRead(["a", "b"], ["b", "c"]), ["a", "b", "c"]);
  const many = Array.from({ length: MAX_READ_IDS + 10 }, (_, i) => `id${i}`);
  const next = withRead([], many);
  assert.equal(next.length, MAX_READ_IDS);
  assert.equal(next[next.length - 1], `id${MAX_READ_IDS + 9}`);
});

test("storage round trip under the four keys", () => {
  const storage = new MemoryStorage();
  saveReadIds(storage, ["transfer:AA"]);
  saveDismissedIds(storage, ["transfer:BB"]);
  saveNotifyPrefs(storage, { ...DEFAULT_NOTIFY_PREFS, governance: true });
  saveNoticeState(storage, { ...INITIAL_NOTICE_STATE, announced: ["x"] });
  assert.deepEqual([...storage.data.keys()].sort(), Object.values(NOTICE_STORAGE_KEYS).sort());
  assert.deepEqual(loadReadIds(storage), ["transfer:AA"]);
  assert.deepEqual(loadDismissedIds(storage), ["transfer:BB"]);
  storage.setItem(NOTICE_STORAGE_KEYS.dismissed, JSON.stringify(["gov:osmosis-1:1", 7, null, "x".repeat(400)]));
  assert.deepEqual(loadDismissedIds(storage), ["gov:osmosis-1:1"], "only bounded strings survive a read");
  assert.equal(loadNotifyPrefs(storage).governance, true);
  assert.deepEqual(loadNoticeState(storage).announced, ["x"]);

  storage.setItem(LEGACY_READ_KEY, "[]");
  dropLegacyKeys(storage);
  assert.equal(storage.getItem(LEGACY_READ_KEY), null);
});

test("storage that throws or holds garbage reads as defaults", () => {
  const broken = new BrokenStorage();
  assert.deepEqual(loadReadIds(broken), []);
  assert.deepEqual(loadNotifyPrefs(broken), DEFAULT_NOTIFY_PREFS);
  assert.deepEqual(loadNoticeState(broken), INITIAL_NOTICE_STATE);
  assert.equal(saveReadIds(broken, ["a"]), false);
  assert.equal(saveReadIds(null, ["a"]), false);

  const garbage = new MemoryStorage();
  garbage.setItem(NOTICE_STORAGE_KEYS.read, "{not json");
  garbage.setItem(NOTICE_STORAGE_KEYS.state, JSON.stringify({ v: 2, announced: ["x"] }));
  assert.deepEqual(loadReadIds(garbage), []);
  assert.deepEqual(loadNoticeState(garbage), INITIAL_NOTICE_STATE);
});

test("state parsing keeps valid accounts and drops malformed parts", () => {
  const state = parseNoticeState({
    v: 1,
    announced: ["a", 3, "b"],
    accounts: {
      good: {
        since: 1,
        seenAt: 2,
        rewards: { phase: "raised", cycle: 4, raisedAt: 5, last: { "osmosis-1": 0.5, bad: "x" } },
        unbonding: [
          { id: "u1", chainId: "c", validator: "v", completesAt: 9, amountText: "1 ATOM" },
          { id: "u2", chainId: "c" },
        ],
        validators: {
          "c|v": { moniker: "M", delegated: true, commission: 0.05, seenAt: 3, jailedSince: 4 },
          "c|w": { moniker: "N", delegated: true, commission: 7, seenAt: 3 },
        },
      },
      bad: { since: "yesterday" },
    },
  });
  assert.deepEqual(state.announced, ["a", "b"]);
  assert.deepEqual(Object.keys(state.accounts), ["good"]);
  const account = state.accounts.good;
  assert.equal(account.rewards.cycle, 4);
  assert.deepEqual(account.rewards.last, { "osmosis-1": 0.5 });
  assert.deepEqual(account.unbonding.map((entry) => entry.id), ["u1"]);
  assert.deepEqual(Object.keys(account.validators), ["c|v"]);
});

test("chain times keep millisecond precision whatever the source printed", () => {
  const ns = parseChainTime("2026-10-12T11:58:17.002622909Z");
  const ms = parseChainTime("2026-10-12T11:58:17.002Z");
  assert.equal(ns, ms);
  assert.equal(parseChainTime("2026-10-12T11:58:17Z"), Date.parse("2026-10-12T11:58:17.000Z"));
  assert.equal(parseChainTime(1_700_000_000_123.7), 1_700_000_000_123);
  assert.equal(parseChainTime("not a time"), null);
  assert.equal(parseChainTime(undefined), null);
});

test("wording helpers", () => {
  assert.equal(durationText(30_000), "1 min");
  assert.equal(durationText(45 * 60_000), "45 min");
  assert.equal(durationText(5.9 * 3_600_000), "5 h");
  assert.equal(durationText(47 * 3_600_000), "47 h");
  assert.equal(durationText(3.5 * 86_400_000), "3 days");
  assert.equal(percentText(0.05), "5%");
  assert.equal(percentText(0.075), "7.5%");
  assert.equal(joinNames(["Osmosis"]), "Osmosis");
  assert.equal(joinNames(["Osmosis", "Cosmos Hub"]), "Osmosis and Cosmos Hub");
  assert.equal(joinNames(["A", "B", "C", "D"], 2, "more"), "A, B and 2 more");
  assert.equal(shortAddress("osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm"), "osmo1gv86…l5rm");
  assert.equal(shortAddress("addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e"), "addr_safro1gv86…dn7e");
});
