/**
 * Re-encoding one account's address under another chain's bech32 prefix.
 *
 * `@zunialab/interchain` deliberately does not do this — it never derives an
 * address — so it lives in the host, which is the layer that knows the coin
 * type behind the connected account. The engine still owns validation
 * (`isValidBech32Address`, `bech32PrefixOf`); this file only re-encodes.
 *
 * Client-safe on purpose. Three call sites need it in the browser: prefilling
 * the recipient on a destination chain, deriving the crosschain-swap recovery
 * address on the venue chain, and telling the user which address a forwarded
 * packet will pass through.
 */

import { bech32 } from "bech32";
import type { ChainEntry } from "@/lib/chains";

/**
 * Re-encode `address` for `target`.
 *
 * Returns `null` — never a guess — when the two chains derive from different
 * keys. Cosmos accounts on the same SLIP-44 coin type share the same 20 bytes,
 * so a `cosmos1…` and an `osmo1…` are the same account; Ethermint chains on
 * coin type 60 are a different key entirely, and re-encoding across that
 * boundary would produce an address the user does not control.
 */
export function reencodeAddress(
  address: string,
  target: Pick<ChainEntry, "bech32Prefix" | "coinType">,
  source: Pick<ChainEntry, "coinType">,
): string | null {
  if (target.coinType !== source.coinType) return null;
  try {
    const decoded = bech32.decode(address, 200);
    return bech32.encode(target.bech32Prefix, decoded.words, 200);
  } catch {
    return null;
  }
}

/**
 * The same address on every chain in `targets` that shares the source's coin
 * type, keyed by chain id.
 *
 * This is what `PlanRouteOptions.intermediateReceivers` wants: without a real
 * address for an intermediate chain the planner falls back to the literal
 * `"pfm"` placeholder and warns, and that placeholder is the one field in the
 * whole flow where a wrong value loses funds.
 */
export function addressesForChains(
  address: string,
  source: Pick<ChainEntry, "coinType">,
  targets: readonly ChainEntry[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const target of targets) {
    const encoded = reencodeAddress(address, target, source);
    if (encoded !== null) out[target.chainId] = encoded;
  }
  return out;
}
