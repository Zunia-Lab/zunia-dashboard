/**
 * Merging per-account searches into one page, and the coverage verdict.
 *
 * The invariants under test are the ones a user would notice when they
 * break: a row never appears twice and never goes missing between pages, a
 * page never shows an old row from one chain while a newer row from another
 * chain is still unread, and "complete" is only claimed with evidence.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_ACCOUNT_CURSOR, type AccountCursor } from "../cursor";
import type { ActivityItem, ActivityKind } from "../types";
import { coverageOf, mergeWindows, type AccountWindow, type CoverageInput, type SearchWindow } from "../window";

const T0 = Date.UTC(2026, 9, 1);

function row(chainId: string, height: number, minute: number, options: { kind?: ActivityKind; signed?: boolean; hash?: string } = {}): ActivityItem {
  return {
    chainId,
    address: `${chainId}-account`,
    hash: options.hash ?? `${chainId}-${height}`.toUpperCase(),
    height,
    time: new Date(T0 + minute * 60_000).toISOString(),
    kind: options.kind ?? "send",
    success: true,
    summary: `row ${height}`,
    fee: null,
    feePaid: options.signed ?? false,
    signed: options.signed ?? false,
    amounts: [],
    messages: 1,
    primaryType: "MsgSend",
  };
}

function search(items: ActivityItem[], exhausted: boolean, failed = false): SearchWindow {
  const oldest = items.length > 0 ? Math.min(...items.map((item) => Date.parse(item.time))) : null;
  return { items, oldest, exhausted, failed };
}

function window(searches: SearchWindow[], cursor: AccountCursor = EMPTY_ACCOUNT_CURSOR): AccountWindow {
  return { searches, cursor };
}

const at = (minute: number) => T0 + minute * 60_000;

describe("mergeWindows", () => {
  it("keeps the list complete above the slowest unfinished search", () => {
    // Sender search stopped at minute 100 (more pages exist); recipient search is done.
    const sender = search([row("a", 30, 300), row("a", 20, 200), row("a", 10, 100)], false);
    const recipient = search([row("a", 25, 250), row("a", 5, 50)], true);
    const merged = mergeWindows([window([sender, recipient])], { limit: 10, kinds: null, before: null });
    assert.deepEqual(merged.items.map((item) => item.height), [30, 25, 20]);
    assert.equal(merged.watermark, at(100));
    assert.equal(merged.boundary, at(100));
    assert.deepEqual(merged.bottlenecks, [{ account: 0, search: 0 }]);
    assert.equal(merged.accounts[0].remaining, true);
    assert.equal(merged.accounts[0].cursor.upper, 19);
  });

  it("holds back an older row of one chain while another chain's newer rows are unread", () => {
    const a = window([search([row("a", 9, 300), row("a", 8, 150)], true), search([], true)]);
    const b = window([search([row("b", 70, 400), row("b", 60, 200)], false), search([], true)]);
    const merged = mergeWindows([a, b], { limit: 10, kinds: null, before: null });
    assert.deepEqual(merged.items.map((item) => `${item.chainId}${item.height}`), ["b70", "a9"]);
    assert.equal(merged.accounts[0].remaining, true, "a's row at minute 150 is still to come");
    assert.equal(merged.accounts[0].cursor.upper, 8);
    assert.equal(merged.accounts[1].cursor.upper, 69);
  });

  it("cuts at the limit but keeps every row of the boundary second", () => {
    const rows = [row("a", 50, 500), row("a", 41, 400, { hash: "X1" }), row("a", 41, 400, { hash: "X2" }), row("a", 40, 400), row("a", 30, 300)];
    const merged = mergeWindows([window([search(rows, true)])], { limit: 2, kinds: null, before: null });
    assert.deepEqual(merged.items.map((item) => item.hash), ["A-50", "X1", "X2", "A-40"]);
    assert.equal(merged.boundary, at(400));
    assert.equal(merged.accounts[0].consumed, 4);
    assert.equal(merged.accounts[0].cursor.upper, 39);
    assert.equal(merged.accounts[0].remaining, true);
    assert.deepEqual(merged.bottlenecks, []);
  });

  it("pages forward with the cursor: no repeats, no gaps", () => {
    const all = Array.from({ length: 7 }, (_, i) => row("a", 100 - i, 1000 - i * 10));
    const pageOf = (cursor: AccountCursor) => {
      const visible = all.filter((item) => cursor.upper === null || item.height <= cursor.upper);
      return mergeWindows([window([search(visible, true)], cursor)], { limit: 3, kinds: null, before: null });
    };
    const first = pageOf(EMPTY_ACCOUNT_CURSOR);
    const second = pageOf(first.accounts[0].cursor);
    const third = pageOf(second.accounts[0].cursor);
    const seen = [...first.items, ...second.items, ...third.items].map((item) => item.height);
    assert.deepEqual(seen, [100, 99, 98, 97, 96, 95, 94]);
    assert.equal(third.accounts[0].remaining, false);
    assert.equal(third.boundary, null);
  });

  it("counts filtered-out rows as consumed so a filtered view moves on", () => {
    const rows = [row("a", 5, 500, { kind: "vote" }), row("a", 4, 400), row("a", 3, 300, { kind: "vote" }), row("a", 2, 200)];
    const merged = mergeWindows([window([search(rows, true)])], { limit: 1, kinds: new Set(["vote"]), before: null });
    assert.deepEqual(merged.items.map((item) => item.height), [5]);
    // Rows newer than the cut are consumed whatever their kind; the next page starts below row 5.
    assert.equal(merged.accounts[0].cursor.upper, 4);
    const next = mergeWindows([window([search(rows.slice(1), true)], merged.accounts[0].cursor)], { limit: 1, kinds: new Set(["vote"]), before: null });
    assert.deepEqual(next.items.map((item) => item.height), [3]);
  });

  it("reads strictly before a time in `before` mode", () => {
    const rows = [row("a", 5, 500), row("a", 4, 400), row("a", 3, 300)];
    const merged = mergeWindows([window([search(rows, true)])], { limit: 10, kinds: null, before: at(400) });
    assert.deepEqual(merged.items.map((item) => item.height), [3]);
  });

  it("dedupes a transaction both searches returned", () => {
    const shared = row("a", 7, 700);
    const merged = mergeWindows([window([search([shared], true), search([shared, row("a", 6, 600)], true)])], { limit: 10, kinds: null, before: null });
    assert.deepEqual(merged.items.map((item) => item.height), [7, 6]);
  });

  it("does not let a failed search hold the others back, keeps it to retry, and remembers the gap", () => {
    const merged = mergeWindows([window([search([], false, true), search([row("a", 3, 300)], true)])], { limit: 10, kinds: null, before: null });
    assert.deepEqual(merged.items.map((item) => item.height), [3]);
    // The failed search is tried again on the next page…
    assert.equal(merged.accounts[0].remaining, true);
    assert.equal(merged.accounts[0].cursor.done, undefined);
    // …but the bound moved past row 3 without it: coverage must keep saying so.
    assert.equal(merged.accounts[0].cursor.gapped, true);
    assert.equal(merged.accounts[0].cursor.upper, 2);
  });

  it("marks an account finished once both searches ended and every row is used", () => {
    const merged = mergeWindows([window([search([row("a", 3, 300)], true), search([], true)])], { limit: 10, kinds: null, before: null });
    assert.equal(merged.accounts[0].remaining, false);
    assert.equal(merged.accounts[0].cursor.done, true);
    assert.equal(merged.accounts[0].cursor.gapped, undefined);
    // Not finished while a row is held back by the limit.
    const cut = mergeWindows([window([search([row("a", 3, 300), row("a", 2, 200)], true), search([], true)])], { limit: 1, kinds: null, before: null });
    assert.equal(cut.accounts[0].cursor.done, undefined);
  });

  it("in `before` mode, skips rows newer than `before` for good and never reports a later boundary", () => {
    // Nothing older than `before` has been reached yet: no rows, a boundary of
    // `before` itself, and a cursor below what was skipped.
    const newer = search([row("a", 50, 900), row("a", 40, 800)], false);
    const first = mergeWindows([window([newer, search([], true)])], { limit: 10, kinds: null, before: at(500) });
    assert.deepEqual(first.items, []);
    assert.equal(first.boundary, at(500));
    assert.equal(first.accounts[0].remaining, true);
    // Row 40 sits at the watermark (its search may hold more in that second): not consumed yet.
    assert.equal(first.accounts[0].cursor.upper, 49);
    // The next page continues below and returns what is older than `before`.
    const next = mergeWindows(
      [window([search([row("a", 40, 800), row("a", 30, 400), row("a", 20, 300)], true), search([], true)], first.accounts[0].cursor)],
      { limit: 10, kinds: null, before: at(500) },
    );
    assert.deepEqual(next.items.map((item) => item.height), [30, 20]);
    assert.equal(next.boundary, null);
    assert.equal(next.accounts[0].cursor.done, true);
  });

  it("tracks the oldest row and the signed count for the coverage verdict", () => {
    const rows = [row("a", 9, 900, { signed: true }), row("a", 8, 800, { signed: true }), row("a", 1, 100)];
    const merged = mergeWindows([window([search(rows, true)], { upper: null, oldest: null, oldestSigned: false, signedSeen: 3 })], {
      limit: 10,
      kinds: null,
      before: null,
    });
    assert.deepEqual(merged.accounts[0].cursor, { upper: 0, oldest: at(100), oldestSigned: false, signedSeen: 5, done: true });
  });
});

describe("coverageOf", () => {
  const base: CoverageInput = {
    chainId: "osmosis-1",
    address: "osmo1x",
    failed: false,
    partial: null,
    remaining: false,
    boundary: null,
    cursor: { upper: 10, oldest: at(500), oldestSigned: false, signedSeen: 4 },
    pruned: null,
    retention: { fromGenesis: false, lowestTime: at(100) },
    account: { exists: true, sequence: 4 },
  };

  it("claims complete with evidence: window starts earlier, funding transfer first, every signed tx seen", () => {
    assert.deepEqual(coverageOf(base), { chainId: "osmosis-1", address: "osmo1x", oldest: new Date(at(500)).toISOString(), complete: true });
  });

  it("is partial when the account signed more than the node returned", () => {
    const coverage = coverageOf({ ...base, account: { exists: true, sequence: 9 } });
    assert.equal(coverage.complete, false);
    assert.equal(coverage.oldest, new Date(at(100)).toISOString());
    assert.equal(coverage.note, `This node keeps history since ${new Date(at(100)).toISOString().slice(0, 10)}.`);
  });

  it("does not date the window later than rows the node returned", () => {
    const coverage = coverageOf({ ...base, cursor: { ...base.cursor, oldest: at(50) }, account: { exists: true, sequence: 9 } });
    assert.equal(coverage.complete, false);
    assert.equal(coverage.oldest, new Date(at(50)).toISOString());
    assert.match(coverage.note ?? "", /keep a limited window/);
  });

  it("is partial when the oldest row is a spend of older funds", () => {
    assert.equal(coverageOf({ ...base, cursor: { ...base.cursor, oldestSigned: true } }).complete, false);
  });

  it("is complete on a node that keeps the chain from genesis", () => {
    const coverage = coverageOf({ ...base, retention: { fromGenesis: true, lowestTime: null }, account: null });
    assert.equal(coverage.complete, true);
  });

  it("is complete for an account the chain has never seen", () => {
    const coverage = coverageOf({ ...base, cursor: EMPTY_ACCOUNT_CURSOR, account: { exists: false, sequence: 0 } });
    assert.deepEqual(coverage, { chainId: "osmosis-1", address: "osmo1x", oldest: null, complete: true });
  });

  it("states the window when more pages remain", () => {
    const coverage = coverageOf({ ...base, remaining: true, boundary: at(300) });
    assert.deepEqual(coverage, { chainId: "osmosis-1", address: "osmo1x", oldest: new Date(at(300)).toISOString(), complete: false });
  });

  it("keeps saying a gap was stepped over, on every later page", () => {
    const gapped = coverageOf({ ...base, cursor: { ...base.cursor, gapped: true } });
    assert.equal(gapped.complete, false);
    assert.match(gapped.note ?? "", /could not be read while loading older pages/);
    const open = coverageOf({ ...base, remaining: true, boundary: at(300), cursor: { ...base.cursor, gapped: true } });
    assert.match(open.note ?? "", /could not be read while loading older pages/);
  });

  it("names a pruned node's window and a failed read", () => {
    assert.match(coverageOf({ ...base, pruned: { since: at(200) } }).note ?? "", /only serves history since/);
    assert.equal(coverageOf({ ...base, failed: true }).oldest, null);
    assert.match(coverageOf({ ...base, partial: "incoming" }).note ?? "", /Incoming transfers could not be read/);
    assert.equal(coverageOf({ ...base, partial: "incoming", retention: { fromGenesis: true, lowestTime: null } }).complete, false);
  });

  it("claims nothing past the list itself when the chain's nodes disagree", () => {
    // Evidence that would otherwise prove completeness, on every path.
    for (const input of [
      base,
      { ...base, retention: { fromGenesis: true, lowestTime: null }, account: null },
      { ...base, account: { exists: true, sequence: 9 } },
    ]) {
      const coverage = coverageOf({ ...input, inconsistent: true });
      assert.equal(coverage.complete, false);
      // The list's own oldest row, never the probe's window start.
      assert.equal(coverage.oldest, new Date(at(500)).toISOString());
      assert.match(coverage.note ?? "", /answered differently/);
    }
  });

  it("dates a mixed window by the node that keeps least, and says so", () => {
    const coverage = coverageOf({ ...base, retention: { fromGenesis: false, lowestTime: at(100), mixed: true }, account: { exists: true, sequence: 9 } });
    assert.equal(coverage.complete, false);
    assert.match(coverage.note ?? "", /keep different windows/);
  });
});
