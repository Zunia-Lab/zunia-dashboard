/**
 * The swap form's glue (src/lib/swap/form.ts), the move-first intent
 * (src/lib/swap/intent.ts), the wire narrowing (src/lib/swap/wire.ts) and the
 * small denom and amount helpers. Intent cases ported from zunia-extension's
 * swap-intent behaviour @ 1453e7a (one read, one hour).
 */

import "./json-modules";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bech32 } from "@scure/base";

import type { AssetOption } from "../assets";
import { PRICE_EXPIRED } from "../checks";
import { denomKey, ibcDenomOf, sameDenom, shortAddress, shortDenom } from "../denoms";
import { feeToWire, swapFeeFor } from "../fee";
import {
  freezeReview,
  minimumReceived,
  priceImpactLevel,
  quoteMismatch,
  quoteRequestFor,
  reviewDrift,
  signBlock,
  slippageNotice,
  swapFeeLine,
  swapFeeOutcome,
} from "../form";
import { rateOf, ratioText, tickerAmount } from "../format";
import { rememberSwapIntent, SWAP_INTENT_KEY, SWAP_INTENT_TTL_MS, takeSwapIntent, type IntentStorage } from "../intent";
import { quoteOnClientClock, readSwapAssetsResponse, readSwapQuoteResponse, type SwapQuoteOk } from "../wire";

const address = (prefix: string, fill: number) => bech32.encode(prefix, bech32.toWords(new Uint8Array(20).fill(fill)));
const OSMO_ME = address("osmo", 7);
const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const NOW = 1_791_330_000_000;

function option(chainId: string, denom: string, ticker: string, osmosisDenom: string | null): AssetOption {
  return {
    key: `${chainId}:${denom}`,
    chainId,
    chainName: chainId === "osmosis-1" ? "Osmosis" : chainId,
    denom,
    identity: {
      key: `${chainId}:${denom}`,
      chainId,
      denom,
      kind: "native",
      ticker,
      name: ticker,
      decimals: 6,
      provenance: "native",
      proven: true,
      ...(osmosisDenom ? { osmosisDenom } : {}),
    },
    ticker,
    decimals: 6,
    amount: "100000000",
    held: true,
    osmosisDenom,
    price: null,
    liquidity: null,
    verified: true,
    executable: "unknown",
    disabledReason: null,
    searchOnly: false,
    testnet: false,
  };
}

const OSMO = option("osmosis-1", "uosmo", "OSMO", "uosmo");
const USDCN = option("osmosis-1", USDC_N, "USDC.n", USDC_N);

const QUOTE: SwapQuoteOk = {
  updatedAt: NOW,
  path: "pool",
  estimate: false,
  signingChainId: "osmosis-1",
  amountIn: "9950000",
  amountOut: "351505",
  minOut: "347989",
  minOutKind: "exact",
  priceImpact: 0.0159,
  effectiveFee: 0.8,
  spotPrice: 0.0354,
  rate: { toPerFrom: "0.0353271", fromPerTo: "28.3069" },
  decimals: { from: 6, to: 6 },
  route: { pools: [{ id: "1464", tokenOutDenom: USDC_N }], splits: [{ inAmount: "9950000", outAmount: "351505", pools: [{ id: "1464", tokenOutDenom: USDC_N }] }] },
  venueInputDenom: "uosmo",
  venueOutputDenom: USDC_N,
  slippagePercent: 1,
  quotedAt: NOW,
  expiresAt: NOW + 20_000,
  warnings: [],
};

