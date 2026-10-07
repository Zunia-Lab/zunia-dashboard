/**
 * Message builders: one call, both encodings.
 *
 * Every flow (send, stake, vote, bridge, swap recovery, NFT) describes what it
 * wants with one of these and hands the result to `useSignAndBroadcast`. Each
 * builder returns a `TxMessage` carrying the protobuf form (always — it is what
 * the TxRaw body holds) and the amino form (what Ledger, and an amino-mode
 * wallet prompt, sign). Both come from one description through
 * `msgProtoBytes`, so they cannot drift apart; the golden tests pin both.
 *
 * Messages without a registered amino form (Osmosis poolmanager, built in
 * `osmosis.ts`) set only `typeUrl` + `value`; the signer then picks direct mode.
 */

import {
  defaultIbcTimeoutNs,
  msgBeginRedelegate,
  msgDelegate,
  msgExecuteContract,
  msgIbcTransfer,
  msgProtoBytes,
  msgSend,
  msgUndelegate,
  msgVote,
  msgVoteV1,
  msgWithdrawReward,
  type AminoMsg,
  type Coin,
  type IbcTimeoutHeight,
  type VoteOption,
} from "./amino-tx";
import type { TxMessage } from "./types";

function shortAddress(address: string): string {
  return address.length > 20 ? `${address.slice(0, 12)}…${address.slice(-6)}` : address;
}

function coinsText(coins: readonly Coin[]): string {
  return coins.length === 0 ? "nothing" : coins.map((c) => `${c.amount} ${c.denom}`).join(" + ");
}

/** Both encodings of an amino-describable message. */
export function txMessageFromAmino(amino: AminoMsg, summary?: string): TxMessage {
  const proto = msgProtoBytes(amino);
  return { typeUrl: proto.typeUrl, value: proto.value, amino, ...(summary ? { summary } : {}) };
}

export function buildSend(params: {
  fromAddress: string;
  toAddress: string;
  amount: Coin[];
  summary?: string;
}): TxMessage {
  return txMessageFromAmino(
    msgSend(params),
    params.summary ?? `Send ${coinsText(params.amount)} to ${shortAddress(params.toAddress)}`,
  );
}

export function buildDelegate(params: {
  delegatorAddress: string;
  validatorAddress: string;
  amount: Coin;
  summary?: string;
}): TxMessage {
  return txMessageFromAmino(
    msgDelegate(params),
    params.summary ?? `Stake ${coinsText([params.amount])} with ${shortAddress(params.validatorAddress)}`,
  );
}

export function buildUndelegate(params: {
  delegatorAddress: string;
  validatorAddress: string;
  amount: Coin;
  summary?: string;
}): TxMessage {
  return txMessageFromAmino(
    msgUndelegate(params),
    params.summary ?? `Unstake ${coinsText([params.amount])} from ${shortAddress(params.validatorAddress)}`,
  );
}

export function buildRedelegate(params: {
  delegatorAddress: string;
  validatorSrcAddress: string;
  validatorDstAddress: string;
  amount: Coin;
  summary?: string;
}): TxMessage {
  return txMessageFromAmino(
    msgBeginRedelegate(params),
    params.summary ??
      `Move ${coinsText([params.amount])} from ${shortAddress(params.validatorSrcAddress)} to ${shortAddress(
        params.validatorDstAddress,
      )}`,
  );
}

export function buildWithdrawReward(params: {
  delegatorAddress: string;
  validatorAddress: string;
  summary?: string;
}): TxMessage {
  return txMessageFromAmino(
    msgWithdrawReward(params),
    params.summary ?? `Claim rewards from ${shortAddress(params.validatorAddress)}`,
  );
}

const VOTE_LABEL: Record<VoteOption, string> = {
  yes: "Yes",
  no: "No",
  veto: "No with veto",
  abstain: "Abstain",
};

/**
 * A governance vote.
 *
 * v1beta1 by default: every SDK from 0.46 to 0.53 still routes it (the
 * "legacy" gov msg server converts it to v1), and it is the form every
 * wallet's amino summarizer knows. Pass `govVersion: "v1"` for a chain that
 * has dropped the legacy router.
 */
