/**
 * Amino StdSignDoc + TxRaw assembly for wallet-originated txs.
 *
 * Signs with SIGN_MODE_LEGACY_AMINO_JSON; broadcasts as modern TxRaw so LCD
 * `/cosmos/tx/v1beta1/txs` accepts the payload.
 */

import { ProtoWriter } from "./proto";
import { serializeAminoSignDoc, sortKeysDeep, toBase64, fromBase64 } from "./bytes";

export const SIGN_MODE_LEGACY_AMINO_JSON = 127;

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

const VOTE_AMINO: Record<VoteOption, string> = {
  yes: "VOTE_OPTION_YES",
  abstain: "VOTE_OPTION_ABSTAIN",
  no: "VOTE_OPTION_NO",
  veto: "VOTE_OPTION_NO_WITH_VETO",
};

const VOTE_PROTO: Record<VoteOption, number> = {
  yes: 1,
  abstain: 2,
  no: 3,
  veto: 4,
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

export function msgWithdrawReward(params: {
  delegatorAddress: string;
  validatorAddress: string;
}): AminoMsg {
  return {
    type: "cosmos-sdk/MsgWithdrawDelegationReward",
    value: {
      delegator_address: params.delegatorAddress,
      validator_address: params.validatorAddress,
    },
  };
}

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
      option: VOTE_AMINO[params.option],
    },
  };
}

/** ICS-20 revision height, as amino spells it. */
export type IbcTimeoutHeight = {
  revision_number: string;
  revision_height: string;
};

export function msgIbcTransfer(params: {
  sourcePort?: string;
  sourceChannel: string;
  token: Coin;
  sender: string;
  receiver: string;
  /** Nanoseconds. Omitted from the sign doc when absent, as ibc-go expects. */
  timeoutTimestamp?: string;
  timeoutHeight?: IbcTimeoutHeight;
  /**
   * The ICS-20 memo. This is the field packet-forward-middleware and ibc-hooks
   * read, so it is the field that decides where the funds go after the first
   * hop — never populate it with anything the approval screen has not
   * described. An empty memo is omitted, because an absent memo and an empty
   * one are the same thing on the wire and CosmJS omits it.
   */
  memo?: string;
}): AminoMsg {
  const value: Record<string, unknown> = {
    source_port: params.sourcePort ?? "transfer",
    source_channel: params.sourceChannel,
    token: params.token,
    sender: params.sender,
    receiver: params.receiver,
  };
  if (params.timeoutHeight) value.timeout_height = params.timeoutHeight;
  if (params.timeoutTimestamp) {
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
 * `local_recovery_addr` can pull it out, with `{"recover":{}}`. Without this
 * builder the dashboard could tell a user their funds were recoverable and then
 * offer no way to recover them.
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
}): StdSignDoc {
  return {
    account_number: params.accountNumber,
    chain_id: params.chainId,
    fee: params.fee,
    memo: params.memo ?? "",
    msgs: params.msgs,
    sequence: params.sequence,
  };
}

export function estimateFee(params: {
  gasLimit: number;
  gasPrice: number;
  denom: string;
}): StdFee {
  const amount = Math.max(
    1,
    Math.ceil(params.gasLimit * params.gasPrice),
  ).toString();
  return {
    amount: [{ denom: params.denom, amount }],
    gas: String(params.gasLimit),
  };
}

function encodeCoin(coin: Coin): Uint8Array {
  return new ProtoWriter()
    .string(1, coin.denom)
    .string(2, coin.amount)
    .intoBytes();
}

function encodeCoins(coins: Coin[]): Uint8Array[] {
  return coins.map(encodeCoin);
}

