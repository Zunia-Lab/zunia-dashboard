/**
 * The crosschain-swaps route table (src/lib/swap/xcs.ts): parsing the
 * swaprouter's raw state, reading it page by page, the table's answers and the
 * To-row verdicts. Ported from zunia-extension lib/__tests__/xcs-routes.test.ts
 * @ 1453e7a, against the same live read of osmosis-1 on 2026-10-05
 * (fixtures/xcs-route-table.json, copied verbatim). Identities are written out
 * here rather than read from the token tables, so the gating rules are tested
 * on their own; the server fills `origins` from token identity in production.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { InterchainError, type LcdClient, type LcdRequestOptions } from "@zunialab/interchain";

import {
  executable,
  executableBetween,
  gateOption,
  gateOptions,
  notTradedReason,
  osmosisDenomFor,
  parseRouterState,
  readRoutingTable,
  SAME_TOKEN_REASON,
  SELF_REASON,
  tableDenoms,
  tableFromWire,
  tableRoute,
  TESTNET_REASON,
  XCS_MAX_PAGES,
  type GateSide,
  type XcsDenomOrigin,
  type XcsRouteTable,
} from "../xcs";

interface LiveFixture {
  xcsContract: string;
  swapContract: string;
  config: unknown;
  pages: { key: string | null; body: { models: unknown[]; pagination?: unknown } }[];
}

const live = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/xcs-route-table.json"), "utf8")) as LiveFixture;

const XCS = live.xcsContract;
const ROUTER = live.swapContract;
const CONFIG_PATH = `/cosmwasm/wasm/v1/contract/${XCS}/raw/Y29uZmln`;
const STATE_PATH = `/cosmwasm/wasm/v1/contract/${ROUTER}/state`;
const MODELS: unknown[] = live.pages.flatMap((page) => page.body.models);

const USDC_AXL = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const USDC_INJ = "ibc/794C7D7F3B857713878A3A1927251FA6AC1EEE520424C1F6FAFE9BA26D476138";
const USDC_N = "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4";
const ATOM = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";
const STATOM = "ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901";
const USDC_INJ_ERC20 = "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a";
const UNLISTED = "ibc/0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

const routes = parseRouterState(MODELS);

/** Every table denom proven, as the server's identity pass names them (uosmo, ATOM and USDC.axl by their real origin). */
function provenOrigins(): Record<string, XcsDenomOrigin> {
  const named: Record<string, XcsDenomOrigin> = {
    uosmo: { originChainId: "osmosis-1", originDenom: "uosmo" },
    [ATOM]: { originChainId: "cosmoshub-4", originDenom: "uatom" },
    [USDC_AXL]: { originChainId: "axelar-dojo-1", originDenom: "uusdc" },
  };
  const out: Record<string, XcsDenomOrigin> = {};
  for (const denom of tableDenoms({ routes })) {
    out[denom] = named[denom] ?? { originChainId: `origin-of-${denom.slice(-6)}`, originDenom: denom };
  }
  return out;
}

const table: XcsRouteTable = { xcsContract: XCS, swapContract: ROUTER, routes, readAt: 0, origins: provenOrigins() };

type Identity = GateSide["identity"];

function side(chainId: string, denom: string, identity: Partial<Identity> & { ticker: string }, testnet = false): GateSide {
  return {
    key: `${chainId}:${denom}`,
    chainId,
    denom,
    identity: { provenance: "native", ...identity },
    testnet,
  };
}

const osmo = side("osmosis-1", "uosmo", { ticker: "OSMO", originChainId: "osmosis-1", originDenom: "uosmo", osmosisDenom: "uosmo" });
const atomHub = side("cosmoshub-4", "uatom", { ticker: "ATOM", originChainId: "cosmoshub-4", originDenom: "uatom", osmosisDenom: ATOM });
const atomOnOsmosis = side("osmosis-1", ATOM, { ticker: "ATOM", provenance: "table", originChainId: "cosmoshub-4", originDenom: "uatom", osmosisDenom: ATOM });
const axlHome = side("axelar-dojo-1", "uusdc", { ticker: "USDC.axl", originChainId: "axelar-dojo-1", originDenom: "uusdc", osmosisDenom: USDC_AXL });
const axlOnOsmosis = side("osmosis-1", USDC_AXL, { ticker: "USDC.axl", provenance: "table", originChainId: "axelar-dojo-1", originDenom: "uusdc", osmosisDenom: USDC_AXL });
const injHome = side("injective-1", USDC_INJ_ERC20, { ticker: "USDC.inj", provenance: "catalog", originChainId: "injective-1", originDenom: USDC_INJ_ERC20, osmosisDenom: USDC_INJ });
const injOnOsmosis = side("osmosis-1", USDC_INJ, { ticker: "USDC.inj", provenance: "table", originChainId: "injective-1", originDenom: USDC_INJ_ERC20, osmosisDenom: USDC_INJ });
const nobleHome = side("noble-1", "uusdc", { ticker: "USDC.n", originChainId: "noble-1", originDenom: "uusdc", osmosisDenom: USDC_N });
const nOnOsmosis = side("osmosis-1", USDC_N, { ticker: "USDC.n", provenance: "table", originChainId: "noble-1", originDenom: "uusdc", osmosisDenom: USDC_N });
const saf = side("safrochain-1", "usaf", { ticker: "SAF", originChainId: "safrochain-1", originDenom: "usaf" });
const unlistedInj = side("injective-1", UNLISTED, { ticker: "IBC·0123", provenance: "unknown" });
const unlistedOsmo = side("osmosis-1", UNLISTED, { ticker: "IBC·0123", provenance: "unknown" });

