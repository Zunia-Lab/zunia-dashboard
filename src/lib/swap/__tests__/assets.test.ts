/**
 * The swap page's two lists (src/lib/swap/assets.ts): rows, the exponent
 * rule, the four sources of the buy list, gating and order. Ported in spirit
 * from zunia-extension lib/__tests__/swap-assets.test.ts @ 1453e7a; the
 * identities are written out here (the server computes them in production),
 * and the catalog is a small one passed in, so the rules are tested alone.
 */

import "./json-modules";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import type { ChainEntry } from "@/lib/chains";
import type { TokenIdentity } from "@/lib/token/types";
import {
  amountUnitsOf,
  buyOptions,
  chainCoinIdentity,
  exponentOf,
  expectedVenueDenoms,
  heldFromPortfolio,
  pickTo,
  sellOptions,
  type HeldToken,
} from "../assets";
import type { SwapAsset } from "../wire";
import { notTradedReason, parseRouterState, SAME_TOKEN_REASON, SELF_REASON, TESTNET_REASON, tableDenoms, type XcsRouteTable } from "../xcs";

const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
const USDC_INJ_ERC20 = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
const USDC_AXL = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const UNLISTED = "ibc/0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

function chain(chainId: string, chainName: string, coinDenom: string, coinMinimalDenom: string, network: "mainnet" | "testnet" = "mainnet"): ChainEntry {
  return {
    chainId,
    chainName,
    bech32Prefix: "x",
    coinType: 118,
    network,
    coinDenom,
    coinMinimalDenom,
    coinDecimals: 6,
    feeDenom: coinDenom,
    feeMinimalDenom: coinMinimalDenom,
    feeDecimals: 6,
    iconUrl: `https://logo/${chainId}.png`,
  };
}

const CHAINS: ChainEntry[] = [
  chain("safrochain-1", "Safrochain", "SAF", "usaf"),
  chain("cosmoshub-4", "Cosmos Hub", "ATOM", "uatom"),
  chain("osmosis-1", "Osmosis", "OSMO", "uosmo"),
  chain("injective-1", "Injective", "INJ", "inj"),
  chain("noble-1", "Noble", "USDC", "uusdc"),
  chain("axelar-dojo-1", "Axelar", "AXL", "uaxl"),
  chain("safro-testnet-1", "Safrochain Testnet", "SAF", "usaf", "testnet"),
];

function identity(chainId: string, denom: string, fields: Partial<TokenIdentity> & { ticker: string }): TokenIdentity {
  return {
    key: `${fields.originChainId ?? chainId}:${fields.originDenom ?? denom}`,
    chainId,
    denom,
    kind: denom.startsWith("ibc/") ? "ibc" : "native",
    name: fields.ticker,
    decimals: 6,
    provenance: "table",
    proven: true,
    ...fields,
  };
}

