/**
 * The security fixes sign exactly the messages the SDK expects: field
 * numbers and order pinned against a hand-built encoding, the amino names
 * the SDK registers (including MsgModifyWithdrawAddress), and the grant key
 * of every typed authorization. A grant whose key is unknown is never given
 * a guessed revoke.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuthzGrantRow } from "@/lib/chain/types";
import { toHex } from "@/lib/tx/bytes";
import { readProtoFields } from "@/lib/tx/proto";

import {
  MSG_REVOKE,
  MSG_REVOKE_ALLOWANCE,
  MSG_SET_WITHDRAW_ADDRESS,
  buildRevokeAllowance,
  buildRevokeGrant,
  buildSetWithdrawAddress,
  revokeAllMessages,
  revokeTypeUrl,
} from "../revoke";

/** Length-delimited string fields, written by hand (every value here is under 128 bytes). */
function handEncoded(fields: readonly string[]): string {
  const out: number[] = [];
  fields.forEach((text, index) => {
    const bytes = [...new TextEncoder().encode(text)];
    assert.ok(bytes.length < 128, "single-byte length in this helper");
    out.push(((index + 1) << 3) | 2, bytes.length, ...bytes);
  });
  return toHex(new Uint8Array(out));
}

const GRANTER = "cosmos1tflk30mq5vgqjdly92kkhhq3raev2hnzldd74z";
const GRANTEE = "cosmos1h8zfr3ffkpe94adnqzktelzg2ajasa4ucpx39r";

test("MsgRevoke: granter, grantee, msg_type_url as fields 1–3, and its amino form", () => {
  const msg = buildRevokeGrant({ granter: GRANTER, grantee: GRANTEE, msgTypeUrl: "/cosmos.gov.v1.MsgVote" });
  assert.equal(msg.typeUrl, MSG_REVOKE);
  assert.equal(toHex(msg.value), handEncoded([GRANTER, GRANTEE, "/cosmos.gov.v1.MsgVote"]));
  assert.deepEqual(msg.amino, {
    type: "cosmos-sdk/MsgRevoke",
    value: { granter: GRANTER, grantee: GRANTEE, msg_type_url: "/cosmos.gov.v1.MsgVote" },
  });
  const fields = readProtoFields(msg.value);
  assert.deepEqual(
    fields.map((field) => field.field),
    [1, 2, 3],
  );
});

test("MsgRevoke refuses what the chain would refuse", () => {
  assert.throws(() => buildRevokeGrant({ granter: GRANTER, grantee: GRANTEE, msgTypeUrl: "" }));
  assert.throws(() => buildRevokeGrant({ granter: GRANTER, grantee: GRANTEE, msgTypeUrl: "cosmos.gov.v1.MsgVote" }));
  assert.throws(() => buildRevokeGrant({ granter: GRANTER, grantee: GRANTER, msgTypeUrl: "/cosmos.gov.v1.MsgVote" }));
});

test("MsgRevokeAllowance: granter and grantee, amino cosmos-sdk/MsgRevokeAllowance", () => {
  const msg = buildRevokeAllowance({ granter: GRANTER, grantee: GRANTEE });
  assert.equal(msg.typeUrl, MSG_REVOKE_ALLOWANCE);
  assert.equal(toHex(msg.value), handEncoded([GRANTER, GRANTEE]));
  assert.deepEqual(msg.amino, { type: "cosmos-sdk/MsgRevokeAllowance", value: { granter: GRANTER, grantee: GRANTEE } });
});

test("MsgSetWithdrawAddress signs as cosmos-sdk/MsgModifyWithdrawAddress", () => {
  const msg = buildSetWithdrawAddress({ delegator: GRANTER, withdrawAddress: GRANTER });
  assert.equal(msg.typeUrl, MSG_SET_WITHDRAW_ADDRESS);
  assert.equal(toHex(msg.value), handEncoded([GRANTER, GRANTER]));
  assert.deepEqual(msg.amino, {
    type: "cosmos-sdk/MsgModifyWithdrawAddress",
    value: { delegator_address: GRANTER, withdraw_address: GRANTER },
  });
});

function grant(extra: Partial<AuthzGrantRow>): AuthzGrantRow {
  return {
    chainId: "cosmoshub-4",
    granter: GRANTER,
    grantee: GRANTEE,
    authorization: "GenericAuthorization",
    authorizationTypeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
    expiration: null,
    ...extra,
  };
}

test("each authorization is revoked under the message type it is stored by", () => {
  assert.equal(revokeTypeUrl(grant({ msgTypeUrl: "/cosmos.gov.v1beta1.MsgVote" })), "/cosmos.gov.v1beta1.MsgVote");
  assert.equal(
    revokeTypeUrl(grant({ authorization: "SendAuthorization", authorizationTypeUrl: "/cosmos.bank.v1beta1.SendAuthorization" })),
    "/cosmos.bank.v1beta1.MsgSend",
  );
  assert.equal(
    revokeTypeUrl(grant({ authorization: "TransferAuthorization", authorizationTypeUrl: "/ibc.applications.transfer.v1.TransferAuthorization" })),
    "/ibc.applications.transfer.v1.MsgTransfer",
  );
  assert.equal(
    revokeTypeUrl(
      grant({ authorization: "StakeAuthorization", authorizationTypeUrl: "/cosmos.staking.v1beta1.StakeAuthorization", stakeAction: "redelegate" }),
    ),
    "/cosmos.staking.v1beta1.MsgBeginRedelegate",
  );
  // Unknown: no key, no guess.
  assert.equal(
    revokeTypeUrl(grant({ authorization: "StakeAuthorization", authorizationTypeUrl: "/cosmos.staking.v1beta1.StakeAuthorization", stakeAction: "unspecified" })),
    null,
  );
  assert.equal(revokeTypeUrl(grant({ authorization: "MysteryAuthorization", authorizationTypeUrl: "/x.y.MysteryAuthorization" })), null);
});

test("revoking a party builds one message per distinct key and reports the rest", () => {
  const { messages, unrevokable, typeUrls } = revokeAllMessages([
    grant({ msgTypeUrl: "/cosmos.gov.v1.MsgVote" }),
    grant({ msgTypeUrl: "/cosmos.gov.v1beta1.MsgVote" }),
    grant({ msgTypeUrl: "/cosmos.gov.v1.MsgVote" }),
    grant({ authorization: "MysteryAuthorization", authorizationTypeUrl: "/x.y.MysteryAuthorization" }),
  ]);
  assert.deepEqual(typeUrls, ["/cosmos.gov.v1.MsgVote", "/cosmos.gov.v1beta1.MsgVote"]);
  assert.equal(messages.length, 2);
  assert.equal(unrevokable.length, 1);
});
