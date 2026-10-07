/**
 * Token identity, ported from zunia-extension lib/__tests__/token-identity.test.ts
 * @ 1453e7a (vitest → node:test). Cases about user-added chains, browser
 * storage and the picker's search are not here: the dashboard has none of
 * those. The rest run against the same generated tables and the same catalog
 * rows, so a name that differs between the wallet and the dashboard fails here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { catalogIconFor, catalogRows, findCatalogEntry, findCurrencyOn, uniqueIssuerOf } from "../catalog";
import { coinDisplay } from "../coin-display";
import {
  chainTicker,
  channelCounterpartyOf,
  familyOf,
  feeTicker,
  ibcDenomFor,
  identifyHeld,
  identityOf,
  isUnlistedLocal,
  osmosisDenomOf,
  resetIdentityFacts,
  shortDenom,
  tickerFor,
  tokenKeywords,
  tokenKindLabel,
  tokenTableRows,
  tokenText,
  type DenomTraceResolver,
  type HeldTokenIdentity,
  type ResolvedTrace,
  type TransientMiss,
} from "../engine";
import { TOKEN_REGISTRY_SOURCES } from "../registry.generated";
import { installTestCatalog } from "./catalog-fixture";

installTestCatalog();

interface Audit {
  traces: { chainId: string; denom: string; path: string; baseDenom: string }[];
  channels: { chainId: string; channelId: string; counterpartyChainId: string }[];
  naming: { chainId: string; denom: string; ticker: string; originChainId: string; originDenom: string }[];
}

const audit = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/audit-traces.json"), "utf8")) as Audit;

const USDC_INJ_ERC20 = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
const USDC_INJ_ON_OSMOSIS = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
const USDC_N_ON_OSMOSIS = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const USDC_N_ON_INJECTIVE = "ibc/2CBC2EA121AE42563B08028466F37B600F2D7D4282342DE938283CC3FB2BC00E";
const USDC_AXL_ON_OSMOSIS = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const ALL_USDC = "factory/osmo147h5x9pcj7lm0cttlaefx6sqq5vdfnmwfcqxkmjd7exqm9gc7grqhr75m0/alloyed/allUSDC";
/** Eureka ETH as the Hub holds it, and its Osmosis voucher over channel-0. */
const HUB_EUREKA_ETH = "ibc/C0B53D3D23827AE38058BED0BDCD554229278AF530A8D265FCF6DFF7C4B2ADFF";
const EUREKA_ETH_ON_OSMOSIS = "ibc/20850C646CDDDC2270E9BBDB08558B5FEE57B647EC6827F41096AABFD8A0471B";
/** Picasso's voucher of Ethereum ETH, the issuer side of ETH.pica. */
const PICASSO_ETH = "ibc/F9D075D4079FC56A9C49B601E54A45292C319D8B0E8CC0F8439041130AA7166C";
const WORMHOLE_SOLANA_USDC =
  "factory/wormhole14ejqjyq8um4p3xfqj74yld5waqljf88fz25yxnma0cngspxe3les00fpjx/HJk1XMDRNUbRrpKkNZYui7SwWDMjXZAsySzqgyNcQoU3";
/** A voucher nothing lists. */
const UNLISTED = "ibc/0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
const ATOM_ON_OSMOSIS = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";

/** Every listed field of `expected` equals the identity's. */
function assertFields(actual: HeldTokenIdentity, expected: Partial<HeldTokenIdentity>, label?: string): void {
  for (const [field, value] of Object.entries(expected)) {
    assert.deepEqual(actual[field as keyof HeldTokenIdentity], value, `${label ?? actual.key}: ${field}`);
  }
}

describe("the audit's vouchers", () => {
  it("hash to their denoms, and the table holds each live trace", () => {
    for (const trace of audit.traces) {
      assert.equal(ibcDenomFor(trace.path, trace.baseDenom), trace.denom);
      const row = tokenTableRows(trace.chainId).find((candidate) => candidate.denom === trace.denom);
      assert.ok(row, trace.denom);
      assert.equal(row.path, trace.path);
      assert.equal(row.baseDenom, trace.baseDenom);
    }
  });

  it("map each first-hop channel to the chain at its other end", () => {
    for (const channel of audit.channels) {
      assert.equal(channelCounterpartyOf(channel.chainId, channel.channelId), channel.counterpartyChainId, channel.channelId);
    }
    assert.equal(channelCounterpartyOf("osmosis-1", "channel-999999"), null);
  });

  it("read as the naming table, proven, with known decimals", () => {
    for (const expected of audit.naming) {
      const identity = identityOf(expected.chainId, expected.denom);
      const label = `${expected.chainId}:${expected.denom}`;
      assert.deepEqual(
        { ticker: identity.ticker, originChainId: identity.originChainId, originDenom: identity.originDenom },
        { ticker: expected.ticker, originChainId: expected.originChainId, originDenom: expected.originDenom },
        label,
      );
      assert.notEqual(identity.provenance, "unknown", label);
      assert.equal(identity.proven, true, label);
      assert.equal(identity.decimalsKnown, true, label);
      assert.equal(identity.key, label);
    }
  });

  it("never reads Noble USDC as Axelar's, nor Picasso ETH as STOS", () => {
    const noble = identityOf("osmosis-1", USDC_N_ON_OSMOSIS);
    const axelar = identityOf("osmosis-1", USDC_AXL_ON_OSMOSIS);
    assert.notEqual(noble.ticker, axelar.ticker);
    assert.equal(noble.originChainName, "Noble");
    assert.equal(axelar.originChainName, "Axelar");
    assert.equal(identityOf("injective-1", USDC_N_ON_INJECTIVE).ticker, "USDC.n");
    const eth = identityOf("osmosis-1", "ibc/A23E590BA7E0D808706FB5085A449B3B9D6864AE4DDE7DAF936243CEBB2A3D43");
    assert.equal(eth.ticker, "ETH.pica");
    assert.equal(eth.family, "ETH");
    assert.equal(eth.decimals, 18);
  });
});

