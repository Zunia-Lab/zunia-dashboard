/**
 * Consensus-address derivation, which is how uptime is joined to a
 * validator. The ed25519 vectors are real validators whose derived address
 * was confirmed against the chain's own signing-info endpoint on 2026-10-07;
 * secp256k1 is checked against Node's own hash implementations.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { bech32 } from "bech32";

import {
  addressHex,
  bech32Prefix,
  consensusAddressBytes,
  consensusHex,
  consensusPrefixFor,
  operatorAccount,
  reencode,
  valconsAddress,
} from "../valcons";

/** Crypto.org (Cronos POS) "Hostenga.com": operator, key and signing-info address read from the chain on 2026-10-07. */
const CRO_OPERATOR = "crocncl1qz7k6tlc37u02yw95pp2rx2dgw0uraxaxne0v8";
const CRO_KEY = { typeUrl: "/cosmos.crypto.ed25519.PubKey", key: "GBwVwPARM2HauwBFKmk0b36/FWu03j85ssKrwmms9fs=" };
const CRO_SIGNING_ADDRESS = "crocnclcons1angd4k6prqg49g233fdn28v0vuaxs6v9y3jmv8";

test("ed25519: first 20 bytes of SHA-256 of the key (Safrochain YnukaLabs)", () => {
  assert.equal(
    valconsAddress(
      { typeUrl: "/cosmos.crypto.ed25519.PubKey", key: "uEMMh+NBGJIW9cwyr+PycuBqw/cb9CxN3TYPvQYEtLY=" },
      "addr_safro",
    ),
    "addr_safrovalcons1uwnp77lnywt32rrk6ktyq5qajx4frgjlp686hd",
  );
});

test("ed25519: Cosmos Hub Kraken03", () => {
  assert.equal(
    valconsAddress(
      { typeUrl: "/cosmos.crypto.ed25519.PubKey", key: "DQpPo7CJ4sFe6laZa00A26UC5vpzT0ktapdU4qa6E+0=" },
      "cosmos",
    ),
    "cosmosvalcons1y0tswrvh2emaz2g248u59e85e468en4d6kh6ed",
  );
});

test("secp256k1: RIPEMD-160 of SHA-256 of the compressed key", () => {
  const key = Buffer.from(
    "02" + "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    "hex",
  );
  const expected = createHash("ripemd160").update(createHash("sha256").update(key).digest()).digest();
  const bytes = consensusAddressBytes({ typeUrl: "/cosmos.crypto.secp256k1.PubKey", key: key.toString("base64") });
  assert.ok(bytes);
  assert.equal(Buffer.from(bytes).toString("hex"), expected.toString("hex"));
  assert.equal(
    valconsAddress({ typeUrl: "/cosmos.crypto.secp256k1.PubKey", key: key.toString("base64") }, "x"),
    bech32.encode("xvalcons", bech32.toWords(expected)),
  );
});

test("unknown key types and wrong lengths derive nothing", () => {
  assert.equal(valconsAddress(null, "cosmos"), null);
  assert.equal(consensusAddressBytes({ typeUrl: "/cosmos.crypto.bn254.PubKey", key: "AAAA" }), null);
  assert.equal(consensusAddressBytes({ typeUrl: "/cosmos.crypto.ed25519.PubKey", key: "AAAA" }), null);
  assert.equal(consensusAddressBytes({ typeUrl: "/cosmos.crypto.ed25519.PubKey", key: "not base64!" }), null);
});

test("operator account is the valoper bytes on the account prefix", () => {
  assert.equal(
    operatorAccount("cosmosvaloper1qe2s0gguw2khnpfteqy8mhsh5qtmmujfa6fas9", "cosmos"),
    "cosmos1qe2s0gguw2khnpfteqy8mhsh5qtmmujfcwaguk",
  );
  assert.equal(
    operatorAccount("addr_safrovaloper1q4c4p0n66crlkgagr76mjtnmt4d8pdlq8knm5z", "addr_safro"),
    "addr_safro1q4c4p0n66crlkgagr76mjtnmt4d8pdlq3gcr9j",
  );
  assert.equal(operatorAccount("garbage", "cosmos"), null);
  assert.equal(reencode("osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm", "cosmos"), "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f");
  assert.equal(bech32Prefix("addr_safrovaloper1q4c4p0n66crlkgagr76mjtnmt4d8pdlq8knm5z"), "addr_safrovaloper");
  assert.equal(bech32Prefix("nope"), null);
});

test("consensus prefix follows the operator prefix (Crypto.org's crocncl → crocnclcons)", () => {
  assert.equal(consensusPrefixFor("cosmosvaloper1qe2s0gguw2khnpfteqy8mhsh5qtmmujfa6fas9", "cosmos"), "cosmosvalcons");
  assert.equal(
    consensusPrefixFor("addr_safrovaloper1q4c4p0n66crlkgagr76mjtnmt4d8pdlq8knm5z", "addr_safro"),
    "addr_safrovalcons",
  );
  assert.equal(consensusPrefixFor(CRO_OPERATOR, "cro"), "crocnclcons");
  // Not bech32: the SDK default.
  assert.equal(consensusPrefixFor("garbage", "cro"), "crovalcons");
  // The derived address is the one the chain's signing info uses.
  assert.equal(valconsAddress(CRO_KEY, "cro", consensusPrefixFor(CRO_OPERATOR, "cro")), CRO_SIGNING_ADDRESS);
});

test("the join compares bytes, so any consensus prefix matches", () => {
  const fromKey = consensusHex(CRO_KEY);
  assert.ok(fromKey && fromKey.length === 40);
  assert.equal(addressHex(CRO_SIGNING_ADDRESS), fromKey);
  // Same bytes under the default prefix still match.
  assert.equal(addressHex(valconsAddress(CRO_KEY, "cro") ?? ""), fromKey);
  assert.equal(consensusHex(null), null);
  assert.equal(addressHex("not-bech32"), null);
});
