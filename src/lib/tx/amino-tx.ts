/**
 * Amino JSON messages, the StdSignDoc, and their protobuf twins.
 *
 * Signing with SIGN_MODE_LEGACY_AMINO_JSON still broadcasts a protobuf
 * `TxRaw`: the wallet signs the JSON document, the chain rebuilds that same
 * JSON from the protobuf body and checks the signature against it. So every
 * message here exists twice — the amino value the wallet signs and the proto
 * bytes the body carries — and the two have to describe the same call down to
 * which empty fields are written.
 *
 * Two of the amino shapes below were verified against the chain itself, not
 * only against a reference library, because the reference vectors this file
 * was first pinned to (zunia-core `tests/vectors/cosmos-signing.json` before
 * 22ae866) spelled them differently from what Cosmos Hub verifies:
 *
 * - `MsgVote.option` is a number (`4`), not the enum name
 *   (`"VOTE_OPTION_NO_WITH_VETO"`).
 * - `MsgTransfer.timeout_height` is always present, as `{}` when there is no
 *   height timeout.
 *
 * Both were checked by rebuilding the sign documents of real amino-signed
 * transactions on cosmoshub-4 (Oct 2026) and verifying their signatures: only
 * the spellings used here verify. `__tests__/chain-verified.test.ts` pins those
 * transactions byte for byte.
 */

import {
  encodeCoin,
  encodeAuthInfo,
  encodePubKeyAny,
  encodeTxBody,
  encodeTxRaw,
  COSMOS_PUBKEY_TYPE_URL,
  ETHERMINT_PUBKEY_TYPE_URL,
  SIGN_MODE_LEGACY_AMINO_JSON as MODE_AMINO,
} from "./encode";
import { ProtoWriter } from "./proto";
import { serializeAminoSignDoc, sortKeysDeep, fromBase64 } from "./bytes";

export const SIGN_MODE_LEGACY_AMINO_JSON = MODE_AMINO;

export type Coin = { denom: string; amount: string };

export type AminoMsg = { type: string; value: Record<string, unknown> };

export type StdFee = {
  amount: Coin[];
  gas: string;
  payer?: string;
  granter?: string;
};

export type StdSignDoc = {
  account_number: string;
  chain_id: string;
  fee: StdFee;
  memo: string;
  msgs: AminoMsg[];
  sequence: string;
  timeout_height?: string;
};

export type VoteOption = "yes" | "no" | "veto" | "abstain";

/** `cosmos.gov.v1beta1.VoteOption` (same numbers in gov v1). */
export const VOTE_OPTION_NUMBER: Record<VoteOption, number> = {
  yes: 1,
  abstain: 2,
  no: 3,
  veto: 4,
};

const VOTE_OPTION_NAMES: Record<string, number> = {
  VOTE_OPTION_YES: 1,
  VOTE_OPTION_ABSTAIN: 2,
  VOTE_OPTION_NO: 3,
  VOTE_OPTION_NO_WITH_VETO: 4,
};

export function msgSend(params: {
  fromAddress: string;
  toAddress: string;
  amount: Coin[];
}): AminoMsg {
  return {
    type: "cosmos-sdk/MsgSend",
    value: {
      from_address: params.fromAddress,
      to_address: params.toAddress,
      amount: params.amount,
    },
  };
}

export function msgDelegate(params: {
  delegatorAddress: string;
  validatorAddress: string;
  amount: Coin;
}): AminoMsg {
  return {
    type: "cosmos-sdk/MsgDelegate",
    value: {
      delegator_address: params.delegatorAddress,
      validator_address: params.validatorAddress,
      amount: params.amount,
    },
  };
}

export function msgUndelegate(params: {
  delegatorAddress: string;
  validatorAddress: string;
  amount: Coin;
}): AminoMsg {
  return {
    type: "cosmos-sdk/MsgUndelegate",
    value: {
      delegator_address: params.delegatorAddress,
      validator_address: params.validatorAddress,
      amount: params.amount,
    },
  };
}

export function msgBeginRedelegate(params: {
  delegatorAddress: string;
  validatorSrcAddress: string;
  validatorDstAddress: string;
  amount: Coin;
}): AminoMsg {
  return {
    type: "cosmos-sdk/MsgBeginRedelegate",
    value: {
      delegator_address: params.delegatorAddress,
      validator_src_address: params.validatorSrcAddress,
      validator_dst_address: params.validatorDstAddress,
      amount: params.amount,
    },
  };
}

