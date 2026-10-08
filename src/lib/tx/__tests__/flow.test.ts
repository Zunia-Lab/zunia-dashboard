/**
 * The sign flow end to end, with a fake wallet and fake routes: what is
 * simulated, what is signed, what is broadcast, what the user is told.
 *
 * The fake wallet signs for real, with the vendored vectors' key (the public
 * "abandon … about" test phrase): the flow verifies every signature before
 * broadcasting it, so a wallet that signs other bytes is a test of its own.
 */
// The flow names its default memo from the chain catalog (a JSON module).
import "../../swap/__tests__/json-modules";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bech32 } from "@scure/base";

import { toBase64, fromBase64, fromHex, serializeAminoSignDoc, sortKeysDeep, toHex } from "../bytes";
import { SimulationRefused, type AccountInfo, type BroadcastAnswer } from "../client";
import { decodeAuthInfoFee, encodeAuthInfo, encodePubKeyAny, encodeSignDoc, encodeTxBody, SIGN_MODE_DIRECT } from "../encode";
import { TxError } from "../errors";
import {
  memoProblem,
  planTx,
  previewTx,
  signAndBroadcast,
  type DirectSignDocInput,
  type FlowChain,
  type FlowOptions,
  type TxApi,
  type TxSigner,
} from "../flow";
import { ZUNIA_DASHBOARD_TAG } from "../memo";
import { buildDelegate, buildExecuteContract, buildSend, buildTransfer, buildVote } from "../messages";
import { readProtoFields } from "../proto";
import { INJECTIVE_PUBKEY_TYPE_URL } from "../pubkey";
import type { SignStage, TxOutcome } from "../types";
import type { StdSignDoc } from "../amino-tx";
import { zuniaCapabilities } from "../zunia-capabilities";

const CHAIN: FlowChain = {
  chainId: "cosmoshub-4",
  chainName: "Cosmos Hub",
  coinType: 118,
  features: [],
  feeMinimalDenom: "uatom",
  feeDenom: "ATOM",
  feeDecimals: 6,
  gasPriceStep: { low: 0.005, average: 0.025, high: 0.03 },
};
const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "vectors/cosmos-signing.json"), "utf8")) as {
  key: { privkey_hex: string; pubkey_compressed_hex: string; addresses: { cosmos: string } };
};
/** The vectors' key: the public "abandon … about" test phrase, m/44'/118'/0'/0/0. */
const PRIVKEY = fromHex(vectors.key.privkey_hex);
const PUBKEY = fromHex(vectors.key.pubkey_compressed_hex);
const ADDRESS = vectors.key.addresses.cosmos;
/** For wallets the flow stops before it looks at their signature. */
const SIGNATURE = toBase64(new Uint8Array(64).fill(5));
const send = buildSend({ fromAddress: ADDRESS, toAddress: ADDRESS, amount: [{ denom: "uatom", amount: "1" }] });

/** A signature as a wallet makes it: secp256k1 over the digest of the bytes, base64. */
const signBytes = (bytes: Uint8Array, digest: (b: Uint8Array) => Uint8Array = sha256) =>
  toBase64(secp256k1.sign(digest(bytes), PRIVKEY, { prehash: false }));
/** What Keplr, Zunia Mobile and Zunia 0.1.5 sign in amino mode (A1 bytes). */
const signAminoDoc = (doc: StdSignDoc) => signBytes(serializeAminoSignDoc(doc));
/** What the Zunia extension up to 0.1.4 signs in amino mode: nothing escaped. */
const signAminoUnescaped = (doc: StdSignDoc) => signBytes(new TextEncoder().encode(JSON.stringify(sortKeysDeep(doc))));
const signDirectDoc = (doc: DirectSignDocInput, digest?: (b: Uint8Array) => Uint8Array) => signBytes(encodeSignDoc(doc), digest);
const PUB_KEY = { type: "tendermint/PubKeySecp256k1", value: toBase64(PUBKEY) };
const SIGNATURE_CHECK_FAILED = "Your wallet signed something other than this transaction, so nothing was sent.";

interface Calls {
  simulate: string[];
  broadcast: string[];
  signAmino: StdSignDoc[];
  signDirect: Array<{ bodyBytes: Uint8Array; authInfoBytes: Uint8Array; accountNumber: string }>;
  stages: SignStage[];
}

