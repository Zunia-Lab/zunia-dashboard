/**
 * Operator configuration is parsed, not trusted.
 *
 * A mangled entry in `ZUNIA_ICS721_BRIDGES` becomes a contract an NFT is handed
 * to, and a mangled entry in `ZUNIA_NFT_CONTRACTS` becomes a contract this
 * build queries on the user's behalf. Both are dropped with a reason rather
 * than half-read, and these tests pin that.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseAddressByChain,
  parseContractsByChain,
  parseFlag,
  parseGateways,
  parseIcs721Links,
  parseList,
} from "../parse-config";

const JUNO_A = "juno1fkj2rsdt2swpm4gz85cpqjcpqmtfqf9lqsqvzq";
const JUNO_B = "juno1qgzcqwlxjq5dppqgqjqcqvqmqvqsqgqcqxqjqq";
/** Safrochain's prefix carries an underscore; a `[a-z]+1` test rejects it. */
const SAFRO = "addr_safro1qgzcqwlxjq5dppqgqjqcqvqmqvqsqgqcqxqjqq";

test("parseList trims, drops empties and keeps order without duplicates", () => {
  assert.deepEqual(parseList(" a , b ,, a , c "), ["a", "b", "c"]);
  assert.deepEqual(parseList(undefined), []);
  assert.deepEqual(parseList(""), []);
});

test("known contracts are grouped by chain and bad addresses are reported", () => {
  const parsed = parseContractsByChain(
    `juno-1=${JUNO_A},${JUNO_B},not-an-address; safrochain-1=${SAFRO}`,
    "ZUNIA_NFT_CONTRACTS",
  );
  assert.deepEqual(parsed.byChainId["juno-1"], [JUNO_A, JUNO_B]);
  assert.deepEqual(parsed.byChainId["safrochain-1"], [SAFRO]);
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0]!.reason, /bech32/);
  assert.match(parsed.problems[0]!.entry, /not-an-address/);
});

test("a group with no chain id is a problem, not a chain-less address list", () => {
  const parsed = parseContractsByChain(JUNO_A, "ZUNIA_NFT_CONTRACTS");
  assert.deepEqual(parsed.byChainId, {});
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0]!.reason, /chainId=address/);
});

test("two different bridges for one chain drop both rather than pick one", () => {
  const parsed = parseAddressByChain(
    `juno-1=${JUNO_A};juno-1=${JUNO_B}`,
    "ZUNIA_ICS721_BRIDGES",
  );
  assert.equal(parsed.byChainId["juno-1"], undefined);
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0]!.reason, /already has a different bridge/);
});

test("a bridge repeated with the same address is not a conflict", () => {
  const parsed = parseAddressByChain(
    `juno-1=${JUNO_A};juno-1=${JUNO_A}`,
    "ZUNIA_ICS721_BRIDGES",
  );
  assert.equal(parsed.byChainId["juno-1"], JUNO_A);
  assert.deepEqual(parsed.problems, []);
});

test("ICS721 links are directional and require a channel-N", () => {
  const parsed = parseIcs721Links(
    "juno-1>stargaze-1=channel-3; juno-1>osmosis-1=chan-9; broken=channel-1",
    "ZUNIA_ICS721_CHANNELS",
  );
  assert.deepEqual(parsed.links, [
    { sourceChainId: "juno-1", destChainId: "stargaze-1", channelId: "channel-3" },
  ]);
  assert.equal(parsed.problems.length, 2);
  assert.match(parsed.problems[0]!.reason, /channel-7/);
  assert.match(parsed.problems[1]!.reason, /sourceChainId>destChainId/);
});

test("a duplicate chain pair keeps the first link and reports the second", () => {
  const parsed = parseIcs721Links(
    "juno-1>stargaze-1=channel-3;juno-1>stargaze-1=channel-9",
    "ZUNIA_ICS721_CHANNELS",
  );
  assert.equal(parsed.links.length, 1);
  assert.equal(parsed.links[0]!.channelId, "channel-3");
  assert.equal(parsed.problems.length, 1);
});

test("gateways must be https and are normalised to a trailing slash", () => {
  const parsed = parseGateways(
    "https://ipfs.example/ipfs, http://cleartext.example/ipfs/, http://127.0.0.1:8899/ipfs",
    "ZUNIA_NFT_IPFS_GATEWAYS",
  );
  // Loopback is allowed so the media path is testable locally; any other
  // cleartext host is not.
  assert.deepEqual(parsed.gateways, [
    "https://ipfs.example/ipfs/",
    "http://127.0.0.1:8899/ipfs/",
  ]);
  assert.equal(parsed.problems.length, 1);
  assert.match(parsed.problems[0]!.entry, /cleartext\.example/);
  assert.match(parsed.problems[0]!.reason, /https/);
});

test("the unknown-features override is off unless it is explicitly on", () => {
  assert.equal(parseFlag(undefined), false);
  assert.equal(parseFlag(""), false);
  assert.equal(parseFlag("0"), false);
  assert.equal(parseFlag("maybe"), false);
  assert.equal(parseFlag("1"), true);
  assert.equal(parseFlag(" TRUE "), true);
  assert.equal(parseFlag("yes"), true);
});
