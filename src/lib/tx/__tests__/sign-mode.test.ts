/** Which document a wallet is asked to sign, for every wallet and message mix. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDelegate, buildExecuteContract, buildSend, buildTransfer, buildVote } from "../messages";
import { poolSwapTxMessage, POOL_SWAP_TYPE_URL } from "../osmosis";
import { aminoNeedsEscaping, chooseSignMode, SignModeError, type SignerKind } from "../sign-mode";
import { isEthKeyChain, pubKeyTypeUrlFor } from "../pubkey";
import type { ResolvedSignMode, TxMessage } from "../types";
import { ZUNIA_SIGNING_FEATURES, zuniaCapabilities } from "../zunia-capabilities";

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

// A send to a 32-byte address: the XCS contract itself.
const sendTo32 = buildSend({ fromAddress: OSMO, toAddress: XCS, amount: [{ denom: "uosmo", amount: "50" }] });

/** What Zunia 0.1.5's provider reports (P1). */
const ZUNIA_015 = {
  version: "0.1.0",
  extensionVersion: "0.1.5",
  isZunia: true,
  features: ["sign-direct:wasm-contract-32", "sign-direct:send-32", "sign-direct:osmosis-poolmanager", "sign-direct:osmosis-exact-out", "sign-amino:escaped"],
};

type Row = {
  name: string;
  messages: TxMessage[];
  memo?: string;
  expect: Record<"zunia" | "keplr" | "zunia-mobile" | "any" | "zunia@0.1.5", ResolvedSignMode>;
};

/*
 * Keplr and Zunia Mobile (and a caller that names no wallet) share the
 * general rule; the Zunia extension has its own, by build: "zunia" is a build
 * that reports nothing (0.1.4 and older), "zunia@0.1.5" one that reports its
 * version and features. "any" is the no-wallet answer, and must equal Keplr's.
 * Leap and Cosmostation are Keplr-API signers that accept any message: they
 * must answer Keplr's column, row for row.
 */