function harness(overrides: {
  api?: Partial<TxApi>;
  signer?: Partial<TxSigner>;
  account?: Partial<AccountInfo>;
  chain?: FlowChain;
} = {}) {
  const chain = overrides.chain ?? CHAIN;
  const calls: Calls = { simulate: [], broadcast: [], signAmino: [], signDirect: [], stages: [] };
  const account: AccountInfo = {
    chainId: chain.chainId,
    address: ADDRESS,
    accountNumber: "681",
    sequence: "366",
    exists: true,
    pubKey: { typeUrl: "/cosmos.crypto.secp256k1.PubKey", key: toBase64(PUBKEY) },
    accountType: "/cosmos.auth.v1beta1.BaseAccount",
    updatedAt: 0,
    ...overrides.account,
  };
  let polls = 0;
  const api: TxApi = {
    getAccount: async () => account,
    simulate: async (_chainId, txBytes) => {
      calls.simulate.push(txBytes);
      return { gasUsed: "87731" };
    },
    broadcast: async (chainId, txBytes): Promise<BroadcastAnswer> => {
      calls.broadcast.push(txBytes);
      return { chainId, txHash: "A".repeat(64), code: 0, codespace: "", rawLog: "", success: true, updatedAt: 0 };
    },
    getTx: async (): Promise<TxOutcome> => {
      polls += 1;
      return polls < 2 ? { status: "pending" } : { status: "success", height: 33290800, gasUsed: 90000, gasWanted: 122824 };
    },
    ...overrides.api,
  };
  // Signs what it was sent, as Keplr and Zunia Mobile do.
  const signer: TxSigner = {
    kind: "keplr",
    capabilities: () => ({ amino: true, direct: true }),
    ensureKey: async () => ({ address: ADDRESS, pubKey: PUBKEY }),
    signAmino: async (_chainId, _signer, doc) => {
      calls.signAmino.push(doc);
      return { signed: doc, signature: { pub_key: PUB_KEY, signature: signAminoDoc(doc) } };
    },
    signDirect: async (_chainId, _signer, doc) => {
      calls.signDirect.push(doc);
      return { signed: { bodyBytes: doc.bodyBytes, authInfoBytes: doc.authInfoBytes }, signature: { pub_key: PUB_KEY, signature: signDirectDoc(doc) } };
    },
    ...overrides.signer,
  };
  const opts: FlowOptions = {
    signer,
    api,
    chain,
    onStage: (stage) => calls.stages.push(stage),
    sleep: async () => {},
    pollIntervalMs: 1,
    pollTimeoutMs: 50,
  };
  return { calls, opts };
}

function txRawParts(base64: string) {
  const [body, auth, sig] = readProtoFields(fromBase64(base64));
  return { body: body!.value as Uint8Array, auth: auth!.value as Uint8Array, sig: sig!.value as Uint8Array };
}

test("amino happy path: simulate ×1.4, sign once, broadcast, confirm", async () => {
  const { calls, opts } = harness();
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "hi" }, opts);
  assert.equal(result.confirmed, true);
  assert.equal(result.signMode, "amino");
  assert.equal(result.height, 33290800);
  assert.deepEqual(result.fee, [{ denom: "uatom", amount: "3071" }]);
  assert.equal(result.gasLimit, "122824");
  assert.deepEqual(calls.stages, ["preparing", "awaiting-signature", "broadcasting", "confirming", "success"]);
  const doc = calls.signAmino[0]!;
  assert.equal(doc.account_number, "681");
  assert.equal(doc.sequence, "366");
  assert.equal(doc.memo, "hi");
  assert.deepEqual(doc.fee, { amount: [{ denom: "uatom", amount: "3071" }], gas: "122824" });
  const parts = txRawParts(calls.broadcast[0]!);
  assert.equal(toBase64(parts.sig), signAminoDoc(doc));
  assert.deepEqual(decodeAuthInfoFee(parts.auth), { amount: [{ denom: "uatom", amount: "3071" }], gasLimit: "122824" });
});

test("direct mode for a contract call; a fee the wallet changed is the fee broadcast", async () => {
  const contract = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  const changedAuth = encodeAuthInfo({
    signers: [{ publicKey: encodePubKeyAny(PUBKEY), mode: SIGN_MODE_DIRECT, sequence: 366 }],
    fee: { amount: [{ denom: "uatom", amount: "9999" }], gasLimit: 122824 },
  });
  const { calls, opts } = harness({
    signer: {
      signDirect: async (_c, _s, doc) => {
        calls.signDirect.push(doc);
        // As the extensions answer across postMessage: a plain array.
        return {
          signed: { bodyBytes: Array.from(doc.bodyBytes), authInfoBytes: Array.from(changedAuth) },
          signature: { pub_key: PUB_KEY, signature: signDirectDoc({ ...doc, authInfoBytes: changedAuth }) },
        };
      },
    },
  });
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [contract] }, opts);
  assert.equal(result.signMode, "direct");
  assert.equal(calls.signDirect[0]!.accountNumber, "681");
  assert.deepEqual(result.fee, [{ denom: "uatom", amount: "9999" }]);
  assert.equal(toHex(txRawParts(calls.broadcast[0]!).auth), toHex(changedAuth));
});

test("a wallet that changes the messages is refused before anything is broadcast", async () => {
  const { calls, opts } = harness({
    signer: {
      signAmino: async (_c, _s, doc) => ({
        signed: { ...doc, msgs: [{ type: "cosmos-sdk/MsgSend", value: { ...doc.msgs[0]!.value, to_address: "cosmos1evil" } }] },
        signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(PUBKEY) }, signature: SIGNATURE },
      }),
    },
  });
  await assert.rejects(signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts), /different transaction/);
  assert.equal(calls.broadcast.length, 0);
  assert.equal(calls.stages.at(-1), "failed");
});

