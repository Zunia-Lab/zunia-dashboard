/**
 * Direct mode, pinned byte for byte to CosmJS: `TxBody`, `AuthInfo` and the
 * `SignDoc` a wallet signs, for all thirteen zunia-core vectors.
 *
 * The ten message types this app builds go through its own builders
 * (`messages.ts`); the three Osmosis poolmanager swaps take their message
 * bytes from the vector (osmojs encoded them; `osmosis.ts` owns those
 * builders), so the envelope around them — the part this file owns — is still
 * what is tested. A disagreement anywhere is an "unauthorized" on chain.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { assembleAminoTxRaw, makeStdSignDoc, type VoteOption } from "../amino-tx";
import { fromHex, toHex } from "../bytes";
import {
  COSMOS_PUBKEY_TYPE_URL,
  SIGN_MODE_DIRECT,
  encodeAuthInfo,
  encodePubKeyAny,
  encodeSignDoc,
  encodeTxBody,
  encodeTxRaw,
} from "../encode";
import {
  buildDelegate,
  buildExecuteContract,
  buildRedelegate,
  buildSend,
  buildTransfer,
  buildUndelegate,
  buildVote,
  buildWithdrawReward,
} from "../messages";
import { readProtoFields } from "../proto";
import type { TxMessage } from "../types";

const VECTORS = join(import.meta.dirname, "vectors/cosmos-signing.json");

type Case = {
  name: string;
  type_url: string;
  memo: string;
  amino: { sign_doc: string };
  direct: { msg_proto_hex: string; body_bytes_hex: string; auth_info_bytes_hex: string; sign_bytes_hex: string };
};

const file = JSON.parse(readFileSync(VECTORS, "utf8")) as {
  key: { pubkey_compressed_hex: string };
  signer: { chain_id: string; account_number: number; sequence: number; fee: { amount: { denom: string; amount: string }[]; gas: string } };
  cases: Case[];
};

const OPTIONS: Record<string, VoteOption> = {
  VOTE_OPTION_YES: "yes",
  VOTE_OPTION_NO: "no",
  VOTE_OPTION_NO_WITH_VETO: "veto",
  VOTE_OPTION_ABSTAIN: "abstain",
};

type V = Record<string, string & { denom: string; amount: string } & Array<{ denom: string; amount: string }> & Record<string, unknown>>;

/** The vector's message through this app's builders; null for the Osmosis swaps. */
function build(name: string, v: V): TxMessage | null {
  switch (name) {
    case "msg_send":
    case "msg_send_with_memo":
      return buildSend({ fromAddress: v.from_address, toAddress: v.to_address, amount: v.amount });
    case "msg_delegate":
      return buildDelegate({ delegatorAddress: v.delegator_address, validatorAddress: v.validator_address, amount: v.amount });
    case "msg_undelegate":
      return buildUndelegate({ delegatorAddress: v.delegator_address, validatorAddress: v.validator_address, amount: v.amount });
    case "msg_begin_redelegate":
      return buildRedelegate({
        delegatorAddress: v.delegator_address,
        validatorSrcAddress: v.validator_src_address,
        validatorDstAddress: v.validator_dst_address,
        amount: v.amount,
      });
    case "msg_withdraw_delegator_reward":
      return buildWithdrawReward({ delegatorAddress: v.delegator_address, validatorAddress: v.validator_address });
    case "msg_vote":
      return buildVote({ proposalId: v.proposal_id, voter: v.voter, option: OPTIONS[v.option]! });
    case "msg_transfer_no_timeout":
      // No timeout at all is not something buildTransfer produces (it always
      // sets one); "0" spells the vector's absent timestamp exactly.
      return buildTransfer({
        sourcePort: v.source_port,
        sourceChannel: v.source_channel,
        token: v.token,
        sender: v.sender,
        receiver: v.receiver,
        timeoutTimestamp: "0",
      });
    case "msg_transfer_with_timeout":
      return buildTransfer({
        sourcePort: v.source_port,
        sourceChannel: v.source_channel,
        token: v.token,
        sender: v.sender,
        receiver: v.receiver,
        timeoutTimestamp: v.timeout_timestamp,
        timeoutHeight: v.timeout_height as unknown as { revision_number: string; revision_height: string },
        memo: v.memo,
      });
    case "msg_execute_contract":
      return buildExecuteContract({
        sender: v.sender,
        contract: v.contract,
        msg: v.msg as Record<string, unknown>,
        funds: v.funds as unknown as Array<{ denom: string; amount: string }>,
      });
    default:
      return null;
  }
}

