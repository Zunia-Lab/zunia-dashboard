/**
 * Asset keys (`TokenIdentity.key`): parsing one from a request and naming the
 * asset it points at. Pure (tables only, no I/O), so the rules are tested;
 * `./identity` re-exports these for server code and adds the LCD-traced
 * `resolveAssetKey`.
 */

import { identityOf, isKnownChain, tokenTableRows, type HeldTokenIdentity } from "./engine";
import { assetKeyOf } from "./trim";

/**
 * A bank denom: a letter, then letters, digits and `/:._-`, at most 128
 * characters (the SDK's rule, relaxed to two characters because Union's `au`
 * and Function X's `FX` are real). Anything else (`../x`, spaces) cannot be
 * held anywhere, so it is never looked up or echoed back as a token.
 */
const BANK_DENOM = /^[A-Za-z][A-Za-z0-9/:._-]{1,127}$/;

/**
 * `chainId:denom` from an asset key (the chain id never contains a colon; the
 * denom may: `injective-1:erc20:0x…`). Null when the shape is wrong or no
 * bundled data names the chain (the catalog, or the token table, which also
 * knows issuers the catalog lacks: `stargaze-1:ustars` is a valid key).
 */
export function parseAssetKey(key: string): { chainId: string; denom: string } | null {
  if (key.length > 200) return null;
  const split = key.indexOf(":");
  if (split <= 0 || split === key.length - 1) return null;
  const chainId = key.slice(0, split);
  const denom = key.slice(split + 1);
  if (!isKnownChain(chainId)) return null;
  if (!BANK_DENOM.test(denom)) return null;
  return { chainId, denom };
}

/**
 * The identity an asset key names, read at the asset's origin when the key is
 * an origin key. A location key of a proven voucher resolves to the same
 * record its origin key does, so `/assets/osmosis-1:ibc/2739…` and
 * `/assets/cosmoshub-4:uatom` show one asset.
 */
export function identityForAssetKey(key: string): HeldTokenIdentity | null {
  const parsed = parseAssetKey(key);
  if (!parsed) return null;
  return atOrigin(identityOf(parsed.chainId, parsed.denom));
}

/**
 * A proven voucher's record at its origin, when the origin names the same
 * asset (ATOM on Osmosis → ATOM on the Hub); anything else as it is.
 */
export function atOrigin(held: HeldTokenIdentity): HeldTokenIdentity {
  if (held.proven && held.originChainId && held.originDenom && held.heldOnChainId !== held.originChainId) {
    const origin = identityOf(held.originChainId, held.originDenom);
    if (assetKeyOf(origin) === assetKeyOf(held)) return origin;
  }
  return held;
}

/**
 * Chains the token table knows this asset to be held on (its vouchers and the
 * issuer itself), for "available on" lines. Bundled data only.
 */
export function chainsHolding(assetKey: string): string[] {
  const out = new Set<string>();
  const parsed = parseAssetKey(assetKey);
  if (parsed) out.add(parsed.chainId);
  for (const row of tokenTableRows()) {
    if (assetKeyOf(identityOf(row.heldOnChainId, row.denom)) === assetKey) out.add(row.heldOnChainId);
  }
  return [...out];
}
