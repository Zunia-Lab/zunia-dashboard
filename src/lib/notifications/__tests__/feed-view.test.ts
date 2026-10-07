/**
 * What the bell popover and the notification centre show: day groups on the
 * user's calendar, type and chain filters, and privacy mode's masking.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { filterNotices, groupNotices, noticeGroupOf } from "@/lib/notifications/group";
import { AMOUNT_MASK, clip, maskAmounts } from "@/lib/notifications/text";
import type { Notice, NoticeKind } from "@/lib/notifications/types";

const NOW = Date.parse("2026-10-07T09:00:00Z");
const HOUR = 3_600_000;

function notice(id: string, kind: NoticeKind, at: number, chainId?: string): Notice {
  return { id, kind, title: id, body: "", at, severity: "info", ...(chainId ? { chainId } : {}) };
}

test("groups follow calendar days in the user's zone, not 24-hour spans", () => {
  // 09:00Z is 11:00 in Paris; 23:30Z the day before is 01:30 today in Paris but 19:30 yesterday in New York.
  const lateYesterdayUtc = Date.parse("2026-10-06T23:30:00Z");
  assert.equal(noticeGroupOf(lateYesterdayUtc, NOW, "Europe/Paris"), "today");
  assert.equal(noticeGroupOf(lateYesterdayUtc, NOW, "America/New_York"), "week");
  assert.equal(noticeGroupOf(NOW - 6 * 24 * HOUR, NOW, "UTC"), "week");
  assert.equal(noticeGroupOf(NOW - 7 * 24 * HOUR, NOW, "UTC"), "earlier");
  assert.equal(noticeGroupOf(Number.NaN, NOW, "UTC"), "earlier");

  const feed = [
    notice("a", "transfer", NOW - HOUR),
    notice("b", "rewards", NOW - 2 * 24 * HOUR),
    notice("c", "governance", NOW - 30 * 24 * HOUR),
    notice("d", "ibc", NOW - 2 * HOUR),
  ];
  const groups = groupNotices(feed, NOW, "UTC");
  assert.deepEqual(
    groups.map((group) => [group.label, group.notices.map((row) => row.id)]),
    [
      ["Today", ["a", "d"]],
      ["This week", ["b"]],
      ["Earlier", ["c"]],
    ],
  );
  assert.deepEqual(groupNotices([], NOW), [], "no empty groups");
});

test("filters: a type covers the kinds a user thinks of as one; chain and unread narrow it", () => {
  const feed = [
    notice("t", "transfer", NOW, "osmosis-1"),
    notice("i", "ibc", NOW, "cosmoshub-4"),
    notice("s", "swap", NOW, "osmosis-1"),
    notice("r", "rewards", NOW),
    notice("u", "unbonding", NOW, "osmosis-1"),
    notice("v", "validator", NOW, "osmosis-1"),
    notice("g", "governance", NOW, "osmosis-1"),
    notice("z", "system", NOW),
  ];
  const ids = (rows: readonly Notice[]) => rows.map((row) => row.id);
  assert.deepEqual(ids(filterNotices(feed)), ["t", "i", "s", "r", "u", "v", "g", "z"]);
  assert.deepEqual(ids(filterNotices(feed, { filter: "transfers" })), ["t", "i", "s"]);
  assert.deepEqual(ids(filterNotices(feed, { filter: "staking" })), ["r", "u", "v"]);
  assert.deepEqual(ids(filterNotices(feed, { filter: "staking", chainId: "osmosis-1" })), ["u", "v"]);
  const read = new Set(["t", "g"]);
  assert.deepEqual(
    ids(filterNotices(feed, { chainId: "osmosis-1", unreadOnly: true, isRead: (id) => read.has(id) })),
    ["s", "u", "v"],
  );
});

test("privacy mode masks every amount of a money notice, and nothing of a vote or a validator alert", () => {
  const m = AMOUNT_MASK;
  // The activity read's own sentence formats the amount differently from data.amount.
  assert.equal(maskAmounts("Received 0.50 OSMO from osmo1zva9…g8mm", "transfer", "0.5 OSMO"), `Received ${m} OSMO from osmo1zva9…g8mm`);
  assert.equal(maskAmounts("Received 0.5 OSMO on Osmosis", "transfer", "0.5 OSMO"), `Received ${m} on Osmosis`);
  assert.equal(maskAmounts("Swapped 10 OSMO → 4.32 USDC.n", "swap"), `Swapped ${m} OSMO → ${m} USDC.n`);
  assert.equal(maskAmounts("1,234.56 ATOM landed on Osmosis.", "ibc"), `${m} ATOM landed on Osmosis.`);
  assert.equal(
    maskAmounts("950000 base units of ibc/7D72…DAB2 landed on cosmoshub-4.", "ibc"),
    `${m} base units of ibc/7D72…DAB2 landed on cosmoshub-4.`,
  );
  assert.equal(maskAmounts("12.5 ATOM from Allnodes is liquid again.", "unbonding", "12.5 ATOM"), `${m} from Allnodes is liquid again.`);
  assert.equal(maskAmounts("1INCH and ATOM2 arrived", "transfer"), "1INCH and ATOM2 arrived", "digits inside tickers stay");
  assert.equal(maskAmounts("#1049 Withdraw · ends in 5 h.", "governance"), "#1049 Withdraw · ends in 5 h.");
  assert.equal(maskAmounts("From 5% to 10% on Osmosis.", "validator"), "From 5% to 10% on Osmosis.");
  assert.equal(maskAmounts("Waiting on Osmosis and 2 more networks.", "rewards"), "Waiting on Osmosis and 2 more networks.");
});

test("clip never returns more than it was allowed", () => {
  assert.equal(clip("hello world", 0), "");
  assert.equal(clip("hello world", 1), "…");
  assert.equal(clip("hello world", 2), "h…");
  assert.equal(clip("short", 10), "short");
  for (let max = 0; max < 14; max += 1) assert.ok(clip("a fairly long sentence here", max).length <= max);
});
