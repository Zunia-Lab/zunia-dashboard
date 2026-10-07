/**
 * The sign flow end to end, with a fake wallet and fake routes: what is
 * simulated, what is signed, what is broadcast, what the user is told.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { toBase64, fromBase64, toHex } from "../bytes";
import { SimulationRefused, type AccountInfo, type BroadcastAnswer } from "../client";
import { decodeAuthInfoFee, encodeAuthInfo, encodePubKeyAny, encodeTxBody, SIGN_MODE_DIRECT } from "../encode";
import { TxError } from "../errors";
import { planTx, previewTx, signAndBroadcast, type FlowChain, type FlowOptions, type TxApi, type TxSigner } from "../flow";
import { buildExecuteContract, buildSend } from "../messages";
import { readProtoFields } from "../proto";
import type { SignStage, TxOutcome } from "../types";
import type { StdSignDoc } from "../amino-tx";

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
const ADDRESS = "cosmos1q6d3d089hg59x6gcx92uumx70s5y5wadntgvtr";
const PUBKEY = fromBase64("A0vr/+IDH9PVhfT1ZI+UcpISMJGty7jNgwndXX4/VAp0");
const SIGNATURE = toBase64(new Uint8Array(64).fill(5));
const send = buildSend({ fromAddress: ADDRESS, toAddress: ADDRESS, amount: [{ denom: "uatom", amount: "1" }] });

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
} = {}) {
  const calls: Calls = { simulate: [], broadcast: [], signAmino: [], signDirect: [], stages: [] };
  const account: AccountInfo = {
    chainId: CHAIN.chainId,
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
  const signer: TxSigner = {
    kind: "keplr",
    capabilities: () => ({ amino: true, direct: true }),
    ensureKey: async () => ({ address: ADDRESS, pubKey: PUBKEY }),
    signAmino: async (_chainId, _signer, doc) => {
      calls.signAmino.push(doc);
      return { signed: doc, signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(PUBKEY) }, signature: SIGNATURE } };
    },
    signDirect: async (_chainId, _signer, doc) => {
      calls.signDirect.push(doc);
      return { signed: { bodyBytes: doc.bodyBytes, authInfoBytes: doc.authInfoBytes }, signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(PUBKEY) }, signature: SIGNATURE } };
    },
    ...overrides.signer,
  };
  const opts: FlowOptions = {
    signer,
    api,
    chain: CHAIN,
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
  assert.equal(toHex(parts.sig), "05".repeat(64));
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
          signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(PUBKEY) }, signature: SIGNATURE },
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
      signDirect: async (_c, _s, doc) => ({
        signed: { bodyBytes: encodeTxBody({ messages: [contract], memo: "edited in the wallet" }), authInfoBytes: doc.authInfoBytes },
        signature: { pub_key: { type: "tendermint/PubKeySecp256k1", value: toBase64(PUBKEY) }, signature: SIGNATURE },
      }),
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