const ROWS: Row[] = [
  { name: "send", messages: [send], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  { name: "send, memo with &", messages: [send], memo: "rent & food", expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  { name: "send, memo with < >", messages: [send], memo: "<b>hi</b>", expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  { name: "stake", messages: [stake], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  { name: "vote", messages: [vote], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  { name: "IBC transfer", messages: [transfer()], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  { name: "IBC transfer, forward memo", messages: [transfer(forwardMemo)], expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  // The swap's cross-chain path: a transfer whose memo runs the swap contract.
  { name: "IBC transfer, wasm-hook memo + fee", messages: [transfer(xcsMemo), feeSend], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  { name: "IBC transfer, forward then wasm hook", messages: [transfer(forwardThenWasm)], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  // The swap from Osmosis funds, a recovery, an NFT transfer.
  { name: "XCS contract call + fee", messages: [xcsSwap, feeSend], expect: { zunia: "amino", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  { name: "recovery contract call", messages: [contract], memo: "Recover swap output · by Zunia-wallet", expect: { zunia: "amino", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  { name: "contract call, memo with &", messages: [contract], memo: "a & b", expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  { name: "contract call, & in its body", messages: [nftAmp], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  // Osmosis pools: direct everywhere, amino form or not.
  { name: "poolmanager (amino form) + fee", messages: [poolSwapWithAmino, feeSend], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  { name: "poolmanager (no amino form)", messages: [poolSwap], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  { name: "poolmanager + contract call", messages: [poolSwapWithAmino, contract], expect: { zunia: "direct", keplr: "direct", "zunia-mobile": "direct", any: "direct", "zunia@0.1.5": "direct" } },
  // A send to a contract or an interchain account: older Zunia builds refuse it in direct mode.
  { name: "send to a 32-byte address", messages: [sendTo32], expect: { zunia: "amino", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
  { name: "send to a 32-byte address, memo with &", messages: [sendTo32], memo: "a & b", expect: { zunia: "direct", keplr: "amino", "zunia-mobile": "amino", any: "amino", "zunia@0.1.5": "direct" } },
];

for (const row of ROWS) {
  test(`policy matrix: ${row.name}`, () => {
    for (const wallet of ["zunia", "keplr", "zunia-mobile"] as const) {
      assert.equal(chooseSignMode(row.messages, both, "auto", { wallet, memo: row.memo }), row.expect[wallet], wallet);
    }
    // A build that reports only the API version "0.1.0" is the build that reports nothing.
    const legacy = { ...both, zunia: zuniaCapabilities({ version: "0.1.0" }) };
    assert.equal(chooseSignMode(row.messages, legacy, "auto", { wallet: "zunia", memo: row.memo }), row.expect.zunia, "zunia, 0.1.0 reported");
    const current = { ...both, zunia: zuniaCapabilities(ZUNIA_015) };
    assert.equal(chooseSignMode(row.messages, current, "auto", { wallet: "zunia", memo: row.memo }), row.expect["zunia@0.1.5"], "zunia@0.1.5");
    // Capabilities are the Zunia extension's: another wallet given them keeps its own rule.
    assert.equal(chooseSignMode(row.messages, current, "auto", { wallet: "keplr", memo: row.memo }), row.expect.keplr, "keplr, Zunia capabilities ignored");
    assert.equal(chooseSignMode(row.messages, both, "auto", { memo: row.memo }), row.expect.any, "no wallet named");
    assert.equal(row.expect.any, row.expect.keplr, "naming Keplr changes nothing");
    for (const wallet of ["leap", "cosmostation"] as const) {
      assert.equal(chooseSignMode(row.messages, both, "auto", { wallet, memo: row.memo }), row.expect.keplr, `${wallet}: Keplr's rule`);
      assert.equal(chooseSignMode(row.messages, current, "auto", { wallet, memo: row.memo }), row.expect.keplr, `${wallet}, Zunia capabilities ignored`);
    }
  });
}

test("Leap and Cosmostation meet the general limits as Keplr does: Ledger amino, explicit modes, Ethereum-key chains, a mode they lack", () => {
  const wallets: SignerKind[] = ["keplr", "leap", "cosmostation"];
  for (const wallet of wallets) {
    assert.equal(chooseSignMode([send], both, "auto", { wallet }), "amino", wallet);
    assert.equal(chooseSignMode([contract], both, "auto", { wallet }), "direct", wallet);
    assert.equal(chooseSignMode([poolSwap], both, "auto", { wallet }), "direct", wallet);
    assert.equal(chooseSignMode([send], { ...both, ledger: true }, "auto", { wallet }), "amino", wallet);
    assert.throws(() => chooseSignMode([poolSwap], { ...both, ledger: true }, "auto", { wallet }), SignModeError);
    assert.equal(chooseSignMode([send], both, "direct", { wallet }), "direct", wallet);
    assert.equal(chooseSignMode([contract], both, "amino", { wallet }), "amino", wallet);
    assert.equal(chooseSignMode([send], both, "auto", { wallet, ethKeyChain: true }), "direct", wallet);
    assert.equal(chooseSignMode([send], { amino: false, direct: true }, "auto", { wallet }), "direct", wallet);
    assert.equal(chooseSignMode([contract], { amino: true, direct: false }, "auto", { wallet }), "amino", wallet);
  }
});

test("Zunia 0.1.5 still meets the general limits: Ledger is amino, an explicit mode is honoured, Ethereum-key chains direct", () => {
  const current = { ...both, zunia: zuniaCapabilities(ZUNIA_015) };
  assert.equal(chooseSignMode([send], current, "amino", { wallet: "zunia" }), "amino");
  assert.equal(chooseSignMode([send], { ...current, ledger: true }, "auto", { wallet: "zunia" }), "amino");
  assert.equal(chooseSignMode([send], { ...current, direct: false }, "auto", { wallet: "zunia" }), "amino");
  assert.equal(chooseSignMode([send], current, "auto", { wallet: "zunia", ethKeyChain: true }), "direct");
});

test("what the Zunia provider reports: 0.1.4 and older say nothing, 0.1.5 its version and what it can sign", () => {
  const legacy = {
    extensionVersion: null,
    directContractCalls: false,
    directSends32: false,
    directPoolmanager: null,
    directExactOut: false,
    aminoEscaping: false,
    aminoPoolmanager: false,
  };
  assert.deepEqual(zuniaCapabilities({ version: "0.1.0" }), legacy);
  assert.deepEqual(zuniaCapabilities(undefined), legacy);
  assert.deepEqual(zuniaCapabilities(null), legacy);
  const fixed = { extensionVersion: "0.1.5", directContractCalls: true, directSends32: true, directPoolmanager: true, directExactOut: true, aminoEscaping: true, aminoPoolmanager: false };
  assert.deepEqual(zuniaCapabilities(ZUNIA_015), fixed);
  // Readable amino pool swaps are optional in 0.1.5: only `features` says so.
  assert.equal(zuniaCapabilities({ ...ZUNIA_015, features: [...ZUNIA_015.features, "sign-amino:osmosis-poolmanager"] }).aminoPoolmanager, true);
  // Without `features`, the version decides.
  assert.deepEqual(zuniaCapabilities({ version: "0.1.0", extensionVersion: "0.1.5" }), fixed);
  assert.equal(zuniaCapabilities({ version: "0.1.0", extensionVersion: "0.2.0" }).directContractCalls, true);
  assert.equal(zuniaCapabilities({ version: "0.1.0", extensionVersion: "0.1.4" }).directContractCalls, false);
  assert.equal(zuniaCapabilities({ version: "0.1.5" }).directContractCalls, true, "a build that reports its release as the API version");
  // With `features`, they decide: a build that lists only some.
  const partial = zuniaCapabilities({ version: "0.1.0", extensionVersion: "0.1.5", features: ["sign-amino:escaped"] });
  assert.equal(partial.directContractCalls, false);
  assert.equal(partial.directPoolmanager, false);
  assert.equal(partial.aminoEscaping, true);
  // 0.1.5 that could not read its manifest says "", and its features still count.
  const unread = zuniaCapabilities({ version: "0.1.0", extensionVersion: "", features: ZUNIA_015.features });
  assert.equal(unread.extensionVersion, null);
  assert.equal(unread.directContractCalls, true);
  // A page object, not trusted to be well-typed.
  assert.deepEqual(zuniaCapabilities({ version: "0.1.0", features: "sign-direct:wasm-contract-32" as unknown as string[] }), legacy);
  assert.deepEqual(zuniaCapabilities({ version: 5 as unknown as string, extensionVersion: 5 as unknown as string }), legacy);
  // The SDK's strings, character for character (sdk-core `ZUNIA_SIGNING_FEATURES`).
  assert.deepEqual(Object.values(ZUNIA_SIGNING_FEATURES), [
    "sign-direct:wasm-contract-32",
    "sign-direct:send-32",
    "sign-direct:osmosis-poolmanager",
    "sign-direct:osmosis-exact-out",
    "sign-amino:escaped",
    "sign-amino:osmosis-poolmanager",
  ]);
});

test("a 32-byte recipient is read from the send's address, and only a well-formed one counts", () => {
  const zunia = { wallet: "zunia" as const };
  // 20 bytes (a person), a malformed address and another chain's 32 bytes.
  assert.equal(chooseSignMode([feeSend], both, "auto", zunia), "direct");
  assert.equal(chooseSignMode([buildSend({ fromAddress: OSMO, toAddress: `${XCS.slice(0, -1)}x`, amount: [{ denom: "uosmo", amount: "1" }] })], both, "auto", zunia), "direct");
  assert.equal(chooseSignMode([buildSend({ fromAddress: "cosmos1a", toAddress: "cosmos1uwk8xc6q0s6t5qcpr6rht3sczu6du83xq8pwxjua0hfj5hzcnh3sqxwvxs", amount: [{ denom: "uatom", amount: "1" }] })], both, "auto", zunia), "direct");
  // A 0.1.5-style build that lists 32-byte sends but not contract calls: the send signs direct.
  const sends = { ...both, zunia: zuniaCapabilities({ version: "0.1.0", features: [ZUNIA_SIGNING_FEATURES.directSends32] }) };
  assert.equal(chooseSignMode([sendTo32], sends, "auto", zunia), "direct");
});

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
