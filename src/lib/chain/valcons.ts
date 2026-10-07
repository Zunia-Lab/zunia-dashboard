/**
 * Address derivations around a validator.
 *
 * - **Consensus address** (`<prefix>valcons1…`): what x/slashing keys signing
 *   info by. Validators list only their consensus *public key*, so joining
 *   uptime to the validator set means deriving the address the same way
 *   CometBFT does: the first 20 bytes of SHA-256 of an ed25519 key, or
 *   RIPEMD-160(SHA-256(key)) for a secp256k1 consensus key. The join itself
 *   compares the 20 bytes (`consensusHex` / `addressHex`), not bech32
 *   strings, because not every chain uses the default `valcons` prefix.
 * - **Operator account** (`<prefix>1…`): the valoper bytes on the account
 *   prefix. It is the validator's own account, which is how self-delegation
 *   and the validator's governance vote are read.
 *
 * Pure (hash libraries only), so `node --test` covers it.
 */

import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64 } from "@scure/base";
import { bech32 } from "bech32";

/** Longer than the 90-char BIP-173 default: Cosmos prefixes can be long. */
const BECH32_LIMIT = 200;

export interface ConsensusPubkey {
  /** `@type` of the key, e.g. `/cosmos.crypto.ed25519.PubKey`. */
  typeUrl: string;
  /** Base64 key bytes. */
  key: string;
}

/** The 20-byte consensus address of a consensus public key, or null. */
export function consensusAddressBytes(pubkey: ConsensusPubkey): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = base64.decode(pubkey.key);
  } catch {
    return null;
  }
  if (pubkey.typeUrl.endsWith("ed25519.PubKey")) {
    if (bytes.length !== 32) return null;
    return sha256(bytes).slice(0, 20);
  }
  if (pubkey.typeUrl.endsWith("secp256k1.PubKey")) {
    if (bytes.length !== 33) return null;
    return ripemd160(sha256(bytes));
  }
  return null;
}

/**
 * `<consensusPrefix>1…` for a consensus public key, or null.
 *
 * `consensusPrefix` defaults to `<accountPrefix>valcons`, the SDK default;
 * pass the chain's real one when it differs (`consensusPrefixFor`).
 */
export function valconsAddress(
  pubkey: ConsensusPubkey | null,
  accountPrefix: string,
  consensusPrefix = `${accountPrefix}valcons`,
): string | null {
  if (!pubkey) return null;
  const bytes = consensusAddressBytes(pubkey);
  if (!bytes) return null;
  try {
    return bech32.encode(consensusPrefix, bech32.toWords(bytes), BECH32_LIMIT);
  } catch {
    return null;
  }
}

/**
 * The consensus-address prefix that goes with a validator operator address.
 *
 * The SDK builds both from one root: `<root>valoper` / `<root>valcons`. A few
 * chains configured their own: Crypto.org (Cronos POS) uses `crocncl` for
 * operators and `crocnclcons` for consensus addresses, so the default
 * `crovalcons` matches none of its signing infos. Rule: a `…valoper` prefix
 * swaps `oper` for `cons`; any other operator prefix gets `cons` appended.
 * Signing infos carry the real prefix too; `signingIndex` prefers that.
 */
export function consensusPrefixFor(operatorAddress: string, accountPrefix: string): string {
  const operatorPrefix = bech32Prefix(operatorAddress);
  if (!operatorPrefix) return `${accountPrefix}valcons`;
  if (operatorPrefix.endsWith("valoper")) return `${operatorPrefix.slice(0, -"oper".length)}cons`;
  return `${operatorPrefix}cons`;
}

/** Lower-case hex of an address's bytes, whatever its prefix; null when not bech32. */
export function addressHex(address: string): string | null {
  try {
    return toHex(bech32.fromWords(bech32.decode(address, BECH32_LIMIT).words));
  } catch {
    return null;
  }
}

/** Lower-case hex of a consensus key's 20-byte address, or null. */
export function consensusHex(pubkey: ConsensusPubkey | null): string | null {
  const bytes = pubkey ? consensusAddressBytes(pubkey) : null;
  return bytes ? toHex(bytes) : null;
}

function toHex(bytes: ArrayLike<number>): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    out += (bytes[index] ?? 0).toString(16).padStart(2, "0");
  }
  return out;
}

/** Re-encodes any bech32 address under `prefix` (same bytes), or null. */
export function reencode(address: string, prefix: string): string | null {
  try {
    const decoded = bech32.decode(address, BECH32_LIMIT);
    return bech32.encode(prefix, decoded.words, BECH32_LIMIT);
  } catch {
    return null;
  }
}

/** The operator's own account address: valoper bytes on the account prefix. */
export function operatorAccount(operatorAddress: string, accountPrefix: string): string | null {
  return reencode(operatorAddress, accountPrefix);
}

/** Bech32 prefix of an address, or null when it does not decode. */
export function bech32Prefix(address: string): string | null {
  try {
    return bech32.decode(address, BECH32_LIMIT).prefix;
  } catch {
    return null;
  }
}
