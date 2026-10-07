/**
 * Whether a wallet's signature verifies over the bytes the chain will check,
 * asked after the wallet answers and before anything is broadcast
 * (`flow.ts` `signPlan`).
 *
 * A wallet can sign other bytes than the ones the chain rebuilds: the Zunia
 * extension up to 0.1.4 writes amino documents without the chain's `&`, `<`,
 * `>` escaping, and CosmJS-based wallets leave U+2028 and U+2029 unescaped
 * where the chain escapes them. The chain then refuses the transaction as an
 * opaque "signature verification failed" that no retry fixes; checked here,
 * the flow stops in words and nothing is sent.
 *
 * The bytes are the chain's:
 * - direct: the `SignDoc` over the body and auth info the wallet returned
 *   (what is broadcast), the chain id and the account number;
 * - amino: the A1 serialization (`serializeAminoSignDoc`) of the document the
 *   wallet returned, which the flow has already held to the messages, chain,
 *   account and sequence it asked for (the fee and memo are the wallet's to
 *   change, and go into the broadcast as returned).
 * The digest is the key type's: SHA-256 for a Cosmos `secp256k1` key,
 * keccak256 for the `ethsecp256k1` family (Injective, Evmos, cosmos/evm,
 * Initia).
 *
 * It answers "unchecked" rather than guess, and the chain decides as before:
 * - a key type it does not know (multisig, ed25519, secp256r1…);
 * - a key that is not a 33-byte compressed secp256k1 point;
 * - amino with an Ethereum key: Ethermint-family chains also accept a
 *   signature over the EIP-712 rendering of the document (what a Ledger signs
 *   there), which only the chain rebuilds.
 * A signature with a high S is accepted: the question is whether the wallet
 * signed these bytes (every wallet the dashboard supports writes a low S). So
 * "invalid" means the chain would refuse the signature, for certain.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import type { StdSignDoc } from "./amino-tx";
import { bytesEqual, serializeAminoSignDoc, sortKeysDeep } from "./bytes";
import { COSMOS_PUBKEY_TYPE_URL, encodeSignDoc } from "./encode";
import { readProtoFields } from "./proto";

export type SignatureVerdict = "valid" | "invalid" | "unchecked";

export interface SignatureCheck {
  verdict: SignatureVerdict;
  /** "invalid": what the signature was found to be over, in words. "unchecked": why. Null when valid. */
  detail: string | null;
}

export type SignatureDigest = "sha256" | "keccak256";

const ETH_PUBKEY_TYPE_URL = /^\/[\w.]+\.ethsecp256k1\.PubKey$/;

/** The digest the chain verifies signatures of a key type over, or null for a key type this check does not know. */
export function signatureDigest(pubKeyTypeUrl: string): SignatureDigest | null {
  if (pubKeyTypeUrl === COSMOS_PUBKEY_TYPE_URL) return "sha256";
  if (ETH_PUBKEY_TYPE_URL.test(pubKeyTypeUrl)) return "keccak256";
  return null;
}

const DIGEST_NAME: Record<SignatureDigest, string> = { sha256: "SHA-256", keccak256: "keccak256" };

function verifies(bytes: Uint8Array, signature: Uint8Array, pubKey: Uint8Array, digest: SignatureDigest): boolean {
  const hash = digest === "keccak256" ? keccak_256(bytes) : sha256(bytes);
  try {
    return secp256k1.verify(signature, hash, pubKey, { prehash: false, lowS: false });
  } catch {
    return false;
  }
}

/** Why a signature cannot be checked here, or null when it can. */
function uncheckable(typeUrl: string, pubKey: Uint8Array, signature: Uint8Array): string | null {
  if (!signatureDigest(typeUrl)) return `Not checked: ${typeUrl || "this key type"} is not a key type this check knows.`;
  if (pubKey.length !== 33 || !secp256k1.utils.isValidPublicKey(pubKey, true)) {
    return "Not checked: the public key is not a 33-byte compressed secp256k1 key.";
  }
  if (signature.length !== 64) return "Not checked: the signature is not 64 bytes.";
  return null;
}