const id = {
  osmo: identity("osmosis-1", "uosmo", { ticker: "OSMO", provenance: "native", originChainId: "osmosis-1", originDenom: "uosmo", osmosisDenom: "uosmo", logoUrl: "https://logo/osmo.png" }),
  atomHub: identity("cosmoshub-4", "uatom", { ticker: "ATOM", provenance: "native", originChainId: "cosmoshub-4", originDenom: "uatom", osmosisDenom: ATOM }),
  atomOsmo: identity("osmosis-1", ATOM, { ticker: "ATOM", originChainId: "cosmoshub-4", originDenom: "uatom", osmosisDenom: ATOM }),
  nOsmo: identity("osmosis-1", USDC_N, { ticker: "USDC.n", originChainId: "noble-1", originDenom: "uusdc", osmosisDenom: USDC_N, logoUrl: "https://logo/usdc.png" }),
  nHome: identity("noble-1", "uusdc", { ticker: "USDC.n", provenance: "native", originChainId: "noble-1", originDenom: "uusdc", osmosisDenom: USDC_N }),
  injOsmo: identity("osmosis-1", USDC_INJ, { ticker: "USDC.inj", originChainId: "injective-1", originDenom: USDC_INJ_ERC20, osmosisDenom: USDC_INJ }),
  injHome: identity("injective-1", USDC_INJ_ERC20, { ticker: "USDC.inj", provenance: "catalog", originChainId: "injective-1", originDenom: USDC_INJ_ERC20, osmosisDenom: USDC_INJ }),
  axlOsmo: identity("osmosis-1", USDC_AXL, { ticker: "USDC.axl", originChainId: "axelar-dojo-1", originDenom: "uusdc", osmosisDenom: USDC_AXL }),
  axlHome: identity("axelar-dojo-1", "uusdc", { ticker: "USDC.axl", provenance: "catalog", originChainId: "axelar-dojo-1", originDenom: "uusdc", osmosisDenom: USDC_AXL }),
  saf: identity("safrochain-1", "usaf", { ticker: "SAF", provenance: "native", originChainId: "safrochain-1", originDenom: "usaf" }),
  safTest: identity("safro-testnet-1", "usaf", { ticker: "SAF", provenance: "native", originChainId: "safro-testnet-1", originDenom: "usaf", testnet: true }),
  unlisted: identity("osmosis-1", UNLISTED, { ticker: "IBC·0123", name: "Unknown token", provenance: "unknown", proven: false, decimals: null }),
};

const HELD: HeldToken[] = [
  { chainId: "safrochain-1", denom: "usaf", amount: "5000000", identity: id.saf },
  { chainId: "cosmoshub-4", denom: "uatom", amount: "1200000", identity: id.atomHub },
  { chainId: "osmosis-1", denom: "uosmo", amount: "25000000", identity: id.osmo },
  { chainId: "osmosis-1", denom: USDC_N, amount: "1234567", identity: id.nOsmo },
  { chainId: "osmosis-1", denom: UNLISTED, amount: "42", identity: id.unlisted },
  { chainId: "osmosis-1", denom: "uosmo", amount: "25000000", identity: id.osmo },
  { chainId: "cosmoshub-4", denom: "uzero", amount: "0", identity: id.atomHub },
  { chainId: "safro-testnet-1", denom: "usaf", amount: "7", identity: id.safTest },
];

function asset(kind: "venue" | "home", ident: TokenIdentity, osmosisDenom: string, listedDecimals = 6): SwapAsset {
  return {
    key: `${ident.chainId}:${ident.denom}`,
    chainId: ident.chainId,
    denom: ident.denom,
    identity: ident,
    osmosisDenom,
    decimals: ident.decimals === listedDecimals ? ident.decimals : null,
    listedDecimals,
    kind,
    liquidity: 1_000_000,
    price: kind === "venue" && osmosisDenom === "uosmo" ? 0.0354 : 1,
    tradable: true,
  };
}

const SWAP_ASSETS: SwapAsset[] = [
  asset("venue", id.osmo, "uosmo"),
  asset("venue", id.atomOsmo, ATOM),
  asset("venue", id.nOsmo, USDC_N),
  asset("home", id.nHome, USDC_N),
  asset("venue", id.injOsmo, USDC_INJ),
  asset("home", id.injHome, USDC_INJ),
  asset("venue", id.axlOsmo, USDC_AXL),
  asset("home", id.axlHome, USDC_AXL),
];

const live = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/xcs-route-table.json"), "utf8")) as {
  xcsContract: string;
  swapContract: string;
  pages: { body: { models: unknown[] } }[];
};
const routes = parseRouterState(live.pages.flatMap((page) => page.body.models));
const ROUTE_TABLE: XcsRouteTable = {
  xcsContract: live.xcsContract,
  swapContract: live.swapContract,
  routes,
  readAt: 0,
  origins: Object.fromEntries(
    tableDenoms({ routes }).map((denom) => [
      denom,
      denom === "uosmo"
        ? { originChainId: "osmosis-1", originDenom: "uosmo" }
        : denom === ATOM
          ? { originChainId: "cosmoshub-4", originDenom: "uatom" }
          : denom === USDC_AXL
            ? { originChainId: "axelar-dojo-1", originDenom: "uusdc" }
            : { originChainId: `origin-${denom.slice(-6)}`, originDenom: denom },
    ]),
  ),
};

