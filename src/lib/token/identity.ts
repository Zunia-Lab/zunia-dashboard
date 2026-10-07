/**
 * Denom → identity: the dashboard's entry point to token naming.
 *
 * The rules are the extension's, ported whole into `./engine` (hash-verified
 * token table, canonical channels, ticker rules such as USDC.n / USDC.axl /
 * allUSDC, the collision guard, `IBC·XXXX` for what nothing proves). This
 * module wires them for the server: it installs the shipped catalog, plugs in
 * the LCD trace resolver and hands out the trimmed `TokenIdentity` that API
 * payloads carry.
 *
 * Server only: the tables are ~200 KB and the resolver reads chain LCDs.
 * Client code receives identities inside API payloads and imports only
 * `./types` (shapes) and `./text` (labels).
 *
 * Testing note: `node --conditions=import --import tsx` cannot load this
 * module (it imports the catalog JSON and `server-only`); tests import
 * `./engine` and install the catalog with `__tests__/catalog-fixture.ts`.
 */

import "server-only";
import "./catalog-data";

import { atOrigin, chainsHolding, identityForAssetKey, parseAssetKey } from "./asset-key";
import { findCatalogEntry } from "./catalog";
import { chainTicker, identifyHeld, identityOf, osmosisDenomOf, type HeldTokenIdentity } from "./engine";
import { lcdTraceResolver } from "./trace-resolver";
import { assetKeyOf, toTokenIdentity } from "./trim";
import type { TokenIdentity } from "./types";

export type { HeldTokenIdentity };
export { assetKeyOf, toTokenIdentity };
/** Asset keys: parse one, name its asset (at its origin), list the chains that hold it. See `./asset-key`. */
export { chainsHolding, identityForAssetKey, parseAssetKey };
/** A chain's staking ticker under the identity rule ("ATOM", "USDC.n", "SAF"); null for an unknown chain. */
export { chainTicker };
/** The canonical Osmosis voucher of an origin asset (verified and stable first), or null. */
export { osmosisDenomOf };

/** Denoms per `identifyDenoms` call; a bank page is 200, ten pages is the read cap. */
const MAX_DENOMS = 2_000;

/** Synchronous, table-only identification. Never touches the network. */
export function identifyDenom(chainId: string, denom: string): TokenIdentity {
  return toTokenIdentity(identityOf(chainId, denom));
}

/** The full record for server code that needs every field (pricing, markets). */
export function heldIdentity(chainId: string, denom: string): HeldTokenIdentity {
  return identityOf(chainId, denom);
}

/**
 * Identifies several denoms held on one chain, resolving unknown `ibc/`
 * vouchers through the chain's denom traces (hash-verified, at most 32 point
 * lookups per call, cached process-wide). Never rejects for an upstream
 * failure: what could not be traced comes back unknown (`IBC·XXXX`).
 */
export async function identifyDenoms(
  chainId: string,
  denoms: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<Map<string, TokenIdentity>> {
  const held = await identifyHeldDenoms(chainId, denoms, options);
  const out = new Map<string, TokenIdentity>();
  for (const [denom, identity] of held) out.set(denom, toTokenIdentity(identity));
  return out;
}

/** {@link identifyDenoms}, returning the full records. */
export async function identifyHeldDenoms(
  chainId: string,
  denoms: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<Map<string, HeldTokenIdentity>> {
  const bounded = denoms.slice(0, MAX_DENOMS);
  if (!findCatalogEntry(chainId)) {
    return new Map(bounded.map((denom) => [denom, identityOf(chainId, denom)]));
  }
  const held = await identifyHeld(chainId, bounded, {
    resolver: lcdTraceResolver,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return new Map(held);
}

/**
 * {@link identityForAssetKey} for a request: an `ibc/` key nothing in the
 * tables names is first traced on its chain's LCD (one hash-verified point
 * lookup, cached process-wide, misses remembered), so an asset page for a
 * voucher reached over a route the table lacks names the asset instead of
 * `IBC·XXXX`. Waits at most `budgetMs` for that lookup; past it, answers
 * from the tables (the lookup still lands for the next request).
 */
export async function resolveAssetKey(key: string, budgetMs = 5_000): Promise<HeldTokenIdentity | null> {
  const parsed = parseAssetKey(key);
  if (!parsed) return null;
  const held = identityOf(parsed.chainId, parsed.denom);
  if (held.provenance === "unknown" && parsed.denom.startsWith("ibc/") && findCatalogEntry(parsed.chainId)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lookup = identifyHeldDenoms(parsed.chainId, [parsed.denom]).then(
      (found) => found.get(parsed.denom) ?? held,
      () => held,
    );
    const late = new Promise<HeldTokenIdentity>((resolve) => {
      timer = setTimeout(() => resolve(held), budgetMs);
    });
    const traced = await Promise.race([lookup, late]).finally(() => clearTimeout(timer));
    return atOrigin(traced);
  }
  return atOrigin(held);
}
