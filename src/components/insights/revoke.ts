/**
 * The security review's three fixes as signable messages: revoke an authz
 * grant, revoke a fee allowance, and pay staking rewards to this account
 * again.
 *
 * Each builder returns a `TxMessage` in both encodings, like the builders in
 * `@/lib/tx/messages` (which has none for these modules): protobuf for the
 * TxRaw and direct signing, and the amino JSON the SDK registers for the
 * type, for wallets that only sign amino (a Ledger). The amino names are the
 * SDK's own, including the one that does not match its message:
 * `MsgSetWithdrawAddress` signs as `cosmos-sdk/MsgModifyWithdrawAddress`.
 *
 * An authz grant is stored under (granter, grantee, message type URL), so a
 * revoke must name the exact type URL the grant was made for. For a generic
 * grant the chain reports it; for the typed authorizations it is the one
 * message type each covers (`revokeTypeUrl`). When it cannot be known the
 * builder is not offered rather than guessed: a revoke for the wrong key
 * fails on chain ("authorization not found") after the fee is paid.
 *
 * Pure (no React, no I/O), so `node --test` pins the bytes.
 */

import type { AuthzGrantRow } from "@/lib/chain/types";
import { shortenAddress } from "@/lib/format";
import { ProtoWriter } from "@/lib/tx/proto";
import type { TxMessage } from "@/lib/tx/types";

export const MSG_REVOKE = "/cosmos.authz.v1beta1.MsgRevoke";
export const MSG_REVOKE_ALLOWANCE = "/cosmos.feegrant.v1beta1.MsgRevokeAllowance";
export const MSG_SET_WITHDRAW_ADDRESS = "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress";

/** The message type each typed authorization covers (its `MsgTypeURL()`). */
const AUTHORIZATION_MSG: Readonly<Record<string, string>> = {
  "/cosmos.bank.v1beta1.SendAuthorization": "/cosmos.bank.v1beta1.MsgSend",
  "/ibc.applications.transfer.v1.TransferAuthorization": "/ibc.applications.transfer.v1.MsgTransfer",
  "/cosmwasm.wasm.v1.ContractExecutionAuthorization": "/cosmwasm.wasm.v1.MsgExecuteContract",
  "/cosmwasm.wasm.v1.ContractMigrationAuthorization": "/cosmwasm.wasm.v1.MsgMigrateContract",
};

/** StakeAuthorization keys its grant by the staking message its type allows. */
const STAKE_MSG: Readonly<Record<string, string>> = {
  delegate: "/cosmos.staking.v1beta1.MsgDelegate",
  undelegate: "/cosmos.staking.v1beta1.MsgUndelegate",
  redelegate: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
  cancel_unbonding: "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
};

/**
 * The message type URL a grant is stored under, or null when the read does
 * not say (an authorization this build does not know, a stake grant with no
 * type): such a grant gets the instructions, not a button.
 */
export function revokeTypeUrl(grant: Pick<AuthzGrantRow, "authorizationTypeUrl" | "msgTypeUrl" | "stakeAction">): string | null {
  if (grant.msgTypeUrl) return grant.msgTypeUrl;
  if (grant.authorizationTypeUrl === "/cosmos.staking.v1beta1.StakeAuthorization") {
    return STAKE_MSG[grant.stakeAction?.toLowerCase() ?? ""] ?? null;
  }
  return AUTHORIZATION_MSG[grant.authorizationTypeUrl] ?? null;
}

function requireText(value: string, what: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${what} is required`);
  return text;
}

/** `MsgRevoke {granter = 1, grantee = 2, msg_type_url = 3}`. */
export function buildRevokeGrant(params: { granter: string; grantee: string; msgTypeUrl: string }): TxMessage {
  const granter = requireText(params.granter, "The granter");
  const grantee = requireText(params.grantee, "The grantee");
  const msgTypeUrl = requireText(params.msgTypeUrl, "The message type");
  if (!msgTypeUrl.startsWith("/")) throw new Error("A message type URL starts with “/”");
  if (granter === grantee) throw new Error("A grant is never to yourself");
  return {
    typeUrl: MSG_REVOKE,
    value: new ProtoWriter().string(1, granter).string(2, grantee).string(3, msgTypeUrl).intoBytes(),
    amino: { type: "cosmos-sdk/MsgRevoke", value: { granter, grantee, msg_type_url: msgTypeUrl } },
    summary: `Revoke ${shortenAddress(grantee, 10, 4)}'s ${msgTypeUrl.split(".").pop() ?? msgTypeUrl} permission`,
  };
}

/** `MsgRevokeAllowance {granter = 1, grantee = 2}`. */
export function buildRevokeAllowance(params: { granter: string; grantee: string }): TxMessage {
  const granter = requireText(params.granter, "The granter");
  const grantee = requireText(params.grantee, "The grantee");
  return {
    typeUrl: MSG_REVOKE_ALLOWANCE,
    value: new ProtoWriter().string(1, granter).string(2, grantee).intoBytes(),
    amino: { type: "cosmos-sdk/MsgRevokeAllowance", value: { granter, grantee } },
    summary: `Stop paying fees for ${shortenAddress(grantee, 10, 4)}`,
  };
}

/** `MsgSetWithdrawAddress {delegator_address = 1, withdraw_address = 2}`. */
export function buildSetWithdrawAddress(params: { delegator: string; withdrawAddress: string }): TxMessage {
  const delegator = requireText(params.delegator, "The delegator");
  const withdrawAddress = requireText(params.withdrawAddress, "The withdraw address");
  return {
    typeUrl: MSG_SET_WITHDRAW_ADDRESS,
    value: new ProtoWriter().string(1, delegator).string(2, withdrawAddress).intoBytes(),
    amino: { type: "cosmos-sdk/MsgModifyWithdrawAddress", value: { delegator_address: delegator, withdraw_address: withdrawAddress } },
    summary: `Pay staking rewards to ${shortenAddress(withdrawAddress, 10, 4)}`,
  };
}

/**
 * One revoke per grant of a grantee, for "revoke everything this party can
 * do". Grants whose key cannot be known are returned apart, so the review can
 * say that they stay.
 */
export function revokeAllMessages(
  grants: readonly AuthzGrantRow[],
): { messages: TxMessage[]; unrevokable: AuthzGrantRow[]; typeUrls: string[] } {
  const messages: TxMessage[] = [];
  const unrevokable: AuthzGrantRow[] = [];
  const typeUrls: string[] = [];
  const seen = new Set<string>();
  for (const grant of grants) {
    const typeUrl = revokeTypeUrl(grant);
    if (!typeUrl) {
      unrevokable.push(grant);
      continue;
    }
    // The same key twice (a read listing a grant twice) would make the second revoke fail.
    const key = `${grant.granter}|${grant.grantee}|${typeUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    typeUrls.push(typeUrl);
    messages.push(buildRevokeGrant({ granter: grant.granter, grantee: grant.grantee, msgTypeUrl: typeUrl }));
  }
  return { messages, unrevokable, typeUrls };
}
