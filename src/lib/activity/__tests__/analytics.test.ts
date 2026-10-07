/**
 * Analytics over decoded recorded transactions plus a few synthetic rows for
 * time buckets. Money rules are the point: fees only where the account paid,
 * unpriced tokens counted and never valued at 0, USD always an estimate.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activityByDay,
  activityByPeriod,
  activityCsv,
  activityStats,
  busiestTimes,
  chainUsage,
  csvCell,
  exactUnits,
  feeSummary,
  filterActivity,
  flowSummary,
  groupOf,
  kindCounts,
  priceMapFrom,
  successRate,
  topCounterparties,
} from "../analytics";
import { decodeActivity } from "../decode";
import type { ActivityCoverage, ActivityItem } from "../types";
import { ACCOUNTS, fixture, testContext } from "./helpers";

function decoded(name: string, chainId: string, address: string): ActivityItem {
  const item = decodeActivity(fixture(name), address, testContext(chainId));
  assert.ok(item);
  return item;
}

/** One account's view of every fixture it signed or received. */
const ITEMS: ActivityItem[] = [
  decoded("safro-send.json", "safrochain-1", ACCOUNTS.vinjan),
  decoded("safro-receive.json", "safrochain-1", ACCOUNTS.vinjan),
  decoded("safro-ibc-in.json", "safrochain-1", ACCOUNTS.vinjan),
  decoded("safro-claim.json", "safrochain-1", ACCOUNTS.vinjan),
  decoded("safro-undelegate.json", "safrochain-1", ACCOUNTS.vinjan),
  decoded("safro-ibc-out.json", "safrochain-1", ACCOUNTS.winnode),
  decoded("safro-failed-transfer.json", "safrochain-1", ACCOUNTS.winnode),
  decoded("osmo-zunia-swap.json", "osmosis-1", ACCOUNTS.swapper),
  decoded("hub-vote.json", "cosmoshub-4", ACCOUNTS.everstake),
  decoded("kava-vote-sdk47.json", "kava_2222-10", ACCOUNTS.kava),
];

const PRICES = new Map<string, number>([
  ["safrochain-1:usaf", 0.02],
  ["osmosis-1:uosmo", 0.035],
  ["cosmoshub-4:uatom", 1.8],
  ["injective-1:erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a", 1],
]);

describe("counts", () => {
  it("counts kinds, groups and failures", () => {
    const kinds = kindCounts(ITEMS);
    assert.equal(kinds.send, 1);
    assert.equal(kinds["ibc-out"], 2);
    assert.equal(kinds.vote, 2);
    assert.equal(groupOf("claim"), "staking");
    assert.deepEqual(successRate(ITEMS), { total: 10, succeeded: 9, failed: 1, rate: 0.9 });
    assert.deepEqual(successRate([]), { total: 0, succeeded: 0, failed: 0, rate: null });
    assert.deepEqual(chainUsage(ITEMS).map((row) => [row.chainId, row.count, row.failed]), [
      ["safrochain-1", 7, 1],
      // Ties: most recent first.
      ["osmosis-1", 1, 0],
      ["cosmoshub-4", 1, 0],
      ["kava_2222-10", 1, 0],
    ]);
  });

  it("ranks counterparties", () => {
    const top = topCounterparties(ITEMS, 2);
    assert.equal(top.length, 2);
    // Vinjan claimed from and undelegated from its own validator.
    assert.equal(top[0].address, "addr_safrovaloper1t0aw2zvghsdr7avfksgtsu090w8nvqpckefdsq");
    assert.equal(top[0].count, 2);
    assert.deepEqual(top[0].kinds, { claim: 1, undelegate: 1 });
    assert.equal(top[1].count, 1);
    assert.deepEqual(topCounterparties(ITEMS, 0), []);
  });
});