export function msgWithdrawReward(params: {
  delegatorAddress: string;
  validatorAddress: string;
}): AminoMsg {
  return {
    // "Delegation", not "Delegator": the amino name differs from the proto name.
    type: "cosmos-sdk/MsgWithdrawDelegationReward",
    value: {
      delegator_address: params.delegatorAddress,
      validator_address: params.validatorAddress,
    },
  };
}

/**
 * A gov v1beta1 vote.
 *
 * `option` is the enum's number. The chain's amino encoder writes enums as
 * integers, so a document carrying `"VOTE_OPTION_YES"` is a document the chain
 * never rebuilds: every amino-signed vote on cosmoshub-4 we checked verifies
 * only with the number.
 */
export function msgVote(params: {
  proposalId: string;
  voter: string;
  option: VoteOption;
}): AminoMsg {
  return {
    type: "cosmos-sdk/MsgVote",
    value: {
      proposal_id: params.proposalId,
      voter: params.voter,
      option: VOTE_OPTION_NUMBER[params.option],
    },
  };
}

/**
 * A gov v1 vote, for chains whose gov module no longer routes v1beta1 votes.
 * Same option numbers; `metadata` is omitted when empty, as the chain omits it.
 */
export function msgVoteV1(params: {
  proposalId: string;
  voter: string;
  option: VoteOption;
  metadata?: string;
}): AminoMsg {
  const value: Record<string, unknown> = {
    proposal_id: params.proposalId,
    voter: params.voter,
    option: VOTE_OPTION_NUMBER[params.option],
  };
  if (params.metadata) value.metadata = params.metadata;
  return { type: "cosmos-sdk/v1/MsgVote", value };
}

/** ICS-20 revision height, as amino spells it. */
export type IbcTimeoutHeight = {
  revision_number: string;
  revision_height: string;
};

/**
 * An ICS-20 transfer.
 *
 * `timeout_height` is always written, as `{}` when there is no height timeout:
 * the field is non-nullable and the chain's amino encoder never omits it. A
 * document without it is not the one the chain rebuilds, which is exactly the
 * timestamp-only transfer this app sends — verified against real amino-signed
 * transfers on cosmoshub-4, where only the `{}` spelling verifies.
 *
 * Zero members inside the height, a zero `timeout_timestamp` and an empty
 * `memo` are omitted (all three verified the same way).
 */
export function msgIbcTransfer(params: {
  sourcePort?: string;
  sourceChannel: string;
  token: Coin;
  sender: string;
  receiver: string;
  /** Nanoseconds. Omitted from the sign doc when absent or zero. */
  timeoutTimestamp?: string;
  timeoutHeight?: IbcTimeoutHeight;
  /**
   * The ICS-20 memo. This is the field packet-forward-middleware and ibc-hooks
   * read, so it is the field that decides where the funds go after the first
   * hop — never populate it with anything the approval screen has not
   * described.
   */
  memo?: string;
}): AminoMsg {
  const height: Record<string, string> = {};
  const revisionNumber = params.timeoutHeight?.revision_number ?? "0";
  const revisionHeight = params.timeoutHeight?.revision_height ?? "0";
  if (revisionNumber !== "0" && revisionNumber !== "") height.revision_number = revisionNumber;
  if (revisionHeight !== "0" && revisionHeight !== "") height.revision_height = revisionHeight;
  const value: Record<string, unknown> = {
    source_port: params.sourcePort ?? "transfer",
    source_channel: params.sourceChannel,
    token: params.token,
    sender: params.sender,
    receiver: params.receiver,
    timeout_height: height,
  };
  if (params.timeoutTimestamp && params.timeoutTimestamp !== "0") {
    value.timeout_timestamp = params.timeoutTimestamp;
  }
  if (params.memo) value.memo = params.memo;
  return { type: "cosmos-sdk/MsgTransfer", value };
}

/**
 * A CosmWasm contract call.
 *
 * Added for crosschain-swap recovery: when a swap succeeds and the payout
 * transfer fails, the output sits in the crosschain-swaps contract and only the
 * `local_recovery_addr` can pull it out, with `{"recover":{}}`.
 *
 * `msg` is the execute body as an object. It is serialised with sorted keys in
 * both encodings, so the proto `msg` bytes and the amino sign document cannot
 * disagree about what was signed.
 */
export function msgExecuteContract(params: {
  sender: string;
  contract: string;
  msg: Record<string, unknown>;
  funds?: Coin[];
}): AminoMsg {
  return {
    type: "wasm/MsgExecuteContract",
    value: {
      sender: params.sender,
      contract: params.contract,
      msg: params.msg,
      // Always present, even when empty: wasmd's amino JSON emits `[]`, and a
      // missing key would produce a different sign document from the one the
      // chain reconstructs.
      funds: params.funds ?? [],
    },
  };
}