test("a simulation the chain refuses stops before the wallet is asked", async () => {
  const { calls, opts } = harness({
    api: {
      simulate: async () => {
        throw new SimulationRefused("…", "insufficient-funds", "spendable balance 1uatom is smaller than 5uatom: insufficient funds");
      },
    },
  });
  const error = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts).catch((e: unknown) => e);
  assert.ok(error instanceof TxError);
  assert.equal(error.explained.kind, "insufficient-funds");
  assert.equal(calls.signAmino.length + calls.signDirect.length, 0);
});

test("a simulation that could not run falls back to fixed gas, flagged as an estimate", async () => {
  const { opts } = harness({ api: { simulate: async () => Promise.reject(new Error("503")) } });
  const plan = await planTx({ chainId: CHAIN.chainId, messages: [send] }, opts);
  assert.equal(plan.gas.method, "fixed");
  assert.equal(plan.gas.estimate, true);
  assert.equal(plan.gas.gasLimit, 150_000);
  assert.match(plan.gas.note!, /fixed gas limit/);
});

test("a stale sequence in simulation is retried with the one the chain expects", async () => {
  let attempts = 0;
  const { calls, opts } = harness({
    api: {
      simulate: async (_c, txBytes) => {
        calls.simulate.push(txBytes);
        attempts += 1;
        if (attempts === 1) throw new SimulationRefused("…", "sequence-mismatch", "account sequence mismatch, expected 367, got 366: incorrect account sequence");
        return { gasUsed: "1000" };
      },
    },
  });
  const plan = await planTx({ chainId: CHAIN.chainId, messages: [send] }, opts);
  assert.equal(plan.gas.method, "simulated");
  assert.equal(calls.simulate.length, 2);
  // …and the corrected sequence is the one signed: signing 366 would be a
  // certain mismatch at broadcast and a second wallet prompt.
  assert.equal(plan.sequence, "367");

  let fresh = 0;
  const run = harness({
    api: {
      simulate: async () => {
        fresh += 1;
        if (fresh === 1) throw new SimulationRefused("…", "sequence-mismatch", "account sequence mismatch, expected 367, got 366: incorrect account sequence");
        return { gasUsed: "1000" };
      },
    },
  });
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, run.opts);
  assert.equal(result.confirmed, true);
  assert.deepEqual(run.calls.signAmino.map((d) => d.sequence), ["367"]);
  assert.equal(run.calls.broadcast.length, 1);
});

test("sequence mismatch at broadcast: re-signed once with the expected sequence", async () => {
  let broadcasts = 0;
  const { calls, opts } = harness({
    api: {
      broadcast: async (chainId, txBytes) => {
        calls.broadcast.push(txBytes);
        broadcasts += 1;
        return broadcasts === 1
          ? { chainId, txHash: "B".repeat(64), code: 32, codespace: "sdk", rawLog: "account sequence mismatch, expected 367, got 366: incorrect account sequence", success: false, updatedAt: 0 }
          : { chainId, txHash: "C".repeat(64), code: 0, codespace: "", rawLog: "", success: true, updatedAt: 0 };
      },
    },
  });
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts);
  assert.equal(result.txHash, "C".repeat(64));
  assert.deepEqual(
    calls.signAmino.map((d) => d.sequence),
    ["366", "367"],
  );
});

test("a rejection at broadcast is explained, keeps the hash for support, and is not on chain", async () => {
  const stageHashes: Array<string | undefined> = [];
  const { opts } = harness({
    api: {
      broadcast: async (chainId) => ({ chainId, txHash: "D".repeat(64), code: 13, codespace: "sdk", rawLog: "insufficient fees; got: 1uatom required: 3071uatom: insufficient fee", success: false, updatedAt: 0 }),
    },
  });
  const error = (await signAndBroadcast(
    { chainId: CHAIN.chainId, messages: [send] },
    { ...opts, onStage: (_stage, detail) => stageHashes.push(detail?.txHash) },
  ).catch((e: unknown) => e)) as TxError;
  assert.equal(error.explained.kind, "insufficient-fee");
  assert.equal(error.txHash, "D".repeat(64));
  assert.equal(error.onChain, false);
  // Progress UI never shows a hash no explorer would find.
  assert.deepEqual(stageHashes.filter(Boolean), []);
});

test("already in the mempool (the same bytes twice) is followed, not failed", async () => {
  const { calls, opts } = harness({
    api: {
      broadcast: async (chainId, txBytes) => {
        calls.broadcast.push(txBytes);
        return { chainId, txHash: "E".repeat(64), code: 19, codespace: "sdk", rawLog: "tx already in mempool", success: false, updatedAt: 0 };
      },
    },
  });
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts);
  assert.equal(result.txHash, "E".repeat(64));
  assert.equal(result.confirmed, true);
  assert.equal(calls.stages.at(-1), "success");
});

test("the signer's address goes with the broadcast and the status polls (server cache drop)", async () => {
  const seen: Array<string | undefined> = [];
  const { opts } = harness({
    api: {
      broadcast: async (chainId, _bytes, address) => {
        seen.push(address);
        return { chainId, txHash: "A".repeat(64), code: 0, codespace: "", rawLog: "", success: true, updatedAt: 0 };
      },
      getTx: async (_chainId, _hash, address) => {
        seen.push(address);
        return { status: "success", height: 1 };
      },
    },
  });
  await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts);
  assert.deepEqual(seen, [ADDRESS, ADDRESS]);
});