describe("USDC.inj", () => {
  it("keeps the mixed-case erc20 origin that hashes to the voucher Osmosis trades", () => {
    const onOsmosis = identityOf("osmosis-1", USDC_INJ_ON_OSMOSIS);
    assert.equal(onOsmosis.originDenom, USDC_INJ_ERC20);
    assert.equal(ibcDenomFor("transfer/channel-122", USDC_INJ_ERC20), USDC_INJ_ON_OSMOSIS);
    assert.equal(osmosisDenomOf("injective-1", USDC_INJ_ERC20), USDC_INJ_ON_OSMOSIS);

    // The catalog's lowercase spelling is a different, empty denom.
    const lowercase = USDC_INJ_ERC20.toLowerCase();
    assert.equal(
      ibcDenomFor("transfer/channel-122", lowercase),
      "ibc/D3B2A035362AF6B16BE95236AD85D408259B3611CA220781ECB7922C60ED7436",
    );
    assert.equal(osmosisDenomOf("injective-1", lowercase), null);

    const onInjective = identityOf("injective-1", USDC_INJ_ERC20);
    assert.equal(onInjective.ticker, "USDC.inj");
    assert.equal(onInjective.osmosisDenom, USDC_INJ_ON_OSMOSIS);
    assert.equal(onInjective.kind, "erc20");
  });

  it("does not lend its name to another spelling of the erc20 denom", () => {
    for (const spelling of [USDC_INJ_ERC20.toLowerCase(), "erc20:0xA00C59fF5a080D2b954d0c75e46E22a0c371235a"]) {
      const identity = identityOf("injective-1", spelling);
      assertFields(identity, { provenance: "unknown", proven: false, decimalsKnown: false }, spelling);
      assert.notEqual(identity.ticker, "USDC.inj", spelling);
      assert.equal(identity.osmosisDenom, null, spelling);
    }
  });

  it("gives the Osmosis row the issuer's channel pair for delivery to Injective", () => {
    const row = tokenTableRows("osmosis-1").find((candidate) => candidate.denom === USDC_INJ_ON_OSMOSIS);
    assert.ok(row);
    assert.equal(row.originChainId, "injective-1");
    assert.equal(row.originDenom, USDC_INJ_ERC20);
    assert.equal(row.channelId, "channel-122");
    assert.equal(row.counterpartyChainId, "injective-1");
    assert.equal(row.counterpartyChannelId, "channel-8");
    assert.equal(row.verified, true);
    assert.equal(row.stable, true);
  });
});

describe("the issuer's own denom", () => {
  /** The ticker before the per-chain collision guard. */
  const unguarded = (identity: HeldTokenIdentity) =>
    tickerFor({
      family: identity.family,
      originChainId: identity.originChainId,
      bridge: identity.bridge,
      sourceNetwork: identity.sourceNetwork,
      alloyed: identity.alloyed,
    });

  it("reads exactly like the voucher that proves it, on every issuer", () => {
    let checked = 0;
    for (const row of tokenTableRows("osmosis-1")) {
      if (!row.channelId || row.counterpartyChainId !== row.originChainId) continue;
      const onOsmosis = identityOf("osmosis-1", row.denom);
      const atIssuer = identityOf(row.originChainId, row.originDenom);
      const label = `${row.originChainId}:${row.originDenom}`;
      assert.equal(atIssuer.proven, true, label);
      assert.deepEqual(
        [atIssuer.originChainId, atIssuer.originDenom],
        [onOsmosis.originChainId, onOsmosis.originDenom],
        label,
      );
      assert.equal(unguarded(atIssuer), unguarded(onOsmosis), label);
      assert.equal(
        atIssuer.decimalsKnown && atIssuer.decimals,
        onOsmosis.decimalsKnown && onOsmosis.decimals,
        label,
      );
      checked += 1;
    }
    assert.ok(checked > 250, `checked ${checked}`);
  });

  it("names issuer denoms the catalog does not list or names its own way", () => {
    assertFields(identityOf("axelar-dojo-1", "polygon-uusdt"), {
      ticker: "USDT.axl.polygon",
      decimals: 6,
      provenance: "table",
      proven: true,
      kind: "other",
    });
    assertFields(identityOf("centauri-1", PICASSO_ETH), {
      ticker: "ETH.pica",
      originChainId: "centauri-1",
      path: "transfer/channel-52",
      decimals: 18,
    });
    // Not USDC.wormhole from the bech32 prefix: the bridge's tag, as on Osmosis.
    assert.equal(identityOf("wormchain", WORMHOLE_SOLANA_USDC).ticker, "USDC.wh.sol");
    const wormholeUsdc = findCatalogEntry("wormchain")?.currencies?.find((currency) => currency.coinDenom === "USDC");
    assert.ok(wormholeUsdc);
    assert.equal(identityOf("wormchain", wormholeUsdc.coinMinimalDenom).ticker, "USDC.wh");
    // Relayed: Osmosis lists LBTC as the Hub's; the issuer is Lombard.
    const lbtc = tokenTableRows("osmosis-1").find((row) => row.aliases.includes("LBTC") || row.family === "LBTC");
    assert.equal(lbtc?.originChainId, "cosmoshub-4");
    const lbtcOnOsmosis = identityOf("osmosis-1", lbtc?.denom ?? "");
    assertFields(lbtcOnOsmosis, { originChainId: "ledger-mainnet-1", originDenom: "uclbtc" });
    assert.deepEqual(lbtcOnOsmosis.hopChainIds, ["cosmoshub-4", "ledger-mainnet-1"]);
    assert.equal(tokenText(lbtcOnOsmosis, "row"), "Lombard Ledger LBTC · on Osmosis");
    // Terra lists ROAR by its bare contract, IBC spells it `cw20:`: one token.
    const roar = "terra1lxx40s29qvkrcj8fsa3yzyehy7w50umdvvnls2r830rys6lu2zns63eelv";
    assert.equal(identityOf("phoenix-1", roar).ticker, "ROAR");
    assert.equal(identityOf("phoenix-1", `cw20:${roar}`).ticker, "ROAR");
  });

  it("names the Hub's Eureka tokens, which no channel walk can", () => {
    const row = tokenTableRows("cosmoshub-4").find((candidate) => candidate.denom === HUB_EUREKA_ETH);
    assert.ok(row);
    assert.equal(row.originChainId, "cosmoshub-4");
    assert.equal(row.originDenom, HUB_EUREKA_ETH);
    assert.equal(row.path, "transfer/08-wasm-1369");
    assert.equal(row.channelId, null);
    assert.equal(row.counterpartyChainId, null);
    assert.equal(ibcDenomFor(row.path, row.baseDenom), HUB_EUREKA_ETH);
    assertFields(identityOf("cosmoshub-4", HUB_EUREKA_ETH), {
      ticker: "ETH.eureka",
      bridge: "eureka",
      provenance: "table",
      proven: true,
      decimals: 18,
      osmosisDenom: EUREKA_ETH_ON_OSMOSIS,
    });
    assertFields(identityOf("osmosis-1", EUREKA_ETH_ON_OSMOSIS), {
      ticker: "ETH.eureka",
      originChainId: "cosmoshub-4",
      originDenom: HUB_EUREKA_ETH,
    });
    // A light-client hop is not a channel: the map gains nothing from it.
    assert.equal(channelCounterpartyOf("cosmoshub-4", "08-wasm-1369"), null);
  });
});