export function makeStdSignDoc(params: {
  chainId: string;
  accountNumber: string;
  sequence: string;
  fee: StdFee;
  msgs: AminoMsg[];
  memo?: string;
  /** Block height timeout; written only when non-zero, as the SDK omits it. */
  timeoutHeight?: string;
}): StdSignDoc {
  const doc: StdSignDoc = {
    account_number: params.accountNumber,
    chain_id: params.chainId,
    fee: params.fee,
    memo: params.memo ?? "",
    msgs: params.msgs,
    sequence: params.sequence,
  };
  if (params.timeoutHeight && params.timeoutHeight !== "0") doc.timeout_height = params.timeoutHeight;
  return doc;
}

function encodeCoins(coins: Coin[]): Uint8Array[] {
  return coins.map(encodeCoin);
}

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function voteOptionNumber(raw: unknown): number {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 4) return raw;
  if (typeof raw === "string") {
    if (raw in VOTE_OPTION_NAMES) return VOTE_OPTION_NAMES[raw]!;
    if (/^[0-4]$/.test(raw)) return Number(raw);
  }
  throw new Error(`Unknown vote option ${JSON.stringify(raw)}`);
}

function encodeMsgProto(msg: AminoMsg): { typeUrl: string; value: Uint8Array } {
  const v = msg.value;
  switch (msg.type) {
    case "cosmos-sdk/MsgSend": {
      const amount = (v.amount as Coin[]) ?? [];
      return {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: new ProtoWriter()
          .string(1, str(v.from_address))
          .string(2, str(v.to_address))
          .repeatedMessage(3, encodeCoins(amount))
          .intoBytes(),
      };
    }
    case "cosmos-sdk/MsgDelegate":
    case "cosmos-sdk/MsgUndelegate": {
      const amount = v.amount as Coin;
      const typeUrl =
        msg.type === "cosmos-sdk/MsgDelegate"
          ? "/cosmos.staking.v1beta1.MsgDelegate"
          : "/cosmos.staking.v1beta1.MsgUndelegate";
      return {
        typeUrl,
        value: new ProtoWriter()
          .string(1, str(v.delegator_address))
          .string(2, str(v.validator_address))
          .messageAlways(3, encodeCoin(amount))
          .intoBytes(),
      };
    }
    case "cosmos-sdk/MsgBeginRedelegate": {
      const amount = v.amount as Coin;
      return {
        typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
        value: new ProtoWriter()
          .string(1, str(v.delegator_address))
          .string(2, str(v.validator_src_address))
          .string(3, str(v.validator_dst_address))
          .messageAlways(4, encodeCoin(amount))
          .intoBytes(),
      };
    }
    case "cosmos-sdk/MsgWithdrawDelegationReward":
      return {
        typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        value: new ProtoWriter()
          .string(1, str(v.delegator_address))
          .string(2, str(v.validator_address))
          .intoBytes(),
      };
    case "cosmos-sdk/MsgVote":
    case "cosmos-sdk/v1/MsgVote": {
      const writer = new ProtoWriter()
        .uint64(1, BigInt(str(v.proposal_id) || "0"))
        .string(2, str(v.voter))
        .int32(3, voteOptionNumber(v.option));
      if (msg.type === "cosmos-sdk/v1/MsgVote") writer.string(4, str(v.metadata));
      return {
        typeUrl: msg.type === "cosmos-sdk/MsgVote" ? "/cosmos.gov.v1beta1.MsgVote" : "/cosmos.gov.v1.MsgVote",
        value: writer.intoBytes(),
      };
    }
    case "cosmos-sdk/MsgTransfer": {
      const token = v.token as Coin;
      const timeoutTs = BigInt(str(v.timeout_timestamp) || "0");
      const rawHeight = v.timeout_height as
        | { revision_number?: string; revision_height?: string }
        | undefined;
      // Empty Height (0-0) must still be present for ibc-go nullable=false.
      const height = new ProtoWriter()
        .uint64(1, BigInt(str(rawHeight?.revision_number) || "0"))
        .uint64(2, BigInt(str(rawHeight?.revision_height) || "0"))
        .intoBytes();
      return {
        typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
        value: new ProtoWriter()
          .string(1, str(v.source_port) || "transfer")
          .string(2, str(v.source_channel))
          .messageAlways(3, encodeCoin(token))
          .string(4, str(v.sender))
          .string(5, str(v.receiver))
          .messageAlways(6, height)
          .uint64(7, timeoutTs)
          .string(8, str(v.memo))
          .intoBytes(),
      };
    }
    case "wasm/MsgExecuteContract": {
      const funds = (v.funds as Coin[]) ?? [];
      // wasmd stores the execute body as raw JSON bytes. Sorted keys, so these
      // bytes and the amino sign document describe the same call.
      const body = new TextEncoder().encode(JSON.stringify(sortKeysDeep(v.msg ?? {})));
      return {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: new ProtoWriter()
          .string(1, str(v.sender))
          .string(2, str(v.contract))
          .bytes(3, body)
          // `funds` is field 5, not 4: field 4 was the old `sent_funds`.
          .repeatedMessage(5, encodeCoins(funds))
          .intoBytes(),
      };
    }
    default:
      throw new Error(`Unsupported amino message type: ${msg.type}`);
  }
}

