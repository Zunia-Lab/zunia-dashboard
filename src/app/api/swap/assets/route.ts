/**
 * What a swap can deliver, from Osmosis's side.
 *
 * GET /api/swap/assets[?network=mainnet|testnet][&fromChainId=<catalog chain id>]
 * → 200 SwapAssetsResponse (src/lib/swap/wire.ts):
 *   {updatedAt, venue:"osmosis-1", network, assets: SwapAsset[], routeTable,
 *    contract, counts:{listed, identified}, priceSource, errors?}
 *   The answer depends on the From's network only (a testnet From gets no
 *   rows, since the only venue is Osmosis mainnet), so `network` is the
 *   parameter to send: one URL per network keeps one cached copy, at the edge
 *   and in the browser. `fromChainId` is still read (its network wins over
 *   `network`) for callers that have a chain at hand. Held balances and every
 *   chain's own coin are added in the browser (src/lib/swap/assets.ts
 *   `buyOptions`).
 * → 400 {error, message}  unknown chain id or network
 * → 429                   rate limited
 * → 503 {error:"upstream_failed", message}  the Osmosis router is unreachable
 *
 * Public market data, identical for every visitor: cached briefly at the edge.
 */

import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson } from "@/lib/server/respond";
import { badRequest, parseChainId, parseEnum } from "@/lib/server/validate";
import { AssetsUnavailable, swapAssets } from "@/lib/server/swap/assets";

export const runtime = "nodejs";

const NETWORKS = ["mainnet", "testnet"] as const;

export async function GET(req: Request) {
  const limited = rateLimit(req, { scope: "swap-assets", capacity: 20, refillPerSecond: 1 });
  if (limited) return limited;

  let network: "mainnet" | "testnet";
  try {
    const params = new URL(req.url).searchParams;
    const fromChainId = params.get("fromChainId");
    network =
      fromChainId !== null && fromChainId !== ""
        ? parseChainId(fromChainId, "fromChainId").network
        : parseEnum(params.get("network"), NETWORKS, "mainnet", "network");
  } catch (error) {
    return badRequest(error);
  }

  try {
    return publicJson(await swapAssets(network), { maxAge: 30, sMaxAge: 60, swr: 300 });
  } catch (error) {
    const message =
      error instanceof AssetsUnavailable ? error.message : "The tokens Osmosis trades could not be listed right now.";
    return Response.json(
      { error: "upstream_failed", message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
