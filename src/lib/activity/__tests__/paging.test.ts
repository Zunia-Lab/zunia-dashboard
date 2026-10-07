/**
 * Client paging: rows stay put when the first page refreshes, the loaded
 * extent is stated honestly, and date ranges load older pages only while
 * they must.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadedExtent, mergeLoaded, rowKey, shouldAutoLoad } from "../paging";
import type { ActivityItem, ActivityPage } from "../types";

function row(hash: string, minute: number, address = "osmo1a"): ActivityItem {
  return {
    chainId: "osmosis-1",
    address,
    hash,
    height: minute,
    time: new Date(Date.UTC(2026, 9, 1) + minute * 60_000).toISOString(),
    kind: "send",
    success: true,
    summary: hash,
    fee: null,
    feePaid: false,
    signed: false,
    amounts: [],
    messages: 1,
    primaryType: "MsgSend",
  };
}

function page(items: ActivityItem[], nextCursor: string | null, nextBefore: string | null = null): ActivityPage {
  return { updatedAt: 0, items, coverage: [], nextCursor, nextBefore };
}

describe("mergeLoaded", () => {
  it("keeps rows a refresh pushed off the first page, newest first, once each", () => {
    const before = [row("C", 30), row("B", 20)];
    const refreshed = page([row("D", 40), row("C", 30)], "c2");
    const older = page([row("A", 10)], null);
    assert.deepEqual(mergeLoaded(refreshed, before, [older]).map((item) => item.hash), ["D", "C", "B", "A"]);
  });

  it("keeps one row per account: a transfer between two of your accounts is two rows", () => {
    const rows = mergeLoaded(page([row("X", 5, "osmo1a"), row("X", 5, "osmo1b")], null), [], []);
    assert.equal(rows.length, 2);
    assert.notEqual(rowKey(rows[0]), rowKey(rows[1]));
  });
});

describe("loadedExtent", () => {
  const rows = [row("B", 20), row("A", 10)];
  const since = Date.UTC(2026, 9, 1) + 15 * 60_000;

  it("names the boundary while more exists, nothing once all is loaded", () => {
    assert.deepEqual(loadedExtent(page(rows, "c", "2026-10-01T00:10:00.000Z"), rows, null), {
      loadedUntil: "2026-10-01T00:10:00.000Z",
      reachedSince: true,
    });
    assert.deepEqual(loadedExtent(page(rows, null), rows, null), { loadedUntil: null, reachedSince: true });
    // A page that named no boundary: the oldest row loaded is the honest edge.
    assert.equal(loadedExtent(page(rows, "c", null), rows, null).loadedUntil, rows[1].time);
  });

  it("reaches a date range only when the loaded list is complete back to it", () => {
    assert.equal(loadedExtent(null, [], since).reachedSince, false);
    assert.equal(loadedExtent(page(rows, "c", "2026-10-01T00:20:00.000Z"), rows, since).reachedSince, false);
    assert.equal(loadedExtent(page(rows, "c", "2026-10-01T00:10:00.000Z"), rows, since).reachedSince, true);
    assert.equal(loadedExtent(page(rows, null), rows, since).reachedSince, true);
  });
});

describe("shouldAutoLoad", () => {
  const base = { since: 1, reachedSince: false, loading: false, failed: false, pagesLoaded: 0, maxPages: 10, nextCursor: "c", stale: false };

  it("loads older pages for a range until it is reached", () => {
    assert.equal(shouldAutoLoad(base), true);
    assert.equal(shouldAutoLoad({ ...base, reachedSince: true }), false);
    assert.equal(shouldAutoLoad({ ...base, since: null }), false);
  });

  it("never loops: one at a time, not after a failure, within the page budget, not on stale rows", () => {
    assert.equal(shouldAutoLoad({ ...base, loading: true }), false);
    assert.equal(shouldAutoLoad({ ...base, failed: true }), false);
    assert.equal(shouldAutoLoad({ ...base, pagesLoaded: 10 }), false);
    assert.equal(shouldAutoLoad({ ...base, nextCursor: null }), false);
    assert.equal(shouldAutoLoad({ ...base, stale: true }), false);
  });
});