/** The Osmosis LCD as it answered on 2026-10-05, serving each state page by its key. */
function liveLcd(): LcdClient & { requests: string[] } {
  const requests: string[] = [];
  return {
    chainId: "osmosis-1",
    requests,
    async getJson(path: string, options?: LcdRequestOptions) {
      if (options?.signal?.aborted) throw new InterchainError("aborted", "cancelled");
      const key = options?.query?.["pagination.key"];
      requests.push(key ? `${path}?key=${String(key)}` : path);
      if (path === CONFIG_PATH) return live.config;
      if (path === STATE_PATH) {
        const page = live.pages.find((candidate) => candidate.key === (key ?? null));
        if (page) return page.body;
      }
      throw new InterchainError("lcd-unreachable", `no answer for ${path}`);
    },
  };
}

/** A `routing_table` key as cw-storage-plus writes it, in the LCD's hex. */
function routeKey(input: string, output: string, namespace = "routing_table"): string {
  const bytes = (text: string) => [...Buffer.from(text, "utf8")];
  const length = (text: string) => [Buffer.byteLength(text) >> 8, Buffer.byteLength(text) & 0xff];
  return Buffer.from([...length(namespace), ...bytes(namespace), ...length(input), ...bytes(input), ...bytes(output)])
    .toString("hex")
    .toUpperCase();
}

function routeValue(hops: readonly { pool_id: string | number; token_out_denom: string }[]): string {
  return Buffer.from(JSON.stringify(hops)).toString("base64");
}

describe("parseRouterState", () => {
  test("reads the 39 routing_table entries out of the router's 41 models", () => {
    assert.equal(MODELS.length, 41);
    assert.equal(routes.length, 39);
    assert.ok(routes.some((r) => r.input === "uosmo" && r.output === USDC_AXL && r.poolIds.join() === "678"));
    assert.ok(routes.some((r) => r.input === ATOM && r.output === STATOM && r.poolIds.join() === "803"));
    assert.equal(tableDenoms({ routes }).length, 20);
    // The only USDC the contract trades is Axelar's, against OSMO.
    assert.equal(routes.filter((r) => r.input === USDC_AXL || r.output === USDC_AXL).length, 2);
    const denoms = new Set(tableDenoms({ routes }));
    for (const denom of [USDC_INJ, USDC_N]) assert.equal(denoms.has(denom), false);
  });

  test("skips items, other maps, bad keys and values that are not a route to the output", () => {
    const item = Buffer.from("contract_info").toString("hex");
    const models = [
      { key: item, value: Buffer.from('{"contract":"crates.io:swaprouter"}').toString("base64") },
      { key: routeKey("uosmo", ATOM, "routing_tablx"), value: routeValue([{ pool_id: "1", token_out_denom: ATOM }]) },
      { key: `${routeKey("uosmo", ATOM)}0`, value: routeValue([{ pool_id: "1", token_out_denom: ATOM }]) },
      { key: routeKey("uosmo", ATOM), value: routeValue([{ pool_id: "1", token_out_denom: USDC_AXL }]) },
      { key: routeKey("uosmo", USDC_AXL), value: "not base64 json" },
      { key: routeKey("uosmo", "ibc/x y"), value: routeValue([{ pool_id: "1", token_out_denom: "ibc/x y" }]) },
      { key: routeKey("uosmo", STATOM), value: routeValue([{ pool_id: "0", token_out_denom: STATOM }]) },
      { key: routeKey("uosmo", "uion"), value: routeValue([{ pool_id: 2, token_out_denom: "uion" }]) },
      { key: routeKey("uosmo", "uion"), value: routeValue([{ pool_id: 3, token_out_denom: "uion" }]) },
      null,
      "routing_table",
    ];
    assert.deepEqual(parseRouterState(models), [{ input: "uosmo", output: "uion", poolIds: ["2"] }]);
  });
});