describe("the quote request a form makes", () => {
  test("prices what is left after the 0.5% fee on the From's chain, with Osmosis names as hints", () => {
    const made = quoteRequestFor({ from: OSMO, to: USDCN, amountUnits: BigInt(10_000_000), slippagePercent: 1 });
    assert.ok(made);
    assert.deepEqual(made.request, {
      fromChainId: "osmosis-1",
      fromDenom: "uosmo",
      toChainId: "osmosis-1",
      toDenom: USDC_N,
      amount: "9950000",
      slippagePercent: 1,
    });
    assert.equal(made.fee.fee, BigInt(50_000));
    const hub = quoteRequestFor({ from: option("cosmoshub-4", "uatom", "ATOM", "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2"), to: OSMO, amountUnits: BigInt(1_000_000), slippagePercent: 1 });
    assert.equal(hub?.request.fromVenueDenom, "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2");
    assert.equal(hub?.request.amount, "995000");
  });

  test("asks nothing for an empty amount, the same row, or a tolerance out of range", () => {
    assert.equal(quoteRequestFor({ from: OSMO, to: USDCN, amountUnits: null, slippagePercent: 1 }), null);
    assert.equal(quoteRequestFor({ from: OSMO, to: USDCN, amountUnits: BigInt(0), slippagePercent: 1 }), null);
    assert.equal(quoteRequestFor({ from: OSMO, to: OSMO, amountUnits: BigInt(10), slippagePercent: 1 }), null);
    assert.equal(quoteRequestFor({ from: OSMO, to: USDCN, amountUnits: BigInt(10), slippagePercent: 0 }), null);
    assert.equal(quoteRequestFor({ from: OSMO, to: USDCN, amountUnits: BigInt(10), slippagePercent: 51 }), null);
  });
});

describe("the review a form freezes", () => {
  const frozen = freezeReview({ id: 7, from: OSMO, to: USDCN, amountUnits: BigInt(10_000_000), quote: QUOTE, slippagePercent: 1, signer: OSMO_ME, recipient: OSMO_ME, recoveryAddress: null, now: NOW });

  test("captures both sides, the amount, the fee charged on the signing chain and the quote", () => {
    assert.ok("review" in frozen);
    const { review } = frozen;
    assert.equal(review.path, "pool");
    assert.equal(review.amountUnits, "10000000");
    assert.deepEqual(review.fee, feeToWire(swapFeeFor("osmosis-1", BigInt(10_000_000))));
    assert.deepEqual(review.from, { chainId: "osmosis-1", chainName: "Osmosis", denom: "uosmo", ticker: "OSMO", decimals: 6, osmosisDenom: "uosmo" });
  });

  test("refuses a price for another amount, an estimate, move-first, and a contract path without recovery", () => {
    const other = freezeReview({ id: 1, from: OSMO, to: USDCN, amountUnits: BigInt(20_000_000), quote: QUOTE, slippagePercent: 1, signer: OSMO_ME, recipient: OSMO_ME, recoveryAddress: null });
    assert.ok("problem" in other && /another amount/.test(other.problem));
    const move = freezeReview({ id: 1, from: OSMO, to: USDCN, amountUnits: BigInt(10_000_000), quote: { ...QUOTE, path: "move-first", estimate: true }, slippagePercent: 1, signer: OSMO_ME, recipient: OSMO_ME, recoveryAddress: null });
    assert.ok("problem" in move && /moves to Osmosis first/.test(move.problem));
    const contract = freezeReview({ id: 1, from: OSMO, to: USDCN, amountUnits: BigInt(10_000_000), quote: { ...QUOTE, path: "contract" }, slippagePercent: 1, signer: OSMO_ME, recipient: OSMO_ME, recoveryAddress: null });
    assert.ok("problem" in contract && /recovery address/.test(contract.problem));
  });

  test("drifts when the form sells, buys, spends or tolerates something else, or the path changed", () => {
    assert.ok("review" in frozen);
    const live = { fromKey: OSMO.key, toKey: USDCN.key, amountUnits: BigInt(10_000_000), slippagePercent: 1, path: "pool" as const };
    assert.equal(reviewDrift(frozen.review, live), null);
    assert.match(reviewDrift(frozen.review, { ...live, fromKey: "x:y" }) ?? "", /no longer sells OSMO on Osmosis/);
    assert.match(reviewDrift(frozen.review, { ...live, toKey: "x:y" }) ?? "", /no longer buys USDC\.n/);
    assert.match(reviewDrift(frozen.review, { ...live, amountUnits: BigInt(1) }) ?? "", /no longer 10 OSMO/);
    assert.match(reviewDrift(frozen.review, { ...live, slippagePercent: 3 }) ?? "", /slippage tolerance changed/);
    assert.match(reviewDrift(frozen.review, { ...live, path: "pool-deliver" }) ?? "", /another way/);
  });

  test("names why the button will not sign, in order", () => {
    const base = { problem: null, drift: null, quote: QUOTE, refreshing: false, now: NOW, feeShort: false };
    assert.equal(signBlock(base), null);
    assert.equal(signBlock({ ...base, problem: "x" })?.label, "Cannot sign");
    assert.equal(signBlock({ ...base, drift: "Moved." })?.reason, "Moved. Go back and review the swap again.");
    assert.equal(signBlock({ ...base, refreshing: true })?.label, "Updating the price…");
    assert.deepEqual(signBlock({ ...base, now: QUOTE.expiresAt }), { label: "Price expired", reason: PRICE_EXPIRED });
    assert.equal(signBlock({ ...base, feeShort: true })?.label, "Need fee room");
  });

  test("words the fee line and what becomes of the fee on failure", () => {
    assert.deepEqual(swapFeeLine(swapFeeFor("osmosis-1", BigInt(10_000_000)), OSMO), { label: "Zunia fee", value: "0.5% · 0.05 OSMO" });
    assert.equal(swapFeeLine(swapFeeFor("osmosis-1", BigInt(100)), OSMO), null);
    assert.match(swapFeeOutcome("pool", "osmosis-1", 50), /one transaction: if the swap fails, no fee is taken/);
    assert.match(swapFeeOutcome("pool-deliver", "osmosis-1", 50), /none of them happens/);
    assert.match(swapFeeOutcome("contract", "osmosis-1", 50), /no fee is taken/);
    assert.equal(swapFeeOutcome("contract", "cosmoshub-4", 50), "If the swap fails on Osmosis, the amount swapped comes back to you, but the 0.5% Zunia fee does not.");
  });
});

