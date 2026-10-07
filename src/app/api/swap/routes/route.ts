/**
 * The crosschain-swaps venue and its route table, for diagnostics.
 *
 * GET /api/swap/routes
 * → 200 SwapRoutesResponse (src/lib/swap/wire.ts):
 *   {updatedAt, venue:{chainId, contract:{address, verified, label, codeId}|null, reason},
 *    table: XcsRouteTable|null, summary:{routes, denoms, readAt}, errors?}
 *   `table` is the swaprouter's routing table as read off the chain (cached an
 *   hour) with each denom's proven origin; `null` when it could not be read,
 *   which gates no pair.
 *
 * Public chain data: cached briefly at the edge.
 */

import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson } from "@/lib/server/respond";
import { swapVenue } from "@/lib/server/swap/venue";
import { loadXcsTable } from "@/lib/server/swap/xcs-table";
import type { SwapRoutesResponse } from "@/lib/swap/wire";
import { tableDenoms } from "@/lib/swap/xcs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const limited = rateLimit(req, { scope: "swap-routes", capacity: 10, refillPerSecond: 0.5 });
  if (limited) return limited;

  const venue = await swapVenue();
  const table = venue.address ? await loadXcsTable(venue.address) : null;
  const errors =
    venue.address && !table
      ? [{ scope: "route-table", message: "The swap contract's route table could not be read." }]
      : [];
  const body: SwapRoutesResponse = {
    updatedAt: Date.now(),
    venue: { chainId: venue.chainId, contract: venue.contract, reason: venue.reason },
    table,
    summary: {
      routes: table?.routes.length ?? 0,
      denoms: table ? tableDenoms(table).length : 0,
      readAt: table?.readAt ?? null,
    },
    ...(errors.length > 0 ? { errors } : {}),
  };
  return publicJson(body, { maxAge: 60, sMaxAge: 300, swr: 600 });
}