function encodeMsgProto(msg: AminoMsg): { typeUrl: string; value: Uint8Array } {
  const v = msg.value;
  switch (msg.type) {
    case "cosmos-sdk/MsgSend": {
      const amount = (v.amount as Coin[]) ?? [];
      return {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: new ProtoWriter()
          .string(1, String(v.from_address ?? ""))
          .string(2, String(v.to_address ?? ""))
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
          .string(1, String(v.delegator_address ?? ""))
          .string(2, String(v.validator_address ?? ""))
          .messageAlways(3, encodeCoin(amount))
          .intoBytes(),
      };
    }
    case "cosmos-sdk/MsgWithdrawDelegationReward":
      return {
        typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        value: new ProtoWriter()
          .string(1, String(v.delegator_address ?? ""))
          .string(2, String(v.validator_address ?? ""))
          .intoBytes(),
      };
    case "cosmos-sdk/MsgVote": {
      const optionName = String(v.option ?? "");
      const optionKey = (Object.keys(VOTE_AMINO) as VoteOption[]).find(
        (k) => VOTE_AMINO[k] === optionName,
      );
      const option = optionKey ? VOTE_PROTO[optionKey] : 0;
      const proposalId = BigInt(String(v.proposal_id ?? "0"));
      return {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: new ProtoWriter()
          .uint64(1, proposalId)
          .string(2, String(v.voter ?? ""))
          .int32(3, option)
          .intoBytes(),
      };
    }
    case "cosmos-sdk/MsgTransfer": {
      const token = v.token as Coin;
      const timeoutTs = BigInt(String(v.timeout_timestamp ?? "0"));
      const rawHeight = v.timeout_height as
        | { revision_number?: string; revision_height?: string }
        | undefined;
      // Empty Height (0-0) must still be present for ibc-go nullable=false.
      const height = new ProtoWriter()
        .uint64(1, BigInt(String(rawHeight?.revision_number ?? "0")))
        .uint64(2, BigInt(String(rawHeight?.revision_height ?? "0")))
        .intoBytes();
      return {
        typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
        value: new ProtoWriter()
          .string(1, String(v.source_port ?? "transfer"))
          .string(2, String(v.source_channel ?? ""))
          .messageAlways(3, encodeCoin(token))
          .string(4, String(v.sender ?? ""))
          .string(5, String(v.receiver ?? ""))
          .messageAlways(6, height)
          .uint64(7, timeoutTs)
          .string(8, String(v.memo ?? ""))
          .intoBytes(),
      };
    }
    case "wasm/MsgExecuteContract": {
      const funds = (v.funds as Coin[]) ?? [];
      // wasmd stores the execute body as raw JSON bytes. Sorted keys, so these
      // bytes and the amino sign document describe the same call.
      const body = new TextEncoder().encode(
        JSON.stringify(sortKeysDeep(v.msg ?? {})),
      );
      return {
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: new ProtoWriter()
          .string(1, String(v.sender ?? ""))
          .string(2, String(v.contract ?? ""))
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
 * The proto encoding of one message, exposed so the golden vectors can pin it.
 *
 * The amino sign document was already covered; the proto body was not, and the
 * body is what actually reaches the chain. A body that disagrees with the
 * signed document is rejected as an opaque "unauthorized", which is the one
 * failure a user cannot act on.
 */
export function msgProtoBytes(msg: AminoMsg): {
  typeUrl: string;
  value: Uint8Array;
} {
  return encodeMsgProto(msg);
}

function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  return new ProtoWriter().string(1, typeUrl).bytes(2, value).intoBytes();
}

function encodeBody(msgs: AminoMsg[], memo: string): Uint8Array {
  const anys = msgs.map((msg) => {
    const encoded = encodeMsgProto(msg);
    return encodeAny(encoded.typeUrl, encoded.value);
  });
  return new ProtoWriter()
    .repeatedMessage(1, anys)
    .string(2, memo)
    .intoBytes();
}

function encodeFee(fee: StdFee): Uint8Array {
  const coins = encodeCoins(fee.amount);
  return new ProtoWriter()
    .repeatedMessage(1, coins)
    .uint64(2, BigInt(fee.gas || "0"))
    .string(3, fee.payer ?? "")
    .string(4, fee.granter ?? "")
    .intoBytes();
}

function encodePubkeyAny(pubKey: Uint8Array, ethKeyType: boolean): Uint8Array {
  const inner = new ProtoWriter().bytes(1, pubKey).intoBytes();
  const typeUrl = ethKeyType
    ? "/ethermint.crypto.v1.ethsecp256k1.PubKey"
    : "/cosmos.crypto.secp256k1.PubKey";
  return encodeAny(typeUrl, inner);
}

function encodeAuthInfo(params: {
  pubKey: Uint8Array;
  sequence: string;
  fee: StdFee;
  ethKeyType?: boolean;
}): Uint8Array {
  const single = new ProtoWriter()
    .int32(1, SIGN_MODE_LEGACY_AMINO_JSON)
    .intoBytes();
  const modeInfo = new ProtoWriter().messageAlways(1, single).intoBytes();
  const signerInfo = new ProtoWriter()
    .message(1, encodePubkeyAny(params.pubKey, Boolean(params.ethKeyType)))
    .message(2, modeInfo)
    .uint64(3, BigInt(params.sequence))
    .intoBytes();
  return new ProtoWriter()
    .repeatedMessage(1, [signerInfo])
    .message(2, encodeFee(params.fee))
    .intoBytes();
}

/** Assemble broadcastable TxRaw (protobuf bytes). */
export function assembleAminoTxRaw(params: {
  signDoc: StdSignDoc;
  pubKey: Uint8Array;
  signature: Uint8Array;
  ethKeyType?: boolean;
}): Uint8Array {
  if (params.signature.length !== 64) {
    throw new Error("Signature must be 64-byte compact secp256k1 r||s");
  }
  const body = encodeBody(params.signDoc.msgs, params.signDoc.memo);
  const authInfo = encodeAuthInfo({
    pubKey: params.pubKey,
    sequence: params.signDoc.sequence,
    fee: params.signDoc.fee,
    ethKeyType: params.ethKeyType,
  });
  return new ProtoWriter()
    .bytes(1, body)
    .bytes(2, authInfo)
    .repeatedMessage(3, [params.signature])
    .intoBytes();
}

export function txRawToBase64(txRaw: Uint8Array): string {
  return toBase64(txRaw);
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
