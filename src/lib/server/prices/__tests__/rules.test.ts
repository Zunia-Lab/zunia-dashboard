/**
 * The pricing rule: which price an asset may wear, and from which source.
 *
 * Identities come from the real identity engine and tables, so a case here
 * reads exactly like the asset does in a portfolio.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { ibcDenomFor, identifyHeld, identityOf, resetIdentityFacts } from "@/lib/token/engine";
import { installTestCatalog } from "@/lib/token/__tests__/catalog-fixture";
import { toTokenIdentity } from "@/lib/token/trim";
import type { TokenIdentity } from "@/lib/token/types";
import type { NumiaToken } from "../parse";
import {
  convertSpot,
  hasOwnSupply,
  indexNumia,
  isSpot,
  isSubject,
  mergeSubjects,
  MIN_PRICING_LIQUIDITY_USD,
  numiaRowFor,
  ownMarketCap,
  priceSubjectOf,
  rateFor,
  spotFor,
  venueSubjectOf,
  type PriceSubject,
  type SpotInputs,
} from "../rules";

installTestCatalog();

const USDC_N_ON_OSMOSIS = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const USDC_AXL_ON_OSMOSIS = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const ATOM_ON_OSMOSIS = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const ALL_USDC = "factory/osmo147h5x9pcj7lm0cttlaefx6sqq5vdfnmwfcqxkmjd7exqm9gc7grqhr75m0/alloyed/allUSDC";

const identity = (chainId: string, denom: string): TokenIdentity => toTokenIdentity(identityOf(chainId, denom));

function subject(chainId: string, denom: string): PriceSubject {
  const result = priceSubjectOf(identity(chainId, denom));
  assert.ok(isSubject(result), `${chainId}:${denom} should be priceable`);
  return result;
}

function numiaRow(overrides: Partial<NumiaToken>): NumiaToken {
  return {
    symbol: "X",
    denom: "ux",
    name: "X",
    exponent: 6,
    coinGeckoId: null,
    price: 1,
    change24h: 0,
    change7d: 0,
    volume24h: 1_000,
    liquidity: 50_000,
    marketCap: null,
    ...overrides,
  };
}

function inputs(overrides: Partial<SpotInputs> = {}): SpotInputs {
  return {
    numia: indexNumia([]),
    numiaAt: 1,
    exchange: new Map(),
    exchangeAt: 2,
    gecko: new Map(),
    geckoAt: 3,
    geckoRead: true,
    usdtUsd: null,
    ...overrides,
  };
}

describe("priceSubjectOf (who may be priced)", () => {
  beforeEach(() => resetIdentityFacts());

  it("prices a chain's own coin and a proven voucher as their origin asset", () => {
    assert.equal(subject("cosmoshub-4", "uatom").key, "cosmoshub-4:uatom");
    // ATOM on Osmosis is the Hub's ATOM: one key, so one price.
    const voucher = subject("osmosis-1", ATOM_ON_OSMOSIS);
    assert.equal(voucher.key, "cosmoshub-4:uatom");
    assert.deepEqual(voucher.osmosisDenoms, [ATOM_ON_OSMOSIS]);
    // USDC.n held on Injective trades on Osmosis as the canonical voucher.
    const usdcN = subject("injective-1", "ibc/2CBC2EA121AE42563B08028466F37B600F2D7D4282342DE938283CC3FB2BC00E");
    assert.equal(usdcN.key, "noble-1:uusdc");
    assert.deepEqual(usdcN.osmosisDenoms, [USDC_N_ON_OSMOSIS]);
  });

  it("names SAF's exchange market and nothing else's", () => {
    const saf = subject("safrochain-1", "usaf");
    assert.equal(saf.key, "safrochain-1:usaf");
    assert.equal(saf.exchange?.market, "SAFUSDT");
    assert.equal(subject("osmosis-1", "uosmo").exchange, null);
  });

  it("never values unknown decimals", () => {
    const unknown = priceSubjectOf(identity("osmosis-1", "ibc/0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"));
    assert.deepEqual(unknown, { unpriced: "decimals-unknown" });
    const lp = priceSubjectOf(identity("osmosis-1", "gamm/pool/1"));
    assert.deepEqual(lp, { unpriced: "decimals-unknown" });
  });

  it("never prices a testnet coin", () => {
    assert.deepEqual(priceSubjectOf(identity("osmo-test-5", "uosmo")), { unpriced: "testnet" });
  });

  it("gives a voucher its origin's price only when its walk is proven", async () => {
    // Noble USDC on Agoric over its canonical channel, and over a look-alike.
    const canonical = ibcDenomFor("transfer/channel-62", "uusdc");
    const lookalike = ibcDenomFor("transfer/channel-4242", "uusdc");
    await identifyHeld("agoric-3", [canonical, lookalike], {
      resolver: {
        identifyDenoms: async () =>
          new Map([
            [canonical, { baseDenom: "uusdc", path: "transfer/channel-62", originChainId: "noble-1", hopChainIds: ["noble-1"] }],
            [lookalike, { baseDenom: "uusdc", path: "transfer/channel-4242", originChainId: "noble-1", hopChainIds: ["noble-1"] }],
          ]),
      },
    });
    const proven = priceSubjectOf(identity("agoric-3", canonical));
    assert.ok(isSubject(proven));
    assert.equal(proven.key, "noble-1:uusdc");
    const unproven = identity("agoric-3", lookalike);
    // Named like USDC.n, keyed by where it sits, and never priced as Noble's.
    assert.equal(unproven.key, `agoric-3:${lookalike}`);
    assert.deepEqual(priceSubjectOf(unproven), { unpriced: "unproven" });
  });

  it("never prices an unlisted token that wears a real token's name", () => {
    const impostor = identity("osmosis-1", "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/USDC.n");
    assert.equal(isSubject(priceSubjectOf(impostor)), false);
  });
});

describe("numiaRowFor (matching Numia's list)", () => {
  it("matches by Osmosis denom, and that row is the only answer", () => {
    const usdcN = subject("osmosis-1", USDC_N_ON_OSMOSIS);
    const index = indexNumia([
      numiaRow({ symbol: "USDC", denom: USDC_AXL_ON_OSMOSIS, price: 0.98 }),
      numiaRow({ symbol: "USDC.n", denom: USDC_N_ON_OSMOSIS, price: 1 }),
    ]);
    assert.equal(numiaRowFor(usdcN, index)?.price, 1);
    // Unpriced on Osmosis: no fallback to another row reading "USDC".
    const unpriced = indexNumia([
      numiaRow({ symbol: "USDC", denom: USDC_AXL_ON_OSMOSIS, price: 0.98 }),
      numiaRow({ symbol: "USDC.n", denom: USDC_N_ON_OSMOSIS, price: null }),
    ]);
    assert.equal(numiaRowFor(usdcN, unpriced), null);
  });

  it("prices an asset from its deepest Osmosis market when it has several", () => {
    // ATOM held on Osmosis over an old route, plus the canonical voucher.
    const OLD_ROUTE = "ibc/1111111111111111111111111111111111111111111111111111111111111111";
    const held = priceSubjectOf(identity("cosmoshub-4", "uatom"), ATOM_ON_OSMOSIS);
    assert.ok(isSubject(held));
    const other: PriceSubject = { ...held, osmosisDenoms: [OLD_ROUTE] };
    const merged = mergeSubjects(other, held);
    assert.deepEqual(merged.osmosisDenoms, [OLD_ROUTE, ATOM_ON_OSMOSIS]);
    const index = indexNumia([
      numiaRow({ symbol: "ATOM", denom: OLD_ROUTE, price: 1.5, liquidity: 2_000 }),
      numiaRow({ symbol: "ATOM", denom: ATOM_ON_OSMOSIS, price: 1.79, liquidity: 2_100_000 }),
    ]);
    assert.equal(numiaRowFor(merged, index)?.price, 1.79);
  });

  it("ignores a pool too thin to quote anything", () => {
    const osmo = subject("osmosis-1", "uosmo");
    const thin = indexNumia([numiaRow({ symbol: "OSMO", denom: "uosmo", liquidity: MIN_PRICING_LIQUIDITY_USD - 1 })]);
    assert.equal(numiaRowFor(osmo, thin), null);
    const deep = indexNumia([numiaRow({ symbol: "OSMO", denom: "uosmo", liquidity: MIN_PRICING_LIQUIDITY_USD })]);
    assert.equal(numiaRowFor(osmo, deep)?.denom, "uosmo");
  });

  it("falls back to a symbol only for an asset with no Osmosis denom, unique and agreeing", () => {
    const base: PriceSubject = {
      key: "example-1:uexa",
      symbol: "EXA",
      decimals: 6,
      exchange: null,
      osmosisDenoms: [],
      coinGeckoId: "example",
    };
    const unique = indexNumia([numiaRow({ symbol: "EXA", denom: "ibc/AAAA", coinGeckoId: "example", price: 2 })]);
    assert.equal(numiaRowFor(base, unique)?.price, 2);
    const twice = indexNumia([
      numiaRow({ symbol: "EXA", denom: "ibc/AAAA", price: 2 }),
      numiaRow({ symbol: "EXA", denom: "ibc/BBBB", price: 3 }),
    ]);
    assert.equal(numiaRowFor(base, twice), null, "a symbol two rows share names neither");
    const otherDecimals = indexNumia([numiaRow({ symbol: "EXA", denom: "ibc/AAAA", exponent: 18 })]);
    assert.equal(numiaRowFor(base, otherDecimals), null);
    const otherGecko = indexNumia([numiaRow({ symbol: "EXA", denom: "ibc/AAAA", coinGeckoId: "other" })]);
    assert.equal(numiaRowFor(base, otherGecko), null);
    // With an Osmosis denom of its own, a symbol twin never prices it.
    const withDenom = { ...base, osmosisDenoms: ["ibc/CCCC"] };
    assert.equal(numiaRowFor(withDenom, unique), null);
  });

  it("refuses a unique symbol whose row the identity rules prove to be another asset", () => {
    const base: PriceSubject = {
      key: "example-1:uexa",
      symbol: "EXA",
      decimals: 6,
      exchange: null,
      osmosisDenoms: [],
      coinGeckoId: null,
    };
    const rows = [numiaRow({ symbol: "EXA", denom: "ibc/AAAA", price: 2 })];
    assert.equal(numiaRowFor(base, indexNumia(rows, () => "other-1:uexa")), null);
    assert.equal(numiaRowFor(base, indexNumia(rows, () => "example-1:uexa"))?.price, 2, "proven to be this asset");
    assert.equal(numiaRowFor(base, indexNumia(rows, () => null))?.price, 2, "nothing proven either way");
    assert.equal(numiaRowFor({ ...base, decimals: null }, indexNumia(rows)), null, "unknown decimals never match by symbol");
  });
});

describe("venueSubjectOf (an Osmosis denom's own market, for market views)", () => {
  beforeEach(() => resetIdentityFacts());

  it("shows an unknown Osmosis voucher its own pool's market, never by symbol or CoinGecko id", () => {
    const unknown = identity("osmosis-1", "ibc/603140E681973C7A3A33B06B1D377AAD0F6AC376119735CECC04C9184A1AB080");
    assert.equal(unknown.proven, false);
    assert.ok(!isSubject(priceSubjectOf(unknown)), "the pricing rule refuses it");
    const venue = venueSubjectOf(unknown);
    assert.ok(venue);
    assert.deepEqual(venue.osmosisDenoms, [unknown.denom]);
    assert.equal(venue.coinGeckoId, null);
    assert.equal(venue.exchange, null);
    const own = numiaRow({ symbol: "stBAND", denom: unknown.denom, price: 0.27 });
    const namesake = numiaRow({ symbol: "IBC·6031", denom: "ibc/FFFF", price: 99 });
    const spot = spotFor(venue, inputs({ numia: indexNumia([own, namesake]) }));
    assert.ok(isSpot(spot));
    assert.equal(spot.price, 0.27);
  });

  it("never applies off Osmosis or on a testnet", () => {
    assert.equal(venueSubjectOf(identity("cosmoshub-4", "ibc/88C8D98E544B20319F69F3A7E0F9E0FB3D4163DF2FFCAF7B603B42DE9E0EC333")), null);
    assert.equal(venueSubjectOf({ ...identity("osmosis-1", "uosmo"), testnet: true }), null);
  });
});

describe("own supply (market cap, circulating supply)", () => {
  it("belongs to Cosmos-native assets only, not to bridged, alloyed or multi-chain ones", () => {
    assert.equal(hasOwnSupply(identity("cosmoshub-4", "uatom")), true);
    assert.equal(ownMarketCap(identity("cosmoshub-4", "uatom"), 9.5e8), 9.5e8);
    assert.equal(hasOwnSupply(identity("osmosis-1", USDC_N_ON_OSMOSIS)), false, "USDC's supply is not Noble's");
    assert.equal(hasOwnSupply(identity("osmosis-1", USDC_AXL_ON_OSMOSIS)), false, "bridged");
    assert.equal(hasOwnSupply(identity("osmosis-1", ALL_USDC)), false, "alloyed");
    assert.equal(hasOwnSupply({ proven: true, family: "USDY" }), false, "issued on many chains at once");
    assert.equal(hasOwnSupply({ proven: false, family: "ATOM" }), false, "unproven");
    assert.equal(ownMarketCap(identity("cosmoshub-4", "uatom"), null), null);
  });
});

describe("spotFor (source priority)", () => {
  it("prices SAF from Coinstore before anything else, labelled with the market", () => {
    const saf = subject("safrochain-1", "usaf");
    const spot = spotFor(
      saf,
      inputs({
        exchange: new Map([["SAFUSDT", { price: 0.0003, change24h: -8, change7d: 2, volume24h: 25_000, lastAt: 0 }]]),
        usdtUsd: 0.999,
      }),
    );
    assert.ok(isSpot(spot));
    assert.equal(spot.source, "coinstore");
    assert.equal(spot.label, "Coinstore SAF/USDT");
    assert.equal(spot.url, "https://www.coinstore.com/spot/SAFUSDT");
    assert.ok(Math.abs(spot.price - 0.0003 * 0.999) < 1e-12);
    assert.equal(spot.change24h, -8);
    // Coinstore down: SAF is "source unavailable", not "no market".
    assert.deepEqual(spotFor(saf, inputs({ exchange: new Map([["SAFUSDT", null]]) })), {
      unpriced: "source-unavailable",
    });
  });

  it("prefers Numia, then CoinGecko by id", () => {
    const atom = subject("cosmoshub-4", "uatom");
    const numia = indexNumia([numiaRow({ symbol: "ATOM", denom: ATOM_ON_OSMOSIS, price: 1.79, change24h: -1.2, change7d: 4 })]);
    const gecko = new Map([["cosmos", { usd: 1.8, change24h: -1 }]]);
    const fromNumia = spotFor(atom, inputs({ numia, gecko }));
    assert.ok(isSpot(fromNumia));
    assert.deepEqual(
      { price: fromNumia.price, source: fromNumia.source, change7d: fromNumia.change7d, at: fromNumia.at },
      { price: 1.79, source: "numia", change7d: 4, at: 1 },
    );
    const fromGecko = spotFor(atom, inputs({ numia: indexNumia([]), gecko }));
    assert.ok(isSpot(fromGecko));
    assert.deepEqual(
      { price: fromGecko.price, source: fromGecko.source, change7d: fromGecko.change7d },
      { price: 1.8, source: "coingecko", change7d: null },
    );
  });

  it("says why there is no price", () => {
    const atom = subject("cosmoshub-4", "uatom");
    assert.deepEqual(spotFor(atom, inputs()), { unpriced: "no-market" });
    // Numia unread and CoinGecko not asked: an outage, not a missing market.
    assert.deepEqual(spotFor(atom, inputs({ numia: null, geckoRead: false })), { unpriced: "source-unavailable" });
  });

  it("never prices an alloy at its family's CoinGecko quote", () => {
    const ALL_BTC = "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC";
    const alloy = subject("osmosis-1", ALL_BTC);
    assert.equal(identity("osmosis-1", ALL_BTC).coinGeckoId, "bitcoin", "the table names the family's id");
    assert.equal(alloy.coinGeckoId, null);
    const gecko = new Map([["bitcoin", { usd: 84_115, change24h: 1 }]]);
    // Numia unread: an outage, never Bitcoin's price.
    assert.deepEqual(spotFor(alloy, inputs({ numia: null, gecko })), { unpriced: "source-unavailable" });
    // Numia read, the alloy's pool too thin: no market, never Bitcoin's price.
    assert.deepEqual(spotFor(alloy, inputs({ gecko })), { unpriced: "no-market" });
    // A non-alloyed token keeps its own id's fallback (USDC.n is USDC; USDC.axl is "axlusdc").
    const usdcN = subject("osmosis-1", USDC_N_ON_OSMOSIS);
    const fromGecko = spotFor(usdcN, inputs({ numia: null, gecko: new Map([["usd-coin", { usd: 0.9999, change24h: 0 }]]) }));
    assert.ok(isSpot(fromGecko));
    assert.equal(fromGecko.source, "coingecko");
    assert.equal(subject("osmosis-1", USDC_AXL_ON_OSMOSIS).coinGeckoId, "axlusdc");
  });

  it("prices the alloy by its own Osmosis denom", () => {
    const alloy = subject("osmosis-1", ALL_USDC);
    assert.deepEqual(alloy.osmosisDenoms, [ALL_USDC]);
    const spot = spotFor(alloy, inputs({ numia: indexNumia([numiaRow({ symbol: "USDC", denom: ALL_USDC, price: 0.9999 })]) }));
    assert.ok(isSpot(spot));
    assert.equal(spot.price, 0.9999);
  });
});

describe("currency", () => {
  it("converts USD prices at one rate and keeps the change", () => {
    const usd = { price: 2, change24h: 5, source: "numia" as const, at: 0 };
    assert.deepEqual(convertSpot(usd, 0.9), { ...usd, price: 1.8 });
    assert.equal(convertSpot(usd, 1), usd);
  });

  it("needs a rate for EUR and GBP, never for USD", () => {
    assert.equal(rateFor("usd", null), 1);
    assert.equal(rateFor("eur", null), null);
    assert.equal(rateFor("eur", { eur: 0.88, gbp: 0.75 }), 0.88);
    assert.equal(rateFor("gbp", { eur: 0.88, gbp: 0.75 }), 0.75);
  });
});
