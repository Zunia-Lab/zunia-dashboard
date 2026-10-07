/**
 * The Activity view model: URL filters other pages link with, the coverage
 * wording the banner and CSV rely on, and the chart window that must never
 * draw zeros for days nobody has read.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { priceMapFrom } from "@/lib/activity/analytics";
import type { ActivityCoverage, ActivityItem, TxMovement, TxPacket } from "@/lib/activity/types";
import type { TokenIdentity } from "@/lib/token/types";
import {
  DEFAULT_FILTERS,
  LIST_STEP,
  amountValue,
  assetIdentityIn,
  assetKeyLabel,
  bech32Body,
  chartWindow,
  comparePeriods,
  comparisonState,
  coverageGroups,
  coverageLine,
  coverageView,
  coverageViews,
  coversRange,
  csvViewLine,
  dayHeading,
  explainOnChainFailure,
  feeSeries,
  feesByGroup,
  filtersFromSearch,
  filtersToSearch,
  gasRatio,
  hourMatrix,
  hasNarrowingFilters,
  historyComplete,
  isOwnTransfer,
  isTxHash,
  legsValue,
  listCaption,
  listFooter,
  movesAsset,
  netFlow,
  netFlowReading,
  nextGroups,
  normalizeHash,
  olderHistoryExists,
  ownRole,
  packetIdentity,
  packetTimeout,
  parseFilters,
  percentChange,
  periodFigures,
  previousSince,
  priceKeysOf,
  privateText,
  rangeSince,
  retentionEdge,
  rowLegs,
  trackPlanFor,
  txHref,
  withSecondLine,
} from "../view";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-07T12:00:30Z");

const ATOM: TokenIdentity = {
  key: "cosmoshub-4:uatom",
  chainId: "cosmoshub-4",
  denom: "uatom",
  kind: "native",
  ticker: "ATOM",
  name: "Cosmos Hub ATOM",
  decimals: 6,
  provenance: "native",
  proven: true,
};

const UNKNOWN: TokenIdentity = {
  key: "osmosis-1:ibc/1E18",
  chainId: "osmosis-1",
  denom: "ibc/1E18",
  kind: "ibc",
  ticker: "IBC·1E18",
  name: "Unknown token",
  decimals: null,
  provenance: "unknown",
  proven: false,
};

function row(partial: Partial<ActivityItem> & Pick<ActivityItem, "hash" | "kind" | "time">): ActivityItem {
  return {
    chainId: "cosmoshub-4",
    address: "cosmos1me",
    height: 1,
    success: true,
    summary: "",
    fee: null,
    feePaid: false,
    signed: true,
    amounts: [],
    messages: 1,
    primaryType: "MsgSend",
    ...partial,
  };
}

describe("ranges", () => {
  it("floors the range start to the minute so it is stable across renders", () => {
    const since = rangeSince("7d", NOW);
    assert.equal(since, Date.parse("2026-09-30T12:00:00Z"));
    assert.equal(rangeSince("7d", NOW + 20_000), since);
  });

  it("has no start for All or before the clock is known", () => {
    assert.equal(rangeSince("all", NOW), null);
    assert.equal(rangeSince("30d", null), null);
  });

  it("puts the comparison period right before the range, same length", () => {
    const since = rangeSince("30d", NOW);
    assert.equal(previousSince("30d", since), (since as number) - 30 * DAY);
    assert.equal(previousSince("7d", rangeSince("7d", NOW)), Date.parse("2026-09-23T12:00:00Z"));
    assert.equal(previousSince("all", null), null);
    assert.equal(previousSince("30d", null), null);
  });
});

describe("URL filters", () => {
  it("reads groups, single kinds and the failed chip leniently", () => {
    const filters = parseFilters({ range: "7D", kind: "swap,ibc-out,staking,failed,bogus", q: "  7075B8  " });
    assert.deepEqual(filters, { range: "7d", groups: ["ibc", "swaps", "staking"], failedOnly: true, query: "7075B8", asset: null });
  });

  it("falls back to the defaults on junk", () => {
    assert.deepEqual(parseFilters({ range: "5y", kind: ["", ","], failed: "nope" }), DEFAULT_FILTERS);
  });

  it("writes only what differs from the defaults, groups in chip order", () => {
    assert.equal(filtersToSearch(DEFAULT_FILTERS), "");
    assert.equal(
      filtersToSearch({ range: "all", groups: ["staking", "transfers"], failedOnly: true, query: "memo x", asset: null }),
      "?range=all&kind=transfers%2Cstaking&failed=1&q=memo+x",
    );
    assert.equal(filtersToSearch({ ...DEFAULT_FILTERS, asset: "osmosis-1:ibc/27394F" }), "?asset=osmosis-1%3Aibc%2F27394F");
  });

  it("reads an asset page's link: the identity key exactly, junk dropped", () => {
    // The link AssetPosition builds: `?asset=<key>&q=<ticker>&range=all`.
    const linked = parseFilters({ asset: "cosmoshub-4:uatom", q: "ATOM", range: "all" });
    assert.equal(linked.asset, "cosmoshub-4:uatom");
    assert.equal(linked.query, "ATOM");
    assert.equal(parseFilters({ asset: " osmosis-1:factory/osmo1abc/alloyed/allBTC " }).asset, "osmosis-1:factory/osmo1abc/alloyed/allBTC");
    assert.equal(parseFilters({ asset: ["safrochain-1:usaf", "x"] }).asset, "safrochain-1:usaf");
    for (const junk of ["", "uatom", "cosmoshub-4:", ":uatom", "cosmoshub-4:u atom", "<script>:x", `a:${"b".repeat(300)}`]) {
      assert.equal(parseFilters({ asset: junk }).asset, null, junk);
    }
  });

  it("reads the live query string, a repeated kind as its list", () => {
    assert.deepEqual(filtersFromSearch("?range=7d&kind=swaps&kind=ibc&asset=cosmoshub-4%3Auatom&q=memo+x"), {
      range: "7d",
      groups: ["ibc", "swaps"],
      failedOnly: false,
      query: "memo x",
      asset: "cosmoshub-4:uatom",
    });
    assert.deepEqual(filtersFromSearch(""), DEFAULT_FILTERS);
  });

  it("round-trips", () => {
    const filters = { range: "90d" as const, groups: ["governance" as const], failedOnly: false, query: "osmo1", asset: "osmosis-1:uosmo" };
    const search = new URLSearchParams(filtersToSearch(filters));
    assert.deepEqual(parseFilters(Object.fromEntries(search)), filters);
  });

  it("knows when rows are narrowed", () => {
    assert.equal(hasNarrowingFilters({ ...DEFAULT_FILTERS, range: "7d" }), false);
    assert.equal(hasNarrowingFilters({ ...DEFAULT_FILTERS, query: " x " }), true);
    assert.equal(hasNarrowingFilters({ ...DEFAULT_FILTERS, failedOnly: true }), true);
    assert.equal(hasNarrowingFilters({ ...DEFAULT_FILTERS, asset: "cosmoshub-4:uatom" }), true);
  });

  it("treats All as clearing the groups", () => {
    assert.deepEqual(nextGroups([], ["all", "swaps"]), ["swaps"]);
    assert.deepEqual(nextGroups(["swaps"], ["swaps", "all"]), []);
    assert.deepEqual(nextGroups(["swaps"], []), []);
    assert.deepEqual(nextGroups(["swaps"], ["swaps", "ibc"]), ["ibc", "swaps"]);
  });
});

describe("CSV view line", () => {
  const labels = { transfers: "Transfers", ibc: "IBC", swaps: "Swaps", staking: "Staking", governance: "Governance", other: "Other" };

  it("says which slice the file holds, with nothing a CSV reader would split", () => {
    const line = csvViewLine({ range: "30d", groups: ["ibc", "swaps"], failedOnly: true, query: 'memo, with "quotes"\nand lines', asset: null }, labels);
    assert.equal(line, "# view: last 30 days; types: IBC + Swaps; failed only; search: memo with quotes and lines");
    assert.equal(csvViewLine(DEFAULT_FILTERS, labels), "# view: last 30 days");
    assert.equal(csvViewLine({ ...DEFAULT_FILTERS, range: "all" }, labels), "# view: all loaded history");
  });

  it("names the asset a view is narrowed to, by ticker when known", () => {
    const filters = { ...DEFAULT_FILTERS, range: "all" as const, asset: "cosmoshub-4:uatom" };
    assert.equal(csvViewLine(filters, labels, "ATOM"), "# view: all loaded history; asset: ATOM (cosmoshub-4:uatom)");
    assert.equal(csvViewLine(filters, labels), "# view: all loaded history; asset: cosmoshub-4:uatom");
    assert.equal(csvViewLine(filters, labels, 'AT,"OM;'), "# view: all loaded history; asset: AT OM (cosmoshub-4:uatom)");
  });

  it("goes in as the second line", () => {
    assert.equal(withSecondLine("# a\r\nh1,h2\r\n", "# b"), "# a\r\n# b\r\nh1,h2\r\n");
  });
});

describe("hashes and links", () => {
  const hash = "7075b8f228e732cd8def8ae72c53456d667e880e897137fe4b7a682456974d3d";

  it("recognises transaction hashes", () => {
    assert.equal(isTxHash(hash), true);
    assert.equal(isTxHash(`0x${hash}`), true);
    assert.equal(isTxHash(hash.slice(1)), false);
    assert.equal(isTxHash("cosmos1abc"), false);
  });

  it("links with the chain as chainId, hash upper-cased", () => {
    assert.equal(normalizeHash(`0x${hash}`), hash.toUpperCase());
    assert.equal(txHref("cosmoshub-4", hash), `/activity/${hash.toUpperCase()}?chainId=cosmoshub-4`);
  });
});

describe("coverage", () => {
  const entry = (partial: Partial<ActivityCoverage>): ActivityCoverage => ({
    chainId: "cosmoshub-4",
    address: "cosmos1me",
    oldest: "2026-09-20T04:00:00.000Z",
    complete: false,
    ...partial,
  });

  it("classifies every server verdict", () => {
    assert.equal(coverageView(entry({ complete: true })).state, "complete");
    assert.equal(coverageView(entry({ complete: true, oldest: null })).state, "empty");
    assert.deepEqual(coverageView(entry({})), {
      chainId: "cosmoshub-4",
      state: "loaded",
      from: "2026-09-20",
      edge: Date.parse("2026-09-20T04:00:00.000Z"),
    });
    assert.equal(coverageView(entry({ oldest: null, note: "History could not be read from this chain's node." })).state, "unreadable");
    assert.equal(coverageView(entry({ note: "Incoming transfers could not be read; the list may miss some." })).state, "partial");
  });

  it("takes the retention date from the note", () => {
    const view = coverageView(entry({ oldest: "2026-09-15T06:46:57.630Z", note: "This node keeps history since 2026-09-14." }));
    assert.equal(view.state, "retention");
    assert.equal(view.from, "2026-09-14");
    assert.equal(coverageView(entry({ note: "This node only serves history since 2026-07-29." })).from, "2026-07-29");
    assert.equal(
      coverageView(entry({ note: "Older history may be missing: this chain's public nodes keep a limited window." })).from,
      "2026-09-20",
    );
  });

  it("judges completeness against the range, to the minute", () => {
    const since = Date.parse("2026-09-20T12:00:00Z");
    assert.equal(coversRange(coverageView(entry({ complete: true })), since), true);
    assert.equal(coversRange(coverageView(entry({ oldest: "2026-09-20T04:00:00.000Z" })), since), true);
    assert.equal(coversRange(coverageView(entry({ oldest: "2026-09-20T13:00:00.000Z" })), since), false);
    assert.equal(coversRange(coverageView(entry({ note: "This node keeps history since 2026-09-14." })), since), true);
    assert.equal(coversRange(coverageView(entry({ note: "This node keeps history since 2026-09-21." })), since), false);
    assert.equal(coversRange(coverageView(entry({ note: "Incoming transfers could not be read; the list may miss some." })), since), false);
    assert.equal(coversRange(coverageView(entry({})), null), false);
  });

  it("keeps the most limiting reading per chain", () => {
    const views = coverageViews([entry({ complete: true }), entry({ note: "This node keeps history since 2026-09-14." })]);
    assert.equal(views.length, 1);
    assert.equal(views[0].state, "retention");
  });

  it("finds the latest retention edge inside a window", () => {
    const views = coverageViews([
      entry({ chainId: "celestia", note: "This node keeps history since 2026-09-15." }),
      entry({ chainId: "osmosis-1", note: "This node keeps history since 2026-07-29." }),
      entry({ chainId: "safrochain-1", complete: true }),
    ]);
    const edge = retentionEdge(views, Date.parse("2026-09-07T00:00:00Z"));
    assert.deepEqual(edge, { chainIds: ["celestia"], at: Date.parse("2026-09-15T00:00:00Z") });
    assert.equal(retentionEdge(views, Date.parse("2026-09-30T00:00:00Z")), null);
  });

  it("words each verdict against the range", () => {
    const since = Date.parse("2026-09-07T12:00:00Z");
    assert.deepEqual(coverageLine(coverageView(entry({ complete: true })), since), { tone: "good", text: "complete history" });
    assert.deepEqual(coverageLine(coverageView(entry({ complete: true, oldest: null })), since), { tone: "good", text: "no transactions" });
    assert.deepEqual(coverageLine(coverageView(entry({ oldest: "2026-09-01T00:00:00Z" })), since), { tone: "good", text: "complete for this range" });
    assert.deepEqual(coverageLine(coverageView(entry({})), since), { tone: "pending", text: "loaded back to Sep 20" });
    assert.deepEqual(coverageLine(coverageView(entry({ note: "This node keeps history since 2026-07-26." })), since), {
      tone: "good",
      text: "complete for this range · node keeps since Jul 26",
    });
    assert.deepEqual(coverageLine(coverageView(entry({ note: "This node keeps history since 2026-09-14." })), since), {
      tone: "limited",
      text: "since Sep 14 · node retention",
    });
    assert.equal(coverageLine(coverageView(entry({ oldest: null, note: "History could not be read from this chain's node." })), since).tone, "bad");
  });

  it("says each verdict once, worst news first", () => {
    const since = Date.parse("2026-09-07T12:00:00Z");
    const groups = coverageGroups(
      coverageViews([
        entry({ chainId: "safrochain-1", complete: true }),
        entry({ chainId: "cosmoshub-4", complete: true, oldest: null }),
        entry({ chainId: "celestia", complete: true, oldest: null }),
        entry({ chainId: "osmosis-1", note: "This node keeps history since 2026-09-14." }),
      ]),
      since,
    );
    assert.deepEqual(
      groups.map((group) => [group.tone, group.text, group.chainIds]),
      [
        ["limited", "since Sep 14 · node retention", ["osmosis-1"]],
        ["good", "complete history", ["safrochain-1"]],
        ["good", "no transactions", ["cosmoshub-4", "celestia"]],
      ],
    );
    assert.deepEqual(groups[0].notes, [{ chainId: "osmosis-1", note: "This node keeps history since 2026-09-14." }]);
  });
});

describe("privacy and own addresses", () => {
  it("masks the amounts in a sentence, never an address or a proposal number", () => {
    assert.equal(privateText("Sent 1,234.5 OSMO to osmo15x7y…nl90", true), "Sent •••• OSMO to osmo15x7y…nl90");
    assert.equal(privateText("Swapped 3,490 SAF → 20.297 OSMO", true), "Swapped •••• SAF → •••• OSMO");
    assert.equal(privateText("Sent 0.5 IBC·498A to cosmos1abc…", true), "Sent •••• IBC·498A to cosmos1abc…");
    assert.equal(privateText("Voted Yes on proposal 12", true, true), "Voted Yes on proposal 12");
    assert.equal(privateText("Sent 12 OSMO", false), "Sent 12 OSMO");
  });

  it("recognises the same key behind another prefix", () => {
    const own = new Set([bech32Body("addr_safro1jz4fmzlc9lskmxum02elvml6jms03wa7gnyzax") as string]);
    assert.equal(bech32Body("osmo1jz4fmzlc9lskmxum02elvml6jms03wa7cyk9qy"), bech32Body("addr_safro1jz4fmzlc9lskmxum02elvml6jms03wa7gnyzax"));
    assert.equal(ownRole("osmo1jz4fmzlc9lskmxum02elvml6jms03wa7cyk9qy", own), "you");
    assert.equal(ownRole("addr_safrovaloper1jz4fmzlc9lskmxum02elvml6jms03wa7abcdef", own), "validator");
    assert.equal(ownRole("osmo15x7yv3tn0hqlh4e6hfkmvtx0yzuprhn2wznl90", own), null);
    assert.equal(bech32Body("not an address"), null);
    assert.equal(bech32Body("x1abc"), null);
  });

  it("treats a transfer to the wallet's own account elsewhere as internal, nothing else", () => {
    const own = new Set([bech32Body("addr_safro1jz4fmzlc9lskmxum02elvml6jms03wa7gnyzax") as string]);
    const toSelf = { kind: "ibc-out" as const, counterparty: "osmo1jz4fmzlc9lskmxum02elvml6jms03wa7cyk9qy" };
    assert.equal(isOwnTransfer(toSelf, own), true);
    assert.equal(isOwnTransfer({ kind: "receive", counterparty: "osmo1jz4fmzlc9lskmxum02elvml6jms03wa7cyk9qy" }, own), true);
    assert.equal(isOwnTransfer({ kind: "ibc-out", counterparty: "osmo15x7yv3tn0hqlh4e6hfkmvtx0yzuprhn2wznl90" }, own), false);
    // Staking with one's own validator is staking, not a transfer.
    assert.equal(isOwnTransfer({ kind: "delegate", counterparty: "addr_safrovaloper1jz4fmzlc9lskmxum02elvml6jms03wa7abcdef" }, own), false);
    assert.equal(isOwnTransfer({ kind: "send" }, own), false);
  });
});

describe("comparing with the period before", () => {
  const OSMO: TokenIdentity = { ...ATOM, key: "osmosis-1:uosmo", chainId: "osmosis-1", denom: "uosmo", ticker: "OSMO" };
  const prices = priceMapFrom({ [OSMO.key]: { price: 0.03 } });
  const fee = (amount: string) => ({ amount, denom: "uosmo", symbol: "OSMO", decimals: 6, key: OSMO.key });

  it("counts transactions, swaps and IBC, and totals fees only when every fee token is priced", () => {
    const figures = periodFigures(
      [
        row({ hash: "A", kind: "swap", time: "2026-10-01T00:00:00Z", feePaid: true, fee: fee("100000") }),
        row({ hash: "B", kind: "ibc-out", time: "2026-10-02T00:00:00Z", feePaid: true, fee: fee("100000") }),
        row({ hash: "C", kind: "receive", time: "2026-10-03T00:00:00Z" }),
      ],
      prices,
    );
    assert.deepEqual({ ...figures, fees: Math.round((figures.fees ?? 0) * 1e6) / 1e6 }, { transactions: 3, swaps: 1, ibc: 1, fees: 0.006 });
    const unpriced = periodFigures([row({ hash: "D", kind: "send", time: "2026-10-01T00:00:00Z", feePaid: true, fee: { ...fee("5"), key: "osmosis-1:ufoo" } })], prices);
    assert.equal(unpriced.fees, null);
    assert.equal(periodFigures([], prices).fees, 0);
  });

  it("says nothing when there was nothing before or a side is unknown", () => {
    assert.equal(percentChange(12, 10), 20);
    assert.equal(percentChange(5, 10), -50);
    assert.equal(percentChange(3, 0), null);
    assert.equal(percentChange(null, 10), null);
    assert.equal(percentChange(10, null), null);
  });

  it("compares the range with the period before it", () => {
    const current = [row({ hash: "A", kind: "swap", time: "2026-10-01T00:00:00Z" }), row({ hash: "B", kind: "swap", time: "2026-10-02T00:00:00Z" })];
    const previous = [row({ hash: "C", kind: "swap", time: "2026-09-01T00:00:00Z" })];
    const comparison = comparePeriods(current, previous, prices, { from: 1, to: 2 });
    assert.equal(comparison.change.transactions, 100);
    assert.equal(comparison.change.swaps, 100);
    assert.equal(comparison.change.ibc, null);
    assert.equal(comparison.change.fees, null);
    assert.equal(comparison.before.transactions, 1);
  });

  it("compares only once every chain is complete for the period before", () => {
    const previous = Date.parse("2026-08-08T12:00:00Z");
    const coverage = (partial: Partial<ActivityCoverage>): ActivityCoverage => ({
      chainId: "osmosis-1",
      address: "osmo1me",
      oldest: "2026-08-01T00:00:00Z",
      complete: false,
      ...partial,
    });
    const complete = coverageViews([coverage({}), coverage({ chainId: "cosmoshub-4", complete: true, oldest: null })]);
    assert.deepEqual(comparisonState({ previousSince: previous, reached: true, views: complete }), { state: "ready" });
    assert.deepEqual(comparisonState({ previousSince: previous, reached: false, views: complete }), { state: "pending" });
    assert.deepEqual(comparisonState({ previousSince: null, reached: true, views: complete }), { state: "pending" });
    const pruned = coverageViews([coverage({}), coverage({ chainId: "cosmoshub-4", note: "This node keeps history since 2026-09-20." })]);
    assert.deepEqual(comparisonState({ previousSince: previous, reached: true, views: pruned }), { state: "uncovered", chainIds: ["cosmoshub-4"] });
  });
});

describe("chart window", () => {
  const rows = [{ time: "2026-10-06T16:46:31Z" }, { time: "2026-09-24T21:41:16Z" }];

  it("covers the range when the list is complete back to it", () => {
    const since = NOW - 30 * DAY;
    const window = chartWindow({ since, now: NOW, rows, loadedUntil: null });
    assert.equal(window?.from, since);
    assert.equal(window?.bucket, "day");
    assert.equal(window?.clipped, false);
    assert.equal(Math.round(window?.days ?? 0), 30);
  });

  it("starts where loading stopped instead of drawing unread days as zero", () => {
    const window = chartWindow({ since: NOW - 90 * DAY, now: NOW, rows, loadedUntil: "2026-09-24T21:41:16.000Z" });
    assert.equal(window?.from, Date.parse("2026-09-24T21:41:16.000Z"));
    assert.equal(window?.clipped, true);
  });

  it("spans the loaded rows for All, weekly past a hundred days", () => {
    const window = chartWindow({ since: null, now: NOW, rows, loadedUntil: null });
    assert.equal(window?.from, Date.parse("2026-09-24T21:41:16Z"));
    const long = chartWindow({ since: null, now: NOW, rows: [{ time: "2026-01-01T00:00:00Z" }], loadedUntil: null });
    assert.equal(long?.bucket, "week");
    assert.equal(chartWindow({ since: null, now: NOW, rows: [], loadedUntil: null }), null);
  });
});

describe("day headings", () => {
  it("names today and yesterday, dates otherwise", () => {
    const now = new Date(2026, 9, 7, 15, 0).getTime();
    assert.equal(dayHeading(new Date(2026, 9, 7).getTime(), now), "Today");
    assert.equal(dayHeading(new Date(2026, 9, 6).getTime(), now), "Yesterday");
    assert.equal(dayHeading(new Date(2026, 9, 5).getTime(), now), "Mon, Oct 5");
    assert.equal(dayHeading(new Date(2025, 9, 6).getTime(), now), "Mon, Oct 6, 2025");
    assert.equal(dayHeading(new Date(2026, 9, 7).getTime(), null), "Wed, Oct 7");
  });
});

describe("amounts", () => {
  const swap = row({
    hash: "A",
    kind: "swap",
    time: "2026-10-06T10:00:00Z",
    amounts: [
      { direction: "in", denom: "ibc/1E18", amount: "4320000", identity: UNKNOWN },
      { direction: "out", denom: "uatom", amount: "10000000", identity: ATOM },
      { direction: "in", denom: "uatom", amount: "0", identity: ATOM },
    ],
  });

  it("orders legs out first and drops zero amounts", () => {
    const legs = rowLegs(swap);
    assert.deepEqual(
      legs.map((leg) => `${leg.direction}:${leg.ticker}`),
      ["out:ATOM", "in:IBC·1E18"],
    );
  });

  it("values exactly and refuses unknown decimals or prices", () => {
    assert.equal(amountValue("1500000", 6, 2), 3);
    assert.equal(amountValue("123456789012345678901234567890", 18, 1), 123456789012.34567);
    assert.equal(amountValue("1500000", null, 2), null);
    assert.equal(amountValue("1500000", 6, undefined), null);
  });

  it("nets legs only when every leg is priced", () => {
    const prices = priceMapFrom({ "cosmoshub-4:uatom": { price: 1.8 } });
    const legs = rowLegs(swap);
    assert.equal(legsValue(legs.slice(0, 1), prices), -18);
    assert.equal(legsValue(legs, prices), null);
  });

  it("computes net flow without inventing a side", () => {
    assert.equal(netFlow(null, null), null);
    assert.equal(netFlow(null, 12), -12);
    assert.equal(netFlow(30, 12), 18);
  });

  it("collects every amount and fee key once", () => {
    const fee = { amount: "5000", denom: "uosmo", symbol: "OSMO", decimals: 6, key: "osmosis-1:uosmo" };
    assert.deepEqual(priceKeysOf([swap, row({ hash: "B", kind: "send", time: swap.time, fee })]), [
      "cosmoshub-4:uatom",
      "osmosis-1:ibc/1E18",
      "osmosis-1:uosmo",
    ]);
  });
});

describe("fees by type", () => {
  it("sums only fees the account paid, per group, most expensive first", () => {
    const fee = (amount: string) => ({ amount, denom: "uatom", symbol: "ATOM", decimals: 6, key: "cosmoshub-4:uatom" });
    const items = [
      row({ hash: "1", kind: "send", time: "2026-10-06T10:00:00Z", fee: fee("5000"), feePaid: true }),
      row({ hash: "2", kind: "claim", time: "2026-10-06T10:00:00Z", fee: fee("20000"), feePaid: true }),
      row({ hash: "3", kind: "claim", time: "2026-10-06T10:00:00Z", fee: fee("20000"), feePaid: true }),
      row({ hash: "4", kind: "receive", time: "2026-10-06T10:00:00Z", fee: fee("90000"), feePaid: false }),
    ];
    const prices = priceMapFrom({ "cosmoshub-4:uatom": { price: 2 } });
    const groups = feesByGroup(items, prices);
    assert.deepEqual(
      groups.map((group) => [group.group, group.count, group.value]),
      [
        ["staking", 2, 0.08],
        ["transfers", 1, 0.01],
      ],
    );
  });
});

describe("fee series", () => {
  const fee = (amount: string, key = "cosmoshub-4:uatom") => ({ amount, denom: "uatom", symbol: "ATOM", decimals: 6, key });
  const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
  const starts = [new Date(2026, 9, 5).getTime(), new Date(2026, 9, 6).getTime(), new Date(2026, 9, 7).getTime()];
  const prices = priceMapFrom({ "cosmoshub-4:uatom": { price: 2 } });

  it("sums priced fees the account paid per day, zero-filled", () => {
    const items = [
      row({ hash: "1", kind: "send", time: day(2026, 10, 5), fee: fee("10000"), feePaid: true }),
      row({ hash: "2", kind: "send", time: day(2026, 10, 5, 18), fee: fee("5000"), feePaid: true }),
      row({ hash: "3", kind: "receive", time: day(2026, 10, 6), fee: fee("90000"), feePaid: false }),
      row({ hash: "4", kind: "send", time: day(2026, 10, 7), fee: fee("2500"), feePaid: true }),
      row({ hash: "5", kind: "send", time: day(2026, 9, 1), fee: fee("2500"), feePaid: true }),
    ];
    assert.deepEqual(
      feeSeries(items, prices, starts, "day")?.map((point) => point.v),
      [0.03, 0, 0.005],
    );
  });

  it("is null when no fee in the window has a price", () => {
    const items = [row({ hash: "1", kind: "send", time: day(2026, 10, 5), fee: fee("10000", "x:unpriced"), feePaid: true })];
    assert.equal(feeSeries(items, prices, starts, "day"), null);
    assert.equal(feeSeries([], prices, [], "day"), null);
  });
});

describe("hour matrix", () => {
  it("counts per local weekday and hour, Monday first, and finds the peak", () => {
    const at = (y: number, m: number, d: number, h: number) => ({ time: new Date(y, m - 1, d, h, 30).toISOString() });
    // Oct 5 2026 is a Monday, Oct 11 a Sunday.
    const matrix = hourMatrix([at(2026, 10, 5, 2), at(2026, 10, 5, 2), at(2026, 10, 12, 2), at(2026, 10, 11, 23), { time: "garbage" }]);
    assert.equal(matrix.cells[0][2], 3);
    assert.equal(matrix.cells[6][23], 1);
    assert.equal(matrix.total, 4);
    assert.equal(matrix.max, 3);
    assert.deepEqual(matrix.peak, { weekday: 0, hour: 2, count: 3 });
    assert.equal(hourMatrix([]).peak, null);
  });
});

describe("explaining recorded failures", () => {
  it("names an IBC transfer that expired before it left", () => {
    const explained = explainOnChainFailure(
      "failed to execute message; message index: 0: invalid packet timeout: current timestamp: 1789567207303547857, timeout timestamp 963497274239090688: timeout elapsed",
      40,
      "channel",
    );
    assert.equal(explained.title, "Expired before it left");
    assert.match(explained.message, /never left/);
  });

  it("never reads a recorded failure as a client-side one", () => {
    const explained = explainOnChainFailure("failed to execute message; message index: 0: deadline exceeded for swap", 7, "wasm");
    assert.equal(explained.kind, "unknown");
    assert.equal(explained.title, "Refused by the chain");
    assert.equal(explained.message, "Deadline exceeded for swap.");
  });

  it("keeps a precise on-chain reading", () => {
    assert.equal(explainOnChainFailure("out of gas in location: WriteFlat; gasWanted: 80000, gasUsed: 80312", 11, "sdk").kind, "out-of-gas");
  });
});

describe("transaction detail", () => {
  it("reads gas use against the limit", () => {
    assert.equal(gasRatio(101_968, 500_000), 0.203936);
    assert.equal(gasRatio(null, 500_000), null);
    assert.equal(gasRatio(10, 0), null);
  });

  it("treats far-future packet timeouts as none", () => {
    assert.equal(packetTimeout("8693041596546154496", NOW), null);
    assert.equal(packetTimeout("0", NOW), null);
    assert.equal(packetTimeout(String((NOW + 600_000) * 1_000_000), NOW), NOW + 600_000);
  });

  const packet: TxPacket = {
    stage: "send",
    sequence: "105",
    sourcePort: "transfer",
    sourceChannel: "channel-1",
    destPort: "transfer",
    destChannel: "channel-110497",
    counterpartyChainId: "osmosis-1",
    denom: "usaf",
    amount: "3490000000",
    sender: "addr_safro1me",
    receiver: "osmo1me",
  };

  it("names the packet's token from the matching movement", () => {
    const identity = { ...ATOM, key: "safrochain-1:usaf", ticker: "SAF" };
    const movements: TxMovement[] = [
      { msgIndex: null, from: "addr_safro1me", to: "addr_safro1fees", denom: "usaf", amount: "37500", identity },
      { msgIndex: 0, from: "addr_safro1me", to: "addr_safro1escrow", denom: "usaf", amount: "3490000000", identity },
    ];
    assert.equal(packetIdentity(packet, movements)?.ticker, "SAF");
    assert.equal(packetIdentity({ ...packet, amount: "1" }, movements), null);
  });

  it("builds a one-hop plan only for a sent packet it can follow", () => {
    const plan = trackPlanFor({ chainId: "safrochain-1", success: true }, packet);
    assert.equal(plan?.destChainId, "osmosis-1");
    assert.deepEqual(plan?.hops, [
      { chainId: "safrochain-1", channelId: "channel-1", port: "transfer", counterpartyChainId: "osmosis-1", kind: "transfer" },
    ]);
    assert.equal(trackPlanFor({ chainId: "safrochain-1", success: false }, packet), null);
    assert.equal(trackPlanFor({ chainId: "osmosis-1", success: true }, { ...packet, stage: "receive" }), null);
    assert.equal(trackPlanFor({ chainId: "safrochain-1", success: true }, { ...packet, counterpartyChainId: undefined }), null);
  });
});

describe("asset filter", () => {
  const atomIn = row({
    hash: "C1",
    kind: "receive",
    time: "2026-10-06T09:00:00Z",
    amounts: [{ direction: "in", denom: "uatom", amount: "1000000", identity: { ...ATOM, logoUrl: "https://example.org/atom.png" } }],
  });
  const vote = row({
    hash: "C2",
    kind: "vote",
    time: "2026-10-06T08:00:00Z",
    fee: { amount: "5000", denom: "uatom", symbol: "ATOM", decimals: 6, key: "cosmoshub-4:uatom" },
    feePaid: true,
  });

  it("keeps rows that moved the asset, not rows that only paid a fee in it", () => {
    assert.equal(movesAsset(atomIn, "cosmoshub-4:uatom"), true);
    assert.equal(movesAsset(vote, "cosmoshub-4:uatom"), false);
    assert.equal(movesAsset(atomIn, "osmosis-1:uosmo"), false);
  });

  it("names the chip from the loaded rows, else from the key", () => {
    assert.equal(assetIdentityIn([vote, atomIn], "cosmoshub-4:uatom")?.logoUrl, "https://example.org/atom.png");
    assert.equal(assetIdentityIn([vote], "cosmoshub-4:uatom"), null);
    assert.equal(assetKeyLabel("cosmoshub-4:uatom"), "uatom");
    assert.equal(assetKeyLabel("osmosis-1:ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"), "ibc/27394FB…");
  });
});

describe("history completeness", () => {
  const since = Date.parse("2026-09-07T12:00:00Z");
  const view = (partial: Partial<ReturnType<typeof coverageView>>) => ({ chainId: "cosmoshub-4", state: "complete" as const, from: null, edge: null, ...partial });

  it("is complete only when every chain covers the range and none went unread", () => {
    assert.equal(historyComplete([view({}), view({ chainId: "celestia", state: "empty" })], since, 0), true);
    assert.equal(historyComplete([view({ state: "loaded", from: "2026-09-01", edge: since - DAY })], since, 0), true);
    assert.equal(historyComplete([view({ state: "loaded", from: "2026-09-20", edge: since + 13 * DAY })], since, 0), false);
    assert.equal(historyComplete([view({ state: "partial", from: "2026-09-01", edge: since - DAY })], since, 0), false);
    assert.equal(historyComplete([view({ state: "unreadable" })], since, 0), false);
    assert.equal(historyComplete([view({})], since, 1), false, "a chain the wallet shared no address for was not read");
    assert.equal(historyComplete([], since, 0), false, "nothing read is not complete");
  });

  it("for all time, wants every chain's whole history", () => {
    assert.equal(historyComplete([view({})], null, 0), true);
    assert.equal(historyComplete([view({ state: "loaded", from: "2026-09-01", edge: since - DAY })], null, 0), false);
  });

  it("knows older history exists from pages, comparison rows or a complete account's oldest row", () => {
    const base = { since, hasMore: false, olderLoaded: 0, coverage: [] };
    assert.equal(olderHistoryExists(base), false);
    assert.equal(olderHistoryExists({ ...base, hasMore: true }), true);
    assert.equal(olderHistoryExists({ ...base, olderLoaded: 3 }), true);
    assert.equal(olderHistoryExists({ ...base, coverage: [{ complete: true, oldest: "2026-08-01T00:00:00Z" }] }), true);
    // A node's retention edge is not a transaction: it proves nothing older.
    assert.equal(olderHistoryExists({ ...base, coverage: [{ complete: false, oldest: "2026-08-01T00:00:00Z" }] }), false);
    assert.equal(olderHistoryExists({ ...base, coverage: [{ complete: true, oldest: "2026-09-20T00:00:00Z" }, { complete: true, oldest: null }] }), false);
    assert.equal(olderHistoryExists({ ...base, since: null, hasMore: true }), true);
  });
});

describe("net flow reading", () => {
  it("prices what it can and says In and Out", () => {
    assert.deepEqual(netFlowReading({ inValue: null, outValue: 2.2, unpriced: 1 }, false), { state: "priced", net: -2.2, inValue: 0, outValue: 2.2 });
    assert.deepEqual(netFlowReading({ inValue: 5, outValue: 2, unpriced: 0 }, true), { state: "priced", net: 3, inValue: 5, outValue: 2 });
  });

  it("is a known zero without transfers once the history is complete, unknown before", () => {
    assert.deepEqual(netFlowReading({ inValue: null, outValue: null, unpriced: 0 }, true), { state: "none" });
    assert.deepEqual(netFlowReading({ inValue: null, outValue: null, unpriced: 0 }, false), { state: "unknown" });
  });

  it("keeps unpriced transfers unknown, never zero", () => {
    assert.deepEqual(netFlowReading({ inValue: null, outValue: null, unpriced: 2 }, true), { state: "unpriced" });
  });
});

describe("the list", () => {
  it("steps by ten", () => {
    assert.equal(LIST_STEP, 10);
  });

  it("captions the span and the order, never a count", () => {
    assert.equal(listCaption("30d", false), "Last 30 days · newest first");
    assert.equal(listCaption("all", false), "All time · newest first");
    assert.equal(listCaption("7d", true), "Filtered · last 7 days · newest first");
  });

  it("reveals loaded rows before fetching, and fetches only for an incomplete view", () => {
    const base = { shown: 10, total: 42, hasMore: true, rangeDone: false, olderExists: true };
    assert.deepEqual(listFooter(base), { kind: "more", fetch: false });
    assert.deepEqual(listFooter({ ...base, shown: 42 }), { kind: "more", fetch: true });
    assert.deepEqual(listFooter({ ...base, shown: 0, total: 0 }), { kind: "more", fetch: true }, "a filter with no match yet can look further back");
  });

  it("offers all time once a range is all on screen, and ends quietly when nothing is older", () => {
    const done = { shown: 23, total: 23, hasMore: true, rangeDone: true, olderExists: true };
    assert.deepEqual(listFooter(done), { kind: "all-time" });
    assert.deepEqual(listFooter({ ...done, hasMore: false, olderExists: false }), { kind: "end" });
    assert.deepEqual(listFooter({ ...done, rangeDone: false, hasMore: false, olderExists: false }), { kind: "end" });
  });
});