const sell = sellOptions(HELD, SWAP_ASSETS, CHAINS);
const held = (key: string) => {
  const found = sell.find((row) => row.key === key);
  assert.ok(found, `${key} is not held`);
  return found;
};
const buy = (fromKey: string | null, overrides: { swapAssets?: SwapAsset[]; routeTable?: XcsRouteTable | null } = {}) =>
  buyOptions(HELD, {
    from: fromKey ? held(fromKey) : null,
    swapAssets: overrides.swapAssets ?? SWAP_ASSETS,
    routeTable: overrides.routeTable === undefined ? ROUTE_TABLE : overrides.routeTable,
    chains: CHAINS,
  });
const row = (rows: ReturnType<typeof buy>, key: string) => {
  const found = rows.find((candidate) => candidate.key === key);
  assert.ok(found, `${key} is not offered`);
  return found;
};

describe("sellOptions", () => {
  test("lists every non-zero balance once, on the chain that holds it", () => {
    assert.deepEqual(
      sell.map((option) => option.key),
      ["safrochain-1:usaf", "cosmoshub-4:uatom", "osmosis-1:uosmo", `osmosis-1:${USDC_N}`, `osmosis-1:${UNLISTED}`, "safro-testnet-1:usaf"],
    );
    for (const option of sell) {
      assert.equal(option.held, true);
      assert.equal(option.executable, "unknown");
      assert.equal(option.disabledReason, null);
    }
    assert.equal(held("safro-testnet-1:usaf").testnet, true);
    assert.equal(held(`osmosis-1:${USDC_N}`).price, 1);
    assert.equal(held("osmosis-1:uosmo").osmosisDenom, "uosmo");
    assert.equal(held("cosmoshub-4:uatom").osmosisDenom, ATOM);
  });

  test("keeps a token nothing names in base units, so only Max can spend it", () => {
    const unknown = held(`osmosis-1:${UNLISTED}`);
    assert.equal(unknown.decimals, null);
    assert.equal(unknown.verified, false);
    assert.equal(unknown.iconUrl, undefined);
    assert.equal(amountUnitsOf(unknown, "42"), BigInt(42));
    assert.equal(amountUnitsOf(unknown, "0.5"), null);
  });

  test("takes the balance reader's exponent only for a token whose identity is unknown, and never over SQS", () => {
    const reported = sellOptions([{ ...HELD[4]!, reportedDecimals: 6 }], SWAP_ASSETS, CHAINS);
    assert.equal(reported[0]?.decimals, 6);
    assert.equal(reported[0]?.identity.decimals, 6);
    const ignored = sellOptions([{ ...HELD[3]!, reportedDecimals: 18 }], SWAP_ASSETS, CHAINS);
    assert.equal(ignored[0]?.decimals, 6);
    for (const bad of [99, -1, 1.5]) {
      assert.equal(sellOptions([{ ...HELD[4]!, reportedDecimals: bad }], SWAP_ASSETS, CHAINS)[0]?.decimals, null);
    }
  });

  test("makes the exponent unknown wherever SQS disagrees with it, row and identity alike", () => {
    const disagreeing = SWAP_ASSETS.map((entry) => (entry.osmosisDenom === USDC_N ? { ...entry, listedDecimals: 18 } : entry));
    const rows = sellOptions(HELD, disagreeing, CHAINS);
    const usdc = rows.find((option) => option.key === `osmosis-1:${USDC_N}`)!;
    assert.equal(usdc.decimals, null);
    assert.equal(usdc.identity.decimals, null);
    assert.equal(usdc.ticker, "USDC.n");
    assert.equal(rows.find((option) => option.key === "osmosis-1:uosmo")?.decimals, 6);
    assert.equal(exponentOf({ decimals: 6, provenance: "table" }, USDC_N, undefined, new Map([[USDC_N, 6]])), 6);
    assert.equal(exponentOf({ decimals: 6, provenance: "table" }, USDC_N, undefined, new Map([[USDC_N, 18]])), null);
    assert.equal(exponentOf({ decimals: null, provenance: "table" }, null, 6, new Map()), null);
  });

  test("uses a token logo, and a chain logo only for that chain's own coin", () => {
    assert.equal(held(`osmosis-1:${USDC_N}`).iconUrl, "https://logo/usdc.png");
    assert.equal(held("cosmoshub-4:uatom").iconUrl, "https://logo/cosmoshub-4.png");
  });
});

