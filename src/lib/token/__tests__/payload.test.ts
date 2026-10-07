/**
 * What leaves the server about a token, and what the browser accepts back:
 * the trimmed identity (and its asset key), the client-side labels, the LCD
 * trace shapes, and the narrowing of API payloads.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { identityOf, tokenTableRows, tokenText as engineText, type HeldTokenIdentity } from "../engine";
import { tokenKeywords, tokenText, type TokenTextVariant } from "../text";
import { parseTraceBody, readClientChainId, traceUnimplemented } from "../trace-body";
import { assetKeyOf, toTokenIdentity } from "../trim";
import {
  readAssetDetailResponse,
  readMarketsResponse,
  readPortfolioResponse,
  readPricesResponse,
  readSpot,
} from "../wire";
import { installTestCatalog } from "./catalog-fixture";

installTestCatalog();

const ATOM_ON_OSMOSIS = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const UNLISTED = "ibc/0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

describe("the trimmed identity", () => {
  it("keys a proven voucher by its origin asset, everything else by where it is", () => {
    assert.equal(assetKeyOf(identityOf("osmosis-1", ATOM_ON_OSMOSIS)), "cosmoshub-4:uatom");
    assert.equal(assetKeyOf(identityOf("cosmoshub-4", "uatom")), "cosmoshub-4:uatom");
    assert.equal(assetKeyOf(identityOf("osmosis-1", UNLISTED)), `osmosis-1:${UNLISTED}`);
    const impostor = "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/USDC.n";
    assert.equal(assetKeyOf(identityOf("osmosis-1", impostor)), `osmosis-1:${impostor}`);
  });

  it("carries unknown decimals as null and the fields the UI labels with", () => {
    const unknown = toTokenIdentity(identityOf("osmosis-1", UNLISTED));
    assert.equal(unknown.decimals, null);
    assert.equal(unknown.ticker, "IBC·0123");
    assert.equal(unknown.originChainId, undefined);
    const atom = toTokenIdentity(identityOf("osmosis-1", ATOM_ON_OSMOSIS));
    assert.deepEqual(
      {
        key: atom.key,
        chainId: atom.chainId,
        chainName: atom.chainName,
        originChainName: atom.originChainName,
        decimals: atom.decimals,
        osmosisDenom: atom.osmosisDenom,
        path: atom.path,
        proven: atom.proven,
        listed: atom.listed,
      },
      {
        key: "cosmoshub-4:uatom",
        chainId: "osmosis-1",
        chainName: "Osmosis",
        originChainName: "Cosmos Hub",
        decimals: 6,
        osmosisDenom: ATOM_ON_OSMOSIS,
        path: "transfer/channel-0",
        proven: true,
        listed: true,
      },
    );
  });

  it("reads the same words in the browser as on the server, for every table token", () => {
    const variants: TokenTextVariant[] = ["pill", "row", "sentence", "a11y"];
    const identities: HeldTokenIdentity[] = [
      ...tokenTableRows().map((row) => identityOf(row.heldOnChainId, row.denom)),
      identityOf("osmosis-1", UNLISTED),
      identityOf("osmosis-1", "factory/osmo1creator/uflower"),
      identityOf("osmosis-1", "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/USDC.n"),
      identityOf("osmo-test-5", "uosmo"),
    ];
    for (const held of identities) {
      const trimmed = toTokenIdentity(held);
      for (const variant of variants) {
        assert.equal(tokenText(trimmed, variant), engineText(held, variant), `${held.key} ${variant}`);
      }
    }
    assert.ok(tokenKeywords(toTokenIdentity(identityOf("osmosis-1", ATOM_ON_OSMOSIS))).includes("Cosmos Hub"));
  });
});

describe("LCD trace answers", () => {
  it("reads the three shapes and refuses empty ones", () => {
    assert.deepEqual(parseTraceBody({ denom_trace: { path: "transfer/channel-0", base_denom: "uatom" } }), {
      path: "transfer/channel-0",
      baseDenom: "uatom",
    });
    assert.deepEqual(parseTraceBody({ path: "/transfer/channel-0/", base_denom: "uatom" }), {
      path: "transfer/channel-0",
      baseDenom: "uatom",
    });
    assert.deepEqual(
      parseTraceBody({
        denom: {
          base: "uusdc",
          trace: [
            { port_id: "transfer", channel_id: "channel-1" },
            { port_id: "transfer", channel_id: "channel-750" },
          ],
        },
      }),
      { path: "transfer/channel-1/transfer/channel-750", baseDenom: "uusdc" },
    );
    assert.equal(parseTraceBody({ denom_trace: { path: "transfer/channel-0", base_denom: "" } }), null);
    assert.equal(parseTraceBody({ denom: { base: "uusdc", trace: [{ port_id: "transfer" }] } }), null);
    assert.equal(parseTraceBody({ code: 5, message: "not found" }), null);
  });

  it("recognises a retired endpoint answered with HTTP 200", () => {
    assert.equal(traceUnimplemented({ code: 12, message: "Not Implemented", details: [] }), true);
    assert.equal(traceUnimplemented({ code: "12" }), true);
    assert.equal(traceUnimplemented({ denom_trace: { path: "", base_denom: "x" } }), false);
  });

  it("reads a channel's light-client chain id, and nothing else", () => {
    const body = {
      identified_client_state: {
        client_id: "07-tendermint-1",
        client_state: { "@type": "/ibc.lightclients.tendermint.v1.ClientState", chain_id: "cosmoshub-4" },
      },
    };
    assert.equal(readClientChainId(body), "cosmoshub-4");
    assert.equal(
      readClientChainId({ identified_client_state: { client_state: { chain_id: "../../evil" } } }),
      null,
    );
    assert.equal(readClientChainId({}), null);
  });
});

describe("payload narrowing", () => {
  const identity = toTokenIdentity(identityOf("cosmoshub-4", "uatom"));

  it("keeps a well-formed portfolio and drops rows that do not narrow", () => {
    const raw = {
      currency: "usd",
      updatedAt: 1,
      totals: {
        value: 10,
        liquid: 10,
        staked: 0,
        rewards: 0,
        unbonding: 0,
        change24hAbs: null,
        change24hPct: null,
        change7dAbs: 2,
        change7dPct: 25,
        pricedValue: 10,
        unpricedAssetCount: 0,
        assetCount: 1,
        chainCount: 1,
      },
      chains: [{ chainId: "cosmoshub-4", status: "ok", value: 10 }, { status: "ok" }],
      assets: [
        {
          identity,
          chainId: "cosmoshub-4",
          amounts: { liquid: "5000000", staked: "x", rewards: "0", unbonding: "0" },
          total: 5,
          price: { price: 2, change24h: null, source: "numia", at: 1 },
          value: 10,
          change24hAbs: null,
        },
        { identity: { key: "broken" }, chainId: "x", amounts: {} },
      ],
      errors: [{ scope: "rewards", message: "timed out", chainId: "cosmoshub-4" }, { nope: true }],
    };
    const portfolio = readPortfolioResponse(raw);
    assert.ok(portfolio);
    assert.equal(portfolio.chains.length, 1);
    assert.equal(portfolio.assets.length, 1);
    assert.equal(portfolio.assets[0]?.amounts.staked, "0", "a malformed amount reads as zero base units");
    assert.equal(portfolio.assets[0]?.identity.decimals, 6);
    assert.deepEqual(portfolio.errors, [{ chainId: "cosmoshub-4", scope: "rewards", message: "timed out" }]);
    assert.deepEqual([portfolio.totals.change7dAbs, portfolio.totals.change7dPct], [2, 25]);
    // An answer from before the 7 d fields existed reads them as unknown, not zero.
    const older = readPortfolioResponse({ ...raw, totals: { ...raw.totals, change7dAbs: undefined, change7dPct: undefined } });
    assert.deepEqual([older?.totals.change7dAbs, older?.totals.change7dPct], [null, null]);
  });

  it("reads an asset page with its CoinGecko figures and an unverified listing", () => {
    const page = readAssetDetailResponse({
      key: "osmosis-1:factory/osmo1x/COOK",
      identity: null,
      currency: "usd",
      market: {
        price: 0.00026,
        change24h: 1,
        change7d: null,
        volume24h: 10,
        liquidity: 2316,
        marketCap: null,
        source: "numia",
        label: "Numia · Osmosis",
        listedAs: { symbol: "COOK", name: "COOK" },
      },
      stats: {
        marketCap: 953959359,
        circulatingSupply: 534612105,
        totalSupply: null,
        volume24h: 41526273,
        ath: 43.84,
        athChangePct: -95.9,
        athAt: 1632067200000,
        source: "coingecko",
        label: "CoinGecko",
        url: "https://www.coingecko.com/en/coins/cosmos",
        at: 5,
      },
      history30d: [{ t: 1, v: 2 }],
      historySource: "Numia · Osmosis",
      updatedAt: 5,
    });
    assert.ok(page);
    assert.deepEqual(page.market.listedAs, { symbol: "COOK", name: "COOK" });
    assert.equal(page.stats?.circulatingSupply, 534612105);
    assert.equal(page.stats?.totalSupply, null);
    const bare = readAssetDetailResponse({ key: "a:b", currency: "usd", market: {}, updatedAt: 1, stats: { source: "elsewhere", at: 1 } });
    assert.equal(bare?.stats, null, "stats from an unknown source are dropped");
    assert.equal(bare?.market.listedAs, undefined);
  });

  it("refuses a payload without its totals or with an unknown currency", () => {
    assert.equal(readPortfolioResponse({ currency: "usd", updatedAt: 1, chains: [], assets: [] }), null);
    assert.equal(
      readPortfolioResponse({ currency: "jpy", updatedAt: 1, totals: { pricedValue: 0 }, chains: [], assets: [] }),
      null,
    );
    assert.equal(readPortfolioResponse({ error: "upstream_failed", message: "x" }), null);
  });

  it("reads prices and markets, keeping null prices null", () => {
    const prices = readPricesResponse({
      currency: "eur",
      updatedAt: 2,
      prices: { "cosmoshub-4:uatom": { price: 1.6, change24h: -1, source: "numia", at: 1 }, "x:y": null },
      unpriced: { "x:y": "unproven", "a:b": "made-up" },
      currencyFallback: { requested: "gbp", reason: "Exchange rate unavailable" },
    });
    assert.ok(prices);
    assert.equal(prices.prices["x:y"], null);
    assert.deepEqual(prices.unpriced, { "x:y": "unproven" });
    assert.equal(prices.currencyFallback?.requested, "gbp");
    assert.equal(readSpot({ price: 1, source: "somewhere", at: 1 }), null);

    const markets = readMarketsResponse({
      currency: "usd",
      updatedAt: 3,
      sources: [{ id: "numia", label: "Numia · Osmosis", url: "https://www.numia.xyz", ok: true, at: 3 }],
      assets: [
        {
          key: "cosmoshub-4:uatom",
          symbol: "ATOM",
          name: "Cosmos Hub ATOM",
          price: 1.79,
          change24h: -1.2,
          change7d: null,
          volume24h: 300000,
          liquidity: 2100000,
          marketCap: null,
          sparkline7d: [1.7, 1.8, "x"],
          tradable: true,
          verified: true,
          source: "numia",
          chainId: "cosmoshub-4",
        },
        { key: "no-price", symbol: "X", source: "numia" },
      ],
    });
    assert.ok(markets);
    assert.equal(markets.assets.length, 1);
    assert.deepEqual(markets.assets[0]?.sparkline7d, [1.7, 1.8]);
    assert.equal(markets.sources[0]?.ok, true);
  });
});