/**
 * The proto encoding of one amino message, exposed so the golden vectors can
 * pin it and so `messages.ts` builds both forms from one description.
 *
 * The body is what actually reaches the chain. A body that disagrees with the
 * signed document is rejected as an opaque "unauthorized", which is the one
 * failure a user cannot act on.
 */
export function msgProtoBytes(msg: AminoMsg): {
  typeUrl: string;
  value: Uint8Array;
} {
  return encodeMsgProto(msg);
}

/** Pubkey type URL for the legacy `ethKeyType` flag. */
function legacyKeyType(ethKeyType: boolean | undefined): string {
  return ethKeyType ? ETHERMINT_PUBKEY_TYPE_URL : COSMOS_PUBKEY_TYPE_URL;
}

/**
 * Assemble a broadcastable TxRaw for an amino signature.
 *
 * Built from the document the wallet returned (`signed`), not the one it was
 * sent: Keplr and the Zunia extension let the user change the fee, and the
 * chain verifies the signature against the fee that is actually in the body.
 */
export function assembleAminoTxRaw(params: {
  signDoc: StdSignDoc;
  pubKey: Uint8Array;
  signature: Uint8Array;
  /** @deprecated Pass `pubKeyTypeUrl`; this only knows Ethermint's URL. */
  ethKeyType?: boolean;
  /** The chain's key type URL (see `pubKeyTypeUrlFor`). Wins over `ethKeyType`. */
  pubKeyTypeUrl?: string;
  /**
   * Proto forms of `signDoc.msgs`, when the caller has them already (messages
   * whose proto encoding this file does not know, e.g. Osmosis poolmanager).
   */
  protoMessages?: { typeUrl: string; value: Uint8Array }[];
}): Uint8Array {
  if (params.signature.length !== 64) {
    throw new Error("Signature must be 64-byte compact secp256k1 r||s");
  }
  const messages = params.protoMessages ?? params.signDoc.msgs.map(encodeMsgProto);
  if (messages.length !== params.signDoc.msgs.length) {
    throw new Error("The signed document and the message list disagree");
  }
  const bodyBytes = encodeTxBody({
    messages,
    memo: params.signDoc.memo,
    timeoutHeight: params.signDoc.timeout_height ?? "0",
  });
  const authInfoBytes = encodeAuthInfo({
    signers: [
      {
        publicKey: encodePubKeyAny(params.pubKey, params.pubKeyTypeUrl ?? legacyKeyType(params.ethKeyType)),
        mode: SIGN_MODE_LEGACY_AMINO_JSON,
        sequence: params.signDoc.sequence,
      },
    ],
    fee: {
      amount: params.signDoc.fee.amount,
      gasLimit: params.signDoc.fee.gas || "0",
      payer: params.signDoc.fee.payer,
      granter: params.signDoc.fee.granter,
    },
  });
  return encodeTxRaw({ bodyBytes, authInfoBytes, signatures: [params.signature] });
}

export function parseSignatureBase64(value: string): Uint8Array {
  const bytes = fromBase64(value);
  // Some wallets return 65-byte signatures with recovery byte.
  if (bytes.length === 65) return bytes.slice(0, 64);
  return bytes;
}

export function signDocBytes(signDoc: StdSignDoc): Uint8Array {
  return serializeAminoSignDoc(signDoc);
}

/** Nanosecond timeout ~10 minutes from now for ICS-20. */
export function defaultIbcTimeoutNs(minutes = 10): string {
  const nowMs = BigInt(Date.now());
  const ns =
    nowMs * BigInt(1_000_000) +
    BigInt(minutes) * BigInt(60) * BigInt(1_000_000_000);
  return ns.toString();
}
