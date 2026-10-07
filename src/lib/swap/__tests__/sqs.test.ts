/**
 * Reading the Osmosis router (src/lib/swap/sqs.ts): quotes as
 * sqs.osmosis.zone answered them, and `/tokens/metadata` as the extension's
 * fixture captured it on 2026-10-05 (fixtures/sqs-tokens-metadata.json,
 * copied verbatim). The metadata cases are ported from zunia-extension
 * lib/__tests__/osmosis-assets.test.ts @ 1453e7a.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  fractionToPercent,
  largestSplit,
  parseOsmosisTokenMetadata,
  parseSqsQuote,
  priceImpactPercent,
  SqsAnswerError,
  spotPriceInDisplayUnits,
} from "../sqs";

const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";

/** sqs.osmosis.zone's answer for 10 OSMO → USDC.n on 2026-10-07. */
const SINGLE = {
  amount_in: { denom: "uosmo", amount: "10000000" },
  amount_out: "351505",
  route: [
    {
      pools: [
        {
          id: 1464,
          type: 2,
          balances: [],
          spread_factor: "0.000100000000000000",
          token_out_denom: USDC_N,
          taker_fee: "0.008000000000000000",
          liquidity_cap: "10699",
        },
      ],
      "has-cw-pool": false,
      out_amount: "351505",
      in_amount: "10000000",
    },
  ],
  liquidity_cap: "10699",
  effective_fee: "0.008000000000000000",
  price_impact: "-0.000159389905375342",
  in_base_out_quote_spot_price: "0.035439620491950298",
};

/** The router's split for 10 OSMO → USDC.inj (2026-10-06): 60/40 across pools 3498 and 3586. */
const SPLIT = {
  amount_in: { denom: "uosmo", amount: "10000000" },
  amount_out: "354634",
  route: [
    { pools: [{ id: 3498, type: 2, token_out_denom: USDC_INJ, spread_factor: "0.002", taker_fee: "0.008" }], in_amount: "6000000", out_amount: "212554" },
    { pools: [{ id: 3586, type: 0, token_out_denom: USDC_INJ, spread_factor: "0.003", taker_fee: "0.008" }], in_amount: "4000000", out_amount: "142080" },
  ],
  effective_fee: "0.008",
  price_impact: "-0.003872499987184370",
  in_base_out_quote_spot_price: "0.035888372884826882",
};

describe("a router quote", () => {
  test("reads one route with its fees, impact and spot price", () => {
    const quote = parseSqsQuote(SINGLE);
    assert.equal(quote.inDenom, "uosmo");
    assert.equal(quote.inAmount, "10000000");
    assert.equal(quote.outAmount, "351505");
    assert.equal(quote.splits.length, 1);
    assert.deepEqual(quote.splits[0]?.pools, [
      { poolId: "1464", tokenOutDenom: USDC_N, spreadFactor: "0.000100000000000000", takerFee: "0.008000000000000000", poolType: 2 },
    ]);
    assert.equal(quote.effectiveFee, "0.008000000000000000");
    assert.equal(quote.spotPrice, "0.035439620491950298");
    // The router signs impact negative against the user; shown as a positive cost.
    const impact = priceImpactPercent(quote);
    assert.ok(impact !== null && Math.abs(impact - 0.0159389905375342) < 1e-12);
    assert.equal(fractionToPercent(quote.effectiveFee), 0.8);
  });

  test("keeps every split of a split order, and names the largest", () => {
    const quote = parseSqsQuote(SPLIT);
    assert.deepEqual(
      quote.splits.map((split) => [split.inAmount, split.outAmount, split.pools.map((pool) => pool.poolId).join(">")]),
      [
        ["6000000", "212554", "3498"],
        ["4000000", "142080", "3586"],
      ],
    );
    assert.equal(largestSplit(quote.splits)?.pools[0]?.poolId, "3498");
  });

  test("drops a split with a leg it cannot read, and calls an empty route no route", () => {
    const broken = { ...SPLIT, route: [{ ...SPLIT.route[0], pools: [{ id: "x", token_out_denom: USDC_INJ }] }, SPLIT.route[1]] };
    assert.deepEqual(parseSqsQuote(broken).splits.map((split) => split.pools[0]?.poolId), ["3586"]);
    assert.throws(() => parseSqsQuote({ ...SINGLE, route: [] }), (error: unknown) => error instanceof SqsAnswerError && error.code === "no-route");
    assert.throws(
      () => parseSqsQuote({ ...SINGLE, route: [{ pools: [{ token_out_denom: USDC_N }] }] }),
      (error: unknown) => error instanceof SqsAnswerError && error.code === "no-route",
    );
  });

  test("refuses an answer without its amounts or route", () => {
    for (const body of [null, [], { ...SINGLE, amount_out: undefined }, { ...SINGLE, amount_in: { denom: "uosmo" } }, { ...SINGLE, route: "x" }, { ...SINGLE, amount_out: "1.5" }]) {
      assert.throws(() => parseSqsQuote(body), (error: unknown) => error instanceof SqsAnswerError && error.code === "malformed", JSON.stringify(body));
    }
  });

  test("never turns a missing impact or spot price into a confident zero", () => {
    const quote = parseSqsQuote({ ...SINGLE, price_impact: undefined, in_base_out_quote_spot_price: undefined, effective_fee: undefined });
    assert.equal(priceImpactPercent(quote), null);
    assert.equal(quote.spotPrice, null);
    assert.equal(fractionToPercent(quote.effectiveFee), null);
    assert.equal(priceImpactPercent({ priceImpact: "0" }), 0);
    assert.equal(Object.is(priceImpactPercent({ priceImpact: "0" }), -0), false);
    // A favourable quote stays favourable: the sign is flipped, not dropped.
    assert.equal(priceImpactPercent({ priceImpact: "0.001" }), -0.1);
  });

  test("accepts a pool id only when it is a safe integer", () => {
    // Past 2^53 a JSON number has already been rounded: the leg, and with it the only split, is dropped.
    const unsafe = { ...SINGLE, route: [{ ...SINGLE.route[0], pools: [{ ...SINGLE.route[0]!.pools[0], id: 2 ** 60 }] }] };
    assert.throws(() => parseSqsQuote(unsafe), (error: unknown) => error instanceof SqsAnswerError && error.code === "no-route");
    const asString = { ...SINGLE, route: [{ ...SINGLE.route[0], pools: [{ ...SINGLE.route[0]!.pools[0], id: "1464" }] }] };
    assert.equal(parseSqsQuote(asString).splits[0]?.pools[0]?.poolId, "1464");
  });
});