describe("buyOptions", () => {
  test("merges held rows, chain coins, Osmosis rows and deliveries home, one row per key", () => {
    const rows = buy("cosmoshub-4:uatom");
    const keys = rows.map((option) => option.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of ["cosmoshub-4:uatom", "noble-1:uusdc", `injective-1:${USDC_INJ_ERC20}`, `osmosis-1:${USDC_INJ}`, "axelar-dojo-1:uusdc", "injective-1:inj"]) {
      assert.ok(keys.includes(key), key);
    }
    // A held row keeps its balance when another source offers the same key.
    assert.equal(row(rows, `osmosis-1:${USDC_N}`).amount, "1234567");
    assert.equal(row(rows, `osmosis-1:${USDC_N}`).held, true);
    // A chain coin with a home row takes its identity (and so its Osmosis name).
    assert.equal(row(rows, "noble-1:uusdc").osmosisDenom, USDC_N);
    assert.equal(row(rows, "noble-1:uusdc").ticker, "USDC.n");
  });

  test("never offers a token nothing names unless the wallet holds it, and only the From's network", () => {
    const rows = buy("osmosis-1:uosmo");
    for (const option of rows) if (!option.held) assert.notEqual(option.identity.provenance, "unknown");
    assert.ok(rows.some((option) => option.key === `osmosis-1:${UNLISTED}`));
    assert.ok(rows.every((option) => !option.testnet));
    const testnet = buy("safro-testnet-1:usaf");
    assert.ok(testnet.length >= 1);
    assert.ok(testnet.every((option) => option.testnet && option.disabledReason === TESTNET_REASON && option.searchOnly));
  });

  test("with From OSMO on Osmosis: what Osmosis trades can be picked; the table only says which the contract reaches", () => {
    const rows = buy("osmosis-1:uosmo");
    for (const key of [`injective-1:${USDC_INJ_ERC20}`, `osmosis-1:${USDC_INJ}`, "noble-1:uusdc", `osmosis-1:${USDC_N}`]) {
      const option = row(rows, key);
      assert.equal(option.executable, "no", key);
      assert.equal(option.disabledReason, null, key);
    }
    for (const key of ["axelar-dojo-1:uusdc", `osmosis-1:${USDC_AXL}`]) {
      assert.equal(row(rows, key).executable, "yes", key);
      assert.equal(row(rows, key).disabledReason, null, key);
    }
    assert.equal(row(rows, "osmosis-1:uosmo").disabledReason, SELF_REASON);
    assert.equal(row(rows, "safrochain-1:usaf").disabledReason, notTradedReason("SAF"));
    assert.equal(row(rows, "safrochain-1:usaf").searchOnly, true);
  });

  test("refuses the same asset elsewhere, and orders held, reachable, the rest, then the disabled", () => {
    const rows = buy("cosmoshub-4:uatom");
    assert.equal(row(rows, `osmosis-1:${ATOM}`).disabledReason, SAME_TOKEN_REASON);
    const group = (option: (typeof rows)[number]) =>
      option.disabledReason !== null ? 3 : option.held ? 0 : option.executable === "yes" ? 1 : 2;
    const groups = rows.map(group);
    assert.deepEqual(groups, [...groups].sort((a, b) => a - b));
    assert.equal(rows[0]?.held, true);
  });

  test("gates no route when the table is unreadable, and nothing without a From", () => {
    const rows = buy("cosmoshub-4:uatom", { routeTable: null });
    assert.ok(rows.every((option) => option.executable === "unknown"));
    assert.deepEqual(
      rows.filter((option) => option.disabledReason !== null).map((option) => [option.key, option.disabledReason]),
      [
        ["cosmoshub-4:uatom", SELF_REASON],
        [`osmosis-1:${ATOM}`, SAME_TOKEN_REASON],
      ],
    );
    const none = buy(null, { swapAssets: [] });
    assert.ok(none.every((option) => option.disabledReason === null && !option.searchOnly));
    assert.ok(!none.some((option) => option.key === `injective-1:${USDC_INJ_ERC20}`));
  });

  test("picks the user's To while it exists, else the first usable row", () => {
    const rows = buy("osmosis-1:uosmo");
    assert.equal(pickTo(rows, "safrochain-1:usaf")?.key, "safrochain-1:usaf");
    assert.equal(pickTo(rows, null)?.disabledReason, null);
    assert.equal(pickTo(rows, "nope:x")?.disabledReason, null);
  });
});

