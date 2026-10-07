/**
 * The protobuf documents of a Cosmos transaction: `TxBody`, `AuthInfo`,
 * `SignDoc` and `TxRaw` (cosmos.tx.v1beta1), byte-identical to CosmJS.
 *
 * Cosmos signs bytes, so "close" is worthless here: a body that differs by one
 * byte from the one inside the signed `SignDoc` verifies against nothing, and
 * the chain reports it as an opaque `unauthorized`. Every function in this file
 * is pinned by the zunia-core CosmJS vectors in `__tests__/direct-golden.test.ts`
 * (body, auth info and sign bytes for eighteen transactions).
 *
 * Field rules that bite (all from the proto definitions, all mirrored from
 * zunia-core `crates/cosmos/src/tx.rs`):
 * - proto3 scalars at their default value are omitted (`ProtoWriter` does it);
 * - `ModeInfo.single` is written even when empty, because "present and empty"
 *   and "absent" decode differently;
 * - `signatures` is a repeated bytes field, so an empty placeholder signature
 *   (simulation) is still written as a zero-length entry.
 */

import { ProtoWriter, readProtoFields } from "./proto";
import type { Coin } from "./amino-tx";

/** `cosmos.tx.signing.v1beta1.SignMode` values a wallet uses. */
export const SIGN_MODE_UNSPECIFIED = 0;
export const SIGN_MODE_DIRECT = 1;
export const SIGN_MODE_LEGACY_AMINO_JSON = 127;

export type ProtoSignMode =
  | typeof SIGN_MODE_UNSPECIFIED
  | typeof SIGN_MODE_DIRECT
  | typeof SIGN_MODE_LEGACY_AMINO_JSON;

/** Protobuf type URL of a Cosmos secp256k1 key. */
export const COSMOS_PUBKEY_TYPE_URL = "/cosmos.crypto.secp256k1.PubKey";
/** Protobuf type URL of an Ethermint `ethsecp256k1` key (Evmos, Dymension, ...). */
export const ETHERMINT_PUBKEY_TYPE_URL = "/ethermint.crypto.v1.ethsecp256k1.PubKey";

/** One message, already encoded: the pair that goes into an `Any`. */
export interface EncodedMessage {
  typeUrl: string;
  value: Uint8Array;
}

export function encodeCoin(coin: Coin): Uint8Array {
  return new ProtoWriter().string(1, coin.denom).string(2, coin.amount).intoBytes();
}

export function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  return new ProtoWriter().string(1, typeUrl).bytes(2, value).intoBytes();
}

/** `cosmos.tx.v1beta1.TxBody`. Extension options are never set by this app. */
export function encodeTxBody(params: {
  messages: readonly EncodedMessage[];
  memo?: string;
  /** Block height after which the tx is invalid; 0 or absent means none. */
  timeoutHeight?: bigint | number | string;
}): Uint8Array {
  if (params.messages.length === 0) throw new Error("A transaction needs at least one message");
  const anys = params.messages.map((msg) => encodeAny(msg.typeUrl, msg.value));
  return new ProtoWriter()
    .repeatedMessage(1, anys)
    .string(2, params.memo ?? "")
    .uint64(3, BigInt(params.timeoutHeight ?? 0))
    .intoBytes();
}

/**
 * A public key as the `Any` that goes into `SignerInfo.public_key`.
 *
 * The 33-byte compressed key is the same for every secp256k1 flavour; the type
 * URL is what tells the chain which signature scheme to verify (SHA-256 for
 * Cosmos, keccak256 for the Ethermint family), so it must be the chain's own.
 */
export function encodePubKeyAny(pubKey: Uint8Array, typeUrl: string = COSMOS_PUBKEY_TYPE_URL): Uint8Array {
  if (pubKey.length !== 33) {
    throw new Error("Expected a 33-byte compressed secp256k1 public key");
  }
  const inner = new ProtoWriter().bytes(1, pubKey).intoBytes();
  return encodeAny(typeUrl, inner);
}

export interface FeeInput {
  amount: readonly Coin[];
  gasLimit: bigint | number | string;
  payer?: string;
  granter?: string;
}

/** `cosmos.tx.v1beta1.Fee`. */
export function encodeFee(fee: FeeInput): Uint8Array {
  return new ProtoWriter()
    .repeatedMessage(1, fee.amount.map(encodeCoin))
    .uint64(2, BigInt(fee.gasLimit))
    .string(3, fee.payer ?? "")
    .string(4, fee.granter ?? "")
    .intoBytes();
}

export interface SignerInfoInput {
  /** The `Any`-encoded key (`encodePubKeyAny`); null for simulation without a known key. */
  publicKey: Uint8Array | null;
  mode: ProtoSignMode;
  sequence: bigint | number | string;
}

