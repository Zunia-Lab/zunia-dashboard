/** Address resolution: the wallet's word first, same-scheme derivation second, never across schemes. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  keyScheme,
  reencodeBech32,
  resolveAddressFor,
  resolveAddresses,
  retargetSignerFields,
  type AddressChain,
} from "../addresses";

const CHAINS: Record<string, AddressChain> = {
  "safrochain-1": { chainId: "safrochain-1", bech32Prefix: "addr_safro", coinType: 118 },
  "cosmoshub-4": { chainId: "cosmoshub-4", bech32Prefix: "cosmos", coinType: 118 },
  "osmosis-1": { chainId: "osmosis-1", bech32Prefix: "osmo", coinType: 118 },
  "secret-4": { chainId: "secret-4", bech32Prefix: "secret", coinType: 529 },
  "evmos_9001-2": { chainId: "evmos_9001-2", bech32Prefix: "evmos", coinType: 60, features: ["eth-address-gen", "eth-key-sign"] },
  "injective-1": { chainId: "injective-1", bech32Prefix: "inj", coinType: 60, features: ["eth-address-gen", "eth-key-sign"] },
};
const lookup = (id: string) => CHAINS[id];

// The Zunia treasury, public: the same 20 bytes on every coin-118 chain.
const SAFRO = "addr_safro1gv86dp8wmnmmatdckgr5xkevnpmy4662qudn7e";
const HUB = "cosmos1gv86dp8wmnmmatdckgr5xkevnpmy4662csvy4f";
const OSMO = "osmo1gv86dp8wmnmmatdckgr5xkevnpmy4662stl5rm";

test("the wallet's own address wins", () => {
  assert.equal(resolveAddressFor("osmosis-1", { "osmosis-1": "osmo1fromwallet", "cosmoshub-4": HUB }, lookup), "osmo1fromwallet");
});

test("same coin type: re-encoded under the target prefix", () => {
  assert.equal(resolveAddressFor("cosmoshub-4", { "safrochain-1": SAFRO }, lookup), HUB);
  assert.equal(resolveAddressFor("osmosis-1", { "safrochain-1": SAFRO }, lookup), OSMO);
  assert.equal(reencodeBech32(HUB, "addr_safro"), SAFRO);
});

test("never across coin types or address schemes", () => {
  assert.equal(resolveAddressFor("evmos_9001-2", { "safrochain-1": SAFRO }, lookup), null);
  assert.equal(resolveAddressFor("secret-4", { "cosmoshub-4": HUB }, lookup), null);
  assert.notEqual(keyScheme(CHAINS["evmos_9001-2"]!), keyScheme(CHAINS["cosmoshub-4"]!));
});

test("Ethereum-style chains share bytes with each other", () => {
  const evmos = reencodeBech32(HUB, "evmos")!; // any valid 20-byte payload
  const inj = resolveAddressFor("injective-1", { "evmos_9001-2": evmos }, lookup)!;
  assert.ok(inj.startsWith("inj1"));
  assert.equal(reencodeBech32(inj, "evmos"), evmos);
});

test("unknown chains and malformed sources resolve to null", () => {
  assert.equal(resolveAddressFor("nope-1", { "cosmoshub-4": HUB }, lookup), null);
  assert.equal(resolveAddressFor("osmosis-1", { "cosmoshub-4": "not-bech32" }, lookup), null);
  assert.equal(resolveAddressFor("osmosis-1", {}, lookup), null);
});

test("the preferred (primary) chain is the source of choice; many at once skips the unknowable", () => {
  const known = { "cosmoshub-4": HUB, "safrochain-1": SAFRO };
  assert.equal(resolveAddressFor("osmosis-1", known, lookup, "safrochain-1"), OSMO);
  assert.deepEqual(resolveAddresses(["osmosis-1", "evmos_9001-2", "cosmoshub-4"], known, lookup), {
    "osmosis-1": OSMO,
    "cosmoshub-4": HUB,
  });
});

test("legacy retargeting moves signer fields only, never a recipient", () => {
  const msgs = [
    { type: "cosmos-sdk/MsgDelegate", value: { delegator_address: SAFRO, validator_address: "cosmosvaloper1x", amount: { denom: "uatom", amount: "1" } } },
    { type: "cosmos-sdk/MsgTransfer", value: { sender: SAFRO, receiver: SAFRO, source_channel: "channel-0" } },
    { type: "cosmos-sdk/MsgSend", value: { from_address: SAFRO, to_address: SAFRO, amount: [] } },
    { type: "cosmos-sdk/MsgVote", value: { voter: SAFRO, proposal_id: "1", option: 1 } },
  ];
  const out = retargetSignerFields(msgs, SAFRO, HUB);
  assert.equal(out[0]!.value.delegator_address, HUB);
  assert.equal(out[1]!.value.sender, HUB);
  assert.equal(out[1]!.value.receiver, SAFRO, "the IBC receiver keeps its own chain's prefix");
  assert.equal(out[2]!.value.from_address, HUB);
  assert.equal(out[2]!.value.to_address, SAFRO);
  assert.equal(out[3]!.value.voter, HUB);
  // Inputs untouched; messages without the signer are returned as they were.
  assert.equal(msgs[0]!.value.delegator_address, SAFRO);
  const other = [{ type: "x", value: { sender: OSMO } }];
  assert.equal(retargetSignerFields(other, SAFRO, HUB)[0], other[0]);
});