describe("tickers", () => {
  it("name each chain's staking coin by the identity rule", () => {
    assert.equal(chainTicker("cosmoshub-4"), "ATOM");
    assert.equal(chainTicker("noble-1"), "USDC.n");
    assert.equal(chainTicker("axelar-dojo-1"), "AXL");
    assert.equal(chainTicker("osmosis-1"), "OSMO");
    assert.equal(chainTicker("injective-1"), "INJ");
    assert.equal(chainTicker("phoenix-1"), "LUNA");
    assert.equal(chainTicker("columbus-5"), "LUNC");
    assert.equal(chainTicker("safrochain-1"), "SAF");
    assert.equal(feeTicker("atomone-1"), "PHOTON");
    assert.equal(chainTicker("not-a-chain"), null);
  });

  it("never tag a chain that pays gas in someone else's coin", () => {
    for (const chainId of ["intergaze-1", "moo-1"]) {
      assert.equal(chainTicker(chainId), "INIT", chainId);
    }
    const intergaze = findCatalogEntry("intergaze-1");
    assert.ok(intergaze);
    assert.equal(identityOf("intergaze-1", intergaze.coinMinimalDenom).ticker, "INIT");
  });

  it("match the naming table for every variant", () => {
    const viaOrigin = (originChainId: string, originDenom: string) => {
      const denom = osmosisDenomOf(originChainId, originDenom);
      if (!denom) throw new Error(`${originChainId}:${originDenom} has no Osmosis voucher`);
      return identityOf("osmosis-1", denom).ticker;
    };
    const snapshot = {
      "USDC (Noble)": viaOrigin("noble-1", "uusdc"),
      "USDC (Injective)": viaOrigin("injective-1", USDC_INJ_ERC20),
      "USDC (Axelar)": viaOrigin("axelar-dojo-1", "uusdc"),
      "USDC (Axelar, Polygon)": viaOrigin("axelar-dojo-1", "polygon-uusdc"),
      "USDC (Axelar, Avalanche)": viaOrigin("axelar-dojo-1", "avalanche-uusdc"),
      "USDC (Gravity)": viaOrigin("gravity-bridge-3", "gravity0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
      "USDC (alloy)": identityOf("osmosis-1", ALL_USDC).ticker,
      "USDT (Kava)": viaOrigin("kava_2222-10", "erc20/tether/usdt"),
      "USDT (Axelar)": viaOrigin("axelar-dojo-1", "uusdt"),
      "USDT (Axelar, Arbitrum)": viaOrigin("axelar-dojo-1", "arbitrum-uusdt"),
      "USDT (Peggy)": viaOrigin("injective-1", "peggy0xdAC17F958D2ee523a2206206994597C13D831ec7"),
      "USDT (Gravity)": viaOrigin("gravity-bridge-3", "gravity0xdAC17F958D2ee523a2206206994597C13D831ec7"),
      "ETH (Axelar)": viaOrigin("axelar-dojo-1", "weth-wei"),
      "ETH (Axelar, Arbitrum)": viaOrigin("axelar-dojo-1", "arbitrum-weth-wei"),
      "ETH (Gravity)": viaOrigin("gravity-bridge-3", "gravity0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
      "ETH (Picasso)": viaOrigin("centauri-1", PICASSO_ETH),
      "USDC (Wormhole, Solana)": viaOrigin("wormchain", WORMHOLE_SOLANA_USDC),
      "WBTC (Axelar)": viaOrigin("axelar-dojo-1", "wbtc-satoshi"),
      "WBTC (Osmosis)": identityOf(
        "osmosis-1",
        "factory/osmo1z0qrq605sjgcqpylfl4aa6s90x738j7m58wyatt0tdzflg2ha26q67k743/wbtc",
      ).ticker,
      "DAI (Axelar)": viaOrigin("axelar-dojo-1", "dai-wei"),
      "ATOM (Hub)": viaOrigin("cosmoshub-4", "uatom"),
      "stATOM (Stride)": viaOrigin("stride-1", "stuatom"),
      "LUNA (Terra)": viaOrigin("phoenix-1", "uluna"),
      "AXL (Axelar)": viaOrigin("axelar-dojo-1", "uaxl"),
    };
    assert.deepEqual(snapshot, {
      "USDC (Noble)": "USDC.n",
      "USDC (Injective)": "USDC.inj",
      "USDC (Axelar)": "USDC.axl",
      "USDC (Axelar, Polygon)": "USDC.axl.polygon",
      "USDC (Axelar, Avalanche)": "USDC.axl.avax",
      "USDC (Gravity)": "USDC.grv",
      "USDC (alloy)": "allUSDC",
      "USDT (Kava)": "USDT.kava",
      "USDT (Axelar)": "USDT.axl",
      "USDT (Axelar, Arbitrum)": "USDT.axl.arb",
      "USDT (Peggy)": "USDT.peggy",
      "USDT (Gravity)": "USDT.grv",
      "ETH (Axelar)": "ETH.axl",
      "ETH (Axelar, Arbitrum)": "ETH.axl.arb",
      "ETH (Gravity)": "ETH.grv",
      "ETH (Picasso)": "ETH.pica",
      "USDC (Wormhole, Solana)": "USDC.wh.sol",
      "WBTC (Axelar)": "WBTC.axl",
      "WBTC (Osmosis)": "WBTC.osmo",
      "DAI (Axelar)": "DAI.axl",
      "ATOM (Hub)": "ATOM",
      "stATOM (Stride)": "stATOM",
      "LUNA (Terra)": "LUNA",
      "AXL (Axelar)": "AXL",
    });
  });

  it("apply the rule from origin, bridge and network", () => {
    assert.equal(tickerFor({ family: "USDC", originChainId: "osmosis-1", alloyed: true }), "allUSDC");
    assert.equal(tickerFor({ family: "USDC", originChainId: "noble-1" }), "USDC.n");
    assert.equal(
      tickerFor({ family: "USDC", originChainId: "axelar-dojo-1", bridge: "axl", sourceNetwork: "polygon" }),
      "USDC.axl.polygon",
    );
    // The network only separates multi-issuer families; WAVAX comes from one place.
    assert.equal(
      tickerFor({ family: "WAVAX", originChainId: "axelar-dojo-1", bridge: "axl", sourceNetwork: "avax" }),
      "WAVAX.axl",
    );
    assert.equal(tickerFor({ family: "ATOM", originChainId: "cosmoshub-4" }), "ATOM");
    assert.equal(tickerFor({ family: "ATOM", originChainId: "thorchain-1" }), "ATOM.thor");
    assert.equal(tickerFor({ family: "ETH", originChainId: "injective-1", bridge: "peggy" }), "ETH.peggy");
    assert.equal(tickerFor({ family: "USDC", originChainId: null }), "USDC");
    // A testnet is never an issuer, so it is never tagged.
    assert.equal(tickerFor({ family: "OSMO", originChainId: "osmo-test-5" }), "OSMO");
  });

  it("strip issuer decorations down to the family", () => {
    const cases: [string, string][] = [
      ["axlUSDC", "USDC"],
      ["PolygonUSDC.axl", "USDC"],
      ["USDC.e.matic.axl", "USDC"],
      ["USDC.n", "USDC"],
      ["solana.USDC.wh", "USDC"],
      ["avalanche.USDC.wh", "USDC"],
      ["USDt", "USDT"],
      ["WETH", "ETH"],
      ["wETH", "ETH"],
      ["ETH.BASE", "ETH"],
      ["stATOM", "stATOM"],
      ["wstETH", "wstETH"],
      ["DGN.old", "DGN.old"],
    ];
    for (const [symbol, family] of cases) assert.equal(familyOf(symbol), family, symbol);
  });

  it("leave no two denoms on one chain with the same ticker", () => {
    const denomsByChain = new Map<string, Set<string>>();
    const add = (chainId: string, denom: string) => {
      const set = denomsByChain.get(chainId) ?? new Set<string>();
      set.add(denom);
      denomsByChain.set(chainId, set);
    };
    for (const row of tokenTableRows()) {
      add(row.heldOnChainId, row.denom);
      if (row.channelId && row.counterpartyChainId === row.originChainId) add(row.originChainId, row.originDenom);
    }
    for (const chainId of [...denomsByChain.keys()]) {
      for (const currency of findCatalogEntry(chainId)?.currencies ?? []) {
        if (!currency.coinMinimalDenom.startsWith("ibc/")) add(chainId, currency.coinMinimalDenom);
      }
    }
    assert.ok(denomsByChain.size > 100);
    for (const [chainId, denoms] of denomsByChain) {
      const byTicker = new Map<string, string[]>();
      for (const denom of denoms) {
        // One CW20 under the catalog's bare spelling and IBC's `cw20:` one.
        if (denom.startsWith("cw20:") && denoms.has(denom.slice("cw20:".length))) continue;
        const { ticker } = identityOf(chainId, denom);
        byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), denom]);
      }
      const shared = [...byTicker.entries()].filter(([, list]) => list.length > 1);
      assert.deepEqual(shared, [], chainId);
    }
  });
});

