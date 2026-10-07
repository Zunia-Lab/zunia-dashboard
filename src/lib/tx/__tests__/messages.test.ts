/** Message builders: both encodings from one description, and the pieces the vectors do not cover. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { toHex } from "../bytes";
import { decodeAuthInfoFee, encodeAuthInfo, encodePubKeyAny, encodeSimulationTx, normalizeSignature } from "../encode";
import { buildTransfer, buildVote, isStandardMessage, messageKind, txMessageFromAmino } from "../messages";
import { msgSend } from "../amino-tx";
import { readProtoFields } from "../proto";

const utf8 = (s: string) => toHex(new TextEncoder().encode(s));

test("gov v1 vote: proto field by field, and the v1 amino name", () => {
  const v1 = buildVote({ proposalId: "848", voter: "cosmos1abc", option: "veto", govVersion: "v1", metadata: "x" });
  assert.equal(v1.typeUrl, "/cosmos.gov.v1.MsgVote");
  assert.equal(v1.amino?.type, "cosmos-sdk/v1/MsgVote");
  // 08 d006 (proposal 848) · 12 0a "cosmos1abc" · 18 04 (veto) · 22 01 "x"
  assert.equal(toHex(v1.value), `08d006120a${utf8("cosmos1abc")}1804` + `2201${utf8("x")}`);
  const beta = buildVote({ proposalId: "848", voter: "cosmos1abc", option: "veto" });
  assert.equal(beta.typeUrl, "/cosmos.gov.v1beta1.MsgVote");
  assert.equal(toHex(beta.value), `08d006120a${utf8("cosmos1abc")}1804`);
  assert.throws(() => buildVote({ proposalId: "12a", voter: "x", option: "yes" }), /positive integer/);
});

test("a transfer always carries a timeout, about ten minutes ahead by default", () => {
  const before = BigInt(Date.now()) * BigInt(1_000_000);
  const t = buildTransfer({ sourceChannel: "channel-141", token: { denom: "uatom", amount: "5" }, sender: "cosmos1a", receiver: "osmo1b", memo: "m" });
  const ts = BigInt(t.amino!.value.timeout_timestamp as string);
  const tenMinutes = BigInt(600) * BigInt(1_000_000_000);
  assert.ok(ts >= before + tenMinutes && ts < before + tenMinutes + BigInt(60) * BigInt(1_000_000_000));
  assert.deepEqual(t.amino!.value.timeout_height, {});
  assert.equal(t.amino!.value.memo, "m");
  assert.throws(() => buildTransfer({ sourceChannel: "141", token: { denom: "u", amount: "1" }, sender: "a", receiver: "b" }), /channel-/);
});

test("summaries say what the message does", () => {
  const t = txMessageFromAmino(msgSend({ fromAddress: "cosmos1a", toAddress: "cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqzzzzzz", amount: [{ denom: "uatom", amount: "7" }] }), "custom");
  assert.equal(t.summary, "custom");
  assert.match(buildVote({ proposalId: "3", voter: "a", option: "abstain" }).summary!, /Vote Abstain on proposal #3/);
});

test("standard vs non-standard, and kinds for fallback gas", () => {
  assert.equal(isStandardMessage({ typeUrl: "/cosmos.bank.v1beta1.MsgSend" }), true);
  assert.equal(isStandardMessage({ typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract" }), false);
  assert.equal(messageKind({ typeUrl: "/osmosis.poolmanager.v1beta1.MsgSplitRouteSwapExactAmountIn" }), "swap");
  assert.equal(messageKind({ typeUrl: "/cosmos.gov.v1.MsgVote" }), "vote");
  assert.equal(messageKind({ typeUrl: "/foo.Bar" }), "other");
});

test("simulation tx: real body, unspecified mode, empty fee present, one empty signature", () => {
  const msg = txMessageFromAmino(msgSend({ fromAddress: "cosmos1a", toAddress: "cosmos1b", amount: [{ denom: "uatom", amount: "1" }] }));
  const pk = new Uint8Array(33).fill(2);
  const raw = encodeSimulationTx({ messages: [msg], memo: "hi", publicKeyAny: encodePubKeyAny(pk), sequence: 7 });
  const [body, auth, sig] = readProtoFields(raw);
  assert.equal(sig!.field, 3);
  assert.equal((sig!.value as Uint8Array).length, 0); // written even though empty
  assert.ok(toHex(raw).endsWith("1a00"));
  const authFields = readProtoFields(auth!.value as Uint8Array);
  const fee = authFields.find((f) => f.field === 2);
  assert.ok(fee, "an empty Fee is still present (a missing one is 'missing fee')");
  assert.equal((fee!.value as Uint8Array).length, 0);
  const signerInfo = readProtoFields(authFields[0]!.value as Uint8Array);
  const modeInfo = readProtoFields(signerInfo.find((f) => f.field === 2)!.value as Uint8Array);
  assert.equal(toHex(modeInfo[0]!.value as Uint8Array), ""); // single {} = SIGN_MODE_UNSPECIFIED
  assert.ok(body);
  // Without a known key the signer info simply has no public key.
  const keyless = encodeSimulationTx({ messages: [msg], publicKeyAny: null, sequence: 0 });
  const keylessSigner = readProtoFields(readProtoFields(readProtoFields(keyless)[1]!.value as Uint8Array)[0]!.value as Uint8Array);
  assert.equal(keylessSigner.some((f) => f.field === 1), false);
});

test("the fee a wallet actually signed is read back from the auth info", () => {
  const auth = encodeAuthInfo({
    signers: [{ publicKey: encodePubKeyAny(new Uint8Array(33).fill(3)), mode: 1, sequence: 9 }],
    fee: { amount: [{ denom: "uosmo", amount: "12345" }], gasLimit: 250_000 },
  });
  assert.deepEqual(decodeAuthInfoFee(auth), { amount: [{ denom: "uosmo", amount: "12345" }], gasLimit: "250000" });
  assert.equal(decodeAuthInfoFee(new Uint8Array([0xff])), null);
});

test("signatures: 64 bytes, a recovery byte dropped, anything else refused", () => {
  assert.equal(normalizeSignature(new Uint8Array(65)).length, 64);
  assert.equal(normalizeSignature(new Uint8Array(64)).length, 64);
  assert.throws(() => normalizeSignature(new Uint8Array(70)));
  assert.throws(() => encodePubKeyAny(new Uint8Array(65)), /33-byte/);
});
