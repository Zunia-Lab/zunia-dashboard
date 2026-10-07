/**
 * The IBC planner's input rules: channel seeds from the chain-registry table,
 * what a seed check must prove, which client states are usable, how a plan's
 * hand-typed channels are read, and which contract a swap recovery may name.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SEED_CHANNEL_ROUTES, type ChannelRoute } from "@zunialab/interchain";

import { IBC_CHANNEL_ROWS } from "@/lib/token/ibc-channels.generated";
import {
  clientUsable,
  createSeedIndex,
  HOST_VERIFIED_CHANNELS,
  MAX_OVERRIDES,
  readOverrides,
  recoveryContractFor,
  seedAccepted,
  tableSeeds,
} from "../interchain-rules";

const everyChain = () => true;
const seeds = createSeedIndex([
  ...SEED_CHANNEL_ROUTES,
  ...tableSeeds(IBC_CHANNEL_ROWS, everyChain),
  ...tableSeeds(HOST_VERIFIED_CHANNELS, everyChain),
]);

function only(from: string, to: string): ChannelRoute {
  const rows = seeds.get(from, to);
  assert.equal(rows.length, 1, `${from} → ${to}: ${JSON.stringify(rows)}`);
  return rows[0]!;
}

test("the registry table seeds the pairs a hub's channel walk never reaches", () => {
  const hubToCelestia = only("cosmoshub-4", "celestia");
  assert.equal(hubToCelestia.channelId, "channel-1879");
  assert.equal(hubToCelestia.counterpartyChannelId, "channel-278");
  assert.equal(hubToCelestia.source, "seed");
  assert.equal(hubToCelestia.verifiedAt, 0, "a seed is never pre-verified");

  const osmoToAkash = only("osmosis-1", "akashnet-2");
  assert.equal(osmoToAkash.channelId, "channel-1");
  assert.equal(osmoToAkash.counterpartyChannelId, "channel-9");

  assert.equal(only("cosmoshub-4", "juno-1").channelId, "channel-207");
  assert.equal(only("osmosis-1", "celestia").channelId, "channel-6994");
});

test("the engine's own seed and the table's row for the same channel are one seed", () => {
  const hubToOsmosis = only("cosmoshub-4", "osmosis-1");
  assert.equal(hubToOsmosis.channelId, "channel-141");
  assert.equal(hubToOsmosis.counterpartyChannelId, "channel-0");
});

test("host-verified channels cover the pairs the table misses, both ways", () => {
  assert.equal(only("cosmoshub-4", "akashnet-2").channelId, "channel-184");
  assert.equal(only("akashnet-2", "cosmoshub-4").channelId, "channel-17");
  assert.equal(only("osmosis-1", "archway-1").counterpartyChannelId, "channel-1");
});

test("rows naming a chain outside the catalog are dropped", () => {
  const known = new Set(["cosmoshub-4", "osmosis-1"]);
  const rows = tableSeeds(IBC_CHANNEL_ROWS, (chainId) => known.has(chainId));
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.ok(known.has(row.sourceChainId) && known.has(row.destChainId), JSON.stringify(row));
  }
});

test("a seed check must show the channel open and pointing at the destination", () => {
  const seed = only("cosmoshub-4", "celestia");
  assert.equal(seedAccepted(seed, { ok: true, counterpartyChainId: "celestia", counterpartyChannelId: "channel-278" }, "celestia"), true);
  // The counterparty could not be read: not a disagreement.
  assert.equal(seedAccepted(seed, { ok: true, counterpartyChainId: "celestia" }, "celestia"), true);
  assert.equal(seedAccepted(seed, { ok: false, counterpartyChainId: "celestia" }, "celestia"), false, "closed");
  assert.equal(seedAccepted(seed, { ok: true, counterpartyChainId: null }, "celestia"), false, "client chain unresolved");
  assert.equal(seedAccepted(seed, { ok: true, counterpartyChainId: "osmosis-1" }, "celestia"), false, "another chain");
  assert.equal(
    seedAccepted(seed, { ok: true, counterpartyChainId: "celestia", counterpartyChannelId: "channel-9" }, "celestia"),
    false,
    "a different channel pair than the registry names",
  );
});

test("only a light client read as expired or frozen disqualifies a channel", () => {
  assert.equal(clientUsable("Active"), true);
  assert.equal(clientUsable(null), true, "unreadable status passes");
  assert.equal(clientUsable("Expired"), false);
  assert.equal(clientUsable("Frozen"), false);
});

test("plan overrides are capped, normalised and limited to catalog chains", () => {
  const known = (chainId: string) => chainId === "cosmoshub-4" || chainId === "osmosis-1";
  const rows = readOverrides(
    [
      { fromChainId: "cosmoshub-4", toChainId: "osmosis-1", channelId: "141", counterpartyChannelId: "channel-0" },
      { fromChainId: "not-a-chain", toChainId: "osmosis-1", channelId: "channel-9" },
      { fromChainId: "cosmoshub-4", toChainId: "osmosis-1", channelId: "bogus" },
      { fromChainId: "cosmoshub-4", toChainId: "osmosis-1", channelId: "channel-1", counterpartyChannelId: "nope" },
      { hopIndex: 1, channelId: "Channel-7" },
      { hopIndex: 99, channelId: "channel-8" },
      null,
      "channel-3",
    ],
    known,
  );
  assert.deepEqual(rows, [
    { fromChainId: "cosmoshub-4", toChainId: "osmosis-1", channelId: "channel-141", counterpartyChannelId: "channel-0" },
    { hopIndex: 1, channelId: "channel-7" },
    { channelId: "channel-8" },
  ]);

  const many = Array.from({ length: 50 }, (_, i) => ({ fromChainId: "cosmoshub-4", toChainId: "osmosis-1", channelId: `channel-${i}` }));
  assert.equal(readOverrides(many, known).length, MAX_OVERRIDES, "a ninth override is ignored");
  assert.deepEqual(readOverrides("not a list", known), []);
});

test("a swap recovery names the verified venue contract, and only for a swap on it", () => {
  const venue = { chainId: "osmosis-1", address: "osmo1xcs" };
  const swapPlan = [
    { kind: "transfer", chainId: "cosmoshub-4" },
    { kind: "swap", chainId: "osmosis-1" },
    { kind: "forward", chainId: "osmosis-1" },
  ];
  assert.equal(recoveryContractFor(swapPlan, venue), "osmo1xcs");
  assert.equal(recoveryContractFor(swapPlan, { chainId: "osmosis-1", address: null }), null, "unverified venue");
  assert.equal(recoveryContractFor(swapPlan, null), null);
  assert.equal(recoveryContractFor([{ kind: "transfer", chainId: "cosmoshub-4" }], venue), null, "no swap");
  assert.equal(recoveryContractFor([{ kind: "swap", chainId: "neutron-1" }], venue), null, "a swap elsewhere");
});
