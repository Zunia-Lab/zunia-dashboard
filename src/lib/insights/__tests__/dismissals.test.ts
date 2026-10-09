import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeDismissals,
  dismissInsights,
  EMPTY_BOOK,
  INSIGHT_REST_MS,
  isDismissed,
  readBook,
  restoreInsights,
  splitDismissed,
} from "@/lib/insights/dismissals";

const NOW = Date.UTC(2026, 9, 9, 12);
const DAY = 24 * 60 * 60 * 1000;
const ME = "addr_safro1me";

test("an opened insight is hidden, the others stay", () => {
  const items = [
    { id: "claim:cosmoshub-4", severity: "opportunity" as const },
    { id: "idle-stake:celestia", severity: "opportunity" as const },
  ];
  const book = dismissInsights(EMPTY_BOOK, ME, [items[0]], NOW);
  const { visible, hidden } = splitDismissed(items, book[ME], NOW + 1000);
  assert.deepEqual(visible.map((item) => item.id), ["idle-stake:celestia"]);
  assert.deepEqual(hidden.map((item) => item.id), ["claim:cosmoshub-4"]);
});

test("a hidden insight comes back after the rest period if it still holds", () => {
  const entry = { at: NOW, severity: "opportunity" as const };
  assert.equal(isDismissed({ id: "claim:cosmoshub-4", severity: "opportunity" }, entry, NOW + INSIGHT_REST_MS - 1), true);
  assert.equal(isDismissed({ id: "claim:cosmoshub-4", severity: "opportunity" }, entry, NOW + INSIGHT_REST_MS), false);
});

test("a hidden insight comes back at once when it becomes more urgent", () => {
  const entry = { at: NOW, severity: "info" as const };
  assert.equal(isDismissed({ id: "vote:osmosis-1:1049", severity: "info" }, entry, NOW + DAY), true);
  assert.equal(isDismissed({ id: "vote:osmosis-1:1049", severity: "warning" }, entry, NOW + DAY), false);
  // Less urgent than when it was hidden: still hidden.
  assert.equal(isDismissed({ id: "validator-risk:celestia:x", severity: "info" }, { at: NOW, severity: "warning" }, NOW + DAY), true);
});

test("a cleared vote stays cleared past the rest period: its proposal ends on its own", () => {
  const entry = { at: NOW, severity: "warning" as const };
  assert.equal(isDismissed({ id: "vote:cosmoshub-4:1058", severity: "warning" }, entry, NOW + 12 * DAY), true);
});

test("dismissals are kept per account", () => {
  const book = dismissInsights(EMPTY_BOOK, ME, [{ id: "unpriced", severity: "info" }], NOW);
  assert.equal(isDismissed({ id: "unpriced", severity: "info" }, book["addr_safro1other"]?.unpriced, NOW), false);
  assert.equal(activeDismissals(book, ME, NOW), 1);
  assert.equal(activeDismissals(book, "addr_safro1other", NOW), 0);
  assert.equal(activeDismissals(book, null, NOW), 0);
});

test("show them again forgets this account's dismissals only", () => {
  let book = dismissInsights(EMPTY_BOOK, ME, [{ id: "unpriced", severity: "info" }], NOW);
  book = dismissInsights(book, "addr_safro1other", [{ id: "unpriced", severity: "info" }], NOW);
  const next = restoreInsights(book, ME);
  assert.equal(ME in next, false);
  assert.equal("addr_safro1other" in next, true);
  assert.equal(restoreInsights(next, ME), next);
});

test("records past any use are pruned on the next write, and the list is capped", () => {
  let book = dismissInsights(EMPTY_BOOK, ME, [{ id: "old", severity: "info" }], NOW - 40 * DAY);
  book = dismissInsights(book, ME, [{ id: "new", severity: "info" }], NOW);
  assert.deepEqual(Object.keys(book[ME]), ["new"]);
  const many = Array.from({ length: 400 }, (_, i) => ({ id: `concentration:asset:${i}`, severity: "info" as const }));
  assert.equal(Object.keys(dismissInsights(EMPTY_BOOK, ME, many, NOW)[ME]).length, 300);
});

test("whatever localStorage held is read defensively", () => {
  assert.equal(readBook(null), EMPTY_BOOK);
  assert.equal(readBook([1, 2]), EMPTY_BOOK);
  const book = readBook({
    [ME]: { ok: { at: NOW, severity: "info" }, badSeverity: { at: NOW, severity: "loud" }, badAt: { at: "now", severity: "info" }, "": { at: NOW, severity: "info" } },
    empty: {},
    junk: "x",
  });
  assert.deepEqual(Object.keys(book), [ME]);
  assert.deepEqual(Object.keys(book[ME]), ["ok"]);
});
