/**
 * What a wallet needs to add a chain it does not know.
 *
 * GET /api/account/chain-info?chainId=<catalog id> → 200 SuggestChainInfo
 * (Keplr's `ChainInfo` shape, see `@/lib/connect/suggest`).
 *
 * Lives on the server because the browser's catalog carries no endpoints, by
 * design; the wallet, not the dashboard, will talk to these nodes. Public,
 * identical for every visitor, and cached like the catalog it comes from.
 */

import type { NextRequest } from "next/server";
import { buildSuggestChainInfo, SuggestUnavailableError } from "@/lib/connect/suggest";
import { publicJson } from "@/lib/server/respond";
import { badRequest, parseChainId } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  let chain;
  try {
    chain = parseChainId(req.nextUrl.searchParams.get("chainId"));
  } catch (error) {
    return badRequest(error);
  }
  try {
    return publicJson(
      { ...buildSuggestChainInfo(chain), updatedAt: Date.now() },
      { maxAge: 3_600, sMaxAge: 3_600, swr: 86_400 },
    );
  } catch (error) {
    // Never a framework 500 page: the caller is a connect flow that shows
    // `message` as the reason the wallet could not add the chain.
    const message =
      error instanceof SuggestUnavailableError ? error.message : `${chain.chainName} cannot be described to a wallet right now.`;
    return Response.json(
      { error: error instanceof SuggestUnavailableError ? "no_endpoint" : "unavailable", message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
