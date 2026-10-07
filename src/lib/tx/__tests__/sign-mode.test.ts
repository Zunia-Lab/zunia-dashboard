/** Which document a wallet is asked to sign, for every wallet and message mix. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildExecuteContract, buildSend, buildVote } from "../messages";
import { chooseSignMode, SignModeError } from "../sign-mode";
import { isEthKeyChain, pubKeyTypeUrlFor } from "../pubkey";

const send = buildSend({ fromAddress: "cosmos1a", toAddress: "cosmos1b", amount: [{ denom: "uatom", amount: "1" }] });
const vote = buildVote({ proposalId: "1", voter: "cosmos1a", option: "yes" });
const contract = buildExecuteContract({ sender: "osmo1a", contract: "osmo1c", msg: { recover: {} } });
const poolSwap = { typeUrl: "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn", value: new Uint8Array([1]) };
const both = { amino: true, direct: true };

test("standard messages sign amino (legible on every wallet, Ledger included)", () => {
  assert.equal(chooseSignMode([send], both), "amino");
  assert.equal(chooseSignMode([send, vote], both), "amino");
});

test("a message without an amino form signs direct", () => {
  assert.equal(chooseSignMode([poolSwap], both), "direct");
  assert.equal(chooseSignMode([send, poolSwap], both), "direct");
});

test("a non-standard message signs direct when the wallet can, so its prompt is decoded", () => {
  assert.equal(chooseSignMode([contract], both), "direct");
  assert.equal(chooseSignMode([contract], { amino: true, direct: false }), "amino");
});

test("Ethereum-key chains sign direct", () => {
  assert.equal(chooseSignMode([send], both, "auto", { ethKeyChain: true }), "direct");
});

test("Ledger: amino only, and a clear refusal when a message has no amino form", () => {
  assert.equal(chooseSignMode([contract], { ...both, ledger: true }), "amino");
  assert.throws(() => chooseSignMode([poolSwap], { ...both, ledger: true }), SignModeError);
  assert.throws(() => chooseSignMode([send], { ...both, ledger: true }, "direct"), /Ledger/);
});

test("an explicit request is honoured or refused, never silently changed", () => {
  assert.equal(chooseSignMode([send], both, "direct"), "direct");
  assert.equal(chooseSignMode([send], both, "amino"), "amino");
  assert.throws(() => chooseSignMode([poolSwap], both, "amino"), /cannot be signed in amino/);
  assert.throws(() => chooseSignMode([send], { amino: true, direct: false }, "direct"), /cannot sign in direct/);
  assert.throws(() => chooseSignMode([], both), /Nothing to sign/);
});

test("public key type URLs: on-chain record, catalog, feature flags, coin type", () => {
  const hub = { chainId: "cosmoshub-4", coinType: 118, features: [] };
  const injective = { chainId: "injective-1", coinType: 60, features: ["eth-address-gen", "eth-key-sign"], ethPubKeyTypeUrl: "/injective.crypto.v1beta1.ethsecp256k1.PubKey" };
  const evmos = { chainId: "evmos_9001-2", coinType: 60, features: ["eth-address-gen", "eth-key-sign"] };
  const cosmosEvm = { chainId: "kiichain_1783-1", coinType: 60, features: ["eth-address-gen", "eth-key-sign", "eth-secp256k1-cosmos"] };
  const initia = { chainId: "interwoven-1", coinType: 60, features: ["eth-key-sign", "eth-secp256k1-initia"] };
  assert.equal(pubKeyTypeUrlFor(hub), "/cosmos.crypto.secp256k1.PubKey");
  assert.equal(pubKeyTypeUrlFor(injective), "/injective.crypto.v1beta1.ethsecp256k1.PubKey");
  assert.equal(pubKeyTypeUrlFor({ ...injective, ethPubKeyTypeUrl: undefined }), "/injective.crypto.v1beta1.ethsecp256k1.PubKey");
  assert.equal(pubKeyTypeUrlFor(evmos), "/ethermint.crypto.v1.ethsecp256k1.PubKey");
  assert.equal(pubKeyTypeUrlFor(cosmosEvm), "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey");
  assert.equal(pubKeyTypeUrlFor(initia), "/initia.crypto.v1beta1.ethsecp256k1.PubKey");
  // The chain's own record of this account wins; the legacy amino spelling is not a type URL.
  assert.equal(pubKeyTypeUrlFor(evmos, "/ethermint.crypto.v1.ethsecp256k1.PubKey"), "/ethermint.crypto.v1.ethsecp256k1.PubKey");
  assert.equal(pubKeyTypeUrlFor(hub, "tendermint/PubKeySecp256k1"), "/cosmos.crypto.secp256k1.PubKey");
  assert.equal(isEthKeyChain(evmos), true);
  assert.equal(isEthKeyChain(hub), false);
});
