/**
 * Swap messages as the wallet signs them, and the one way the engine reads a
 * signable message back.
 *
 * The engine builds every message as `MsgJson` (proto-JSON, the extension's
 * `BuiltMsg` shape). Here each one becomes a `TxMessage`: the protobuf bytes
 * a direct signature covers, plus the amino document an amino signature
 * covers. The encoders are the dashboard's own (`@/lib/tx/amino-tx`
 * `msgProtoBytes` for the bank send, the IBC transfer and the contract call,
 * `@/lib/tx/osmosis` for poolmanager), wrapped, never re-implemented.
 *
 * {@link viewOf} is the read-back's foundation: it re-encodes a message's
 * amino document and refuses it unless the bytes are *exactly* the message's
 * protobuf bytes. Whatever a wallet signs (bytes or document), the review
 * checks (./checks.ts) then read the same facts, so a message whose two
 * encodings disagree, or whose bytes were edited after it was built, is never
 * described, and never signed.
 *
 * `MsgTransfer`'s amino document is written in CosmJS's shape
 * (`timeout_height: {}` always present, `memo` omitted when empty), the shape
 * ibc-go v8 chains reconstruct (the field is `amino.dont_omitempty`).
 */

import { msgExecuteContract, msgProtoBytes, msgSend, type AminoMsg, type Coin } from "@/lib/tx/amino-tx";
import { encodePoolSwap, POOLMANAGER_AMINO_TYPES, poolSwapTxMessage } from "@/lib/tx/osmosis";
import type { TxMessage } from "@/lib/tx/types";
import { BANK_SEND_TYPE_URL } from "@/lib/swap/fee";
import { POOL_SPLIT_SWAP_TYPE_URL, POOL_SWAP_TYPE_URL, TRANSFER_TYPE_URL } from "@/lib/swap/pool";
import { isRecord, type MsgJson } from "@/lib/swap/types";

export const EXECUTE_CONTRACT_TYPE_URL = "/cosmwasm.wasm.v1.MsgExecuteContract";

/** Amino name for each type URL the swap signs. */
const AMINO_TYPES: Readonly<Record<string, string>> = {
  [BANK_SEND_TYPE_URL]: "cosmos-sdk/MsgSend",
  [TRANSFER_TYPE_URL]: "cosmos-sdk/MsgTransfer",
  [EXECUTE_CONTRACT_TYPE_URL]: "wasm/MsgExecuteContract",
  ...POOLMANAGER_AMINO_TYPES,
};

function coinsOf(raw: unknown, what: string): Coin[] {
  if (!Array.isArray(raw)) throw new Error(`${what} is not a coin list`);
  return raw.map((coin) => {
    if (!isRecord(coin) || typeof coin.denom !== "string" || typeof coin.amount !== "string") {
      throw new Error(`${what} holds a coin that is not one`);
    }
    return { denom: coin.denom, amount: coin.amount };
  });
}

function text(raw: unknown, what: string): string {
  if (typeof raw !== "string") throw new Error(`${what} is not a string`);
  return raw;
}

/** The amino document for a swap message, in the shape its chain reconstructs. */
function aminoOf(msg: MsgJson): AminoMsg {
  const v = msg.value;
  switch (msg.typeUrl) {
    case BANK_SEND_TYPE_URL:
      return msgSend({
        fromAddress: text(v.from_address, "from_address"),
        toAddress: text(v.to_address, "to_address"),
        amount: coinsOf(v.amount, "amount"),
      });
    case TRANSFER_TYPE_URL: {
      const token = coinsOf([v.token], "token")[0];
      const value: Record<string, unknown> = {
        source_port: text(v.source_port, "source_port"),
        source_channel: text(v.source_channel, "source_channel"),
        token,
        sender: text(v.sender, "sender"),
        receiver: text(v.receiver, "receiver"),
        // CosmJS writes an unset height as `{}`, and ibc-go v8 chains rebuild
        // the sign document the same way; a height is never set here.
        timeout_height: {},
        timeout_timestamp: text(v.timeout_timestamp, "timeout_timestamp"),
      };
      const memo = v.memo === undefined ? "" : text(v.memo, "memo");
      if (memo !== "") value.memo = memo;
      return { type: "cosmos-sdk/MsgTransfer", value };
    }
    case EXECUTE_CONTRACT_TYPE_URL: {
      if (!isRecord(v.msg)) throw new Error("msg is not a JSON object");
      return msgExecuteContract({
        sender: text(v.sender, "sender"),
        contract: text(v.contract, "contract"),
        msg: v.msg,
        funds: coinsOf(v.funds, "funds"),
      });
    }
    default:
      throw new Error(`${msg.typeUrl} is not a message the swap signs`);
  }
}

/** Protobuf bytes of an amino document, by its type (and only the types the swap signs). */
function bytesOfAmino(typeUrl: string, amino: AminoMsg): Uint8Array {
  if (Object.hasOwn(POOLMANAGER_AMINO_TYPES, typeUrl)) return encodePoolSwap(typeUrl, amino.value);
  const encoded = msgProtoBytes(amino);
  if (encoded.typeUrl !== typeUrl) throw new Error(`${amino.type} does not encode as ${typeUrl}`);
  return encoded.value;
}

/**
 * A signable message from the engine's view of it: the amino document and
 * the protobuf bytes derived from it, so the two say the same thing by
 * construction. Throws on anything the swap does not sign.
 */
export function toTxMessage(msg: MsgJson, summary?: string): TxMessage {
  if (msg.typeUrl === POOL_SWAP_TYPE_URL || msg.typeUrl === POOL_SPLIT_SWAP_TYPE_URL) {
    return poolSwapTxMessage(msg.typeUrl, msg.value, summary);
  }
  const amino = aminoOf(msg);
  return {
    typeUrl: msg.typeUrl,
    value: bytesOfAmino(msg.typeUrl, amino),
    amino,
    ...(summary ? { summary } : {}),
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * What a signable message says, as the review checks read it: its amino
 * document's value under its protobuf type URL, but only when re-encoding
 * that document gives back exactly the message's protobuf bytes and the amino
 * name is the one that type URL signs under. `null` otherwise (no amino
 * document, a type the swap does not sign, any disagreement): unreadable.
 */
export function viewOf(msg: TxMessage | undefined): MsgJson | null {
  if (!msg || !msg.amino || !isRecord(msg.amino.value)) return null;
  const expected = Object.hasOwn(AMINO_TYPES, msg.typeUrl) ? AMINO_TYPES[msg.typeUrl] : undefined;
  if (!expected || msg.amino.type !== expected) return null;
  let bytes: Uint8Array;
  try {
    bytes = bytesOfAmino(msg.typeUrl, msg.amino);
  } catch {
    return null;
  }
  if (!(msg.value instanceof Uint8Array) || !sameBytes(bytes, msg.value)) return null;
  // A deep copy: the checks must not read an object someone can still edit.
  return { typeUrl: msg.typeUrl, value: JSON.parse(JSON.stringify(msg.amino.value)) as Record<string, unknown> };
}