test("a wallet that signs with another account is stopped before broadcast, in words", async () => {
  const other = fromBase64("A8vEu/tePOxYvIxVdQbcHtE63aJ5l9ZD/Tvk4x7zi13e");
  const { calls, opts } = harness({
    signer: {
      signAmino: async (_c, _s, doc) => ({
        signed: doc,
        signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(other) }, signature: SIGNATURE },
      }),
    },
  });
  const error = (await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts).catch((e: unknown) => e)) as TxError;
  assert.match(error.message, /different account/);
  assert.equal(calls.broadcast.length, 0);
});

test("direct mode: a changed memo is accepted, changed messages are refused", async () => {
  const contract = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  const memoEdited = harness({
    signer: {
      signDirect: async (_c, _s, doc) => {
        const bodyBytes = encodeTxBody({ messages: [contract], memo: "edited in the wallet" });
        return { signed: { bodyBytes, authInfoBytes: doc.authInfoBytes }, signature: { pub_key: PUB_KEY, signature: signDirectDoc({ ...doc, bodyBytes }) } };
      },
    },
  });
  const ok = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [contract], memo: "hi" }, memoEdited.opts);
  assert.equal(ok.signMode, "direct");
  assert.equal(memoEdited.calls.broadcast.length, 1);

  const other = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { withdraw: {} } });
  const swapped = harness({
    signer: {
      signDirect: async (_c, _s, doc) => ({
        signed: { bodyBytes: encodeTxBody({ messages: [other], memo: "hi" }), authInfoBytes: doc.authInfoBytes },
        signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(PUBKEY) }, signature: SIGNATURE },
      }),
    },
  });
  await assert.rejects(signAndBroadcast({ chainId: CHAIN.chainId, messages: [contract], memo: "hi" }, swapped.opts), /different transaction/);
  assert.equal(swapped.calls.broadcast.length, 0);
});

test("included but failed: the chain's reason, with the hash, on chain", async () => {
  const { calls, opts } = harness({
    api: { getTx: async () => ({ status: "failed", code: 11, codespace: "sdk", rawLog: "out of gas in location: ReadFlat" }) },
  });
  const error = (await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts).catch((e: unknown) => e)) as TxError;
  assert.equal(error.explained.kind, "out-of-gas");
  assert.equal(error.txHash, "A".repeat(64));
  assert.equal(error.onChain, true);
  assert.equal(calls.stages.at(-1), "failed");
});

test("not seen in a block within the window: submitted, not failed", async () => {
  const { calls, opts } = harness({ api: { getTx: async () => ({ status: "pending" }) } });
  let clock = 0;
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, { ...opts, now: () => (clock += 10) });
  assert.equal(result.confirmed, false);
  assert.equal(calls.stages.at(-1), "submitted");
});

test("the user declining in the wallet is said plainly", async () => {
  const { calls, opts } = harness({ signer: { signAmino: async () => Promise.reject(new Error("Request rejected")) } });
  const error = (await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts).catch((e: unknown) => e)) as TxError;
  assert.equal(error.explained.kind, "user-rejected");
  assert.equal(calls.broadcast.length, 0);
});

test("a fixed gas limit skips simulation; Ledger signs amino", async () => {
  const { calls, opts } = harness({ signer: { ensureKey: async () => ({ address: ADDRESS, pubKey: PUBKEY, isNanoLedger: true }), capabilities: () => ({ amino: true, direct: true, ledger: true }) } });
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], gasLimit: 200_000, feeTier: "high" }, opts);
  assert.equal(calls.simulate.length, 0);
  assert.equal(result.signMode, "amino");
  assert.deepEqual(result.fee, [{ denom: "uatom", amount: "6000" }]);
});

test("preview: fee tiers before any prompt, without a key when none is shared", async () => {
  const { calls, opts } = harness();
  const preview = await previewTx({ chainId: CHAIN.chainId, messages: [send] }, { api: opts.api, chain: CHAIN, address: ADDRESS, pubKey: null });
  assert.equal(preview.gas.gasLimit, 122_824);
  assert.equal(preview.fee.display, "0.003071");
  assert.equal(preview.tiers!.high.amount[0]!.amount, "3685");
  assert.equal(preview.accountExists, true);
  // No key → the simulated signer info carries no public key.
  const auth = readProtoFields(fromBase64(calls.simulate[0]!))[1]!.value as Uint8Array;
  const signerInfo = readProtoFields(readProtoFields(auth)[0]!.value as Uint8Array);
  assert.equal(signerInfo.some((f) => f.field === 1), false);
});

test("requests are validated before anything else", async () => {
  const { opts } = harness();
  await assert.rejects(signAndBroadcast({ chainId: CHAIN.chainId, messages: [] }, opts), /Nothing to sign/);
  await assert.rejects(signAndBroadcast({ chainId: "osmosis-1", messages: [send] }, opts), /disagree/);
  await assert.rejects(signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "x".repeat(300) }, opts), /256 bytes/);
});

