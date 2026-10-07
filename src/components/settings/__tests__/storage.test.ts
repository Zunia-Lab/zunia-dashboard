/**
 * "Clear local data" removes exactly the dashboard's keys: never the theme,
 * never the wallet SDK's session record, never another site's or app's keys,
 * and none skipped by removing while iterating.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bytesText, clearDashboardData, dashboardKeys, footprint, type KeyStore } from "../storage";

class FakeStorage implements KeyStore {
  private map = new Map<string, string>();
  constructor(entries: Record<string, string>) {
    for (const [key, value] of Object.entries(entries)) this.map.set(key, value);
  }
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  keys() {
    return [...this.map.keys()].sort();
  }
}

test("only dashboard keys are listed and cleared; the theme and the wallet session stay", () => {
  const local = new FakeStorage({
    "zunia-theme": "light",
    "zunia.dashboard.followed": '["safrochain-1"]',
    "zunia.dashboard.currency": '"eur"',
    "zunia.dashboard.api.v1:/api/portfolio?accounts=x": "{}",
    "zunia.dashboard.walletHint": "{}",
    "zunia.connect.v2.session": "{}",
    "other-app": "1",
  });
  const session = new FakeStorage({ "zunia.dashboard.iosInstallDismissed": "1", unrelated: "x" });

  assert.deepEqual(dashboardKeys(local), [
    "zunia.dashboard.api.v1:/api/portfolio?accounts=x",
    "zunia.dashboard.currency",
    "zunia.dashboard.followed",
    "zunia.dashboard.walletHint",
  ]);
  assert.equal(clearDashboardData([local, session]), 5);
  assert.deepEqual(local.keys(), ["other-app", "zunia-theme", "zunia.connect.v2.session"]);
  assert.deepEqual(session.keys(), ["unrelated"]);
});

test("footprint counts what the browser counts", () => {
  const store = new FakeStorage({ "zunia.dashboard.a": "12345", "zunia-theme": "dark" });
  // ("zunia.dashboard.a".length + "12345".length) × 2 bytes per UTF-16 unit.
  assert.deepEqual(footprint(store), { count: 1, bytes: (17 + 5) * 2 });
});

test("bytes read the way a person reads them", () => {
  assert.equal(bytesText(640), "640 B");
  assert.equal(bytesText(12 * 1024 + 300), "12 KB");
  assert.equal(bytesText(1.4 * 1024 * 1024), "1.4 MB");
  assert.equal(bytesText(Number.NaN), "—");
});
