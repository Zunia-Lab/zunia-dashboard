/**
 * The portfolio answer: totals, buckets, the exact 24 h change, unpriced
 * assets counted (never valued at zero), failed chains reported (never
 * zeroed), and the LCD shapes behind it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SpotPrice, TokenIdentity } from "@/lib/token/types";
import type { UnpricedReason } from "@/lib/token/wire";
import { buildPortfolio, change24hAbsOf, groupHoldings, toWhole, type ChainInput } from "../aggregate";
import {
  integerAmount,
  parseBalancesPage,
  parseDelegationsPage,
  parseRewards,
  parseUnbondingPage,
  truncatedDecimal,
} from "../parse";

function identity(chainId: string, denom: string, overrides: Partial<TokenIdentity> = {}): TokenIdentity {
  return {
    key: `${chainId}:${denom}`,
    chainId,
    denom,
    kind: "native",
    ticker: denom.slice(1).toUpperCase(),
    name: denom,
    decimals: 6,
    provenance: "native",
    proven: true,
    ...overrides,
  };
}

function spot(price: number, change24h: number | null, change7d: number | null = null): SpotPrice {
  return { price, change24h, change7d, source: "numia", at: 0 };
}

const IDENTITIES: Record<string, TokenIdentity> = {
  "cosmoshub-4\nuatom": identity("cosmoshub-4", "uatom"),
  "osmosis-1\nuosmo": identity("osmosis-1", "uosmo"),
  // ATOM held on Osmosis: proven voucher, priced as the Hub's ATOM.
  "osmosis-1\nibc/27394": identity("osmosis-1", "ibc/27394", { key: "cosmoshub-4:uatom", kind: "ibc", ticker: "ATOM" }),
  // An LP share: decimals unknown.
  "osmosis-1\ngamm/pool/1": identity("osmosis-1", "gamm/pool/1", { kind: "other", decimals: null, proven: false }),
  // A voucher nothing proves.
  "osmosis-1\nibc/0123": identity("osmosis-1", "ibc/0123", { kind: "ibc", decimals: null, proven: false, provenance: "unknown" }),
  // Proven, but no market quotes it.
  "osmosis-1\nuion": identity("osmosis-1", "uion", { kind: "other" }),
};

const PRICES = new Map<string, SpotPrice>([
  ["cosmoshub-4:uatom", spot(2, 10, 25)],
  // CoinGecko-style quote: no 7 d change.
  ["osmosis-1:uosmo", spot(0.5, -20, null)],
]);

const UNPRICED = new Map<string, UnpricedReason>([["osmosis-1:uion", "no-market"]]);

function chain(chainId: string, holdings: ChainInput["holdings"], error?: string): ChainInput {
  return {
    chainId,
    chainName: chainId,
    iconUrl: null,
    nativeSymbol: chainId === "cosmoshub-4" ? "ATOM" : "OSMO",
    address: `${chainId}-address`,
    holdings,
    ...(error ? { error } : {}),
  };
}

function build(chains: ChainInput[]) {
  return buildPortfolio({
    currency: "usd",
    chains,
    identify: (chainId, denom) => {
      const found = IDENTITIES[`${chainId}\n${denom}`];
      if (!found) throw new Error(`no identity for ${chainId} ${denom}`);
      return found;
    },
    prices: PRICES,
    unpriced: UNPRICED,
    errors: [],
    now: 1_000,
  });
}

const HUB = chain("cosmoshub-4", {
  liquid: [{ denom: "uatom", amount: "1000000" }],
  staked: [{ denom: "uatom", amount: "9000000" }],
  rewards: [{ denom: "uatom", amount: "500000" }],
  unbonding: [{ denom: "uatom", amount: "2000000" }],
  issues: [],
});

const OSMOSIS = chain("osmosis-1", {
  liquid: [
    { denom: "uosmo", amount: "4000000" },
    { denom: "ibc/27394", amount: "1500000" },
    { denom: "gamm/pool/1", amount: "123456789" },
    { denom: "ibc/0123", amount: "42" },
    { denom: "uion", amount: "7000000" },
  ],
  staked: [],
  rewards: [],
  unbonding: [],
  issues: [{ scope: "rewards", message: "lcd timed out" }],
});

describe("buildPortfolio", () => {
  it("values each asset as total units × price across its four buckets", () => {
    const portfolio = build([HUB]);
    const atom = portfolio.assets[0];
    assert.ok(atom);
    assert.deepEqual(atom.amounts, { liquid: "1000000", staked: "9000000", rewards: "500000", unbonding: "2000000" });
    assert.equal(atom.total, 12.5);
    assert.equal(atom.value, 25);
    assert.deepEqual(
      {
        liquid: portfolio.totals.liquid,
        staked: portfolio.totals.staked,
        rewards: portfolio.totals.rewards,
        unbonding: portfolio.totals.unbonding,
      },
      { liquid: 2, staked: 18, rewards: 1, unbonding: 4 },
    );
    assert.equal(portfolio.totals.value, 25);
    assert.equal(portfolio.totals.pricedValue, 25);
  });

  it("computes the 24 h change exactly for constant holdings", () => {
    const portfolio = build([HUB, OSMOSIS]);
    // ATOM: 25 + 3 (ATOM on Osmosis) = 28 now at +10 % → was 28/1.1.
    // OSMO: 2 now at −20 % → was 2/0.8 = 2.5.
    const was = 28 / 1.1 + 2 / 0.8;
    const now = 28 + 2;
    assert.ok(Math.abs((portfolio.totals.change24hAbs ?? 0) - (now - was)) < 1e-9);
    assert.ok(Math.abs((portfolio.totals.change24hPct ?? 0) - ((now - was) / was) * 100) < 1e-9);
    // Not the value-weighted average of percentages (which would say +8 %).
    assert.notEqual(Math.round((portfolio.totals.change24hPct ?? 0) * 100) / 100, 8);
    assert.ok(Math.abs((change24hAbsOf(110, 10) ?? 0) - 10) < 1e-9);
    assert.equal(change24hAbsOf(5, null), null);
    assert.equal(change24hAbsOf(5, -100), null);
  });

  it("counts unpriced assets, never values them at zero, and says why", () => {
    const portfolio = build([HUB, OSMOSIS]);
    assert.equal(portfolio.totals.assetCount, 6);
    assert.equal(portfolio.totals.unpricedAssetCount, 3);
    const byDenom = new Map(portfolio.assets.map((asset) => [asset.identity.denom, asset]));
    assert.equal(byDenom.get("gamm/pool/1")?.value, null);
    assert.equal(byDenom.get("gamm/pool/1")?.total, null, "unknown decimals: no whole-unit total");
    assert.equal(byDenom.get("gamm/pool/1")?.unpriced, "decimals-unknown");
    assert.equal(byDenom.get("ibc/0123")?.unpriced, "decimals-unknown");
    assert.equal(byDenom.get("uion")?.unpriced, "no-market");
    assert.equal(byDenom.get("uion")?.total, 7);
    // Priced first by value (25, 3, 2), then unpriced by ticker (AMM…, BC…, ION).
    assert.deepEqual(
      portfolio.assets.map((asset) => asset.identity.denom),
      ["uatom", "ibc/27394", "uosmo", "gamm/pool/1", "ibc/0123", "uion"],
    );
  });

  it("answers null, not zero, when assets are held but none could be priced", () => {
    const portfolio = build([
      chain("osmosis-1", {
        liquid: [{ denom: "gamm/pool/1", amount: "5" }],
        staked: [],
        rewards: [],
        unbonding: [],
        issues: [],
      }),
    ]);
    assert.equal(portfolio.totals.value, null);
    assert.equal(portfolio.totals.pricedValue, 0);
    assert.equal(portfolio.chains[0]?.value, null);
    assert.deepEqual(
      [portfolio.chains[0]?.liquid, portfolio.chains[0]?.staked, portfolio.chains[0]?.rewards, portfolio.chains[0]?.unbonding],
      [null, null, null, null],
      "a chain whose holdings cannot be priced has unknown buckets, not $0 ones",
    );
    assert.equal(portfolio.totals.change24hAbs, null);
    assert.equal(portfolio.totals.change24hPct, null);
    assert.equal(portfolio.totals.change7dAbs, null);
  });

  it("computes the 7 d change the same way, over the assets whose source gives one", () => {
    const portfolio = build([HUB, OSMOSIS]);
    // ATOM (28 now) moved +25 % over 7 d → was 22.4; OSMO has no 7 d change
    // and is left out of both the change and its base.
    assert.ok(Math.abs((portfolio.totals.change7dAbs ?? 0) - (28 - 28 / 1.25)) < 1e-9);
    assert.ok(Math.abs((portfolio.totals.change7dPct ?? 0) - 25) < 1e-9);
  });

  it("is worth zero when it holds nothing", () => {
    const portfolio = build([chain("cosmoshub-4", { liquid: [], staked: [], rewards: [], unbonding: [], issues: [] })]);
    assert.equal(portfolio.totals.value, 0);
    assert.equal(portfolio.totals.assetCount, 0);
    assert.equal(portfolio.totals.chainCount, 0);
    assert.equal(portfolio.chains[0]?.status, "ok");
  });

  it("keeps a failed chain as an error row, reports it, and totals the rest", () => {
    const portfolio = build([chain("cosmoshub-4", null, "lcd-cosmoshub.keplr.app timed out"), OSMOSIS]);
    const failed = portfolio.chains.find((row) => row.chainId === "cosmoshub-4");
    assert.ok(failed);
    assert.equal(failed.status, "error");
    assert.equal(failed.value, null);
    assert.equal(failed.error, "lcd-cosmoshub.keplr.app timed out");
    assert.equal(portfolio.chains[portfolio.chains.length - 1]?.chainId, "cosmoshub-4", "failed chains last");
    assert.deepEqual(portfolio.errors, [
      { chainId: "cosmoshub-4", scope: "chain", message: "lcd-cosmoshub.keplr.app timed out" },
      { scope: "rewards", message: "lcd timed out", chainId: "osmosis-1" },
    ]);
    assert.equal(portfolio.totals.value, 5);
    assert.equal(portfolio.totals.chainCount, 1);
  });

  it("sums per chain and per bucket", () => {
    const portfolio = build([HUB, OSMOSIS]);
    const osmosis = portfolio.chains.find((row) => row.chainId === "osmosis-1");
    assert.equal(osmosis?.value, 5);
    assert.equal(osmosis?.assetCount, 5);
    assert.equal(portfolio.chains[0]?.chainId, "cosmoshub-4", "most valuable chain first");
    assert.equal(portfolio.totals.value, 30);
  });
});

describe("groupHoldings (the history curve's series)", () => {
  it("merges one asset across chains, most valuable first, priced holdings only", () => {
    const groups = groupHoldings(build([HUB, OSMOSIS]).assets);
    assert.deepEqual(
      groups.map((group) => [group.identity.key, group.units, group.value, group.spot]),
      [
        ["cosmoshub-4:uatom", 14, 28, 2],
        ["osmosis-1:uosmo", 4, 2, 0.5],
      ],
    );
  });
});

describe("toWhole", () => {
  it("scales base units without float drift", () => {
    assert.equal(toWhole("1", 6), 0.000001);
    assert.equal(toWhole("123456789", 6), 123.456789);
    assert.equal(toWhole("1000000000000000000", 18), 1);
    assert.equal(toWhole("0", 6), 0);
    assert.equal(toWhole(BigInt(5), 0), 5);
  });
});

describe("LCD shapes", () => {
  it("reads bank pages: non-zero, valid denoms, the next key", () => {
    const page = parseBalancesPage({
      balances: [
        { denom: "uatom", amount: "1000" },
        { denom: "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", amount: "5" },
        { denom: "uzero", amount: "0" },
        { denom: "../../etc", amount: "1" },
        { denom: "ufloat", amount: "1.5" },
        // Union's coin: two characters, below the SDK's default minimum, real.
        { denom: "au", amount: "7" },
        { denom: "a", amount: "7" },
      ],
      pagination: { next_key: "AAEC", total: "0" },
    });
    assert.ok(page);
    assert.deepEqual(
      page.rows.map((row) => row.denom),
      ["uatom", "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2", "au"],
    );
    assert.equal(page.nextKey, "AAEC");
    assert.equal(parseBalancesPage({ balances: [], pagination: { next_key: null } })?.nextKey, null);
    assert.equal(parseBalancesPage({ code: 5, message: "not found" }), null);
  });

  it("reads delegations with their validator and bond denom", () => {
    const page = parseDelegationsPage({
      delegation_responses: [
        { delegation: { validator_address: "cosmosvaloper1x", shares: "1.5" }, balance: { denom: "uatom", amount: "9000000" } },
        { delegation: { validator_address: "cosmosvaloper1y" }, balance: { denom: "uatom", amount: "0" } },
      ],
      pagination: {},
    });
    assert.deepEqual(page?.rows, [{ validator: "cosmosvaloper1x", denom: "uatom", amount: "9000000" }]);
  });

  it("truncates reward decimals to whole base units, any denom", () => {
    const rewards = parseRewards({
      rewards: [],
      total: [
        { denom: "uatom", amount: "305513.983000000000000000" },
        { denom: "ibc/ABC", amount: "0.999999999999999999" },
        { denom: "ustrd", amount: "103.000000000000000000" },
      ],
    });
    assert.deepEqual(rewards, [
      { denom: "uatom", amount: "305513" },
      { denom: "ustrd", amount: "103" },
    ]);
    assert.deepEqual(parseRewards({ rewards: [] }), []);
    assert.equal(parseRewards("nope"), null);
    assert.equal(truncatedDecimal("12.9"), "12");
    assert.equal(truncatedDecimal("007"), "7");
    assert.equal(truncatedDecimal("-1"), null);
    assert.equal(integerAmount("1e5"), null);
  });

  it("reads every unbonding entry with its completion time", () => {
    const page = parseUnbondingPage({
      unbonding_responses: [
        {
          validator_address: "cosmosvaloper1x",
          entries: [
            { balance: "2000000", completion_time: "2026-10-20T10:00:00Z" },
            { balance: "1", completion_time: "garbage" },
            { balance: "0", completion_time: "2026-10-21T10:00:00Z" },
          ],
        },
      ],
      pagination: { next_key: null },
    });
    assert.deepEqual(page?.rows, [
      { validator: "cosmosvaloper1x", amount: "2000000", completesAt: Date.UTC(2026, 9, 20, 10) },
      { validator: "cosmosvaloper1x", amount: "1", completesAt: null },
    ]);
  });
});