/** The key type the first signer in `AuthInfo` bytes names: what the chain reads. Null when there is none to read. */
export function signerKeyTypeUrl(authInfoBytes: Uint8Array): string | null {
  try {
    const signerInfo = readProtoFields(authInfoBytes).find((field) => field.field === 1);
    if (signerInfo?.wire !== 2) return null;
    const publicKey = readProtoFields(signerInfo.value).find((field) => field.field === 1);
    if (publicKey?.wire !== 2) return null;
    const typeUrl = readProtoFields(publicKey.value).find((field) => field.field === 1);
    return typeUrl?.wire === 2 ? new TextDecoder().decode(typeUrl.value) : null;
  } catch {
    return null;
  }
}

/**
 * A direct-mode signature, over the body and auth info as they will be
 * broadcast. `pubKeyTypeUrl` is the key type the transaction was planned
 * with; the one the auth info names wins, being what the chain reads.
 */
export function checkDirectSignature(params: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: string;
  pubKey: Uint8Array;
  pubKeyTypeUrl: string;
  signature: Uint8Array;
}): SignatureCheck {
  const typeUrl = signerKeyTypeUrl(params.authInfoBytes) ?? params.pubKeyTypeUrl;
  const digest = signatureDigest(typeUrl);
  const skip = uncheckable(typeUrl, params.pubKey, params.signature);
  if (skip || !digest) return { verdict: "unchecked", detail: skip };
  const signBytes = encodeSignDoc({
    bodyBytes: params.bodyBytes,
    authInfoBytes: params.authInfoBytes,
    chainId: params.chainId,
    accountNumber: params.accountNumber,
  });
  if (verifies(signBytes, params.signature, params.pubKey, digest)) return { verdict: "valid", detail: null };
  const other: SignatureDigest = digest === "sha256" ? "keccak256" : "sha256";
  if (verifies(signBytes, params.signature, params.pubKey, other)) {
    return {
      verdict: "invalid",
      detail: `The direct signature is over the transaction's ${DIGEST_NAME[other]} digest; the chain checks ${DIGEST_NAME[digest]} for this key type.`,
    };
  }
  return { verdict: "invalid", detail: "The direct signature does not verify over the transaction's sign bytes." };
}

/** CosmJS `serializeSignDoc` (Keplr, Zunia Mobile): `&`, `<`, `>` escaped, U+2028 and U+2029 left as they are. */
function htmlEscapedBytes(doc: StdSignDoc): Uint8Array {
  const json = JSON.stringify(sortKeysDeep(doc)).replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return new TextEncoder().encode(json);
}

/** The Zunia extension up to 0.1.4: nothing escaped. */
function unescapedBytes(doc: StdSignDoc): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(sortKeysDeep(doc)));
}

/**
 * An amino signature, over the document the wallet returned as the chain
 * rebuilds it. When it fails, the serializations wallets are known to sign
 * instead are tried, only to say in the detail which one it was.
 */
export function checkAminoSignature(params: {
  signed: StdSignDoc;
  pubKey: Uint8Array;
  pubKeyTypeUrl: string;
  signature: Uint8Array;
}): SignatureCheck {
  const digest = signatureDigest(params.pubKeyTypeUrl);
  if (digest === "keccak256") {
    return {
      verdict: "unchecked",
      detail: "Not checked: with an Ethereum key the chain also accepts amino signed as EIP-712, which only the chain rebuilds.",
    };
  }
  const skip = uncheckable(params.pubKeyTypeUrl, params.pubKey, params.signature);
  if (skip || !digest) return { verdict: "unchecked", detail: skip };
  const chainBytes = serializeAminoSignDoc(params.signed);
  if (verifies(chainBytes, params.signature, params.pubKey, digest)) return { verdict: "valid", detail: null };
  const variants: ReadonlyArray<readonly [Uint8Array, string]> = [
    [htmlEscapedBytes(params.signed), "with U+2028 or U+2029 left unescaped, where the chain escapes them"],
    [unescapedBytes(params.signed), "without the chain's escaping of &, < and > (as the Zunia extension 0.1.4 and older sign it)"],
  ];
  for (const [bytes, how] of variants) {
    if (!bytesEqual(bytes, chainBytes) && verifies(bytes, params.signature, params.pubKey, digest)) {
      return { verdict: "invalid", detail: `The amino signature is over the document ${how}.` };
    }
  }
  return { verdict: "invalid", detail: "The amino signature does not verify over the document the chain rebuilds from this transaction." };
}
