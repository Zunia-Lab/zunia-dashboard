/**
 * Asset keys from requests: what parses, what is refused before anything is
 * looked up, and which record a key names (a proven voucher's location key
 * names the same asset as its origin key).
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { atOrigin, chainsHolding, identityForAssetKey, parseAssetKey } from "../asset-key";
import { identityOf, resetIdentityFacts } from "../engine";
import { assetKeyOf } from "../trim";
import { installTestCatalog } from "./catalog-fixture";

installTestCatalog();

const ATOM_ON_OSMOSIS = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";

describe("parseAssetKey", () => {
  it("splits at the first colon; the denom may contain more", () => {
    assert.deepEqual(parseAssetKey("cosmoshub-4:uatom"), { chainId: "cosmoshub-4", denom: "uatom" });
    assert.deepEqual(parseAssetKey("injective-1:erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a"), {
      chainId: "injective-1",
      denom: "erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
    });
    assert.deepEqual(parseAssetKey(`osmosis-1:${ATOM_ON_OSMOSIS}`)?.denom, ATOM_ON_OSMOSIS);
  });

  it("knows issuers only the token table names, and two-character coins", () => {
    assert.ok(parseAssetKey("stargaze-1:ustars"));
    assert.ok(parseAssetKey("union-1:au"), "Union's coin is two characters long");
  });

  it("refuses unknown chains and anything that cannot be a bank denom", () => {
    for (const key of [
      "foo",
      ":uatom",
      "cosmoshub-4:",
      "nope-1:uatom",
      "cosmoshub-4:../../etc",
      "cosmoshub-4:u atom",
      "cosmoshub-4:a",
      "cosmoshub-4:1atom",
      `cosmoshub-4:u${"x".repeat(200)}`,
    ]) {
      assert.equal(parseAssetKey(key), null, key);
    }
  });
});

describe("identityForAssetKey", () => {
  beforeEach(() => resetIdentityFacts());

  it("names one asset whether the key is the origin or a proven voucher's location", () => {
    const origin = identityForAssetKey("cosmoshub-4:uatom");
    const voucher = identityForAssetKey(`osmosis-1:${ATOM_ON_OSMOSIS}`);
    assert.ok(origin && voucher);
    assert.equal(voucher.heldOnChainId, "cosmoshub-4");
    assert.equal(assetKeyOf(voucher), assetKeyOf(origin));
    assert.equal(assetKeyOf(origin), "cosmoshub-4:uatom");
  });

  it("keeps an unproven voucher where it is, never at the origin it claims", () => {
    const unknown = "ibc/603140E681973C7A3A33B06B1D377AAD0F6AC376119735CECC04C9184A1AB080";
    const held = identityForAssetKey(`osmosis-1:${unknown}`);
    assert.ok(held);
    assert.equal(held.proven, false);
    assert.equal(assetKeyOf(held), `osmosis-1:${unknown}`);
    assert.equal(atOrigin(identityOf("osmosis-1", unknown)), identityOf("osmosis-1", unknown));
  });

  it("lists the chains the table knows an asset on", () => {
    const chains = chainsHolding("cosmoshub-4:uatom");
    assert.ok(chains.includes("cosmoshub-4") && chains.includes("osmosis-1"));
    assert.deepEqual(chainsHolding("nope-1:x"), []);
  });
});