test("a Zunia extension that reports nothing (0.1.4 and older): a send signs direct (memo with & included), a contract call amino", async () => {
  const zunia = harness({ signer: { kind: "zunia" } });
  const sent = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "rent & food" }, zunia.opts);
  assert.equal(sent.signMode, "direct");
  assert.equal(zunia.calls.signAmino.length, 0);
  const call = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  const recovered = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [call], memo: "Recover swap output · by Zunia-wallet" }, zunia.opts);
  assert.equal(recovered.signMode, "amino");
  assert.equal(zunia.calls.signAmino[0]!.msgs[0]!.type, "wasm/MsgExecuteContract");
  // The same transactions from Keplr keep the general rule.
  const keplr = harness();
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "rent & food" }, keplr.opts)).signMode, "amino");
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [call] }, keplr.opts)).signMode, "direct");
});

test("a Zunia refusal reaches the user with the next step, and nothing is broadcast", async () => {
  const refuse = (code: string, message: string) => async () => Promise.reject(Object.assign(new Error(message), { code }));
  const cases: Array<[string, string, string, RegExp]> = [
    ["UNSUPPORTED", "Blind signing disabled for unknown messages", "wallet-unsupported", /can't sign this transaction yet\. Update Zunia to the latest version, or use Keplr or Zunia Mobile/],
    ["UNSUPPORTED", "Blind signing disabled for unknown messages: /cosmos.authz.v1beta1.MsgGrant", "wallet-unsupported", /\(it cannot read \/cosmos\.authz\.v1beta1\.MsgGrant\)/],
    ["LOCKED", "Zunia stayed locked, so the request was cancelled", "wallet-timeout", /Unlock it and try again/],
    ["USER_REJECTED", "Request expired before it was answered", "wallet-timeout", /prompt expired/],
    ["INTERNAL", "Extension context invalidated.", "wallet-disconnected", /Reload this page/],
  ];
  for (const [code, message, kind, words] of cases) {
    const { calls, opts } = harness({ signer: { kind: "zunia", signDirect: refuse(code, message) } });
    const error = (await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, opts).catch((e: unknown) => e)) as TxError;
    assert.equal(error.explained.kind, kind, code);
    assert.match(error.explained.message, words, code);
    assert.equal(calls.broadcast.length, 0, code);
  }
});

/* ------------------------------------------------- Zunia builds, by what they report */

/** What Zunia 0.1.5's provider reports (P1). */
const ZUNIA_015 = {
  version: "0.1.0",
  extensionVersion: "0.1.5",
  isZunia: true,
  features: ["sign-direct:wasm-contract-32", "sign-direct:send-32", "sign-direct:osmosis-poolmanager", "sign-direct:osmosis-exact-out", "sign-amino:escaped"],
};
/** A 32-byte account: a contract, an interchain account, a DAO treasury. */
const CONTRACT_ACCOUNT = bech32.encode("cosmos", bech32.toWords(new Uint8Array(32).fill(7)));
const sendTo32 = buildSend({ fromAddress: ADDRESS, toAddress: CONTRACT_ACCOUNT, amount: [{ denom: "uatom", amount: "1" }] });

test("Zunia 0.1.5 (it reports its build): everything signs direct, where its prompt is the decoded transaction", async () => {
  const zunia = harness({ signer: { kind: "zunia", capabilities: () => ({ amino: true, direct: true, zunia: zuniaCapabilities(ZUNIA_015) }) } });
  const call = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  const requests: Array<{ messages: (typeof send)[]; memo?: string }> = [
    { messages: [call], memo: "Recover swap output · by Zunia-wallet" },
    { messages: [send], memo: "rent & food" },
    { messages: [sendTo32] },
    { messages: [send] },
  ];
  for (const request of requests) {
    const result = await signAndBroadcast({ chainId: CHAIN.chainId, ...request }, zunia.opts);
    assert.equal(result.signMode, "direct", request.messages[0]!.typeUrl);
  }
  assert.equal(zunia.calls.signAmino.length, 0);
  assert.equal(zunia.calls.broadcast.length, requests.length);
});

test("a Zunia extension that reports nothing: a send to a 32-byte address signs amino (its direct decoder refuses it), unless it needs escaping", async () => {
  const zunia = harness({ signer: { kind: "zunia" } });
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [sendTo32] }, zunia.opts)).signMode, "amino");
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [sendTo32], memo: "a & b" }, zunia.opts)).signMode, "direct");
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, zunia.opts)).signMode, "direct");
});

/* ------------------------------------------------- the signature check before broadcast */

