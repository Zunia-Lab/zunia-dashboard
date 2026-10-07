/**
 * The crosschain-swaps contract's route table, and the live per-pair gate.
 *
 * The table (raw `config` → `swap_contract` → the swaprouter's paginated
 * contract state → its `routing_table` keys, src/lib/swap/xcs.ts) is read once
 * an hour per process: the router's owner can add routes at any time, and the
 * live gate below covers the gap, so a stale hour only costs UX. When the
 * table cannot be read every answer is `unknown`, which gates nothing.
 *
 * The table also carries each traded denom's proven origin (from token
 * identity), which is what lets the browser answer "no" for an asset that
 * provably is none of the table's (SAF), instead of "unknown".
 *
 * The live gate is the contract's own `get_route(input, output)` smart query,
 * read through the engine (`readXcsExecutableRoute`) with a 60 s cache: it is
 * what the contract will actually execute, so the contract path is only ever
 * priced along that route and only signed when it exists.
 */

import "server-only";

import { readXcsExecutableRoute, type XcsRouteRead } from "@zunialab/interchain";

import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { cached } from "@/lib/server/cache";
import { chainRegistry, lcdFor } from "@/lib/server/interchain";
import { restLcd } from "@/lib/server/swap/lcd";
import { readRoutingTable, tableDenoms, XCS_ROUTES_TTL_MS, type XcsDenomOrigin, type XcsRouteTable } from "@/lib/swap/xcs";
import { identifyDenom } from "@/lib/token/identity";

/** What the table's denoms are, from token identity; `null` where nothing proves one. */
function originsOf(table: XcsRouteTable): Record<string, XcsDenomOrigin | null> {
  const origins: Record<string, XcsDenomOrigin | null> = {};
  for (const denom of tableDenoms(table)) {
    const identity = identifyDenom(SWAP_VENUE_CHAIN_ID, denom);
    origins[denom] =
      identity.provenance !== "unknown" && identity.originChainId && identity.originDenom
        ? { originChainId: identity.originChainId, originDenom: identity.originDenom }
        : null;
  }
  return origins;
}

/**
 * The route table of `xcsContract`, read at most once an hour. Resolves
 * `null` when it cannot be read for any reason (an unreachable LCD, a router
 * this cannot parse): every pair is then `unknown` and nothing is gated.
 */
export async function loadXcsTable(xcsContract: string): Promise<XcsRouteTable | null> {
  const lcd = restLcd(SWAP_VENUE_CHAIN_ID, { timeoutMs: 10_000, retries: 1 });
  if (!lcd) return null;
  try {
    const table = await cached(
      `swap:xcs-table:${xcsContract}`,
      { ttlMs: XCS_ROUTES_TTL_MS, staleMs: XCS_ROUTES_TTL_MS, errorTtlMs: 60_000 },
      () => readRoutingTable(lcd, xcsContract),
    );
    // Identities are worked out per call, not cached with the table: the
    // identity tables can change under a running process (a deploy of the
    // token table), and the work is a few dozen synchronous lookups.
    return { ...table, origins: originsOf(table) };
  } catch {
    return null;
  }
}

/**
 * What the contract will execute for `vin` → `vout` right now: `ready` with
 * its pools, `missing` (no route: the packet would be refused and refunded),
 * or `unreadable` (the check failed; signing is refused, with other words).
 * Cached 60 s per pair.
 */
export async function xcsRouteGate(xcsContract: string, vin: string, vout: string): Promise<XcsRouteRead> {
  const lcd = lcdFor(chainRegistry.get(SWAP_VENUE_CHAIN_ID));
  if (!lcd) return { status: "unreadable" };
  try {
    return await cached(
      `swap:xcs-gate:${xcsContract}:${vin}:${vout}`,
      { ttlMs: 60_000, staleMs: 0, errorTtlMs: 10_000 },
      // The engine classifies wasmd's 500 "…not found" as `missing` from the
      // LCD error text, which is why this read goes through the engine's LCD
      // client rather than `fetchJson` (which never keeps an upstream body).
      () => readXcsExecutableRoute(lcd, xcsContract, vin, vout, { retries: 0, timeoutMs: 8_000, cacheTtlMs: 60_000 }),
    );
  } catch {
    return { status: "unreadable" };
  }
}