describe("the move-first intent", () => {
  function memory(): IntentStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key) };
  }

  test("is read once, within the hour", () => {
    const area = memory();
    rememberSwapIntent({ fromKey: "osmosis-1:ibc/ABC", toKey: "noble-1:uusdc" }, NOW, area);
    assert.ok(area.map.has(SWAP_INTENT_KEY));
    assert.deepEqual(takeSwapIntent(NOW + 1_000, area), { fromKey: "osmosis-1:ibc/ABC", toKey: "noble-1:uusdc" });
    assert.equal(takeSwapIntent(NOW + 2_000, area), null);
    rememberSwapIntent({ fromKey: "osmosis-1:uosmo", toKey: "noble-1:uusdc" }, NOW, area);
    assert.equal(takeSwapIntent(NOW + SWAP_INTENT_TTL_MS + 1, area), null);
    rememberSwapIntent({ fromKey: "osmosis-1:uosmo", toKey: "noble-1:uusdc" }, NOW, area);
    assert.equal(takeSwapIntent(NOW - 1, area), null);
  });

  test("ignores damaged records and works without storage", () => {
    const area = memory();
    area.setItem(SWAP_INTENT_KEY, "{not json");
    assert.equal(takeSwapIntent(NOW, area), null);
    area.setItem(SWAP_INTENT_KEY, JSON.stringify({ fromKey: 1, toKey: "a:b", at: NOW }));
    assert.equal(takeSwapIntent(NOW, area), null);
    rememberSwapIntent({ fromKey: "no key", toKey: "a:b" }, NOW, area);
    assert.equal(area.map.size, 0);
    assert.doesNotThrow(() => rememberSwapIntent({ fromKey: "a:b", toKey: "c:d" }, NOW, null));
    assert.equal(takeSwapIntent(NOW, null), null);
  });
});

