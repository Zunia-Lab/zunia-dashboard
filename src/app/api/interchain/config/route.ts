/**
 * Whether this deployment can build a crosschain swap, and why not when it
 * cannot.
 *
 * The swap page asks this first and disables everything with `reason` until it
 * comes back `available`. That ordering matters: without it the form would
 * accept an amount, plan a route and only fail at signing, which is the worst
 * possible moment to discover the contract address was never configured.
 */

import { swapVenueConfig } from "@/lib/server/swap-venue";

export const runtime = "nodejs";

export async function GET() {
  const venue = await swapVenueConfig();
  return Response.json({
    ok: true,
    config: {
      available: venue.available,
      chainId: venue.chainId,
      chainName: venue.chainName,
      contractAddress: venue.contractAddress,
      configured: venue.configured,
      verified: venue.verified,
      reason: venue.reason,
      configKey: venue.configKey,
      routerConfigured: venue.routerConfigured,
      defaultSlippagePercent: venue.defaultSlippagePercent,
    },
  });
}