test("a wallet that signs amino without the chain's escaping is stopped before broadcast, in words", async () => {
  // The Zunia extension up to 0.1.4, under a policy that sends it a document with "&".
  const { calls, opts } = harness({
    signer: {
      signAmino: async (_c, _s, doc) => {
        calls.signAmino.push(doc);
        return { signed: doc, signature: { pub_key: PUB_KEY, signature: signAminoUnescaped(doc) } };
      },
    },
  });
  const error = (await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "rent & food" }, opts).catch((e: unknown) => e)) as TxError;
  assert.ok(error instanceof TxError);
  assert.equal(error.explained.kind, "signature-mismatch");
  assert.equal(error.explained.title, "Signature mismatch");
  assert.equal(error.explained.message, SIGNATURE_CHECK_FAILED);
  assert.match(error.explained.detail!, /without the chain's escaping of &, < and >/);
  assert.equal(error.explained.retryable, false);
  assert.equal(error.txHash, null);
  assert.equal(error.onChain, false);
  assert.equal(calls.signAmino.length, 1);
  assert.equal(calls.broadcast.length, 0);
  assert.ok(!calls.stages.includes("broadcasting"));
  assert.equal(calls.stages.at(-1), "failed");
  // With nothing to escape, the same wallet signs the chain's bytes: broadcast.
  const plain = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "rent" }, opts);
  assert.equal(plain.signMode, "amino");
  assert.equal(calls.broadcast.length, 1);
});

test("direct: a wallet that returns an edited memo but signed the original body is stopped before broadcast", async () => {
  const contract = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  const { calls, opts } = harness({
    signer: {
      signDirect: async (_c, _s, doc) => ({
        signed: { bodyBytes: encodeTxBody({ messages: [contract], memo: "edited in the wallet" }), authInfoBytes: doc.authInfoBytes },
        signature: { pub_key: PUB_KEY, signature: signDirectDoc(doc) },
      }),
    },
  });
  const error = (await signAndBroadcast({ chainId: CHAIN.chainId, messages: [contract], memo: "hi" }, opts).catch((e: unknown) => e)) as TxError;
  assert.equal(error.explained.kind, "signature-mismatch");
  assert.equal(error.explained.message, SIGNATURE_CHECK_FAILED);
  assert.match(error.explained.detail!, /does not verify over the transaction's sign bytes/);
  assert.equal(calls.broadcast.length, 0);
});

const INJECTIVE: FlowChain = {
  chainId: "injective-1",
  chainName: "Injective",
  coinType: 60,
  features: ["eth-address-gen", "eth-key-sign"],
  ethPubKeyTypeUrl: INJECTIVE_PUBKEY_TYPE_URL,
  feeMinimalDenom: "inj",
  feeDenom: "INJ",
  feeDecimals: 18,
  gasPriceStep: { low: 500_000_000, average: 500_000_000, high: 500_000_000 },
};

test("Ethereum-key chains: direct is checked over keccak256; amino from a Ledger (EIP-712 there) is left to the chain", async () => {
  const account = { pubKey: { typeUrl: INJECTIVE_PUBKEY_TYPE_URL, key: toBase64(PUBKEY) } };
  const contract = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  const wallet = (digest: (b: Uint8Array) => Uint8Array) =>
    harness({
      chain: INJECTIVE,
      account,
      signer: {
        signDirect: async (_c, _s, doc) => ({
          signed: { bodyBytes: doc.bodyBytes, authInfoBytes: doc.authInfoBytes },
          signature: { pub_key: PUB_KEY, signature: signDirectDoc(doc, digest) },
        }),
      },
    });
  const keccak = wallet(keccak_256);
  assert.equal((await signAndBroadcast({ chainId: INJECTIVE.chainId, messages: [contract] }, keccak.opts)).signMode, "direct");
  assert.equal(keccak.calls.broadcast.length, 1);

  // A wallet that hashed with SHA-256 where the chain checks keccak256.
  const sha = wallet(sha256);
  const error = (await signAndBroadcast({ chainId: INJECTIVE.chainId, messages: [contract] }, sha.opts).catch((e: unknown) => e)) as TxError;
  assert.equal(error.explained.kind, "signature-mismatch");
  assert.match(error.explained.detail!, /SHA-256 digest; the chain checks keccak256/);
  assert.equal(sha.calls.broadcast.length, 0);

  // A Ledger signs amino there, and what it signs (EIP-712) only the chain rebuilds.
  const ledger = harness({
    chain: INJECTIVE,
    account,
    signer: {
      ensureKey: async () => ({ address: ADDRESS, pubKey: PUBKEY, isNanoLedger: true }),
      capabilities: () => ({ amino: true, direct: true, ledger: true }),
      signAmino: async (_c, _s, doc) => ({
        signed: doc,
        signature: { pub_key: PUB_KEY, signature: signBytes(new TextEncoder().encode("an EIP-712 digest stand-in"), keccak_256) },
      }),
    },
  });
  assert.equal((await signAndBroadcast({ chainId: INJECTIVE.chainId, messages: [send] }, ledger.opts)).signMode, "amino");
  assert.equal(ledger.calls.broadcast.length, 1);
});

test("a key that is not a compressed secp256k1 point is left to the chain", async () => {
  const odd = PUBKEY.slice();
  odd[0] = 0x05;
  const contract = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  const { calls, opts } = harness({
    signer: {
      ensureKey: async () => ({ address: ADDRESS, pubKey: odd }),
      signDirect: async (_c, _s, doc) => ({
        signed: { bodyBytes: doc.bodyBytes, authInfoBytes: doc.authInfoBytes },
        signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(odd) }, signature: SIGNATURE },
      }),
    },
  });
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [contract] }, opts)).signMode, "direct");
  assert.equal(calls.broadcast.length, 1);
});

