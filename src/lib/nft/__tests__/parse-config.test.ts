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
  parseIndexerUrl,
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
  const raw =
    "https://ipfs.example/ipfs, http://cleartext.example/ipfs/, http://127.0.0.1:8899/ipfs";
  // Loopback is accepted only when the caller opts in (local development);
  // any other cleartext host never is.
  const dev = parseGateways(raw, "ZUNIA_NFT_IPFS_GATEWAYS", { allowLoopback: true });
  assert.deepEqual(dev.gateways, [
    "https://ipfs.example/ipfs/",
    "http://127.0.0.1:8899/ipfs/",
  ]);
  assert.equal(dev.problems.length, 1);
  assert.match(dev.problems[0]!.entry, /cleartext\.example/);
  assert.match(dev.problems[0]!.reason, /https/);

  // Without the option — which is what a production build passes — the
  // loopback gateway is a problem too.
  const prod = parseGateways(raw, "ZUNIA_NFT_IPFS_GATEWAYS");
  assert.deepEqual(prod.gateways, ["https://ipfs.example/ipfs/"]);
  assert.equal(prod.problems.length, 2);
  assert.match(prod.problems[1]!.reason, /local development/);
});

test("a gateway that is not a URL, or carries credentials, is refused without echoing them", () => {
  const parsed = parseGateways(
    "https://alice:s3cret@gw.example/ipfs, https://, https://127.0.0.1.attacker.example/ipfs",
    "ZUNIA_NFT_IPFS_GATEWAYS",
  );
  // A host that merely starts with 127.0.0.1 is an ordinary https host.
  assert.deepEqual(parsed.gateways, ["https://127.0.0.1.attacker.example/ipfs/"]);
  assert.equal(parsed.problems.length, 2);
  assert.doesNotMatch(JSON.stringify(parsed.problems), /s3cret|alice/);
  assert.match(parsed.problems[0]!.entry, /<redacted>@gw\.example/);
  assert.match(parsed.problems[1]!.reason, /valid URL/);
});

test("a refused entry never echoes a password or a token, even malformed", () => {
  const parsed = parseGateways(
    [
      // A password containing "/" used to defeat the userinfo pattern.
      "https://alice:pa/ss@gw.example/ipfs",
      // Cleartext with a token in the query.
      "http://gw.example/ipfs?token=t0ps3cret",
      // https, but a query cannot be a gateway base: the content id would land in it.
      "https://gw.example/ipfs?pinataGatewayToken=t0ps3cret",
    ].join(","),
    "ZUNIA_NFT_IPFS_GATEWAYS",
  );
  assert.deepEqual(parsed.gateways, []);
  assert.equal(parsed.problems.length, 3);
  assert.doesNotMatch(JSON.stringify(parsed.problems), /alice|pa\/ss|t0ps3cret/);
  assert.match(parsed.problems[1]!.entry, /^http:\/\/gw\.example\/ipfs\?<redacted>$/);
  assert.match(parsed.problems[2]!.reason, /query string/);
});

test("the NFT index URL follows the gateway transport rule, exactly", () => {
  const key = "ZUNIA_NFT_INDEXER_URL";
  assert.deepEqual(parseIndexerUrl(undefined, key), { url: null, problems: [] });
  assert.deepEqual(parseIndexerUrl("  ", key), { url: null, problems: [] });
  // https, trailing slash dropped; a query (an access key) is kept for the server.
  assert.equal(parseIndexerUrl("https://index.example/v1/nfts/", key).url, "https://index.example/v1/nfts");
  assert.equal(parseIndexerUrl("https://index.example/v1?key=abc", key).url, "https://index.example/v1?key=abc");

  // Loopback cleartext only when the caller allows it, and only the exact host:
  // the old prefix test also let `http://127.0.0.1.attacker.example` through.
  assert.equal(parseIndexerUrl("http://127.0.0.1:9000/idx", key).url, null);
  assert.equal(parseIndexerUrl("http://127.0.0.1:9000/idx", key, { allowLoopback: true }).url, "http://127.0.0.1:9000/idx");
  const spoof = parseIndexerUrl("http://127.0.0.1.attacker.example/idx", key, { allowLoopback: true });
  assert.equal(spoof.url, null);
  assert.match(spoof.problems[0]!.reason, /https/);

  const leaky = parseIndexerUrl("http://idx.example/v1?key=s3cret", key);
  assert.equal(leaky.url, null);
  assert.doesNotMatch(leaky.problems[0]!.entry, /s3cret/);
  const withUser = parseIndexerUrl("https://bob:s3cret@idx.example/v1", key);
  assert.equal(withUser.url, null);
  assert.doesNotMatch(JSON.stringify(withUser.problems), /bob|s3cret/);
  assert.match(parseIndexerUrl("not a url", key).problems[0]!.reason, /valid URL/);
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