describe("the wire", () => {
  test("narrows a quote, a blocked answer, and refuses anything else", () => {
    const ok = readSwapQuoteResponse(JSON.parse(JSON.stringify(QUOTE)));
    assert.deepEqual(ok, QUOTE);
    const blocked = readSwapQuoteResponse({ updatedAt: NOW, blocked: { code: "not-traded", message: "SAF is not traded on Osmosis, so Zunia cannot swap it." }, path: "move-first" });
    assert.equal(blocked?.blocked?.code, "not-traded");
    const preview = readSwapQuoteResponse({ updatedAt: NOW, blocked: { code: "no-floor", message: "x" }, preview: QUOTE });
    assert.equal(preview && "preview" in preview ? preview.preview?.amountOut : null, "351505");
    for (const bad of [
      null,
      { ...QUOTE, updatedAt: "now" },
      { ...QUOTE, amountOut: 351505 },
      { ...QUOTE, minOut: "01" },
      { ...QUOTE, path: "teleport" },
      { ...QUOTE, route: { pools: [{ id: "0", tokenOutDenom: USDC_N }] } },
      { updatedAt: NOW, blocked: { code: "made-up", message: "x" } },
    ]) {
      assert.equal(readSwapQuoteResponse(bad), null, JSON.stringify(bad));
    }
  });

  test("narrows an assets answer and refuses a malformed row", () => {
    const body = {
      updatedAt: NOW,
      venue: "osmosis-1",
      network: "mainnet",
      assets: [
        {
          key: `osmosis-1:${USDC_N}`,
          chainId: "osmosis-1",
          denom: USDC_N,
          identity: { key: "noble-1:uusdc", chainId: "osmosis-1", denom: USDC_N, kind: "ibc", ticker: "USDC.n", name: "Noble USDC", decimals: 6, provenance: "table", proven: true, osmosisDenom: USDC_N },
          osmosisDenom: USDC_N,
          decimals: 6,
          listedDecimals: 6,
          kind: "venue",
          liquidity: 2_109_808,
          price: 1,
          tradable: true,
        },
      ],
      routeTable: null,
      contract: { chainId: "osmosis-1", contract: null, reason: "off" },
      counts: { listed: 1320, identified: 177 },
      priceSource: "osmosis-sqs",
    };
    assert.equal(readSwapAssetsResponse(body)?.assets[0]?.identity.ticker, "USDC.n");
    assert.equal(readSwapAssetsResponse({ ...body, assets: [{ ...body.assets[0], listedDecimals: "6" }] }), null);
    assert.equal(readSwapAssetsResponse({ ...body, venue: "osmosis-2" }), null);
  });
});

describe("denoms and amounts", () => {
  test("hashes a voucher the way ICS-20 does, in the base's exact case", () => {
    assert.equal(ibcDenomOf("transfer/channel-122", "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a"), "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138");
    assert.notEqual(ibcDenomOf("transfer/channel-122", "erc20:0xa00c59ff5a080d2b954d0c75e46e22a0c371235a"), "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138");
    assert.equal(ibcDenomOf("transfer/channel-0", "uatom"), "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2");
    assert.equal(sameDenom(USDC_N, `ibc/${USDC_N.slice(4).toLowerCase()}`), true);
    assert.equal(denomKey("uosmo"), "uosmo");
    assert.equal(shortDenom(USDC_N), "ibc/498A…6E4");
    assert.equal(shortAddress(OSMO_ME), `${OSMO_ME.slice(0, 10)}…${OSMO_ME.slice(-6)}`);
  });

  test("writes amounts exactly, in base units when the exponent is unknown, and rates both ways", () => {
    assert.equal(tickerAmount("9950000", { ticker: "OSMO", decimals: 6 }), "9.95 OSMO");
    assert.equal(tickerAmount(BigInt("1234567890123456789"), { ticker: "INJ", decimals: 18 }), "1.23456789 INJ");
    assert.equal(tickerAmount("42", { ticker: "IBC·0123", decimals: null }), "42 base units of IBC·0123");
    assert.deepEqual(rateOf("9950000", 6, "351505", 6), { toPerFrom: "0.0353271", fromPerTo: "28.3069" });
    assert.deepEqual(rateOf("9950000", null, "351505", 6), { toPerFrom: null, fromPerTo: null });
    assert.deepEqual(rateOf("0", 6, "1", 6), { toPerFrom: null, fromPerTo: null });
    assert.equal(ratioText(0.00000035142), "0.00000035142");
    assert.equal(ratioText(28.30694), "28.3069");
    assert.equal(ratioText(0), null);
  });
});

