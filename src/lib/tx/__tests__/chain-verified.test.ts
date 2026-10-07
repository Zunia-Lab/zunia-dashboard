/**
 * The amino builders rebuild sign documents the chain actually accepted.
 *
 * Reference libraries and hand-written vectors can agree with each other and
 * still be wrong about the chain: zunia-core's vectors spell `MsgVote.option`
 * as `"VOTE_OPTION_NO"` and leave `timeout_height` out of a timestamp-only
 * `MsgTransfer`, and amino documents built that way verify against nothing on
 * cosmoshub-4. The fixtures here are real amino-signed Hub transactions; each
 * one's sign bytes were checked against its on-chain secp256k1 signature when
 * the fixture was generated, so matching them byte for byte means the chain
 * will verify what this app asks a wallet to sign.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { makeStdSignDoc, msgIbcTransfer, msgVote, signDocBytes, type AminoMsg, type VoteOption } from "../amino-tx";
import { toHex } from "../bytes";

type Message = Record<string, string & Record<string, string>>;
type Case = {
  name: string;
  txHash: string;
  chainId: string;
  accountNumber: string;
  sequence: string;
  fee: { amount: { denom: string; amount: string }[]; gas: string; payer?: string; granter?: string };
  memo: string;
  /** The transaction's block-height timeout ("0" when none): part of the amino document when set. */
  timeoutHeight: string;
  message: Message;
  signBytesHex: string;
};

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/chain-verified-amino.json"), "utf8")) as {
  cases: Case[];
};

const OPTIONS: Record<string, VoteOption> = {
  VOTE_OPTION_YES: "yes",
  VOTE_OPTION_NO: "no",
  VOTE_OPTION_NO_WITH_VETO: "veto",
  VOTE_OPTION_ABSTAIN: "abstain",
};

function build(message: Message): AminoMsg {
  switch (message["@type"]) {
    case "/cosmos.gov.v1beta1.MsgVote":
      return msgVote({ proposalId: message.proposal_id, voter: message.voter, option: OPTIONS[message.option]! });
    case "/ibc.applications.transfer.v1.MsgTransfer":
      return msgIbcTransfer({
        sourcePort: message.source_port,
        sourceChannel: message.source_channel,
        token: message.token as unknown as { denom: string; amount: string },
        sender: message.sender,
        receiver: message.receiver,
        timeoutTimestamp: message.timeout_timestamp,
        timeoutHeight: message.timeout_height as unknown as { revision_number: string; revision_height: string },
        memo: message.memo,
      });
    default:
      throw new Error(`No builder for ${message["@type"]}`);
  }
}

for (const c of fixture.cases) {
  test(`${c.name} (${c.txHash.slice(0, 10)}…): rebuilt sign bytes are the ones the chain verified`, () => {
    const doc = makeStdSignDoc({
      chainId: c.chainId,
      accountNumber: c.accountNumber,
      sequence: c.sequence,
      fee: c.fee,
      msgs: [build(c.message)],
      memo: c.memo,
      timeoutHeight: c.timeoutHeight,
    });
    assert.equal(toHex(signDocBytes(doc)), c.signBytesHex);
  });
}

test("the fixture covers votes and every transfer timeout shape", () => {
  const names = fixture.cases.map((c) => c.name);
  assert.ok(names.some((n) => n.startsWith("vote_")), "a vote");
  assert.ok(names.includes("transfer_timestamp_only_with_memo"), "timestamp-only transfer with memo");
  assert.ok(names.includes("transfer_timestamp_only_no_memo"), "timestamp-only transfer without memo");
  assert.ok(names.includes("transfer_height_and_timestamp"), "height + timestamp transfer");
  assert.ok(fixture.cases.some((c) => c.timeoutHeight !== "0"), "a transaction-level timeout height");
});

test("vote option is the enum number and a timestamp-only transfer carries timeout_height {}", () => {
  const vote = msgVote({ proposalId: "1", voter: "cosmos1x", option: "veto" });
  assert.equal(vote.value.option, 4);
  const transfer = msgIbcTransfer({
    sourceChannel: "channel-0",
    token: { denom: "uatom", amount: "1" },
    sender: "cosmos1a",
    receiver: "osmo1b",
    timeoutTimestamp: "1700000000000000000",
  });
  assert.deepEqual(transfer.value.timeout_height, {});
  assert.equal("memo" in transfer.value, false);
});
