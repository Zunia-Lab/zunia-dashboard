/**
 * The notification centre's day groups follow the calendar in the viewer's
 * zone (23:50 yesterday is "Yesterday", not "Today"), keep the feed's order,
 * and the counts and network list agree with the filters the page offers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Notice } from "@/lib/notifications/types";

import { filterCounts, groupByDay, noticeChains } from "../feed-view";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const H = 3_600_000;

function notice(id: string, at: number, kind: Notice["kind"] = "transfer", chainId?: string): Notice {
  return { id, kind, title: id, body: "", at, severity: "info", ...(chainId ? { chainId } : {}) };
}

test("groups by calendar day in the given zone, newest first", () => {
  const groups = groupByDay(
    [
      notice("a", NOW - 1 * H),
      notice("b", NOW - 12.5 * H), // 23:30 UTC on Oct 6
      notice("c", NOW - 3 * 24 * H),
      notice("d", NOW - 20 * 24 * H),
      notice("e", Date.parse("2025-12-31T10:00:00Z")),
    ],
    NOW,
    "UTC",
  );
  assert.deepEqual(
    groups.map((group) => [group.label, group.notices.map((n) => n.id).join("")]),
    [
      ["Today", "a"],
      ["Yesterday", "b"],
      ["Sunday, Oct 4", "c"],
      ["Sep 17", "d"],
      ["Dec 31, 2025", "e"],
    ],
  );
  // The same instant is "Today" two hours east of UTC.
  assert.equal(groupByDay([notice("b", NOW - 12.5 * H)], NOW, "Europe/Paris")[0]?.label, "Today");
});

test("a notice without a usable time lands in Earlier", () => {
  const groups = groupByDay([notice("x", Number.NaN)], NOW, "UTC");
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Earlier"],
  );
});

test("filter counts and networks match the feed", () => {
  const feed = [
    notice("1", NOW, "transfer", "osmosis-1"),
    notice("2", NOW, "ibc", "osmosis-1"),
    notice("3", NOW, "rewards", "celestia"),
    notice("4", NOW, "governance", "cosmoshub-4"),
    notice("5", NOW, "system"),
  ];
  assert.deepEqual(filterCounts(feed), { all: 5, transfers: 2, staking: 1, governance: 1, system: 1 });
  assert.deepEqual(noticeChains(feed), [
    { chainId: "osmosis-1", count: 2 },
    { chainId: "celestia", count: 1 },
    { chainId: "cosmoshub-4", count: 1 },
  ]);
});