describe("a quote checked against the form it answers", () => {
  const INJ_USDC = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
  const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
  const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
  const HOME_USDC = option("injective-1", INJ_USDC, "USDC.inj", USDC_INJ);
  const HUB_ATOM = option("cosmoshub-4", "uatom", "ATOM", ATOM);
  const DELIVER: SwapQuoteOk = {
    ...QUOTE,
    path: "pool-deliver",
    venueOutputDenom: USDC_INJ,
    delivery: { destChainId: "injective-1", channelId: "channel-122", port: "transfer", arrivalDenom: INJ_USDC, kind: "unwind", clientStatus: "active" },
  };
  const CONTRACT: SwapQuoteOk = {
    ...QUOTE,
    path: "contract",
    signingChainId: "cosmoshub-4",
    amountIn: "995000",
    venueInputDenom: ATOM,
    venueOutputDenom: "uosmo",
    minOutKind: "twap-estimate",
    twapWindowSeconds: 10,
    inbound: { sourceChainId: "cosmoshub-4", channelId: "channel-141", port: "transfer", venueChannelId: "channel-0", kind: "wrap", clientStatus: "active" },
  };

  test("accepts a quote for exactly this pair and tolerance, on each path", () => {
    assert.equal(quoteMismatch(QUOTE, OSMO, USDCN, 1), null);
    assert.equal(quoteMismatch(DELIVER, OSMO, HOME_USDC, 1), null);
    assert.equal(quoteMismatch(CONTRACT, HUB_ATOM, OSMO, 1), null);
  });

  test("refuses a quote for another tolerance, another From, another To, another delivery or entry", () => {
    assert.match(quoteMismatch(QUOTE, OSMO, USDCN, 0.5) ?? "", /another slippage tolerance/);
    assert.match(quoteMismatch(QUOTE, USDCN, OSMO, 1) ?? "", /another swap/);
    assert.match(quoteMismatch(QUOTE, OSMO, option("osmosis-1", ATOM, "ATOM", ATOM), 1) ?? "", /another swap/);
    assert.match(quoteMismatch({ ...DELIVER, delivery: { ...DELIVER.delivery!, arrivalDenom: "inj" } }, OSMO, HOME_USDC, 1) ?? "", /another swap/);
    assert.match(quoteMismatch({ ...DELIVER, delivery: undefined }, OSMO, HOME_USDC, 1) ?? "", /another swap/);
    assert.match(quoteMismatch({ ...CONTRACT, inbound: { ...CONTRACT.inbound!, sourceChainId: "juno-1" } }, HUB_ATOM, OSMO, 1) ?? "", /another swap/);
    assert.match(quoteMismatch({ ...CONTRACT, signingChainId: "osmosis-1" }, HUB_ATOM, OSMO, 1) ?? "", /another swap/);
  });

  test("freezes no review from a quote made for another tolerance", () => {
    const frozen = freezeReview({ id: 2, from: OSMO, to: USDCN, amountUnits: BigInt(10_000_000), quote: QUOTE, slippagePercent: 3, signer: OSMO_ME, recipient: OSMO_ME, recoveryAddress: null });
    assert.ok("problem" in frozen && /another slippage tolerance/.test(frozen.problem));
  });
});

