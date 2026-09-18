/**
 * The browser does not trust the shape it gets back, even from our own origin.
 *
 * The reader that matters most is `queriedContractCount`: it is the number that
 * separates "you hold none" from "nothing was queried", and it defaults to 0 —
 * the safe direction — when the field is missing, so a stale deploy makes the
 * grid say "nothing was asked" rather than "you own nothing".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readNftCollectionsResponse,
  readNftConfigResponse,
  readNftTokensResponse,
} from "../wire";

test("a failure envelope passes through with the engine's own code", () => {
  const result = readNftConfigResponse({
    ok: false,
    code: "unsupported-chain",
    message: "Cosmos Hub does not declare cosmwasm.",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "unsupported-chain");
});

test("a config with an unknown status is unreadable rather than assumed", () => {
  const result = readNftConfigResponse({
    ok: true,
    config: { chainId: "juno-1", status: "probably", basis: "registry-declared" },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "malformed-response");
});

test("config defaults keep a disabled control disabled", () => {
  const result = readNftConfigResponse({
    ok: true,
    config: {
      chainId: "juno-1",
      chainName: "Juno",
      status: "unverified",
      basis: "catalog-missing",
      reason: "The catalog carries no features list.",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.status, "unverified");
  assert.equal(result.config.featuresDeclared, false);
  assert.equal(result.config.allowUnknownFeatures, false);
  assert.equal(result.config.discovery.indexerConfigured, false);
  assert.equal(result.config.ics721.bridgeContract, null);
  assert.deepEqual(result.config.ics721.destinations, []);
  // Falls back to the real key names so a disabled screen still names them.
  assert.equal(result.config.configKeys.bridges, "ZUNIA_ICS721_BRIDGES");
});

test("an ICS721 destination missing its channel is dropped, not half-rendered", () => {
  const result = readNftConfigResponse({
    ok: true,
    config: {
      chainId: "juno-1",
      status: "supported",
      basis: "registry-declared",
      ics721: {
        bridgeContract: "juno1bridge",
        destinations: [
          { chainId: "stargaze-1", chainName: "Stargaze", channelId: "channel-3" },
          { chainId: "osmosis-1", chainName: "Osmosis" },
        ],
      },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.config.ics721.destinations.length, 1);
  assert.equal(result.config.ics721.destinations[0]!.channelId, "channel-3");
});

test("a missing queriedContractCount reads as nothing queried", () => {
  const result = readNftCollectionsResponse({
    ok: true,
    chainId: "juno-1",
    owner: "juno1owner",
    holdings: [],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.collections.queriedContractCount, 0);
  assert.equal(result.collections.complete, false);
  assert.deepEqual(result.collections.sources, []);
});

test("holdings keep their discovery source and their truncation flag", () => {
  const result = readNftCollectionsResponse({
    ok: true,
    chainId: "juno-1",
    chainName: "Juno",
    owner: "juno1owner",
    queriedContractCount: 3,
    sources: ["user", "known", "nonsense"],
    holdings: [
      {
        contractAddress: "juno1a",
        source: "user",
        tokenIds: ["1", 2, "3"],
        truncated: true,
        collection: { contractAddress: "juno1a", name: "Apes", tokenCount: 7 },
      },
      { source: "known", tokenIds: ["9"] },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // The row with no contract address is dropped; a card cannot be built from it.
  assert.equal(result.collections.holdings.length, 1);
  const holding = result.collections.holdings[0]!;
  assert.equal(holding.source, "user");
  assert.equal(holding.truncated, true);
  // A numeric token id on the wire is not a string; it is dropped rather than
  // coerced, because the id is used verbatim in a signed message.
  assert.deepEqual(holding.tokenIds, ["1", "3"]);
  assert.equal(holding.collection?.name, "Apes");
  assert.deepEqual(result.collections.sources, ["user", "known"]);
});

test("a token read keeps a per-token error instead of losing the token", () => {
  const result = readNftTokensResponse({
    ok: true,
    chainId: "juno-1",
    contractAddress: "juno1a",
    mediaRequested: true,
    tokens: [
      {
        tokenId: "1",
        collectionAddress: "juno1a",
        chainId: "juno-1",
        name: "One",
        imageUrl: "https://cdn.example/1.png",
        traits: [
          { traitType: "Colour", value: "Blue" },
          { traitType: "Broken", value: 7 },
        ],
        metadataSource: "remote",
      },
      {
        tokenId: "2",
        collectionAddress: "juno1a",
        error: "juno-1: contract rejected all_nft_info",
      },
      { collectionAddress: "juno1a" },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.tokens.length, 2);
  assert.equal(result.page.tokens[0]!.metadataSource, "remote");
  // A non-string trait value is dropped rather than stringified into the UI.
  assert.equal(result.page.tokens[0]!.traits.length, 1);
  assert.equal(result.page.tokens[1]!.error, "juno-1: contract rejected all_nft_info");
  assert.equal(result.page.tokens[1]!.imageUrl, null);
  assert.equal(result.page.mediaRequested, true);
});

test("an unrecognised metadata source becomes null, not a claim", () => {
  const result = readNftTokensResponse({
    ok: true,
    chainId: "juno-1",
    contractAddress: "juno1a",
    tokens: [
      { tokenId: "1", collectionAddress: "juno1a", metadataSource: "cached" },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.tokens[0]!.metadataSource, null);
});
