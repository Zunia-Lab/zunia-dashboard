/**
 * Three statuses, three screens, and none of them inferred from another.
 *
 * These are the assertions that stop the two defects this gate exists for:
 * telling a user their chain cannot hold NFTs when nobody checked, and firing
 * wasm queries at a chain that cannot answer them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChainInfoLike } from "@zunialab/interchain";
import { decideNftSupport } from "../support";

const BASE: ChainInfoLike = {
  chainId: "juno-1",
  chainName: "Juno",
  bech32Prefix: "juno",
  coinType: 118,
  network: "mainnet",
  coinDenom: "JUNO",
  coinMinimalDenom: "ujuno",
  coinDecimals: 6,
  feeDenom: "JUNO",
  feeMinimalDenom: "ujuno",
  feeDecimals: 6,
};

const WITH_WASM: ChainInfoLike = { ...BASE, features: ["cosmwasm", "ibc-transfer"] };
const WITHOUT_WASM: ChainInfoLike = { ...BASE, features: ["ibc-transfer"] };
/** Every row in today's catalog: no `features` key at all. */
const NO_FEATURES: ChainInfoLike = BASE;

test("a registry that declares cosmwasm is the only answer needing no work", () => {
  const support = decideNftSupport({
    chainId: "juno-1",
    chain: WITH_WASM,
    allowUnknownFeatures: false,
    hasEndpoint: true,
    probe: null,
  });
  assert.equal(support.status, "supported");
  assert.equal(support.basis, "registry-declared");
  assert.equal(support.reason, null);
  assert.equal(support.note, null);
  assert.equal(support.featuresDeclared, true);
});

test("a registry that lists features without cosmwasm is a hard no", () => {
  const support = decideNftSupport({
    chainId: "juno-1",
    chain: WITHOUT_WASM,
    // Even with the override on: the registry answered, so nothing is probed.
    allowUnknownFeatures: true,
    hasEndpoint: true,
    probe: { ok: true, detail: "should never be consulted" },
  });
  assert.equal(support.status, "unsupported");
  assert.equal(support.basis, "registry-denied");
  assert.match(support.reason ?? "", /does not declare the "cosmwasm" feature/);
  // The sentence that stops an empty grid reading as an empty wallet.
  assert.match(support.reason ?? "", /not an empty wallet/);
});

test("no features list and no override is unverified, never unsupported", () => {
  const support = decideNftSupport({
    chainId: "juno-1",
    chain: NO_FEATURES,
    allowUnknownFeatures: false,
    hasEndpoint: true,
    probe: null,
  });
  assert.equal(support.status, "unverified");
  assert.equal(support.basis, "catalog-missing");
  assert.equal(support.featuresDeclared, false);
  // Names the generator that drops features[] and the key that overrides it, so
  // the screen is actionable by whoever is reading it.
  assert.match(support.reason ?? "", /generate-chain-catalog\.mjs/);
  assert.match(support.reason ?? "", /ZUNIA_NFT_ALLOW_UNKNOWN_FEATURES=1/);
});

test("a chain outside the catalog is unverified, not unsupported", () => {
  const support = decideNftSupport({
    chainId: "made-up-1",
    chain: undefined,
    allowUnknownFeatures: true,
    hasEndpoint: false,
    probe: null,
  });
  assert.equal(support.status, "unverified");
  assert.equal(support.basis, "catalog-missing");
  assert.match(support.reason ?? "", /not in this build's chain catalog/);
});

test("with the override on, a chain that answers a wasm query is supported and says so", () => {
  const support = decideNftSupport({
    chainId: "juno-1",
    chain: NO_FEATURES,
    allowUnknownFeatures: true,
    hasEndpoint: true,
    probe: { ok: true, detail: "Juno answered a CosmWasm query, so it runs x/wasm." },
  });
  assert.equal(support.status, "supported");
  assert.equal(support.basis, "chain-probe");
  assert.equal(support.reason, null);
  // Support on weaker evidence than the registry is never silent about it.
  assert.match(support.note ?? "", /came from the chain itself/);
  assert.equal(support.featuresDeclared, false);
});

test("a probe that did not answer stays unverified — a refusal is not a 'no'", () => {
  const support = decideNftSupport({
    chainId: "osmosis-1",
    chain: { ...NO_FEATURES, chainId: "osmosis-1", chainName: "Osmosis" },
    allowUnknownFeatures: true,
    hasEndpoint: true,
    probe: {
      ok: false,
      detail: "Osmosis's endpoint answered HTTP 501 for /cosmwasm/wasm/v1/codes.",
    },
  });
  assert.equal(support.status, "unverified");
  assert.equal(support.basis, "probe-failed");
  assert.match(support.reason ?? "", /501/);
});

test("no REST endpoint is its own reason, not a generic failure", () => {
  const support = decideNftSupport({
    chainId: "juno-1",
    chain: NO_FEATURES,
    allowUnknownFeatures: true,
    hasEndpoint: false,
    probe: null,
  });
  assert.equal(support.status, "unverified");
  assert.equal(support.basis, "no-endpoint");
  assert.match(support.reason ?? "", /no REST endpoint/);
});

test("every non-supported status carries a reason and no supported one carries one", () => {
  const cases = [
    { chain: WITH_WASM, allow: false, endpoint: true, probe: null },
    { chain: WITHOUT_WASM, allow: false, endpoint: true, probe: null },
    { chain: NO_FEATURES, allow: false, endpoint: true, probe: null },
    { chain: NO_FEATURES, allow: true, endpoint: false, probe: null },
    {
      chain: NO_FEATURES,
      allow: true,
      endpoint: true,
      probe: { ok: true, detail: "ok" },
    },
    {
      chain: NO_FEATURES,
      allow: true,
      endpoint: true,
      probe: { ok: false, detail: "nope" },
    },
    { chain: undefined, allow: true, endpoint: false, probe: null },
  ] as const;

  for (const row of cases) {
    const support = decideNftSupport({
      chainId: "juno-1",
      chain: row.chain,
      allowUnknownFeatures: row.allow,
      hasEndpoint: row.endpoint,
      probe: row.probe,
    });
    if (support.status === "supported") {
      assert.equal(support.reason, null, `${support.basis} should carry no reason`);
    } else {
      assert.ok(
        (support.reason ?? "").length > 20,
        `${support.basis} must explain itself`,
      );
    }
  }
});