describe("readRoutingTable", () => {
  test("reads the contract's config, then every page of its router's state", async () => {
    const lcd = liveLcd();
    const read = await readRoutingTable(lcd, XCS, { now: 1_000 });
    assert.equal(read.xcsContract, XCS);
    assert.equal(read.swapContract, ROUTER);
    assert.equal(read.readAt, 1_000);
    assert.deepEqual(read.routes, routes);
    assert.deepEqual(lcd.requests, [
      CONFIG_PATH,
      STATE_PATH,
      `${STATE_PATH}?key=${live.pages[1]?.key}`,
      `${STATE_PATH}?key=${live.pages[2]?.key}`,
    ]);
  });

  test("refuses an address that is not one, a config without a router and a state without routes", async () => {
    await assert.rejects(readRoutingTable(liveLcd(), "not-a-contract"), { code: "invalid-request" });
    const noRouter: LcdClient = {
      chainId: "osmosis-1",
      getJson: async () => ({ data: Buffer.from('{"governor":"osmo1x"}').toString("base64") }),
    };
    await assert.rejects(readRoutingTable(noRouter, XCS), { code: "malformed-response" });
    const itemsOnly: LcdClient = {
      chainId: "osmosis-1",
      getJson: async (path: string) =>
        path === CONFIG_PATH
          ? live.config
          : { models: MODELS.filter((model) => !String((model as { key: string }).key).startsWith("000D")), pagination: {} },
    };
    await assert.rejects(readRoutingTable(itemsOnly, XCS), { code: "malformed-response" });
  });

  test("gives up on a state that never ends instead of trusting part of it", async () => {
    let pages = 0;
    const endless: LcdClient = {
      chainId: "osmosis-1",
      getJson: async (path: string) => {
        if (path === CONFIG_PATH) return live.config;
        pages += 1;
        return { models: live.pages[0]?.body.models ?? [], pagination: { next_key: `page-${pages}` } };
      },
    };
    await assert.rejects(readRoutingTable(endless, XCS), { code: "malformed-response" });
    assert.equal(pages, XCS_MAX_PAGES);
  });

  test("stops at once when a gateway ignores the page key and repeats the first page", async () => {
    const requested: (string | undefined)[] = [];
    const deaf: LcdClient = {
      chainId: "osmosis-1",
      getJson: async (path: string, options?: LcdRequestOptions) => {
        if (path === CONFIG_PATH) return live.config;
        requested.push(options?.query?.["pagination.key"] as string | undefined);
        return live.pages[0]?.body;
      },
    };
    await assert.rejects(readRoutingTable(deaf, XCS), { code: "malformed-response" });
    assert.deepEqual(requested, [undefined, live.pages[1]?.key]);
  });
});

describe("the table as JSON", () => {
  test("round-trips through the wire and refuses a damaged copy", () => {
    const copy = tableFromWire(JSON.parse(JSON.stringify(table)));
    assert.deepEqual(copy, table);
    assert.equal(tableFromWire({ ...table, routes: [{ input: "uosmo", output: "bad denom", poolIds: ["1"] }] }), null);
    assert.equal(tableFromWire({ ...table, routes: [{ input: "uosmo", output: ATOM, poolIds: ["0"] }] }), null);
    assert.equal(tableFromWire({ ...table, xcsContract: "nope" }), null);
    assert.equal(tableFromWire({ ...table, origins: { uosmo: { originChainId: "" } } }), null);
    // A key that is not a denom is not a table: `__proto__` (as JSON.parse
    // makes it, an own key) would otherwise be assigned as a prototype.
    const polluted = JSON.parse(`{"__proto__":{"originChainId":"x","originDenom":"y"}}`) as Record<string, unknown>;
    assert.equal(tableFromWire({ ...table, origins: polluted }), null);
    assert.deepEqual(tableRoute(table, "uosmo", USDC_AXL), ["678"]);
    assert.equal(tableRoute(table, "uosmo", USDC_INJ), null);
  });
});

