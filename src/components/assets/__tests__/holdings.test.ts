/**
 * The Assets page's arithmetic: unknown is never small, unlisted is counted
 * not dropped, amounts add in base units, shares are of the priced value.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SpotPrice, TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset, PortfolioResponse } from "@/lib/token/wire";
import { groupAssets } from "@/lib/token/holdings";

import {
  SMALL_VALUE,
  amountDigits,
  baseAmountDigits,
  bondedShare,
  chainSections,
  concentration,
  contributions,
  csvHeaderLine,
  filterRows,
  floorText,
  groupBaseTotal,
  hideSmallGroups,
  holdingsCsv,
  idleWorthStaking,
  holdingsCsvRows,
  isSmall,
  isUnlisted,
  isUnverifiedRoute,
  matchesQuery,
  rowBaseTotal,
  smallFloorOf,
  stakeableAssets,
  summarize,
  typeCounts,
  typicalStakingRate,
} from "../holdings";

function identity(overrides: Partial<TokenIdentity> & Pick<TokenIdentity, "key" | "chainId" | "denom" | "ticker">): TokenIdentity {
  return {
    kind: "native",
    name: overrides.ticker,
    decimals: 6,
    provenance: "native",
    proven: true,
    listed: true,
    chainName: overrides.chainId,
    ...overrides,
  };
}

function price(value: number, change24h: number | null = null, change7d: number | null = null): SpotPrice {
  return { price: value, change24h, change7d, source: "numia", at: 0, label: "Numia · Osmosis" };
}

function row(
  id: TokenIdentity,
  amounts: Partial<PortfolioAsset["amounts"]>,
  spot: SpotPrice | null,
  extra: Partial<PortfolioAsset> = {},
): PortfolioAsset {
  const full = { liquid: "0", staked: "0", rewards: "0", unbonding: "0", ...amounts };
  const decimals = id.decimals;
  const base = Number(BigInt(full.liquid) + BigInt(full.staked) + BigInt(full.rewards) + BigInt(full.unbonding));
  const total = decimals === null ? null : base / 10 ** decimals;
  const value = spot && total !== null ? total * spot.price : null;
  return {
    identity: id,
    chainId: id.chainId,
    amounts: full,
    total,
    price: spot,
    value,
    change24hAbs: value !== null && spot?.change24h != null ? (value * spot.change24h) / (100 + spot.change24h) : null,
    ...(spot ? {} : { unpriced: "no-market" as const }),
    ...extra,
  };
}

const ATOM_HUB = identity({ key: "cosmoshub-4:uatom", chainId: "cosmoshub-4", denom: "uatom", ticker: "ATOM", chainName: "Cosmos Hub", originChainId: "cosmoshub-4" });
const ATOM_OSMO = identity({
  key: "cosmoshub-4:uatom",
  chainId: "osmosis-1",
  denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
  ticker: "ATOM",
  kind: "ibc",
  provenance: "table",
  chainName: "Osmosis",
  originChainId: "cosmoshub-4",
});
const TIA = identity({ key: "celestia:utia", chainId: "celestia", denom: "utia", ticker: "TIA", chainName: "Celestia", originChainId: "celestia" });
const SPAM = identity({
  key: "cosmoshub-4:ibc/27BC",
  chainId: "cosmoshub-4",
  denom: "ibc/27BC",
  ticker: "IBC·27BC",
  kind: "ibc",
  provenance: "unknown",
  proven: false,
  listed: false,
  decimals: null,
  name: "Unknown token",
});
const ODD_ATOM = identity({
  key: "akashnet-2:ibc/2E5D",
  chainId: "akashnet-2",
  denom: "ibc/2E5D",
  ticker: "ATOM",
  kind: "ibc",
  provenance: "channel-walk",
  proven: false,
  listed: true,
});
const DUST = identity({ key: "osmosis-1:factory/x/BERNESE", chainId: "osmosis-1", denom: "factory/x/BERNESE", ticker: "BERNESE", kind: "factory", provenance: "catalog" });

const rows: PortfolioAsset[] = [
  row(TIA, { liquid: "49000000000", staked: "41000000000" }, price(0.5, 4, 8)),
  row(ATOM_HUB, { liquid: "10000000", staked: "278000000", rewards: "48373" }, price(1.78, -0.8, 2.6)),
  row(ATOM_OSMO, { liquid: "2000000" }, price(1.78, -0.8, 2.6)),
  row(DUST, { liquid: "65982" }, price(0.001, 20, 1)),
  row(ODD_ATOM, { liquid: "330" }, null, { unpriced: "unproven" }),
  row(SPAM, { liquid: "463" }, null, { unpriced: "decimals-unknown" }),
];

describe("unlisted and unverified", () => {
  it("calls a token nobody lists unlisted, and a non-canonical route unverified", () => {
    assert.equal(isUnlisted(SPAM), true);
    assert.equal(isUnlisted(ODD_ATOM), false);
    assert.equal(isUnverifiedRoute(ODD_ATOM), true);
    assert.equal(isUnverifiedRoute(SPAM), false);
    assert.equal(isUnverifiedRoute(ATOM_OSMO), false);
  });

  it("folds unlisted rows away by default and counts them", () => {
    const hidden = filterRows(rows, { type: "all", query: "", showUnlisted: false });
    assert.equal(hidden.rows.length, 5);
    assert.equal(hidden.hiddenUnlisted, 1);
    const shown = filterRows(rows, { type: "all", query: "", showUnlisted: true });
    assert.equal(shown.rows.length, 6);
    assert.equal(shown.hiddenUnlisted, 0);
  });

  it("counts the hidden unlisted as assets too, one per asset key", () => {
    const twice = [...rows, row({ ...SPAM, chainId: "osmosis-1", chainName: "Osmosis" }, { liquid: "9" }, null, { unpriced: "decimals-unknown" })];
    const hidden = filterRows(twice, { type: "all", query: "", showUnlisted: false });
    assert.equal(hidden.hiddenUnlisted, 2); // two holdings…
    assert.equal(hidden.hiddenUnlistedAssets, 1); // …of one asset
  });

  it("only counts hidden unlisted rows that match the other filters", () => {
    const natives = filterRows(rows, { type: "native", query: "", showUnlisted: false });
    assert.equal(natives.hiddenUnlisted, 0);
    assert.deepEqual(
      natives.rows.map((r) => r.identity.ticker),
      ["TIA", "ATOM"],
    );
  });
});

describe("filters", () => {
  it("matches types per chain row (IBC ATOM is not native ATOM)", () => {
    const ibc = filterRows(rows, { type: "ibc", query: "", showUnlisted: true }).rows;
    assert.deepEqual(ibc.map((r) => r.chainId), ["osmosis-1", "akashnet-2", "cosmoshub-4"]);
    const staked = filterRows(rows, { type: "staked", query: "", showUnlisted: true }).rows;
    assert.deepEqual(staked.map((r) => r.identity.ticker), ["TIA", "ATOM"]);
    const factory = filterRows(rows, { type: "factory", query: "", showUnlisted: true }).rows;
    assert.deepEqual(factory.map((r) => r.identity.ticker), ["BERNESE"]);
  });

  it("searches tickers, names, chains and denoms case-insensitively", () => {
    assert.equal(matchesQuery(rows[2], "osmosis"), true);
    assert.equal(matchesQuery(rows[2], "OSMO"), true);
    assert.equal(matchesQuery(rows[2], "ibc/2739"), true);
    assert.equal(matchesQuery(rows[0], "atom"), false);
    assert.equal(matchesQuery(rows[0], "  "), true);
  });

  it("matches a chain at the start of a word only, as the token pickers do", () => {
    // "Cosmos Hub" and "cosmoshub-4" contain "osmo"; the Hub's ATOM is not an Osmosis token.
    assert.equal(matchesQuery(rows[1], "osmo"), false);
    assert.equal(matchesQuery(rows[1], "hub"), true);
    assert.equal(matchesQuery(rows[1], "cosmoshub"), true);
  });

  it("counts groups per chip, merging ATOM across chains", () => {
    const counts = typeCounts(rows, false);
    // TIA, ATOM (Hub + Osmosis merged), BERNESE, the unverified ATOM voucher.
    assert.equal(counts.all, 4);
    assert.equal(counts.native, 2);
    assert.equal(counts.ibc, 2);
    assert.equal(counts.staked, 2);
  });

  it("counts holdings per chip in the By chain unit", () => {
    const counts = typeCounts(rows, false, "holding");
    // Every row but the folded unlisted one: ATOM counts once per chain.
    assert.equal(counts.all, 5);
    assert.equal(counts.ibc, 2);
    assert.equal(typeCounts(rows, true, "holding").all, 6);
  });
});

describe("small balances", () => {
  it("never calls an unpriced position small", () => {
    assert.equal(isSmall(null), false);
    assert.equal(isSmall(0.5), true);
    assert.equal(isSmall(1), false);
  });

  it("hides priced groups under the floor and keeps unpriced ones", () => {
    const groups = groupAssets(rows);
    const { groups: kept, hidden } = hideSmallGroups(groups, true);
    assert.equal(hidden, 1); // BERNESE dust
    assert.ok(kept.some((g) => g.identity.ticker === "IBC·27BC"));
    assert.equal(hideSmallGroups(groups, false).hidden, 0);
  });

  it("uses the viewer's floor when one is stored, the default otherwise", () => {
    assert.equal(smallFloorOf(10), 10);
    assert.equal(smallFloorOf(0.5), 0.5);
    for (const bad of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, "10", {}]) assert.equal(smallFloorOf(bad), SMALL_VALUE);
    // ATOM on Osmosis alone is $3.56: under a $10 floor, over the $1 default.
    assert.equal(isSmall(3.56, 10), true);
    assert.equal(isSmall(3.56), false);
    // At $1,000 the ATOM group ($516) folds away with the BERNESE dust; TIA stays.
    const groups = groupAssets(rows);
    assert.equal(hideSmallGroups(groups, true, 1000).hidden, 2);
  });

  it("says the floor in the response currency", () => {
    assert.equal(floorText(1, "usd"), "$1");
    assert.equal(floorText(10, "eur"), "€10");
    assert.equal(floorText(0.5, "gbp"), "£0.50");
  });
});

describe("amount digits", () => {
  it("keeps three significant figures below one token, up to eight digits", () => {
    // 364 base units of an 8-decimal BTC: six digits cut it to 0.000003, 18% short.
    assert.equal(amountDigits(0.00000364), 8);
    assert.equal(baseAmountDigits("364", 8), 8);
    assert.equal(amountDigits(0.000829), 6);
    assert.equal(amountDigits(0.3778), 6);
    assert.equal(amountDigits(0.3778, 4), 4);
    assert.equal(amountDigits(1e-12), 8);
  });

  it("reads larger amounts at four, then two digits", () => {
    assert.equal(amountDigits(20.1286), 4);
    assert.equal(amountDigits(652_725.65), 2);
    assert.equal(amountDigits(null), 6);
    assert.equal(amountDigits(0), 6);
    assert.equal(baseAmountDigits(BigInt(20_128_600), 6, 4), 4);
    assert.equal(baseAmountDigits("463", null), 6);
  });
});

describe("amounts", () => {
  it("adds buckets in base units", () => {
    assert.equal(rowBaseTotal(rows[1]), BigInt(288048373));
    assert.equal(rowBaseTotal({ amounts: { liquid: "x", staked: "1", rewards: "", unbonding: "2" } }), BigInt(3));
  });

  it("adds a group's rows exactly when they share an exponent", () => {
    const atom = groupAssets(rows).find((g) => g.key === "cosmoshub-4:uatom");
    assert.ok(atom);
    assert.deepEqual(groupBaseTotal(atom), { amount: BigInt(290048373), decimals: 6 });
    assert.equal(groupBaseTotal({ rows: [rows[1], { ...rows[2], identity: { ...ATOM_OSMO, decimals: 18 } }] }), null);
  });

  it("computes the bonded share without floats of base units", () => {
    assert.ok(Math.abs((bondedShare([rows[0]]) ?? 0) - (41 / 90) * 100) < 0.0001);
    assert.equal(bondedShare([]), null);
    const huge = { amounts: { liquid: "1000000000000000000000", staked: "1000000000000000000000", rewards: "0", unbonding: "0" } };
    assert.equal(bondedShare([huge]), 50);
  });
});

describe("chain sections", () => {
  it("orders chains by value, unpriced-only chains last", () => {
    const sections = chainSections(rows, [
      { chainId: "celestia", chainName: "Celestia", iconUrl: null, address: "", status: "ok", value: 0, liquid: 0, staked: 0, rewards: 0, unbonding: 0, change24hAbs: null, assetCount: 1, nativeSymbol: "TIA" },
    ]);
    assert.deepEqual(
      sections.map((s) => s.chainId),
      ["celestia", "cosmoshub-4", "osmosis-1", "akashnet-2"],
    );
    assert.equal(sections[3].value, null);
    assert.equal(sections[0].chainName, "Celestia");
  });
});

describe("summary", () => {
  const data: Pick<PortfolioResponse, "totals" | "assets"> = {
    totals: {
      value: 1000,
      liquid: 0,
      staked: 0,
      rewards: 0,
      unbonding: 0,
      change24hAbs: 10,
      change24hPct: 1,
      change7dAbs: null,
      change7dPct: null,
      pricedValue: 1000,
      unpricedAssetCount: 2,
      assetCount: 6,
      chainCount: 4,
    },
    assets: rows,
  };

  it("counts assets, holdings, chains and unpriced groups with reasons", () => {
    const summary = summarize(data);
    assert.equal(summary.assetCount, 5);
    assert.equal(summary.holdingCount, 6);
    assert.equal(summary.chainCount, 4);
    assert.equal(summary.unpricedCount, 2);
    assert.equal(summary.unlistedCount, 1);
    assert.equal(summary.unpricedReasons.length, 2);
  });

  it("names the largest position with its share of the priced value", () => {
    const summary = summarize(data);
    assert.equal(summary.largest?.group.identity.ticker, "TIA");
    const priced = groupAssets(rows).reduce((s, g) => s + (g.value ?? 0), 0);
    assert.ok(Math.abs((summary.largest?.share ?? 0) - (45_000 / priced) * 100) < 1e-9);
  });

  it("ignores dust for best and worst", () => {
    const summary = summarize(data);
    assert.equal(summary.best?.identity.ticker, "TIA"); // BERNESE +20% is dust
    assert.equal(summary.worst?.identity.ticker, "ATOM");
  });

  it("ranks best and worst over the viewer's floor", () => {
    // TIA ($45,000) and ATOM ($516) are both under a $100,000 floor.
    const summary = summarize(data, 100_000);
    assert.equal(summary.best, null);
    assert.equal(summary.worst, null);
    assert.equal(summarize(data, 1000).worst, null); // ATOM folds; TIA rose
  });

  it("does not report one mover as both best and worst", () => {
    const summary = summarize({ ...data, assets: [rows[0]] });
    assert.equal(summary.best?.identity.ticker, "TIA");
    assert.equal(summary.worst, null);
  });
});

describe("analyses", () => {
  it("computes HHI and its level", () => {
    const one = concentration([100]);
    assert.equal(one?.hhi, 1);
    assert.equal(one?.level, "concentrated");
    const even = concentration([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    assert.ok(even && Math.abs(even.hhi - 0.1) < 1e-12);
    assert.equal(even?.level, "diversified");
    assert.equal(concentration([1, 1, 1, 1, 1])?.level, "moderate");
    assert.equal(concentration([0, -1]), null);
    assert.equal(concentration([3, 1])?.top1, 75);
  });

  it("ranks 24 h contributions by size either way, dust last, no-change out", () => {
    const list = contributions(groupAssets(rows));
    assert.deepEqual(
      list.map((c) => c.identity.ticker),
      ["TIA", "ATOM", "BERNESE"],
    );
    assert.ok(list[0].abs > 0 && list[1].abs < 0 && list[2].abs > 0);
    const flat = row(identity({ key: "noble-1:uusdc", chainId: "noble-1", denom: "uusdc", ticker: "USDC" }), { liquid: "5000000" }, price(1, 0, 0));
    assert.equal(contributions(groupAssets([flat])).length, 0);
  });
});

describe("staking coverage", () => {
  const denoms: Record<string, string> = { celestia: "utia", "cosmoshub-4": "uatom", "osmosis-1": "uosmo" };

  it("lists the chain's own staking coin only, most idle value first", () => {
    const list = stakeableAssets(rows, (chainId) => denoms[chainId]);
    assert.deepEqual(
      list.map((s) => s.identity.ticker),
      ["TIA", "ATOM"],
    );
    assert.equal(list[0].liquid, 49000);
    assert.equal(list[0].liquidValue, 24500);
    // No reserve given: everything liquid is idle.
    assert.equal(list[0].idle, "49000000000");
    assert.equal(list[0].idleValue, 24500);
  });

  it("keeps the Staking page's fee reserve back from what is idle", () => {
    // The Hub's reserve for three staking transactions: 0.0675 ATOM.
    const reserve = (chainId: string) => (chainId === "cosmoshub-4" ? "67500" : "0");
    const atom = stakeableAssets(rows, (chainId) => denoms[chainId], reserve).find((s) => s.identity.ticker === "ATOM");
    assert.ok(atom);
    assert.equal(atom.idle, "9932500");
    assert.equal(atom.idleWhole, 9.9325);
    assert.ok(Math.abs((atom.idleValue ?? 0) - 9.9325 * 1.78) < 1e-9);
    // The staked share is about the whole position, reserve or not.
    assert.equal(atom.liquid, 10);
    // A reserve larger than the balance leaves nothing idle.
    const all = stakeableAssets(rows, (chainId) => denoms[chainId], () => "99999999999");
    assert.ok(all.every((s) => s.idle === "0" && !idleWorthStaking(s)));
  });

  it("calls idle under a cent dust, as Staking does", () => {
    assert.equal(idleWorthStaking({ idleWhole: 0.004, idleValue: 0.006 }), false);
    assert.equal(idleWorthStaking({ idleWhole: 0.3, idleValue: 0.51 }), true);
    assert.equal(idleWorthStaking({ idleWhole: 2, idleValue: null }), true);
    assert.equal(idleWorthStaking({ idleWhole: null, idleValue: null }), false);
  });

  it("rates staking at the actual APR after the median commission", () => {
    const rate = typicalStakingRate({ apr: { actual: 0.196 }, medianCommission: 0.05 });
    assert.ok(rate !== null && Math.abs(rate - 0.1862) < 1e-12);
    // A naive APR is not used, and either figure missing leaves no rate.
    assert.equal(typicalStakingRate({ apr: { actual: null }, medianCommission: 0.05 }), null);
    assert.equal(typicalStakingRate({ apr: { actual: 0.2 }, medianCommission: null }), null);
    assert.equal(typicalStakingRate(null), null);
  });
});

describe("csv", () => {
  it("writes exact amounts and keeps unknown decimals in base units", () => {
    const [tia, , , , , spam] = holdingsCsvRows(rows);
    assert.equal(tia.total, "90000");
    assert.equal(tia.unit, "tokens");
    assert.equal(spam.unit, "base units");
    assert.equal(spam.total, "463");
    assert.equal(spam.listed, false);
    assert.equal(spam.unpriced, "decimals-unknown");
  });

  it("writes a comment line no CSV reader splits", () => {
    const line = csvHeaderLine(Date.UTC(2026, 9, 7, 4, 20), "eur", "All chains, 5 networks", 41);
    assert.ok(line.startsWith("# Zunia holdings export · 2026-10-07 04:20 UTC · values in EUR"));
    assert.equal(line.includes(","), false);
  });
});

describe("holdingsCsv", () => {
  it("starts with the dated line, then one exact row per holding", () => {
    const held = [row(ATOM_HUB, { liquid: "1500000", staked: "2000000", rewards: "1" }, price(1.71, -2))];
    const csv = holdingsCsv(held, { at: Date.UTC(2026, 9, 7, 9, 5), currency: "eur", scope: "Cosmos Hub" });
    const lines = csv.split("\r\n");
    assert.match(lines[0] ?? "", /^# Zunia holdings export · 2026-10-07 09:05 UTC · values in EUR · scope Cosmos Hub · 1 holdings/);
    assert.match(lines[1] ?? "", /^Chain ID,Chain,Asset key,Ticker/);
    assert.match(lines[1] ?? "", /Price \(EUR\),Value \(EUR\)/);
    assert.match(lines[2] ?? "", /^cosmoshub-4,/);
    assert.match(lines[2] ?? "", /,1\.5,2,0\.000001,0,3\.500001,/);
  });
});