describe("helpers", () => {
  test("a chain coin named from the catalog, or from its home row", () => {
    const hub = CHAINS[1]!;
    const plain = chainCoinIdentity(hub);
    assert.equal(plain.ticker, "ATOM");
    assert.equal(plain.osmosisDenom, undefined);
    assert.equal(chainCoinIdentity(hub, asset("home", id.atomHub, ATOM)).osmosisDenom, ATOM);
    assert.equal(chainCoinIdentity(CHAINS[2]!).osmosisDenom, "uosmo");
  });

  test("amounts convert with the row's exponent, never past it", () => {
    assert.equal(amountUnitsOf({ decimals: 6 }, "1.5"), BigInt(1_500_000));
    assert.equal(amountUnitsOf({ decimals: 6 }, "1.0000001"), null);
    assert.equal(amountUnitsOf({ decimals: 6 }, ""), null);
    assert.equal(amountUnitsOf(undefined, "1"), null);
  });

  test("hints both Osmosis names except a side already on Osmosis", () => {
    assert.deepEqual(expectedVenueDenoms(held("cosmoshub-4:uatom"), held("osmosis-1:uosmo")), { fromVenueDenom: ATOM });
    assert.deepEqual(expectedVenueDenoms(held("osmosis-1:uosmo"), { chainId: "injective-1", denom: USDC_INJ_ERC20, identity: id.injHome }), {
      toVenueDenom: USDC_INJ,
    });
    assert.deepEqual(expectedVenueDenoms(held("safrochain-1:usaf"), held("osmosis-1:uosmo")), {});
  });
});

describe("the sell side from the portfolio", () => {
  const identity = (chainId: string, denom: string, ticker: string): TokenIdentity => ({
    key: `${chainId}:${denom}`,
    chainId,
    denom,
    kind: "native",
    ticker,
    name: ticker,
    decimals: 6,
    provenance: "native",
    proven: true,
  });

  test("offers each asset's liquid balance only: staked, unbonding and rewards cannot be sold", () => {
    const held = heldFromPortfolio([
      { chainId: "osmosis-1", identity: identity("osmosis-1", "uosmo", "OSMO"), amounts: { liquid: "12500000", staked: "900000000", rewards: "1", unbonding: "0" } },
      { chainId: "cosmoshub-4", identity: identity("cosmoshub-4", "uatom", "ATOM"), amounts: { liquid: "0", staked: "5000000", rewards: "10", unbonding: "0" } },
      { chainId: "juno-1", identity: identity("juno-1", "ujuno", "JUNO"), amounts: { liquid: "not a number", staked: "0", rewards: "0", unbonding: "0" } },
    ]);
    assert.deepEqual(
      held.map((token) => [token.chainId, token.denom, token.amount]),
      [["osmosis-1", "uosmo", "12500000"]],
    );
    assert.equal(sellOptions(held)[0]?.amount, "12500000");
  });
});