/* ------------------------------------------------- memos the signature would not survive */

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const HIGH_SURROGATE = String.fromCharCode(0xd83d);
const LOW_SURROGATE = String.fromCharCode(0xde80);

test("a memo with a line separator or half a character is refused before the wallet is asked, in words", async () => {
  for (const memo of [
    `rent${LINE_SEPARATOR}food`,
    `rent${PARAGRAPH_SEPARATOR}food`,
    `rent ${HIGH_SURROGATE}`,
    `${LOW_SURROGATE} rent`,
    `${HIGH_SURROGATE}${HIGH_SURROGATE}${LOW_SURROGATE}`,
  ]) {
    const { calls, opts } = harness();
    const error = (await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo }, opts).catch((e: unknown) => e)) as TxError;
    assert.ok(error instanceof TxError, JSON.stringify(memo));
    assert.equal(error.explained.message, memoProblem(memo));
    assert.equal(calls.simulate.length + calls.signAmino.length + calls.signDirect.length + calls.broadcast.length, 0);
  }
  assert.match(memoProblem(`rent${LINE_SEPARATOR}food`)!, /invisible line separator.*Clear the memo and type it again/);
  assert.match(memoProblem(`rent ${HIGH_SURROGATE}`)!, /broken character.*Clear the memo and type it again/);
  // Whole characters are fine, & < > included: the chain's escaping covers those.
  for (const memo of [undefined, "", "rent & food <3>", `rocket ${HIGH_SURROGATE}${LOW_SURROGATE}`, "Recover swap output · by Zunia-wallet"]) {
    assert.equal(memoProblem(memo), null, JSON.stringify(memo));
  }
  // The fee is still measured: only the signature would not survive such a memo.
  const { opts } = harness();
  const preview = await previewTx(
    { chainId: CHAIN.chainId, messages: [send], memo: `rent${LINE_SEPARATOR}food` },
    { api: opts.api, chain: CHAIN, address: ADDRESS, pubKey: PUBKEY },
  );
  assert.equal(preview.gas.method, "simulated");
});

/* ------------------------------------------------- the default memo, end to end */

/** The memo inside a TxRaw (or a simulation tx): body (field 1), then its field 2. */
function memoInTx(base64: string): string {
  return memoInBody(txRawParts(base64).body);
}

function memoInBody(body: Uint8Array): string {
  const field = readProtoFields(body).find((f) => f.field === 2);
  return field ? new TextDecoder().decode(field.value as Uint8Array) : "";
}

const TAG = ` - ${ZUNIA_DASHBOARD_TAG}`;
const VALOPER = bech32.encode("cosmosvaloper", bech32.toWords(new Uint8Array(20).fill(9)));

test("an empty memo signs Zunia's default: the one string the plan, the simulation, the signature and the broadcast carry (amino)", async () => {
  const { calls, opts } = harness();
  const req = { chainId: CHAIN.chainId, messages: [send] };
  const plan = await planTx(req, opts);
  assert.equal(plan.memo, `Send ATOM${TAG}`);
  assert.equal(plan.mode, "amino");
  assert.equal(memoInTx(calls.simulate[0]!), `Send ATOM${TAG}`);

  const result = await signAndBroadcast(req, opts);
  assert.equal(result.signMode, "amino");
  assert.equal(calls.signAmino[0]!.memo, `Send ATOM${TAG}`);
  assert.equal(memoInTx(calls.simulate.at(-1)!), `Send ATOM${TAG}`);
  assert.equal(memoInTx(calls.broadcast[0]!), `Send ATOM${TAG}`);
  // The request is not rewritten: the memo is the flow's, the caller's object stays as it was.
  assert.equal("memo" in req, false);
});

test("an empty memo signs Zunia's default in direct mode too, and the signature over it verifies", async () => {
  const { calls, opts } = harness();
  const vote = buildVote({ proposalId: "42", voter: ADDRESS, option: "veto" });
  const result = await signAndBroadcast({ chainId: CHAIN.chainId, messages: [vote], signMode: "direct" }, opts);
  assert.equal(result.signMode, "direct");
  assert.equal(memoInBody(calls.signDirect[0]!.bodyBytes), `Vote No with veto on proposal 42${TAG}`);
  assert.equal(memoInTx(calls.simulate[0]!), `Vote No with veto on proposal 42${TAG}`);
  assert.equal(memoInTx(calls.broadcast[0]!), `Vote No with veto on proposal 42${TAG}`);
  assert.equal(calls.broadcast.length, 1);
});

test("a memo the user wrote is signed as written, trimmed, never suffixed", async () => {
  const { calls, opts } = harness();
  await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "  rent & food  " }, opts);
  assert.equal(calls.signAmino[0]!.memo, "rent & food");
  assert.equal(memoInTx(calls.simulate[0]!), "rent & food");
  assert.equal(memoInTx(calls.broadcast[0]!), "rent & food");
  // Only spaces is no memo: the default is signed.
  const blank = harness();
  await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send], memo: "   " }, blank.opts);
  assert.equal(blank.calls.signAmino[0]!.memo, `Send ATOM${TAG}`);
  assert.equal(memoInTx(blank.calls.broadcast[0]!), `Send ATOM${TAG}`);
});

