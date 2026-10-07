/**
 * Which public-key type a chain verifies.
 *
 * The 33-byte compressed key is the same for every secp256k1 flavour; the
 * `Any` type URL around it tells the chain which signature scheme to check
 * (SHA-256 for Cosmos chains, keccak256 for the Ethereum-key family). It is
 * part of the signed `AuthInfo`, so a wrong URL is a signature that verifies
 * against nothing.
 *
 * Order of authority:
 * 1. the type the chain already recorded for this account (an account that
 *    has signed before carries its key on chain — the most reliable answer);
 * 2. the catalog's explicit `ethPubKeyTypeUrl` (Injective);
 * 3. the Keplr-registry feature flags the catalog carries
 *    (`eth-secp256k1-cosmos` → cosmos/evm, `eth-secp256k1-initia` → Initia);
 * 4. any other Ethereum-key chain (coin type 60 / `eth-key-sign`) → Ethermint;
 * 5. everything else → Cosmos secp256k1.
 *
 * Mirrors the rule Keplr applies when it builds the same `AuthInfo`, and
 * zunia-core `SignerData::pubkey_type_url`.
 */

import { COSMOS_PUBKEY_TYPE_URL, ETHERMINT_PUBKEY_TYPE_URL } from "./encode";

export const INJECTIVE_PUBKEY_TYPE_URL = "/injective.crypto.v1beta1.ethsecp256k1.PubKey";
export const COSMOS_EVM_PUBKEY_TYPE_URL = "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey";
export const INITIA_PUBKEY_TYPE_URL = "/initia.crypto.v1beta1.ethsecp256k1.PubKey";

/** The catalog fields this needs; `ChainEntry` satisfies it. */
export interface KeyChain {
  chainId: string;
  coinType: number;
  features?: string[];
  /** Present in the catalog for Injective; read structurally. */
  ethPubKeyTypeUrl?: string;
}

/** True when the chain derives addresses and verifies signatures Ethereum-style. */
export function isEthKeyChain(chain: KeyChain): boolean {
  return chain.coinType === 60 || Boolean(chain.features?.includes("eth-key-sign"));
}

export function pubKeyTypeUrlFor(chain: KeyChain, onChainTypeUrl?: string | null): string {
  // The proto-JSON spelling starts with "/"; the legacy amino spelling
  // ("tendermint/PubKeySecp256k1") is not a type URL and is ignored.
  if (onChainTypeUrl && onChainTypeUrl.startsWith("/") && /PubKey$/.test(onChainTypeUrl)) {
    return onChainTypeUrl;
  }
  const explicit = (chain as { ethPubKeyTypeUrl?: unknown }).ethPubKeyTypeUrl;
  if (typeof explicit === "string" && explicit.startsWith("/")) return explicit;
  if (!isEthKeyChain(chain)) return COSMOS_PUBKEY_TYPE_URL;
  if (chain.chainId.startsWith("injective")) return INJECTIVE_PUBKEY_TYPE_URL;
  if (chain.features?.includes("eth-secp256k1-cosmos")) return COSMOS_EVM_PUBKEY_TYPE_URL;
  if (chain.features?.includes("eth-secp256k1-initia")) return INITIA_PUBKEY_TYPE_URL;
  return ETHERMINT_PUBKEY_TYPE_URL;
}
