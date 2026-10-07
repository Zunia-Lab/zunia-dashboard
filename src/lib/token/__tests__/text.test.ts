/**
 * The token search rank (../text.ts, `tokenSearchRank`), shared by the swap
 * pickers, the Send / Bridge token picker and the Assets table: what a token
 * is outranks where it sits, chains and names match at word starts only, and
 * nothing unproven outranks a proven match.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { tokenSearchRank } from "../text";
import type { TokenIdentity } from "../types";

const ATOM_ON_OSMOSIS = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";

function identity(fields: Partial<TokenIdentity> & Pick<TokenIdentity, "ticker" | "name" | "chainId" | "denom">): TokenIdentity {
  return {
    key: `${fields.chainId}:${fields.denom}`,
    kind: "native",
    decimals: 6,
    provenance: "native",
    proven: true,
    ...fields,
  };
}

const ATOM_HUB = identity({
  ticker: "ATOM",
  name: "Cosmos Hub ATOM",
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  denom: "uatom",
  originChainId: "cosmoshub-4",
  originChainName: "Cosmos Hub",
  originDenom: "uatom",
  family: "ATOM",
});
const ATOM_OSMO = identity({
  ...ATOM_HUB,
  kind: "ibc",
  chainId: "osmosis-1",
  chainName: "Osmosis",
  denom: ATOM_ON_OSMOSIS,
  provenance: "table",
});
const OSMO = identity({ ticker: "OSMO", name: "Osmosis OSMO", chainId: "osmosis-1", chainName: "Osmosis", denom: "uosmo", originChainId: "osmosis-1", originChainName: "Osmosis", originDenom: "uosmo" });
const ST_OSMO = identity({ ticker: "stOSMO", name: "Stride stOSMO", chainId: "cosmoshub-4", chainName: "Cosmos Hub", denom: "ibc/AAAA", originChainId: "stride-1", originChainName: "Stride", originDenom: "stuosmo", kind: "ibc", provenance: "table" });
const STARS = identity({ ticker: "STARS", name: "Stargaze STARS", chainId: "osmosis-1", chainName: "Osmosis", denom: "ibc/BBBB", originChainId: "stargaze-1", originChainName: "Stargaze", originDenom: "ustars", kind: "ibc", provenance: "table" });
const ST_STARS = identity({ ticker: "stSTARS", name: "Stride stSTARS", chainId: "osmosis-1", chainName: "Osmosis", denom: "ibc/CCCC", originChainId: "stride-1", originChainName: "Stride", originDenom: "stustars", kind: "ibc", provenance: "table" });
const ALL_BTC = identity({ ticker: "allBTC", name: "Alloyed BTC", chainId: "osmosis-1", chainName: "Osmosis", denom: "factory/osmo1z6r6qdknhgsc0zeracktgpcxf43j6sekq07nw8sxduc9lg0qjjlqfu25e3/alloyed/allBTC", family: "BTC", alloyed: true, kind: "factory", provenance: "table" });
const BTC_RT = identity({ ticker: "BTC.rt", name: "Unlisted Osmosis token", chainId: "osmosis-1", chainName: "Osmosis", denom: "factory/osmo1myv2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/BTC.rt", kind: "factory", listed: false });
const USDC_N = identity({ ticker: "USDC.n", name: "Noble USDC", chainId: "osmosis-1", chainName: "Osmosis", denom: "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4", family: "USDC", aliases: ["USDC.noble"], originChainId: "noble-1", originChainName: "Noble", originDenom: "uusdc", kind: "ibc", provenance: "table" });
const UNKNOWN = identity({ ticker: "IBC·27BC", name: "Unknown token", chainId: "osmosis-1", chainName: "Osmosis", denom: "ibc/27BC0B4F6C1D2E3F", kind: "ibc", provenance: "unknown", proven: false });
const ETH_AXL = identity({ ticker: "ETH.axl", name: "Axelar ETH", chainId: "osmosis-1", chainName: "Osmosis", denom: "ibc/EA1D43981D5C9A1C4AAEA9C23BB1D4FA126BA9BC7020A25E0AE4AA841EA25DC5", family: "ETH", aliases: ["WETH", "axlETH", "axlWETH"], originChainId: "axelar-dojo-1", originChainName: "Axelar", originDenom: "weth-wei", kind: "ibc", provenance: "table" });
const ALL_ETH = identity({ ticker: "allETH", name: "Alloyed ETH", chainId: "osmosis-1", chainName: "Osmosis", denom: "factory/osmo1k6c8jln7ejuqwtqmay3yvzrg3kueaczl96pk067ldg8u835w0yhsw27twm/alloyed/allETH", family: "ETH", alloyed: true, kind: "factory", provenance: "table" });
const WST_ETH = identity({ ticker: "wstETH", name: "Neutron wstETH", chainId: "osmosis-1", chainName: "Osmosis", denom: "ibc/2F21E6D4271DE3F561F20A02CD541DAF7405B1E9CB3B9B07E3C2AC7D8A4338A5", family: "wstETH", originChainId: "neutron-1", originChainName: "Neutron", kind: "ibc", provenance: "table" });
// A route spelled in an alias: USDC from Ethereum over Axelar.
const USDC_AXL = identity({ ticker: "USDC.axl", name: "Axelar USDC", chainId: "cosmoshub-4", chainName: "Cosmos Hub", denom: "ibc/FA33D22EED651DC2D251315AAE2E7C5BA924D308081EE9760AE653AA2F6661CB", family: "USDC", aliases: ["USDC.eth.axl", "axlUSDC"], originChainId: "axelar-dojo-1", originChainName: "Axelar", originDenom: "uusdc", kind: "ibc", provenance: "channel-walk" });

describe("token search rank", () => {
  test("osmo finds OSMO first, never a token for its chain's name", () => {
    assert.equal(tokenSearchRank(OSMO, "osmo"), 0);
    assert.equal(tokenSearchRank(ATOM_HUB, "osmo"), null);
    assert.equal(tokenSearchRank(ATOM_HUB, "osmo", "Cosmos Hub"), null);
    // Inside a ticker still matches, after the exact one.
    assert.equal(tokenSearchRank(ST_OSMO, "osmo"), 3);
    // Held on Osmosis: the chain's name starts with it.
    assert.equal(tokenSearchRank(ATOM_OSMO, "osmo", "Osmosis"), 6);
  });

  test("eth: every ETH before a USDC whose alias spells the route through Ethereum", () => {
    const ranks = [ETH_AXL, ALL_ETH, WST_ETH, USDC_AXL].map((token) => tokenSearchRank(token, "eth"));
    assert.deepEqual(ranks, [1, 2, 3, 4]);
    // The alias still finds it, exactly: "axlusdc" is USDC.axl.
    assert.equal(tokenSearchRank(USDC_AXL, "axlusdc"), 2);
  });

  test("the exact ticker before one that contains it", () => {
    const stars = tokenSearchRank(STARS, "stars");
    const stStars = tokenSearchRank(ST_STARS, "stars");
    assert.ok(stars !== null && stStars !== null && stars < stStars);
    assert.equal(tokenSearchRank(ST_STARS, "st"), 1);
  });

  test("btc: allBTC by its family, ahead of an unlisted factory BTC", () => {
    const all = tokenSearchRank(ALL_BTC, "btc");
    const impostor = tokenSearchRank(BTC_RT, "btc");
    assert.equal(all, 2);
    assert.ok(impostor !== null && all !== null && all < impostor);
  });

  test("names and chains match at word starts", () => {
    assert.equal(tokenSearchRank(USDC_N, "noble usdc"), 5);
    // Inside its alias "USDC.noble" before its name.
    assert.equal(tokenSearchRank(USDC_N, "noble"), 4);
    assert.equal(tokenSearchRank(ATOM_HUB, "hub"), 5);
    assert.equal(tokenSearchRank(ATOM_HUB, "cosmoshub"), 6);
    assert.equal(tokenSearchRank(ATOM_HUB, "smos"), null);
  });

  test("aliases and denoms", () => {
    assert.equal(tokenSearchRank(USDC_N, "usdc.noble"), 2);
    assert.equal(tokenSearchRank(ATOM_OSMO, "27394fb0"), 7);
    // An unknown voucher by its hash: found, after every proven match.
    const unknown = tokenSearchRank(UNKNOWN, "27bc");
    assert.ok(unknown !== null && unknown >= 10);
  });

  test("an empty query matches nothing", () => {
    assert.equal(tokenSearchRank(OSMO, ""), null);
  });
});