test("the default is named from the request's context: the token the page shows, the chain it goes to", async () => {
  const { calls, opts } = harness();
  const delegate = buildDelegate({ delegatorAddress: ADDRESS, validatorAddress: VALOPER, amount: { denom: "uatom", amount: "1" } });
  await signAndBroadcast({ chainId: CHAIN.chainId, messages: [delegate] }, opts);
  assert.equal(memoInTx(calls.broadcast[0]!), `Stake ATOM${TAG}`);
  const voucher = "ibc/14F9BC3E44B8A9C1BE1FB08980FAB87034C9905EF17CF2F5008FC085218811CC";
  const sendVoucher = buildSend({ fromAddress: ADDRESS, toAddress: ADDRESS, amount: [{ denom: voucher, amount: "1" }] });
  const named = harness();
  await signAndBroadcast(
    { chainId: CHAIN.chainId, messages: [sendVoucher], memoContext: { tokens: [{ chainId: CHAIN.chainId, denom: voucher, ticker: "OSMO", proven: true }] } },
    named.opts,
  );
  assert.equal(memoInTx(named.calls.broadcast[0]!), `Send OSMO${TAG}`);
  // The same voucher with nothing to prove it reads "Send".
  const unnamed = harness();
  await signAndBroadcast({ chainId: CHAIN.chainId, messages: [sendVoucher] }, unnamed.opts);
  assert.equal(memoInTx(unnamed.calls.broadcast[0]!), `Send${TAG}`);
  // An IBC transfer names where it goes; its packet memo is the message's, untouched.
  const osmo = bech32.encode("osmo", bech32.toWords(new Uint8Array(20).fill(7)));
  const ibc = buildTransfer({ sourceChannel: "channel-141", token: { denom: "uatom", amount: "1" }, sender: ADDRESS, receiver: osmo, memo: "deposit 104857" });
  const before = toHex(ibc.value);
  const moved = harness();
  await signAndBroadcast({ chainId: CHAIN.chainId, messages: [ibc], memoContext: { destinationChainId: "osmosis-1" } }, moved.opts);
  assert.equal(memoInTx(moved.calls.broadcast[0]!), `IBC transfer of ATOM to Osmosis${TAG}`);
  assert.equal(moved.calls.signAmino[0]!.msgs[0]!.value.memo, "deposit 104857");
  assert.equal(toHex(ibc.value), before);
});

test("a default memo leaves the sign-mode policy where it was: Ledger, Zunia 0.1.4 and 0.1.5 sign as before", async () => {
  // A Ledger signs amino, the default memo included, and the signature verifies before broadcast.
  const ledger = harness({ signer: { ensureKey: async () => ({ address: ADDRESS, pubKey: PUBKEY, isNanoLedger: true }), capabilities: () => ({ amino: true, direct: true, ledger: true }) } });
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [send] }, ledger.opts)).signMode, "amino");
  assert.match(ledger.calls.signAmino[0]!.memo, /^[\x20-\x7e]+$/);
  assert.equal(memoInTx(ledger.calls.broadcast[0]!), `Send ATOM${TAG}`);
  // Zunia up to 0.1.4: a contract call and a send to a 32-byte address still sign amino (nothing to escape in the default).
  const zunia = harness({ signer: { kind: "zunia" } });
  const call = buildExecuteContract({ sender: ADDRESS, contract: ADDRESS, msg: { recover: {} } });
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [call] }, zunia.opts)).signMode, "amino");
  assert.equal(zunia.calls.signAmino[0]!.memo, `Recover swap${TAG}`);
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [sendTo32] }, zunia.opts)).signMode, "amino");
  assert.equal(zunia.calls.signAmino[1]!.memo, `Send ATOM${TAG}`);
  // Zunia 0.1.5: direct for everything.
  const current = harness({ signer: { kind: "zunia", capabilities: () => ({ amino: true, direct: true, zunia: zuniaCapabilities(ZUNIA_015) }) } });
  assert.equal((await signAndBroadcast({ chainId: CHAIN.chainId, messages: [call] }, current.opts)).signMode, "direct");
  assert.equal(memoInBody(current.calls.signDirect[0]!.bodyBytes), `Recover swap${TAG}`);
});

test("the fee preview measures the transaction with the memo it will sign", async () => {
  const { calls, opts } = harness();
  await previewTx({ chainId: CHAIN.chainId, messages: [send] }, { api: opts.api, chain: CHAIN, address: ADDRESS, pubKey: PUBKEY });
  assert.equal(memoInTx(calls.simulate[0]!), `Send ATOM${TAG}`);
  await previewTx({ chainId: CHAIN.chainId, messages: [send], memo: " mine " }, { api: opts.api, chain: CHAIN, address: ADDRESS, pubKey: PUBKEY });
  assert.equal(memoInTx(calls.simulate[1]!), "mine");
});
