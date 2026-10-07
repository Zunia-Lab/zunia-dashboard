/**
 * The token pickers' search rank (../token-search.ts): what a token is
 * outranks where it sits, chains and names match at word starts only, and
 * nothing unproven outranks a proven match.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TokenIdentity } from "@/lib/token/types";

import { tokenSearchRank } from "../token-search";

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

describe("token search rank", () => {
  test("osmo finds OSMO first, never a token for its chain's name", () => {
    assert.equal(tokenSearchRank(OSMO, "osmo"), 0);
    assert.equal(tokenSearchRank(ATOM_HUB, "osmo"), null);
    assert.equal(tokenSearchRank(ATOM_HUB, "osmo", "Cosmos Hub"), null);
    // Inside a ticker still matches, after the exact one.
    assert.equal(tokenSearchRank(ST_OSMO, "osmo"), 3);
    // Held on Osmosis: the chain's name starts with it.
    assert.equal(tokenSearchRank(ATOM_OSMO, "osmo", "Osmosis"), 5);
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
    assert.equal(tokenSearchRank(USDC_N, "noble usdc"), 4);
    // Inside its alias "USDC.noble" before its name.
    assert.equal(tokenSearchRank(USDC_N, "noble"), 3);
    assert.equal(tokenSearchRank(ATOM_HUB, "hub"), 4);
    assert.equal(tokenSearchRank(ATOM_HUB, "cosmoshub"), 5);
    assert.equal(tokenSearchRank(ATOM_HUB, "smos"), null);
  });

  test("aliases and denoms", () => {
    assert.equal(tokenSearchRank(USDC_N, "usdc.noble"), 2);
    assert.equal(tokenSearchRank(ATOM_OSMO, "27394fb0"), 6);
    // An unknown voucher by its hash: found, after every proven match.
    const unknown = tokenSearchRank(UNKNOWN, "27bc");
    assert.ok(unknown !== null && unknown >= 10);
  });

  test("an empty query matches nothing", () => {
    assert.equal(tokenSearchRank(OSMO, ""), null);
  });
});