describe("fees", () => {
  it("counts only fees the account paid, priced at today's price as an estimate", () => {
    const fees = feeSummary(ITEMS, PRICES);
    // Paid: send, claim, undelegate (Vinjan), ibc-out and the failed one (Winnode), the swap, two votes.
    assert.equal(fees.count, 8);
    const saf = fees.byToken.find((token) => token.key === "safrochain-1:usaf");
    assert.equal(saf?.amount, String(6545 + 9744 + 14764 + 37500 + 37500));
    assert.equal(saf?.count, 5);
    assert.ok(Math.abs((saf?.value ?? 0) - 0.106053 * 0.02) < 1e-12);
    // KAVA has no price: counted, not valued.
    const kava = fees.byToken.find((token) => token.key === "kava_2222-10:ukava");
    assert.equal(kava?.value, null);
    assert.equal(fees.unpriced, 1);
    assert.equal(fees.estimate, true);
    assert.match(fees.method, /today's price/);
    assert.equal(fees.byChain.find((chain) => chain.chainId === "kava_2222-10")?.value, null);
  });

  it("has no money value at all without prices", () => {
    const fees = feeSummary(ITEMS);
    assert.equal(fees.value, null);
    assert.equal(fees.unpriced, fees.byToken.length);
  });
});

describe("flows", () => {
  it("sums sent and received by token in base units, transfers and IBC only by default", () => {
    const flows = flowSummary(ITEMS, { prices: PRICES });
    const saf = flows.byToken.find((token) => token.key === "safrochain-1:usaf");
    assert.equal(saf?.in, "5000000");
    assert.equal(saf?.out, String(17000000000 + 3490000000));
    const usdc = flows.byToken.find((token) => token.symbol === "USDC.inj");
    assert.equal(usdc?.in, "760");
    assert.ok(Math.abs((flows.inValue ?? NaN) - (5 * 0.02 + 0.00076)) < 1e-9);
    assert.ok(Math.abs((flows.outValue ?? NaN) - 20490 * 0.02) < 1e-6);
    assert.equal(flows.unpriced, 0);
    // The swap and the rewards are not "sent / received".
    assert.equal(flows.byToken.some((token) => token.key === "osmosis-1:uosmo"), false);
  });

  it("includes other groups on request and counts unpriced entries, never as 0", () => {
    const flows = flowSummary(ITEMS, { groups: ["swaps"] });
    assert.equal(flows.byToken.length, 2);
    // Nothing priced: no money figure at all, rather than "$0 received".
    assert.equal(flows.inValue, null);
    assert.equal(flows.outValue, null);
    assert.equal(flows.unpriced, 3);
    assert.equal(flows.unpricedIn, 1);
    assert.equal(flows.unpricedOut, 2);
    assert.deepEqual(flows.byChain.map((chain) => [chain.chainId, chain.inCount, chain.outCount, chain.inValue]), [["osmosis-1", 1, 2, null]]);
  });

  it("builds a price map from /api/prices, leaving unpriced keys out", () => {
    const map = priceMapFrom({ "osmosis-1:uosmo": { price: 0.03 }, "x:unpriced": null, "y:bad": { price: Number.NaN } });
    assert.deepEqual([...map], [["osmosis-1:uosmo", 0.03]]);
    assert.equal(priceMapFrom(null).size, 0);
  });

  it("puts the strip together", () => {
    const stats = activityStats(ITEMS, PRICES);
    assert.equal(stats.count, 10);
    assert.equal(stats.failed, 1);
    assert.equal(stats.swaps, 1);
    assert.equal(stats.ibcTransfers, 3);
  });
});

describe("filters", () => {
  it("filters by chip group, failure, chain, time, asset and free text", () => {
    assert.equal(filterActivity(ITEMS, {}).length, ITEMS.length);
    assert.deepEqual(
      filterActivity(ITEMS, { groups: ["governance"] }).map((item) => item.chainId),
      ["cosmoshub-4", "kava_2222-10"],
    );
    assert.deepEqual(filterActivity(ITEMS, { failedOnly: true }).map((item) => item.kind), ["ibc-out"]);
    assert.equal(filterActivity(ITEMS, { chains: ["osmosis-1"] }).length, 1);
    assert.equal(filterActivity(ITEMS, { groups: ["staking"], kinds: ["vote"] }).length, 4, "groups and kinds combine as OR");
    assert.equal(filterActivity(ITEMS, { since: Date.parse("2026-10-01T00:00:00Z") }).every((item) => Date.parse(item.time) >= Date.parse("2026-10-01T00:00:00Z")), true);
    assert.equal(filterActivity(ITEMS, { assetKey: "injective-1:erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a" }).length, 2);
    assert.equal(filterActivity(ITEMS, { query: "3c81d97e" }).length, 1, "hash, any case");
    assert.equal(filterActivity(ITEMS, { query: "thanks" }).length, 1, "memo");
    assert.equal(filterActivity(ITEMS, { query: "usdc.inj" }).length, 2, "ticker");
  });

  it("groups rows by day, newest day first, keeping row order", () => {
    const days = activityByDay(ITEMS, "utc");
    assert.ok(days.length > 1);
    for (let i = 1; i < days.length; i++) assert.ok(days[i - 1].start > days[i].start);
    assert.equal(days.reduce((sum, day) => sum + day.items.length, 0), ITEMS.length);
    assert.match(days[0].label, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("time", () => {
  const at = (iso: string): ActivityItem => ({ ...ITEMS[0], hash: iso, time: iso });

  it("buckets by UTC day and fills the gaps", () => {
    const rows = activityByPeriod(
      [at("2026-10-01T10:00:00Z"), at("2026-10-01T23:59:59Z"), at("2026-10-03T00:00:00Z")],
      { bucket: "day", zone: "utc" },
    );
    assert.deepEqual(rows.map((row) => [row.label, row.total, row.byGroup.transfers]), [
      ["2026-10-01", 2, 2],
      ["2026-10-02", 0, 0],
      ["2026-10-03", 1, 1],
    ]);
  });

  it("buckets by ISO week starting Monday, within a range", () => {
    const rows = activityByPeriod([at("2026-10-04T12:00:00Z"), at("2026-10-05T12:00:00Z")], {
      bucket: "week",
      zone: "utc",
      from: Date.UTC(2026, 8, 28),
      to: Date.UTC(2026, 9, 11),
    });
    assert.deepEqual(rows.map((row) => [row.label, row.total]), [
      ["2026-09-28", 1],
      ["2026-10-05", 1],
    ]);
  });

  it("finds the busiest weekday and hour", () => {
    const busy = busiestTimes([at("2026-10-05T09:15:00Z"), at("2026-10-05T09:45:00Z"), at("2026-10-06T22:00:00Z")], "utc");
    assert.equal(busy.weekday, 0, "Monday");
    assert.equal(busy.hour, 9);
    assert.equal(busy.byWeekday.reduce((a, b) => a + b, 0), 3);
    assert.deepEqual(busiestTimes([], "utc").weekday, null);
  });
});

describe("CSV", () => {
  const coverage: ActivityCoverage[] = [
    { chainId: "safrochain-1", address: ACCOUNTS.vinjan, oldest: "2026-06-25T12:08:15.000Z", complete: true },
    { chainId: "osmosis-1", address: ACCOUNTS.swapper, oldest: "2026-07-13T00:00:00.000Z", complete: false, note: "This node keeps history since 2026-07-13." },
  ];

  it("writes a coverage line, the header, one line per amount, the fee once", () => {
    const csv = activityCsv([decoded("osmo-zunia-swap.json", "osmosis-1", ACCOUNTS.swapper)], coverage, { now: Date.UTC(2026, 9, 7) });
    const lines = csv.trimEnd().split("\r\n");
    assert.equal(
      lines[0],
      "# Zunia activity export 2026-10-07T00:00:00.000Z · coverage: safrochain-1 complete; osmosis-1 since 2026-07-13 (partial: This node keeps history since 2026-07-13.)",
    );
    assert.equal(lines[1], "date,chain,hash,kind,direction,amount,token,fee,fee token,memo,success");
    assert.equal(lines.length, 5);
    assert.equal(
      lines[2],
      "2026-10-06T21:52:30Z,osmosis-1,7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3,swap,out,100,OSMO,0.078179,OSMO,Swap OSMO to USDC.inj · by Zunia-wallet,true",
    );
    assert.equal(lines[3], "2026-10-06T21:52:30Z,osmosis-1,7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3,swap,out,3.431895,USDC.inj,,,,true");
    assert.equal(lines[4], "2026-10-06T21:52:30Z,osmosis-1,7B5E447B64067CF2E5E31D4921927156C3F9B9B913E06895239E0795D72B57F3,swap,in,3.494518,USDC.inj,,,,true");
  });

  it("leaves out fees the account did not pay and says when amounts are base units", () => {
    const received = decoded("safro-receive.json", "safrochain-1", ACCOUNTS.vinjan);
    const unknown = { ...received, amounts: [{ ...received.amounts[0], identity: { ...received.amounts[0].identity, decimals: null, ticker: "IBC·1E18" } }] };
    const lines = activityCsv([unknown], [], { now: 0 }).trimEnd().split("\r\n");
    assert.equal(lines[0], "# Zunia activity export 1970-01-01T00:00:00.000Z · coverage: none");
    assert.match(lines[2], /,receive,in,5000000,IBC·1E18 \(base units\),,,thanks,true$/);
  });

  it("quotes separators and defuses formulas in memos", () => {
    assert.equal(csvCell('a,b "c"'), '"a,b ""c"""');
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell("-1"), "'-1");
    assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
    assert.equal(csvCell("plain"), "plain");
  });

  it("starts a downloaded file with a byte order mark when asked", () => {
    const csv = activityCsv([], [], { now: 0, bom: true });
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(activityCsv([], [], { now: 0 }).charCodeAt(0), "#".charCodeAt(0));
  });

  it("writes exact decimals", () => {
    assert.equal(exactUnits("17000000000", 6), "17000");
    assert.equal(exactUnits("760", 6), "0.00076");
    assert.equal(exactUnits("770000000000000000000", 18), "770");
    assert.equal(exactUnits("123", 0), "123");
  });
});
