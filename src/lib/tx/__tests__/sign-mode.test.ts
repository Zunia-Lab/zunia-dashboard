/** Which document a wallet is asked to sign, for every wallet and message mix. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDelegate, buildExecuteContract, buildSend, buildTransfer, buildVote } from "../messages";
import { poolSwapTxMessage, POOL_SWAP_TYPE_URL } from "../osmosis";
import { aminoNeedsEscaping, chooseSignMode, SignModeError, type SignerKind } from "../sign-mode";
import { isEthKeyChain, pubKeyTypeUrlFor } from "../pubkey";
import type { ResolvedSignMode, TxMessage } from "../types";

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
  // The Zunia rule decides "auto" only.
  assert.equal(chooseSignMode([send], both, "amino", { wallet: "zunia" }), "amino");
  assert.equal(chooseSignMode([contract], both, "direct", { wallet: "zunia" }), "direct");
});

/* ------------------------------------------------------------ the matrix */

const OSMO = "osmo1qx8te2rzsdyj47q2hswzclqc52gp9nju8ltgjy";
const XCS = "osmo1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs";
const feeSend = buildSend({ fromAddress: OSMO, toAddress: "osmo1treasury", amount: [{ denom: "uosmo", amount: "50" }] });
const stake = buildDelegate({ delegatorAddress: "cosmos1a", validatorAddress: "cosmosvaloper1v", amount: { denom: "uatom", amount: "9" } });
const transfer = (memo?: string) =>
  buildTransfer({ sourceChannel: "channel-141", token: { denom: "uatom", amount: "5" }, sender: "cosmos1a", receiver: XCS, ...(memo ? { memo } : {}) });
const xcsMemo = JSON.stringify({ wasm: { contract: XCS, msg: { osmosis_swap: { output_denom: "uosmo", receiver: "cosmos1a" } } } });
const forwardMemo = JSON.stringify({ forward: { receiver: "celestia1x", port: "transfer", channel: "channel-6956" } });
const forwardThenWasm = JSON.stringify({ forward: { receiver: XCS, port: "transfer", channel: "channel-0", next: { wasm: { contract: XCS, msg: {} } } } });
const xcsSwap = buildExecuteContract({
  sender: OSMO,
  contract: XCS,
  msg: { osmosis_swap: { output_denom: "uatom", slippage: { twap: { window_seconds: 10, slippage_percentage: "5" } }, receiver: "cosmos1a", on_failed_delivery: { local_recovery_addr: OSMO } } },
  funds: [{ denom: "uosmo", amount: "1000" }],
});
const nftAmp = buildExecuteContract({ sender: "stars1a", contract: "stars1collection", msg: { transfer_nft: { recipient: "stars1b", token_id: "rock & roll" } } });
// As the swap builds it: poolmanager carries its amino form too.
const poolSwapWithAmino = poolSwapTxMessage(POOL_SWAP_TYPE_URL, {
  sender: OSMO,
  routes: [{ pool_id: "1", token_out_denom: "uion" }],
  token_in: { denom: "uosmo", amount: "1000" },
  token_out_min_amount: "1",
});

type Row = { name: string; messages: TxMessage[]; memo?: string; expect: Record<SignerKind | "any", ResolvedSignMode> };

/*
 * Keplr and Zunia Mobile (and a caller that names no wallet) share the
 * general rule; the Zunia extension has its own. "any" is the no-wallet
 * answer, and must equal Keplr's.
 */
