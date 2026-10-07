/**
 * From the engine's full identity record to the `TokenIdentity` API payloads
 * carry. Pure, so the mapping (and the asset-key rule it applies) is tested.
 */

import type { HeldTokenIdentity } from "./engine";
import type { TokenIdentity } from "./types";

/**
 * The grouping key of an identity: the origin asset when proven, else the
 * location. See `TokenIdentity.key`.
 */
export function assetKeyOf(held: HeldTokenIdentity): string {
  if (held.proven && held.originChainId && held.originDenom) {
    return `${held.originChainId}:${held.originDenom}`;
  }
  return `${held.heldOnChainId}:${held.denom}`;
}

/** The full record, trimmed to what API payloads carry. */
export function toTokenIdentity(held: HeldTokenIdentity): TokenIdentity {
  const identity: TokenIdentity = {
    key: assetKeyOf(held),
    chainId: held.heldOnChainId,
    denom: held.denom,
    kind: held.kind,
    ticker: held.ticker,
    name: held.name,
    decimals: held.decimalsKnown ? held.decimals : null,
    provenance: held.provenance,
    proven: held.proven,
    testnet: held.testnet,
    chainName: held.heldOnChainName,
    family: held.family,
    alloyed: held.alloyed,
    listed: held.listed,
  };
  if (held.logoUrl) identity.logoUrl = held.logoUrl;
  if (held.originChainId) identity.originChainId = held.originChainId;
  if (held.originChainName) identity.originChainName = held.originChainName;
  if (held.originDenom) identity.originDenom = held.originDenom;
  if (held.coinGeckoId) identity.coinGeckoId = held.coinGeckoId;
  if (held.osmosisDenom) identity.osmosisDenom = held.osmosisDenom;
  if (held.path) identity.path = held.path;
  if (held.bridge) identity.bridge = held.bridge;
  if (held.aliases.length > 0) identity.aliases = [...held.aliases];
  return identity;
}