describe("executable", () => {
  test("answers from the table: OSMO to USDC.axl yes, OSMO to USDC.inj no", () => {
    assert.equal(executable(table, "uosmo", USDC_AXL), "yes");
    assert.equal(executable(table, USDC_AXL, "uosmo"), "yes");
    assert.equal(executable(table, "uosmo", USDC_INJ), "no");
    assert.equal(executable(table, ATOM, USDC_AXL), "no");
    // An ibc hash names the same denom in either case.
    assert.equal(executable(table, "uosmo", `ibc/${USDC_AXL.slice(4).toLowerCase()}`), "yes");
  });

  test("answers unknown without a table or without a name for a side", () => {
    assert.equal(executable(null, "uosmo", USDC_AXL), "unknown");
    assert.equal(executable(undefined, "uosmo", USDC_AXL), "unknown");
    assert.equal(executable(table, null, USDC_AXL), "unknown");
    assert.equal(executable(table, "uosmo", ""), "unknown");
  });

  test("from identities: a coin Osmosis does not list provably has no route; an unnamed one is unknown", () => {
    assert.equal(executableBetween(table, atomHub, axlHome), "no");
    assert.equal(executableBetween(table, osmo, axlHome), "yes");
    assert.equal(executableBetween(table, osmo, saf), "no");
    assert.equal(executableBetween(table, saf, osmo), "no");
    assert.equal(executableBetween(table, osmo, unlistedInj), "unknown");
    // A held Osmosis denom is its own name, identified or not.
    assert.equal(executableBetween(table, osmo, unlistedOsmo), "no");
    // When the table trades a denom nothing names, absence proves nothing.
    const unnamed: XcsRouteTable = {
      ...table,
      routes: [...table.routes, { input: "uosmo", output: UNLISTED, poolIds: ["1"] }],
      origins: { ...table.origins, [UNLISTED]: null },
    };
    assert.equal(executableBetween(unnamed, osmo, saf), "unknown");
    // Without origins at all (the server could not name them), the same.
    assert.equal(executableBetween({ ...table, origins: undefined }, osmo, saf), "unknown");
    assert.equal(executableBetween(null, osmo, axlHome), "unknown");
  });

  test("names a side on Osmosis by its held denom there, else by its canonical voucher", () => {
    assert.equal(osmosisDenomFor(nOnOsmosis), USDC_N);
    assert.equal(osmosisDenomFor(injHome), USDC_INJ);
    assert.equal(osmosisDenomFor(saf), null);
  });
});

describe("gateOption", () => {
  test("with From OSMO on Osmosis: every pair Osmosis trades can be picked, whatever the contract's table says", () => {
    assert.deepEqual(gateOption(osmo, injHome, table), { executable: "no", disabledReason: null });
    assert.deepEqual(gateOption(osmo, injOnOsmosis, table), { executable: "no", disabledReason: null });
    assert.deepEqual(gateOption(osmo, nobleHome, table), { executable: "no", disabledReason: null });
    assert.deepEqual(gateOption(osmo, axlHome, table), { executable: "yes", disabledReason: null });
    assert.deepEqual(gateOption(osmo, axlOnOsmosis, table), { executable: "yes", disabledReason: null });
  });

  test("refuses a side Osmosis does not trade, in either direction", () => {
    assert.deepEqual(gateOption(osmo, saf, table), { executable: "no", disabledReason: notTradedReason("SAF") });
    assert.deepEqual(gateOption(saf, osmo, table), { executable: "no", disabledReason: notTradedReason("SAF") });
    // Funds elsewhere that Osmosis does trade move there first: not refused.
    assert.deepEqual(gateOption(atomHub, injHome, table), { executable: "no", disabledReason: null });
  });

  test("refuses the From itself and the same asset anywhere else", () => {
    assert.equal(gateOption(osmo, osmo, table).disabledReason, SELF_REASON);
    assert.equal(gateOption(atomHub, atomOnOsmosis, table).disabledReason, SAME_TOKEN_REASON);
    assert.equal(gateOption(nOnOsmosis, nobleHome, table).disabledReason, SAME_TOKEN_REASON);
  });

  test("refuses testnet sides: the only venue is Osmosis mainnet", () => {
    const testnet = side("safro-testnet-1", "usaf", { ticker: "SAF" }, true);
    const osmoTest = side("osmo-test-5", "uosmo", { ticker: "OSMO" }, true);
    assert.equal(gateOption(testnet, osmoTest, table).disabledReason, TESTNET_REASON);
    assert.equal(gateOption(testnet, osmoTest, null).disabledReason, TESTNET_REASON);
  });

  test("gates no route when the table is unreadable, and nothing at all without a From", () => {
    assert.deepEqual(gateOption(osmo, injHome, null), { executable: "unknown", disabledReason: null });
    assert.equal(gateOption(osmo, injOnOsmosis, null).disabledReason, null);
    assert.deepEqual(gateOption(null, injHome, table), { executable: "unknown", disabledReason: null });
  });

  test("gateOptions keeps every row, in order, with its verdict", () => {
    const gated = gateOptions(osmo, [axlHome, injHome], table);
    assert.deepEqual(
      gated.map((row) => [row.key, row.executable]),
      [
        ["axelar-dojo-1:uusdc", "yes"],
        [`injective-1:${USDC_INJ_ERC20}`, "no"],
      ],
    );
    assert.equal(gated[1]?.identity, injHome.identity);
  });
});