const pubKey = fromHex(file.key.pubkey_compressed_hex);
const { signer } = file;
let ownBuilders = 0;

for (const c of file.cases) {
  const doc = JSON.parse(c.amino.sign_doc) as { msgs: { value: V }[] };
  const built = build(c.name, doc.msgs[0]!.value);
  if (built) ownBuilders += 1;
  const message: TxMessage = built ?? { typeUrl: c.type_url, value: fromHex(c.direct.msg_proto_hex) };

  const bodyBytes = encodeTxBody({ messages: [message], memo: c.memo });
  const authInfoBytes = encodeAuthInfo({
    signers: [{ publicKey: encodePubKeyAny(pubKey, COSMOS_PUBKEY_TYPE_URL), mode: SIGN_MODE_DIRECT, sequence: signer.sequence }],
    fee: { amount: signer.fee.amount, gasLimit: signer.fee.gas },
  });

  test(`${c.name}: message, body, auth info and sign doc match CosmJS`, () => {
    assert.equal(message.typeUrl, c.type_url);
    assert.equal(toHex(message.value), c.direct.msg_proto_hex);
    assert.equal(toHex(bodyBytes), c.direct.body_bytes_hex);
    assert.equal(toHex(authInfoBytes), c.direct.auth_info_bytes_hex);
    const signBytes = encodeSignDoc({
      bodyBytes,
      authInfoBytes,
      chainId: signer.chain_id,
      accountNumber: signer.account_number,
    });
    assert.equal(toHex(signBytes), c.direct.sign_bytes_hex);
  });
}

test("ten of the thirteen vectors went through this app's own builders", () => {
  assert.equal(ownBuilders, 10);
});

test("a TxRaw carries the signed body and auth info unchanged, then the signature", () => {
  const c = file.cases[0]!;
  const body = fromHex(c.direct.body_bytes_hex);
  const auth = fromHex(c.direct.auth_info_bytes_hex);
  const signature = new Uint8Array(64).fill(9);
  const raw = encodeTxRaw({ bodyBytes: body, authInfoBytes: auth, signatures: [signature] });
  const fields = readProtoFields(raw);
  assert.deepEqual(
    fields.map((f) => f.field),
    [1, 2, 3],
  );
  assert.equal(toHex(fields[0]!.value as Uint8Array), c.direct.body_bytes_hex);
  assert.equal(toHex(fields[1]!.value as Uint8Array), c.direct.auth_info_bytes_hex);
  assert.equal(toHex(fields[2]!.value as Uint8Array), toHex(signature));
});

test("amino assembly reuses the direct body and changes only the sign mode", () => {
  const c = file.cases.find((x) => x.name === "msg_send")!;
  const message = build(c.name, (JSON.parse(c.amino.sign_doc) as { msgs: { value: V }[] }).msgs[0]!.value)!;
  const stdDoc = makeStdSignDoc({
    chainId: signer.chain_id,
    accountNumber: String(signer.account_number),
    sequence: String(signer.sequence),
    fee: signer.fee,
    msgs: [message.amino!],
  });
  const raw = assembleAminoTxRaw({ signDoc: stdDoc, pubKey, signature: new Uint8Array(64), pubKeyTypeUrl: COSMOS_PUBKEY_TYPE_URL });
  const [body, auth] = readProtoFields(raw);
  assert.equal(toHex(body!.value as Uint8Array), c.direct.body_bytes_hex);
  const expectedAuth = encodeAuthInfo({
    signers: [{ publicKey: encodePubKeyAny(pubKey), mode: 127, sequence: signer.sequence }],
    fee: { amount: signer.fee.amount, gasLimit: signer.fee.gas },
  });
  assert.equal(toHex(auth!.value as Uint8Array), toHex(expectedAuth));
  // Direct and amino auth info differ in exactly the mode varint (0x01 → 0x7f).
  assert.equal(c.direct.auth_info_bytes_hex.replace("0a020801", "0a02087f"), toHex(expectedAuth));
});