describe("one wording of a quote for every surface", () => {
  test("validates a typed tolerance like the quote route does, and warns above 3%", () => {
    assert.deepEqual(slippageNotice(1), { valid: true, message: null });
    assert.deepEqual(slippageNotice(3), { valid: true, message: null });
    assert.equal(slippageNotice(3.5).valid, true);
    assert.match(slippageNotice(3.5).message ?? "", /up to 3.5% less than quoted/);
    for (const bad of [0, -1, 50.5, Number.NaN, 0.0000001]) assert.equal(slippageNotice(bad).valid, false, String(bad));
    assert.equal(quoteRequestFor({ from: OSMO, to: USDCN, amountUnits: BigInt(10_000_000), slippagePercent: 0.0000001 }), null);
  });

  test("grades price impact by the shared thresholds, unknown when the router said nothing", () => {
    assert.equal(priceImpactLevel(null), "unknown");
    assert.equal(priceImpactLevel(-0.3), "normal");
    assert.equal(priceImpactLevel(0.2), "normal");
    assert.equal(priceImpactLevel(1), "caution");
    assert.equal(priceImpactLevel(2.17), "caution");
    assert.equal(priceImpactLevel(5), "warning");
  });

  test("says the minimum as a signed number on the pools and as a rule on the contract", () => {
    const usdc = { ticker: "USDC.n", decimals: 6 };
    assert.deepEqual(minimumReceived(QUOTE, usdc), { amount: "0.347989 USDC.n", exact: true, estimate: false, rule: null });
    assert.deepEqual(minimumReceived({ ...QUOTE, estimate: true }, usdc).estimate, true);
    const twap = minimumReceived({ ...QUOTE, minOutKind: "twap-estimate", twapWindowSeconds: 10, slippagePercent: 1, minOut: "49264584" }, { ticker: "OSMO", decimals: 6 });
    assert.deepEqual(twap, {
      amount: "49.264584 OSMO",
      exact: false,
      estimate: true,
      rule: "The 10-second average price, less 1%. Below it the swap does not happen.",
    });
    assert.equal(minimumReceived({ ...QUOTE, minOut: null }, usdc).amount, null);
  });
});

describe("a quote's life, on the browser's clock", () => {
  // The server answered at NOW + 4 s (cold proofs) a price the router gave at NOW.
  const answered = { ...QUOTE, quotedAt: NOW, expiresAt: NOW + 20_000, updatedAt: NOW + 4_000 };

  test("keeps the life left at the answer, counted from its arrival, whatever the skew", () => {
    for (const skew of [0, 45_000, -600_000]) {
      const receivedAt = NOW + 4_050 + skew;
      const moved = quoteOnClientClock(answered, receivedAt, 20_000) as SwapQuoteOk;
      assert.equal(moved.expiresAt, receivedAt + 16_000, `skew ${skew}`);
      assert.equal(moved.quotedAt, receivedAt - 4_000, `skew ${skew}`);
      // Fresh on arrival on a clock 45 s ahead, still dead 16 s later on one 10 min behind.
      assert.equal(signBlock({ problem: null, drift: null, quote: moved, refreshing: false, now: receivedAt + 1_000, feeShort: false }), null);
      assert.equal(signBlock({ problem: null, drift: null, quote: moved, refreshing: false, now: receivedAt + 16_000, feeShort: false })?.label, "Price expired");
      assert.equal(moved.amountOut, QUOTE.amountOut);
    }
  });

  test("clamps a stamp it cannot believe, and moves a blocked answer's preview the same way", () => {
    const wild = quoteOnClientClock({ ...answered, expiresAt: NOW + 9_999_999 }, 1_000, 20_000) as SwapQuoteOk;
    assert.equal(wild.expiresAt, 21_000);
    const late = quoteOnClientClock({ ...answered, updatedAt: NOW + 25_000 }, 1_000, 20_000) as SwapQuoteOk;
    assert.equal(late.expiresAt, 1_000);
    const blocked = quoteOnClientClock({ updatedAt: NOW + 4_000, blocked: { code: "no-floor", message: "x" }, preview: QUOTE }, 50_000, 20_000);
    assert.ok(blocked.blocked && blocked.preview);
    assert.equal(blocked.preview.expiresAt, 66_000);
    const bare = { updatedAt: NOW, blocked: { code: "not-traded" as const, message: "x" } };
    assert.deepEqual(quoteOnClientClock(bare, 1, 20_000), bare);
  });
});