describe("testnets and base denoms", () => {
  it("show a testnet coin under its own symbol, never as an issuer", () => {
    const testnet = catalogRows().find((entry) => entry.chainId === "osmo-test-5");
    assert.ok(testnet);
    const identity = identityOf("osmo-test-5", testnet.coinMinimalDenom);
    assert.equal(identity.ticker, testnet.coinDenom);
    assert.equal(identity.testnet, true);
  });

  it("only name a base denom by an issuer when exactly one registry chain issues it", () => {
    assert.equal(uniqueIssuerOf("uusdc"), undefined);
    assert.equal(uniqueIssuerOf("uluna"), undefined);
    assert.equal(uniqueIssuerOf("uatom")?.entry.chainId, "cosmoshub-4");
    // Stratos calls its coin `wei`; that does not make it Ethereum's issuer.
    assert.equal(uniqueIssuerOf("wei"), undefined);
  });
});

describe("unknown and unproven identities", () => {
  it("leave an unlisted voucher unknown, in base units", () => {
    const identity = identityOf("osmosis-1", UNLISTED);
    assertFields(identity, {
      provenance: "unknown",
      proven: false,
      originChainId: null,
      originDenom: null,
      decimals: 0,
      decimalsKnown: false,
      logoUrl: null,
      ticker: "IBC·0123",
      kind: "ibc",
    });
    assert.equal(tokenText(identity, "row"), "Unknown origin · on Osmosis · ibc/0123…ABCDEF");
  });

  it("know where an unlisted local token was minted but not its name", () => {
    assertFields(identityOf("osmosis-1", "factory/osmo1creator/uflower"), {
      provenance: "native",
      originChainId: "osmosis-1",
      ticker: "uflower",
      proven: false,
      decimalsKnown: false,
      kind: "factory",
    });
  });

  it("name a legacy Peggy denom from the Ethereum contract it embeds", () => {
    assertFields(identityOf("injective-1", "peggy0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), {
      ticker: "USDC.peggy",
      decimals: 6,
      bridge: "peggy",
      proven: true,
    });
  });

  it("read a contract denom only on the chain whose bridge mints it", () => {
    for (const chainId of ["injective-888", "osmosis-1"]) {
      const identity = identityOf(chainId, "peggy0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
      assert.equal(identity.proven, false, chainId);
      assert.doesNotMatch(identity.ticker, /^USDC/, chainId);
    }
  });

  it("treat a packet path as a path, not a bank denom", () => {
    assert.equal(identityOf("osmosis-1", "transfer/channel-750/uusdc").provenance, "unknown");
    assert.equal(
      identityOf("cosmoshub-4", "transfer/08-wasm-1369/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2").provenance,
      "unknown",
    );
  });

  it("never let a token nobody lists wear a listed token's ticker", () => {
    const cases: [string, string, string][] = [
      ["osmosis-1", "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/USDC.n", "USDC.n"],
      ["osmosis-1", "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/OSMO", "OSMO"],
      ["osmosis-1", "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/allUSDC", "allUSDC"],
      ["osmosis-1", "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/atom", "ATOM"],
      ["injective-1", "factory/inj1qyqszqgpqyqszqgpqyqszqgpqyqszqgpvk3zns/USDC.inj", "USDC.inj"],
    ];
    for (const [chainId, denom, real] of cases) {
      const identity = identityOf(chainId, denom);
      assert.notEqual(identity.ticker.toUpperCase(), real.toUpperCase(), denom);
      assert.match(identity.ticker, /·[0-9A-F]{4}$/, denom);
      assert.match(identity.name, /^Unlisted /, denom);
      assert.equal(identity.proven, false, denom);
    }
    assert.equal(identityOf("osmosis-1", USDC_N_ON_OSMOSIS).ticker, "USDC.n");
    assert.equal(identityOf("osmosis-1", "factory/osmo1creator/uflower").ticker, "uflower");
  });

  it("never throw", () => {
    assert.equal(identityOf("", "").provenance, "unknown");
    assert.equal(identityOf("not-a-chain", "ibc/XYZ").provenance, "unknown");
  });
});

describe("unlisted local tokens", () => {
  const IMPOSTOR = "factory/osmo1qyqszqgpqyqszqgpqyqszqgpqyqszqgpjnp7du/USDC.n";

  it("never call a token nothing lists native, in any wording", () => {
    const cases: [chainId: string, denom: string][] = [
      ["osmosis-1", IMPOSTOR],
      ["osmosis-1", "factory/osmo1creator/uflower"],
      ["injective-1", "factory/inj1qyqszqgpqyqszqgpqyqszqgpqyqszqgpvk3zns/USDC.inj"],
      ["injective-1", "erc20:0x0000000000000000000000000000000000000001"],
      ["cosmoshub-4", "uunlisted"],
      ["cosmoshub-4", "cw20:cosmos1xyz"],
      ["osmo-test-5", "factory/osmo1creator/utest"],
    ];
    for (const [chainId, denom] of cases) {
      const identity = identityOf(chainId, denom);
      assertFields(identity, { originChainId: chainId, listed: false, proven: false }, denom);
      assert.notEqual(identity.provenance, "unknown", denom);
      const held = identity.heldOnChainName;
      assert.equal(tokenText(identity, "row"), `Unlisted token · on ${held}`, denom);
      assert.equal(tokenText(identity, "a11y"), `${identity.ticker}, unlisted token, on ${held}`, denom);
      assert.equal(tokenText(identity, "sentence"), `${identity.ticker} (unlisted token) on ${held}`, denom);
      for (const variant of ["row", "a11y", "sentence"] as const) {
        assert.doesNotMatch(tokenText(identity, variant), /native/i, `${denom} ${variant}`);
      }
      assert.equal(isUnlistedLocal(identity), true, denom);
    }
    const impostor = identityOf("osmosis-1", IMPOSTOR);
    assert.match(impostor.ticker, /^USDC\.n·[0-9A-F]{4}$/);
    assert.equal(tokenText(impostor, "row"), "Unlisted token · on Osmosis");
  });

  it("keep Native for a chain's own coin and the local tokens a registry or a known contract names", () => {
    const listed: [chainId: string, denom: string, row: string][] = [
      ["osmosis-1", "uosmo", "Native on Osmosis"],
      ["injective-1", USDC_INJ_ERC20, "Native on Injective"],
      ["injective-1", "peggy0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "Native on Injective"],
      ["cosmoshub-4", HUB_EUREKA_ETH, "Native on Cosmos Hub"],
      ["axelar-dojo-1", "polygon-uusdt", "Native on Axelar"],
      ["osmo-test-5", "uosmo", "Native on Osmosis Testnet"],
    ];
    for (const [chainId, denom, row] of listed) {
      const identity = identityOf(chainId, denom);
      assert.equal(identity.listed, true, denom);
      assert.equal(isUnlistedLocal(identity), false, denom);
      assert.equal(tokenText(identity, "row"), row, denom);
    }
    assert.equal(
      tokenText(identityOf("injective-888", "peggy0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), "row"),
      "Unlisted token · on Injective (Testnet)",
    );
    const unknown = identityOf("osmosis-1", UNLISTED);
    assert.equal(unknown.listed, false);
    assert.equal(isUnlistedLocal(unknown), false);
  });

  it("name every registry, table and catalog token as listed, so none of them reads Unlisted", () => {
    const seen = new Set<string>();
    const unlisted: string[] = [];
    const check = (chainId: string, denom: string) => {
      const key = `${chainId}:${denom}`;
      if (seen.has(key)) return;
      seen.add(key);
      const identity = identityOf(chainId, denom);
      if (identity.listed) {
        assert.doesNotMatch(tokenText(identity, "row"), /Unlisted/, key);
      } else if (identity.provenance !== "unknown") {
        unlisted.push(key);
      }
    };
    for (const row of tokenTableRows()) {
      check(row.heldOnChainId, row.denom);
      check(row.originChainId, row.originDenom);
    }
    for (const entry of catalogRows()) {
      check(entry.chainId, entry.coinMinimalDenom);
      for (const currency of entry.currencies ?? []) check(entry.chainId, currency.coinMinimalDenom);
    }
    assert.ok(seen.size > 1400, `seen ${seen.size}`);
    // The one exception: Migaloo's own OPHIR, known only from a two-hop Hub voucher.
    assert.deepEqual(unlisted, [
      "migaloo-1:factory/migaloo1t862qdu9mj5hr3j727247acypym3ej47axu22rrapm4tqlcpuseqltxwq5/ophir",
    ]);
  });
});

describe("logos", () => {
  it("never use a chain icon for a token that is not that chain's coin", () => {
    const icons = new Set(catalogRows().flatMap((entry) => [catalogIconFor(entry), entry.iconUrl]).filter(Boolean));
    const identities: HeldTokenIdentity[] = [
      ...tokenTableRows().map((row) => identityOf(row.heldOnChainId, row.denom)),
      ...tokenTableRows().map((row) => identityOf(row.originChainId, row.originDenom)),
      ...audit.naming.map((row) => identityOf(row.chainId, row.denom)),
    ];
    let checked = 0;
    for (const identity of identities) {
      if (!identity.logoUrl || identity.kind === "native") continue;
      checked += 1;
      assert.equal(icons.has(identity.logoUrl), false, identity.key);
      assert.doesNotMatch(identity.logoUrl, /\/chain\.(png|svg)$/, identity.key);
    }
    assert.ok(checked > 300);
    assert.match(identityOf("osmosis-1", USDC_N_ON_OSMOSIS).logoUrl ?? "", /usdc\.(png|svg)$/);
  });
});

describe("text", () => {
  it("separates the issuer from the location", () => {
    const onOsmosis = identityOf("osmosis-1", USDC_INJ_ON_OSMOSIS);
    assert.equal(tokenText(onOsmosis, "pill"), "on Osmosis");
    assert.equal(tokenText(onOsmosis, "row"), "Injective USDC · on Osmosis");
    assert.equal(tokenText(onOsmosis, "sentence"), "USDC.inj (Injective USDC) on Osmosis");
    assert.equal(tokenText(onOsmosis, "a11y"), "USDC from Injective, on Osmosis");

    const atHome = identityOf("injective-1", USDC_INJ_ERC20);
    assert.equal(tokenText(atHome, "row"), "Native on Injective");
    assert.equal(tokenText(atHome, "sentence"), "USDC.inj on Injective");
    assert.equal(tokenText(atHome, "a11y"), "USDC.inj, native on Injective");

    assert.equal(tokenText(identityOf("osmosis-1", USDC_N_ON_OSMOSIS), "row"), "Noble USDC · on Osmosis");
    assert.equal(tokenText(identityOf("injective-1", USDC_N_ON_INJECTIVE), "a11y"), "USDC from Noble, on Injective");
    assert.equal(tokenText(identityOf("osmosis-1", ALL_USDC), "row"), "Alloyed USDC · Osmosis only");
    assert.equal(
      identityOf("osmosis-1", osmosisDenomOf("axelar-dojo-1", "polygon-uusdc") ?? "").name,
      "Axelar USDC from Polygon",
    );
    const unknown = identityOf("osmosis-1", UNLISTED);
    assert.equal(tokenText(unknown, "a11y"), "Unknown token ibc/0123…ABCDEF, on Osmosis");
    assert.equal(tokenText(unknown, "sentence"), "unknown token ibc/0123…ABCDEF on Osmosis");
  });

  it("makes every name users have seen a search keyword", () => {
    const noble = tokenKeywords(identityOf("osmosis-1", USDC_N_ON_OSMOSIS));
    assert.ok(noble.includes("USDC.noble") && noble.includes("Noble"), noble.join(","));
    const axelar = tokenKeywords(identityOf("osmosis-1", USDC_AXL_ON_OSMOSIS));
    assert.ok(axelar.includes("axlUSDC"), axelar.join(","));
    const atom = tokenKeywords(identityOf("osmosis-1", ATOM_ON_OSMOSIS));
    assert.ok(atom.includes("ATOM") && atom.includes("Cosmos Hub") && atom.includes("Osmosis"));
  });

  it("shortens every long denom one way", () => {
    assert.equal(shortDenom(USDC_N_ON_OSMOSIS), "ibc/498A…6BA6E4");
    assert.equal(shortDenom(USDC_INJ_ERC20), "erc20:0xa00C…235a");
    assert.equal(shortDenom("peggy0xdAC17F958D2ee523a2206206994597C13D831ec7"), "peggy0xdAC1…1ec7");
    assert.equal(shortDenom("factory/osmo1abcdefghijklmnop/uflower"), "factory/osmo1a…mnop/uflower");
    assert.equal(shortDenom("uatom"), "uatom");
  });

  it("labels every kind", () => {
    assert.deepEqual(
      (["native", "ibc", "factory", "erc20", "peggy", "cw20", "other"] as const).map(tokenKindLabel),
      ["Native", "IBC", "Factory", "ERC-20", "Peggy", "CW20", "Asset"],
    );
  });
});

describe("coinDisplay", () => {
  it("names a held voucher by its trace", () => {
    assert.deepEqual(coinDisplay("osmosis-1", USDC_N_ON_OSMOSIS), { symbol: "USDC.n", decimals: 6, known: true });
    assert.deepEqual(coinDisplay("injective-1", USDC_N_ON_INJECTIVE), { symbol: "USDC.n", decimals: 6, known: true });
    assert.deepEqual(coinDisplay("osmosis-1", USDC_AXL_ON_OSMOSIS), { symbol: "USDC.axl", decimals: 6, known: true });
  });

  it("no longer guesses an issuer from a base denom several chains use", () => {
    assert.equal(coinDisplay("noble-1", "transfer/channel-750/uusdc").known, false);
    const eth = coinDisplay("osmosis-1", "transfer/channel-1279/transfer/channel-52/wei");
    assert.equal(eth.known, false);
    assert.notEqual(eth.symbol, "STOS");
    assert.equal(coinDisplay("centauri-1", "wei").known, false);
  });

  it("still names a base denom exactly one registry chain issues", () => {
    assert.deepEqual(coinDisplay("osmosis-1", "uatom"), { symbol: "ATOM", decimals: 6, known: true });
    assert.deepEqual(coinDisplay("osmosis-1", "transfer/channel-141/uosmo"), { symbol: "OSMO", decimals: 6, known: true });
  });

  it("names a packet denom by the exact spelling it carries, not the catalog's", () => {
    const usdcInj = { symbol: "USDC.inj", decimals: 6, known: true };
    assert.deepEqual(coinDisplay("osmosis-1", USDC_INJ_ERC20), usdcInj);
    assert.deepEqual(coinDisplay("injective-1", `transfer/channel-122/${USDC_INJ_ERC20}`), usdcInj);
    assert.equal(coinDisplay("osmosis-1", USDC_INJ_ERC20.toLowerCase()).known, false);
  });
});

describe("the generated table", () => {
  it("is pinned and within its size budget", () => {
    assert.match(TOKEN_REGISTRY_SOURCES.osmosisAssetlists, /^[0-9a-f]{40}$/);
    assert.match(TOKEN_REGISTRY_SOURCES.chainRegistry, /^[0-9a-f]{40}$/);
  });

  it("holds only vouchers whose trace hashes to their denom", () => {
    const vouchers = tokenTableRows().filter((row) => row.path);
    assert.ok(vouchers.length > 300);
    for (const row of vouchers) {
      assert.equal(ibcDenomFor(row.path, row.baseDenom), row.denom, `${row.heldOnChainId}:${row.denom}`);
    }
  });

  it("trusts decimals only where the catalog and the table agree", () => {
    for (const row of tokenTableRows()) {
      const catalog = findCurrencyOn(row.originChainId, row.originDenom)?.currency.coinDecimals;
      const identity = identityOf(row.heldOnChainId, row.denom);
      if (catalog === undefined || catalog === row.decimals) {
        assert.equal(identity.decimals, row.decimals, identity.key);
        assert.equal(identity.decimalsKnown, true, identity.key);
      } else {
        assert.equal(identity.decimalsKnown, false, identity.key);
        assert.equal(identity.decimals, 0, identity.key);
      }
    }
  });
});

describe("identifyHeld", () => {
  beforeEach(() => resetIdentityFacts());
  afterEach(() => {
    mock.timers.reset();
    resetIdentityFacts();
  });

  /** A Noble USDC voucher on Akash, over a channel no table lists. */
  const AKASH_USDC = ibcDenomFor("transfer/channel-999", "uusdc");

  function resolverAnswering(
    answer: Record<string, ResolvedTrace>,
  ): DenomTraceResolver & { calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      identifyDenoms: async (_chainId, denoms) => {
        calls.push([...denoms]);
        return new Map(
          denoms.flatMap((denom) => (answer[denom] ? [[denom, answer[denom]] as [string, ResolvedTrace]] : [])),
        );
      },
    };
  }

  it("walks an unlisted voucher once and names it from its origin", async () => {
    const resolver = resolverAnswering({
      [AKASH_USDC]: { baseDenom: "uusdc", path: "transfer/channel-999", originChainId: "noble-1" },
    });
    const found = await identifyHeld("akashnet-2", [AKASH_USDC, "uakt"], { resolver });
    const usdc = found.get(AKASH_USDC);
    assert.ok(usdc);
    assertFields(usdc, {
      ticker: "USDC.n",
      provenance: "channel-walk",
      // Named from the walk, but channel-999 is no canonical channel: not proven.
      proven: false,
      originChainId: "noble-1",
      osmosisDenom: USDC_N_ON_OSMOSIS,
      decimals: 6,
    });
    assert.equal(tokenText(usdc, "row"), "Noble USDC · on Akash");
    assert.equal(found.get("uakt")?.ticker, "AKT");
    assert.deepEqual(resolver.calls, [[AKASH_USDC]]);

    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver });
    assert.equal(resolver.calls.length, 1);
    assert.equal(identityOf("akashnet-2", AKASH_USDC).ticker, "USDC.n");
  });

  it("proves a walk only when every hop crossed a registry-canonical channel", async () => {
    // Agoric's canonical channel to Noble is channel-62.
    const canonical = ibcDenomFor("transfer/channel-62", "uusdc");
    const lookalike = ibcDenomFor("transfer/channel-4242", "uusdc");
    const resolver = resolverAnswering({
      [canonical]: { baseDenom: "uusdc", path: "transfer/channel-62", originChainId: "noble-1", hopChainIds: ["noble-1"] },
      [lookalike]: { baseDenom: "uusdc", path: "transfer/channel-4242", originChainId: "noble-1", hopChainIds: ["noble-1"] },
    });
    const found = await identifyHeld("agoric-3", [canonical, lookalike], { resolver });
    assertFields(found.get(canonical)!, { provenance: "channel-walk", proven: true });
    assertFields(found.get(lookalike)!, { provenance: "channel-walk", proven: false });
    assert.equal(resolver.calls.length, 1);
  });

  it("rejects a trace whose hash does not match, and asks about it once", async () => {
    const resolver = resolverAnswering({
      [AKASH_USDC]: { baseDenom: "uatom", path: "transfer/channel-999", originChainId: "cosmoshub-4" },
    });
    const found = await identifyHeld("akashnet-2", [AKASH_USDC], { resolver });
    assert.equal(found.get(AKASH_USDC)?.provenance, "unknown");
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver });
    assert.equal(resolver.calls.length, 1);
  });

  it("asks nothing about denoms the table or the catalog already name", async () => {
    const resolver: DenomTraceResolver = {
      identifyDenoms: async () => {
        throw new Error("should not be asked");
      },
    };
    const found = await identifyHeld("osmosis-1", [USDC_N_ON_OSMOSIS, "uosmo", ALL_USDC], { resolver });
    assert.deepEqual(
      [...found.values()].map((entry) => entry.ticker),
      ["USDC.n", "OSMO", "allUSDC"],
    );
  });

  it("retries a voucher after a transient failure sooner than after a miss", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    let calls = 0;
    const flaky: DenomTraceResolver = {
      identifyDenoms: async (_chainId, denoms) => {
        calls += 1;
        return new Map<string, ResolvedTrace | TransientMiss>(denoms.map((denom) => [denom, { transient: true }]));
      },
    };
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver: flaky });
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver: flaky });
    assert.equal(calls, 1, "not asked again within the transient window");
    mock.timers.tick(3 * 60_000);
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver: flaky });
    assert.equal(calls, 2, "asked again after the transient window");

    // A whole-resolver failure is transient too.
    const broken: DenomTraceResolver = {
      identifyDenoms: async () => {
        calls += 1;
        throw new Error("LCD down");
      },
    };
    const other = ibcDenomFor("transfer/channel-998", "uusdc");
    await identifyHeld("akashnet-2", [other], { resolver: broken });
    mock.timers.tick(3 * 60_000);
    await identifyHeld("akashnet-2", [other], { resolver: broken });
    assert.equal(calls, 4);
  });

  it("remembers a real miss for half an hour", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const resolver = resolverAnswering({});
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver });
    mock.timers.tick(10 * 60_000);
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver });
    assert.equal(resolver.calls.length, 1);
    mock.timers.tick(25 * 60_000);
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver });
    assert.equal(resolver.calls.length, 2);
  });

  it("tags a second route of an asset the chain already lists", async () => {
    const canonical = tokenTableRows("juno-1").find(
      (row) => row.originChainId === "noble-1" && row.originDenom === "uusdc",
    );
    assert.ok(canonical);
    const detour = ibcDenomFor("transfer/channel-999", "uusdc");
    const resolver = resolverAnswering({
      [detour]: { baseDenom: "uusdc", path: "transfer/channel-999", originChainId: "noble-1" },
    });
    await identifyHeld("juno-1", [detour], { resolver });
    assert.equal(identityOf("juno-1", canonical.denom).ticker, "USDC.n");
    assert.equal(identityOf("juno-1", detour).ticker, `USDC.n·${detour.slice(4, 8)}`);
  });

  it("asks one batch per read and leaves the rest for the next, not for a miss", async () => {
    const vouchers = Array.from({ length: 40 }, (_, index) => ibcDenomFor(`transfer/channel-${5000 + index}`, "uusdc"));
    const batches: number[] = [];
    const resolver: DenomTraceResolver = {
      identifyDenoms: async (_chainId, denoms, options) => {
        batches.push(denoms.length);
        const answered = denoms.slice(0, options?.maxLookups ?? 32);
        return new Map(
          answered.map((denom) => [
            denom,
            {
              baseDenom: "uusdc",
              path: `transfer/channel-${5000 + vouchers.indexOf(denom)}`,
              originChainId: "noble-1",
            } satisfies ResolvedTrace,
          ]),
        );
      },
    };
    await identifyHeld("akashnet-2", vouchers, { resolver });
    await identifyHeld("akashnet-2", vouchers, { resolver });
    assert.deepEqual(batches, [32, 8]);
    assert.equal(
      vouchers.filter((denom) => identityOf("akashnet-2", denom).originChainId === "noble-1").length,
      40,
    );
  });

  it("records no miss when the read is cancelled", async () => {
    const controller = new AbortController();
    const cancelling: DenomTraceResolver = {
      identifyDenoms: async () => {
        controller.abort();
        return new Map();
      },
    };
    await assert.rejects(identifyHeld("akashnet-2", [AKASH_USDC], { resolver: cancelling, signal: controller.signal }));
    const resolver = resolverAnswering({
      [AKASH_USDC]: { baseDenom: "uusdc", path: "transfer/channel-999", originChainId: "noble-1" },
    });
    await identifyHeld("akashnet-2", [AKASH_USDC], { resolver });
    assert.equal(resolver.calls.length, 1);
    assert.equal(identityOf("akashnet-2", AKASH_USDC).ticker, "USDC.n");
  });

  it("never proves a testnet walk that claims a mainnet issuer", async () => {
    const voucher = ibcDenomFor("transfer/channel-7", "uusdc");
    const resolver = resolverAnswering({
      [voucher]: { baseDenom: "uusdc", path: "transfer/channel-7", originChainId: "noble-1" },
    });
    await identifyHeld("osmo-test-5", [voucher], { resolver });
    assertFields(identityOf("osmo-test-5", voucher), { originChainId: "noble-1", testnet: true, proven: false });
  });

  it("does not dress a walked token nobody lists as a variant of a real one", async () => {
    const base = "factory/neutron1qyqszqgpqyqszqgpqyqszqgpqyqszqgpz3jc3a/USDC.n";
    const impostor = ibcDenomFor("transfer/channel-874", base);
    const resolver = resolverAnswering({
      [impostor]: { baseDenom: base, path: "transfer/channel-874", originChainId: "neutron-1" },
    });
    await identifyHeld("osmosis-1", [impostor], { resolver });
    const walked = identityOf("osmosis-1", impostor);
    assert.equal(walked.provenance, "channel-walk");
    assert.equal(walked.proven, false);
    assert.match(walked.ticker, /^USDC\.n·[0-9A-F]{4}$/);
    assert.equal(walked.name, "Unlisted Neutron token");
    assert.equal(walked.listed, false);
    assert.equal(tokenText(walked, "row"), "Unlisted Neutron token · on Osmosis");
    assert.equal(tokenText(walked, "a11y"), "Unlisted Neutron token, on Osmosis");
    assert.equal(identityOf("osmosis-1", USDC_N_ON_OSMOSIS).ticker, "USDC.n");
  });

  it("reads an alloy held off Osmosis as a voucher, not as 'Neutron only'", async () => {
    const voucher = ibcDenomFor("transfer/channel-10", ALL_USDC);
    const resolver = resolverAnswering({
      [voucher]: { baseDenom: ALL_USDC, path: "transfer/channel-10", originChainId: "osmosis-1" },
    });
    await identifyHeld("neutron-1", [voucher], { resolver });
    const held = identityOf("neutron-1", voucher);
    assert.equal(held.ticker, "allUSDC");
    assert.equal(tokenText(held, "row"), "Alloyed USDC · on Neutron");
    assert.equal(tokenText(identityOf("osmosis-1", ALL_USDC), "row"), "Alloyed USDC · Osmosis only");
  });
});