export function buildVote(params: {
  proposalId: string;
  voter: string;
  option: VoteOption;
  govVersion?: "v1beta1" | "v1";
  metadata?: string;
  summary?: string;
}): TxMessage {
  if (!/^\d+$/.test(params.proposalId)) throw new Error("A proposal id is a positive integer");
  const amino = params.govVersion === "v1" ? msgVoteV1(params) : msgVote(params);
  return txMessageFromAmino(
    amino,
    params.summary ?? `Vote ${VOTE_LABEL[params.option]} on proposal #${params.proposalId}`,
  );
}

/**
 * An ICS-20 transfer.
 *
 * Timeout: an explicit `timeoutTimestamp` (nanoseconds) wins; otherwise
 * `timeoutMinutes` from now (default 10, the extension's packet timeout). A
 * transfer always carries a timeout so a packet can never be stuck forever.
 */
export function buildTransfer(params: {
  sourcePort?: string;
  sourceChannel: string;
  token: Coin;
  sender: string;
  receiver: string;
  memo?: string;
  timeoutTimestamp?: string;
  timeoutMinutes?: number;
  timeoutHeight?: IbcTimeoutHeight;
  summary?: string;
}): TxMessage {
  if (!/^channel-\d+$/.test(params.sourceChannel)) throw new Error("A source channel looks like channel-<n>");
  const minutes = Math.min(Math.max(params.timeoutMinutes ?? 10, 1), 7 * 24 * 60);
  const timeoutTimestamp = params.timeoutTimestamp ?? defaultIbcTimeoutNs(minutes);
  return txMessageFromAmino(
    msgIbcTransfer({ ...params, timeoutTimestamp }),
    params.summary ??
      `Transfer ${coinsText([params.token])} to ${shortAddress(params.receiver)} over ${params.sourceChannel}`,
  );
}

export function buildExecuteContract(params: {
  sender: string;
  contract: string;
  msg: Record<string, unknown>;
  funds?: Coin[];
  summary?: string;
}): TxMessage {
  const action = Object.keys(params.msg)[0] ?? "execute";
  return txMessageFromAmino(
    msgExecuteContract(params),
    params.summary ?? `Call ${action} on contract ${shortAddress(params.contract)}`,
  );
}

/**
 * Message types every wallet's amino summarizer describes properly: bank,
 * staking, distribution, gov votes and plain ICS-20. Anything else (contract
 * calls, chain-specific modules) is "non-standard": a wallet that can sign it
 * in direct mode shows the decoded message there rather than a raw JSON blob.
 */
const STANDARD_TYPE_URLS = new Set([
  "/cosmos.bank.v1beta1.MsgSend",
  "/cosmos.staking.v1beta1.MsgDelegate",
  "/cosmos.staking.v1beta1.MsgUndelegate",
  "/cosmos.staking.v1beta1.MsgBeginRedelegate",
  "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
  "/cosmos.gov.v1beta1.MsgVote",
  "/cosmos.gov.v1.MsgVote",
  "/ibc.applications.transfer.v1.MsgTransfer",
]);

export function isStandardMessage(message: Pick<TxMessage, "typeUrl">): boolean {
  return STANDARD_TYPE_URLS.has(message.typeUrl);
}

/** The kind label used for fallback gas and for copy ("send", "vote", …). */
export type MessageKind =
  | "send"
  | "delegate"
  | "undelegate"
  | "redelegate"
  | "claim"
  | "vote"
  | "transfer"
  | "contract"
  | "swap"
  | "other";

export function messageKind(message: Pick<TxMessage, "typeUrl">): MessageKind {
  switch (message.typeUrl) {
    case "/cosmos.bank.v1beta1.MsgSend":
      return "send";
    case "/cosmos.staking.v1beta1.MsgDelegate":
      return "delegate";
    case "/cosmos.staking.v1beta1.MsgUndelegate":
      return "undelegate";
    case "/cosmos.staking.v1beta1.MsgBeginRedelegate":
      return "redelegate";
    case "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward":
      return "claim";
    case "/cosmos.gov.v1beta1.MsgVote":
    case "/cosmos.gov.v1.MsgVote":
      return "vote";
    case "/ibc.applications.transfer.v1.MsgTransfer":
      return "transfer";
    case "/cosmwasm.wasm.v1.MsgExecuteContract":
      return "contract";
    default:
      return message.typeUrl.startsWith("/osmosis.poolmanager.") ? "swap" : "other";
  }
}
