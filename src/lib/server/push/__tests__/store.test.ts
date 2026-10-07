/**
 * The subscription store: caps and de-duplication (pure), then the file
 * underneath it (atomic replacement, coalesced writes, corrupt files moved
 * aside) against a real temp directory.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { DEFAULT_NOTIFY_PREFS } from "@/lib/notifications/prefs";
import { JsonFile, writeFileAtomic } from "@/lib/server/push/file-store";
import {
  hasSent,
  markSent,
  parseRecord,
  parseStoreFile,
  pruneStale,
  PUSH_STORE_LIMITS,
  serializeStore,
  upsertRecord,
  type PushRecord,
} from "@/lib/server/push/subscriptions";
import type { SubscribeRequest } from "@/lib/server/push/validate";

const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const T0 = Date.parse("2026-10-07T00:00:00Z");

function request(endpoint: string, overrides: Partial<SubscribeRequest> = {}): SubscribeRequest {
  return {
    subscription: { endpoint, keys: { p256dh: P256DH, auth: AUTH } },
    accounts: [
      { chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" },
      { chainId: "cosmoshub-4", address: "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f" },
    ],
    prefs: DEFAULT_NOTIFY_PREFS,
    locale: "en",
    timeZone: "UTC",
    replaces: null,
    ...overrides,
  };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "zunia-push-test-"));
  dirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("upsert: one record per endpoint; a refresh keeps what the poller learned for watched chains", () => {
  const records = new Map<string, PushRecord>();
  const endpoint = "https://fcm.googleapis.com/fcm/send/a";
  const first = upsertRecord(records, request(endpoint), T0);
  assert.ok(first.ok && first.created);
  const record = records.get(endpoint)!;
  record.lastHeights = { "osmosis-1": 100, "cosmoshub-4": 200 };
  markSent(record, ["transfer:AA"]);
  record.pendingUnbondings = [
    { id: "u1", chainId: "cosmoshub-4", address: "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f", completesAt: T0 + 1, text: "1 ATOM" },
  ];

  const again = upsertRecord(
    records,
    request(endpoint, { accounts: [{ chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" }] }),
    T0 + 1_000,
  );
  assert.ok(again.ok && !again.created);
  assert.equal(records.size, 1);
  assert.deepEqual(record.lastHeights, { "osmosis-1": 100 }, "an unwatched chain is forgotten");
  assert.deepEqual(record.pendingUnbondings, [], "and so are its pending unbondings");
  assert.equal(hasSent(record, "transfer:AA"), true, "sent ids survive a refresh: no replay");
  assert.equal(record.lastSeen, T0 + 1_000);
  assert.equal(record.createdAt, T0);
});

test("replaces drops the browser's previous endpoint and carries what it learned", () => {
  const records = new Map<string, PushRecord>();
  const old = upsertRecord(records, request("https://fcm.googleapis.com/fcm/send/old"), T0);
  assert.ok(old.ok);
  old.record.lastHeights = { "osmosis-1": 72_000_000, "cosmoshub-4": 33_000_000 };
  markSent(old.record, ["transfer:AA"]);
  old.record.pendingUnbondings = [
    { id: "unbonding:osmosis-1:v:1", chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm", completesAt: T0 + 1, text: "1 OSMO" },
  ];
  // The rotated subscription stops watching the Hub.
  const rotated = upsertRecord(
    records,
    request("https://fcm.googleapis.com/fcm/send/new", {
      replaces: "https://fcm.googleapis.com/fcm/send/old",
      accounts: [{ chainId: "osmosis-1", address: "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm" }],
    }),
    T0 + 1_000,
  );
  assert.deepEqual([...records.keys()], ["https://fcm.googleapis.com/fcm/send/new"]);
  assert.ok(rotated.ok && rotated.created);
  assert.equal(rotated.record.createdAt, T0, "the same browser, subscribed since then");
  assert.deepEqual(rotated.record.lastHeights, { "osmosis-1": 72_000_000 });
  assert.ok(hasSent(rotated.record, "transfer:AA"), "no replay after a rotation");
  assert.equal(rotated.record.pendingUnbondings.length, 1, "a pending unbonding is still announced");
});

test("the subscription cap holds, after stale records are pruned", () => {
  const records = new Map<string, PushRecord>();
  for (let i = 0; i < PUSH_STORE_LIMITS.subscriptions; i += 1) {
    upsertRecord(records, request(`https://fcm.googleapis.com/fcm/send/${i}`), T0);
  }
  const full = upsertRecord(records, request("https://fcm.googleapis.com/fcm/send/one-more"), T0 + 1);
  assert.deepEqual(full, { ok: false, reason: "full" });
  // 90 days later every one of them is stale: room again.
  const later = upsertRecord(records, request("https://fcm.googleapis.com/fcm/send/one-more"), T0 + PUSH_STORE_LIMITS.staleMs + 10);
  assert.ok(later.ok);
  assert.equal(records.size, 1);
});

test("sent ids: newest first, de-duplicated, capped", () => {
  const records = new Map<string, PushRecord>();
  upsertRecord(records, request("https://fcm.googleapis.com/fcm/send/a"), T0);
  const record = [...records.values()][0];
  markSent(record, ["a", "b", "a"]);
  markSent(record, ["c", "b"]);
  assert.deepEqual(record.sentIds, ["c", "b", "a"]);
  markSent(record, Array.from({ length: 300 }, (_, i) => `id${i}`));
  assert.equal(record.sentIds.length, PUSH_STORE_LIMITS.sentIds);
  assert.equal(record.sentIds[0], "id0");
});

test("stale pruning and a validated round trip through the file format", () => {
  const records = new Map<string, PushRecord>();
  upsertRecord(records, request("https://fcm.googleapis.com/fcm/send/fresh"), T0);
  upsertRecord(records, request("https://fcm.googleapis.com/fcm/send/stale"), T0 - PUSH_STORE_LIMITS.staleMs - 1);
  assert.equal(pruneStale(records, T0), 1);

  const parsed = parseStoreFile(JSON.parse(serializeStore(records, T0)));
  assert.deepEqual([...parsed.values()], [...records.values()]);

  // A tampered file cannot smuggle an arbitrary endpoint into the sender.
  const tampered = parseStoreFile({
    v: 1,
    subscriptions: [{ ...[...records.values()][0], endpoint: "https://169.254.169.254/latest" }, "junk"],
  });
  assert.equal(tampered.size, 0);
  assert.equal(parseRecord({ endpoint: "https://fcm.googleapis.com/x" }), null);
});

test("atomic write: temp file then rename, private permissions, no leftovers", async () => {
  const dir = join(tempDir(), "nested", "data");
  const path = join(dir, "store.json");
  await writeFileAtomic(path, '{"v":1}');
  assert.equal(readFileSync(path, "utf8"), '{"v":1}');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  await writeFileAtomic(path, '{"v":2}');
  assert.equal(readFileSync(path, "utf8"), '{"v":2}');
  assert.deepEqual(readdirSync(dir), ["store.json"], "no temp files left behind");
});

test("a failed write leaves the previous file intact", async () => {
  const dir = tempDir();
  const path = join(dir, "store.json");
  await writeFileAtomic(path, '{"good":true}');
  // Renaming a file over a directory fails: simulate a write that cannot complete.
  const blocked = join(dir, "blocked.json");
  mkdirSync(blocked);
  writeFileSync(join(blocked, "keep"), "x");
  await assert.rejects(writeFileAtomic(blocked, '{"bad":true}'));
  assert.equal(readFileSync(path, "utf8"), '{"good":true}');
  assert.deepEqual(readdirSync(dir).sort(), ["blocked.json", "store.json"], "the temp file was cleaned up");
});

test("debounced saves coalesce and always write the latest snapshot", async () => {
  const path = join(tempDir(), "store.json");
  const file = new JsonFile(path, { debounceMs: 20 });
  let version = 0;
  const snapshot = () => JSON.stringify({ version });
  for (let i = 0; i < 50; i += 1) {
    version = i;
    file.schedule(snapshot);
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  await file.flush();
  assert.equal(file.writes, 1);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { version: 49 });

  version = 50;
  file.schedule(snapshot);
  await file.flush();
  assert.equal(file.writes, 2);
  assert.deepEqual(await file.read(), { version: 50 });
});

test("a corrupt file is moved aside, not overwritten", async () => {
  const dir = tempDir();
  const path = join(dir, "store.json");
  writeFileSync(path, "{half a json");
  const errors: unknown[] = [];
  const file = new JsonFile(path, { onError: (error) => errors.push(error) });
  assert.equal(await file.read(), null);
  assert.equal(errors.length, 1);
  const names = readdirSync(dir);
  assert.equal(names.length, 1);
  assert.match(names[0], /^store\.json\.corrupt-\d+$/);
  assert.equal(await new JsonFile(join(dir, "missing.json")).read(), null, "a missing file is simply empty");
});