describe("parseOsmosisTokenMetadata", () => {
  test("keeps listed tokens keyed by denom, sorted by symbol", () => {
    const assets = parseOsmosisTokenMetadata({
      uosmo: { name: "Osmosis", symbol: "OSMO", decimals: 6, preview: false, coingeckoId: "osmosis" },
      [ATOM]: { name: "Cosmos Hub", symbol: "ATOM", decimals: 6, preview: false, coingeckoId: "" },
    });
    assert.deepEqual(assets, [
      { denom: ATOM, symbol: "ATOM", name: "Cosmos Hub", decimals: 6, coinGeckoId: null },
      { denom: "uosmo", symbol: "OSMO", name: "Osmosis", decimals: 6, coinGeckoId: "osmosis" },
    ]);
  });

  test("drops preview tokens and rows that do not parse", () => {
    const assets = parseOsmosisTokenMetadata({
      "factory/osmo1x/new": { symbol: "NEW", decimals: 6, preview: true },
      "factory/osmo1x/unflagged": { symbol: "UNF", decimals: 6 },
      "1bad": { symbol: "BAD", decimals: 6, preview: false },
      unamed: { symbol: "", decimals: 6, preview: false },
      ufrac: { symbol: "FRAC", decimals: 6.5, preview: false },
      uhuge: { symbol: "HUGE", decimals: 99, preview: false },
      ustr: { symbol: "STR", decimals: "6", preview: false },
      unull: null,
    });
    assert.deepEqual(assets, []);
  });

  test("falls back to the symbol for a missing name and bounds long text", () => {
    const [short, long] = parseOsmosisTokenMetadata({
      ushort: { symbol: "A", decimals: 18, preview: false, coingeckoId: "Not An Id" },
      ulong: { symbol: "X".repeat(40), name: "Y".repeat(90), decimals: 6, preview: false },
    });
    assert.equal(short?.name, "A");
    assert.equal(short?.coinGeckoId, null);
    assert.equal(long?.symbol.length, 24);
    assert.equal(long?.name.length, 48);
  });

  test("answers an unexpected body with an empty list", () => {
    assert.deepEqual(parseOsmosisTokenMetadata(null), []);
    assert.deepEqual(parseOsmosisTokenMetadata([{ symbol: "OSMO" }]), []);
    assert.deepEqual(parseOsmosisTokenMetadata("tokens"), []);
  });

  test("reads the captured listing: 127 of 131 rows listed, USDC.inj among them", () => {
    const body: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/sqs-tokens-metadata.json"), "utf8"));
    const listed = parseOsmosisTokenMetadata(body);
    assert.equal(Object.keys(body as object).length, 131);
    assert.equal(listed.length, 127);
    assert.deepEqual(
      listed.find((row) => row.denom === USDC_INJ),
      { denom: USDC_INJ, symbol: "USDC.inj", name: "USDC (Injective)", decimals: 6, coinGeckoId: "usd-coin" },
    );
  });
});

describe("the spot price, in display units", () => {
  test("scales the router's base-unit ratio by the two exponents", () => {
    // sqs.osmosis.zone, 2026-10-07: 0.1 INJ (18 decimals) → USDC.n (6) answered
    // `in_base_out_quote_spot_price: "0.000000000008133009"`, i.e. $8.133009.
    const injUsdc = spotPriceInDisplayUnits("0.000000000008133009", 18, 6);
    assert.ok(injUsdc !== null && Math.abs(injUsdc - 8.133009) < 1e-9, String(injUsdc));
    // Same exponent on both sides: the figure is already the display price.
    assert.equal(spotPriceInDisplayUnits("0.019916060478349877", 6, 6), 0.019916060478349877);
    // USDC (6) → INJ (18): the other way round.
    const usdcInj = spotPriceInDisplayUnits("122953586497.89", 6, 18);
    assert.ok(usdcInj !== null && Math.abs(usdcInj - 0.12295358649789) < 1e-12, String(usdcInj));
  });

  test("is unknown, never a guess, when a side's decimals or the figure are missing", () => {
    assert.equal(spotPriceInDisplayUnits("0.0199", null, 6), null);
    assert.equal(spotPriceInDisplayUnits("0.0199", 6, null), null);
    assert.equal(spotPriceInDisplayUnits(null, 6, 6), null);
    assert.equal(spotPriceInDisplayUnits("0", 6, 6), null);
    assert.equal(spotPriceInDisplayUnits("-1", 6, 6), null);
    assert.equal(spotPriceInDisplayUnits("abc", 6, 6), null);
  });
});