const ROWS: Row[] = [
  { name: "send", messages: [send], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino" } },
  { name: "send, memo with &", messages: [send], memo: "rent & food", expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino" } },
  { name: "send, memo with < >", messages: [send], memo: "<b>hi</b>", expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino" } },
  { name: "stake", messages: [stake], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino" } },
  { name: "vote", messages: [vote], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino" } },
  { name: "IBC transfer", messages: [transfer()], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino" } },
  { name: "IBC transfer, forward memo", messages: [transfer(forwardMemo)], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino" } },
  // The swap's cross-chain path: a transfer whose memo runs the swap contract.
  { name: "IBC transfer, wasm-hook memo + fee", messages: [transfer(xcsMemo), feeSend], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  { name: "IBC transfer, forward then wasm hook", messages: [transfer(forwardThenWasm)], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  // The swap from Osmosis funds, a recovery, an NFT transfer.
  { name: "XCS contract call + fee", messages: [xcsSwap, feeSend], expect: { zunia: "amino", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  { name: "recovery contract call", messages: [contract], memo: "Recover swap output · by Zunia-wallet", expect: { zunia: "amino", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  { name: "contract call, memo with &", messages: [contract], memo: "a & b", expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  { name: "contract call, & in its body", messages: [nftAmp], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  // Osmosis pools: direct everywhere, amino form or not.
  { name: "poolmanager (amino form) + fee", messages: [poolSwapWithAmino, feeSend], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  { name: "poolmanager (no amino form)", messages: [poolSwap], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
  { name: "poolmanager + contract call", messages: [poolSwapWithAmino, contract], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct" } },
];

for (const row of ROWS) {
  test(`policy matrix: ${row.name}`, () => {
    for (const wallet of ["zunia", "keplr", "zunia-mobile"] as const) {
      assert.equal(chooseSignMode(row.messages, both, "auto", { wallet, memo: row.memo }), row.expect[wallet], wallet);
    }
    assert.equal(chooseSignMode(row.messages, both, "auto", { memo: row.memo }), row.expect.any, "no wallet named");
    assert.equal(row.expect.any, row.expect.keplr, "naming Keplr changes nothing");
  });
}

test("Zunia: a wallet without one of the modes gets the other; Ethereum-key chains stay direct", () => {
  assert.equal(chooseSignMode([send], { amino: true, direct: false }, "auto", { wallet: "zunia" }), "amino");
  assert.equal(chooseSignMode([contract], { amino: false, direct: true }, "auto", { wallet: "zunia" }), "direct");
  // Injective-style chains: amino with an Ethereum key is refused by the chain, contracts there are 20 bytes.
  assert.equal(chooseSignMode([contract], both, "auto", { wallet: "zunia", ethKeyChain: true }), "direct");
});

test("amino escaping: only free text can need it, and it is found wherever it is", () => {
  assert.equal(aminoNeedsEscaping([send], undefined), false);
  assert.equal(aminoNeedsEscaping([send], ""), false);
  assert.equal(aminoNeedsEscaping([send], "a & b"), true);
  assert.equal(aminoNeedsEscaping([send], "1 < 2"), true);
  assert.equal(aminoNeedsEscaping([send], "2 > 1"), true);
  assert.equal(aminoNeedsEscaping([send], "Swap OSMO to USDC.n · by Zunia-wallet"), false);
  assert.equal(aminoNeedsEscaping([xcsSwap, feeSend], ""), false);
  assert.equal(aminoNeedsEscaping([nftAmp], ""), true);
  assert.equal(aminoNeedsEscaping([transfer("x<y")], ""), true);
  // A message with no amino form has nothing to escape.
  assert.equal(aminoNeedsEscaping([poolSwap], ""), false);
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

test("the chain's amino bytes escape & < > (CosmJS serializeSignDoc); unescaped bytes differ exactly then", async () => {
  const { makeStdSignDoc } = await import("../amino-tx");
  const { serializeAminoSignDoc, sortKeysDeep } = await import("../bytes");
  const unescaped = (doc: unknown) => new TextEncoder().encode(JSON.stringify(sortKeysDeep(doc)));
  const fee = { amount: [{ denom: "uatom", amount: "5000" }], gas: "200000" };
  const doc = (memo: string, msg = send) => makeStdSignDoc({ chainId: "cosmoshub-4", accountNumber: "1", sequence: "0", fee, msgs: [msg.amino!], memo });
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  assert.match(text(serializeAminoSignDoc(doc("rent & food"))), /"memo":"rent \\u0026 food"/);
  assert.match(text(serializeAminoSignDoc(doc("<b>"))), /"memo":"\\u003cb\\u003e"/);
  // The Zunia extension's bytes equal the chain's exactly when nothing needs escaping:
  // the policy's amino choice for Zunia is safe precisely then.
  for (const [memo, msg] of [["plain", send], ["rent & food", send], ["", nftAmp], ["", xcsSwap]] as const) {
    const same = text(unescaped(doc(memo, msg))) === text(serializeAminoSignDoc(doc(memo, msg)));
    assert.equal(same, !aminoNeedsEscaping([msg], memo), `${memo || msg.summary}`);
  }
});