/** `cosmos.tx.v1beta1.AuthInfo` (tip is deprecated and never set). */
export function encodeAuthInfo(params: { signers: readonly SignerInfoInput[]; fee: FeeInput }): Uint8Array {
  const signerInfos = params.signers.map((signer) => {
    const single = new ProtoWriter().int32(1, signer.mode).intoBytes();
    // messageAlways: an empty ModeInfo.Single (SIGN_MODE_UNSPECIFIED, used for
    // simulation) is meaningful and must be present.
    const modeInfo = new ProtoWriter().messageAlways(1, single).intoBytes();
    return new ProtoWriter()
      .message(1, signer.publicKey ?? new Uint8Array())
      .message(2, modeInfo)
      .uint64(3, BigInt(signer.sequence))
      .intoBytes();
  });
  return new ProtoWriter()
    .repeatedMessage(1, signerInfos)
    // Always written: an empty Fee (simulation) and a missing one are
    // different things to the SDK, which rejects the latter as "missing fee".
    .messageAlways(2, encodeFee(params.fee))
    .intoBytes();
}

/** `cosmos.tx.v1beta1.SignDoc`: the bytes a direct-mode signature covers. */
export function encodeSignDoc(params: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint | number | string;
}): Uint8Array {
  if (!params.chainId.trim()) throw new Error("A sign document needs a chain id");
  return new ProtoWriter()
    .bytes(1, params.bodyBytes)
    .bytes(2, params.authInfoBytes)
    .string(3, params.chainId)
    .uint64(4, BigInt(params.accountNumber))
    .intoBytes();
}

/** `cosmos.tx.v1beta1.TxRaw`: what is broadcast. */
export function encodeTxRaw(params: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  signatures: readonly Uint8Array[];
}): Uint8Array {
  return new ProtoWriter()
    .bytes(1, params.bodyBytes)
    .bytes(2, params.authInfoBytes)
    .repeatedMessage(3, [...params.signatures])
    .intoBytes();
}

/**
 * The transaction `/cosmos/tx/v1beta1/simulate` is asked about.
 *
 * Built the way CosmJS builds it: the real body, one signer with the real key
 * and sequence, `SIGN_MODE_UNSPECIFIED`, and an empty signature. The SDK skips
 * signature verification in simulation but still charges gas for a signature
 * of the key's type, which is why the key goes in when it is known — leaving it
 * out under-measures by the cost of verifying it.
 *
 * The fee defaults to empty, as in CosmJS: the gas a fee costs is not known
 * before the gas is, and the 1.4 margin applied to the answer covers the fee
 * deduction the empty fee skips.
 */
export function encodeSimulationTx(params: {
  messages: readonly EncodedMessage[];
  memo?: string;
  timeoutHeight?: bigint | number | string;
  publicKeyAny: Uint8Array | null;
  sequence: bigint | number | string;
  fee?: FeeInput;
}): Uint8Array {
  const bodyBytes = encodeTxBody(params);
  const authInfoBytes = encodeAuthInfo({
    signers: [{ publicKey: params.publicKeyAny, mode: SIGN_MODE_UNSPECIFIED, sequence: params.sequence }],
    fee: params.fee ?? { amount: [], gasLimit: 0 },
  });
  return encodeTxRaw({ bodyBytes, authInfoBytes, signatures: [new Uint8Array()] });
}

/**
 * The fee inside `AuthInfo` bytes.
 *
 * Read back after a direct signature because the wallet may have changed it
 * (the Zunia extension and Keplr both let the user pick a fee tier and return
 * new auth info bytes); the result screen reports the fee that was signed, not
 * the one that was proposed.
 */
export function decodeAuthInfoFee(authInfoBytes: Uint8Array): { amount: Coin[]; gasLimit: string } | null {
  try {
    const feeField = readProtoFields(authInfoBytes).find((f) => f.field === 2 && f.wire === 2);
    if (!feeField || feeField.wire !== 2) return null;
    const amount: Coin[] = [];
    let gasLimit = "0";
    for (const f of readProtoFields(feeField.value)) {
      if (f.field === 1 && f.wire === 2) {
        let denom = "";
        let value = "";
        for (const c of readProtoFields(f.value)) {
          if (c.wire !== 2) continue;
          if (c.field === 1) denom = new TextDecoder().decode(c.value);
          if (c.field === 2) value = new TextDecoder().decode(c.value);
        }
        amount.push({ denom, amount: value || "0" });
      } else if (f.field === 2 && f.wire === 0) {
        gasLimit = f.value.toString();
      }
    }
    return { amount, gasLimit };
  } catch {
    return null;
  }
}

/** A signature out of a wallet: 64-byte compact r‖s (a 65th recovery byte is dropped). */
export function normalizeSignature(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 65) return bytes.slice(0, 64);
  if (bytes.length !== 64) throw new Error("The wallet returned a signature of an unexpected length");
  return bytes;
}
