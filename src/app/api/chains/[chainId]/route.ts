/**
 * GET /api/chains/[chainId][?currency=usd|eur|gbp]
 *
 * One chain's detail page in one read: its `ChainStats` (economics, block
 * status, slashing and gov parameters, native token price in `currency`),
 * the bonded set summary with the ten largest validators (for the
 * voting-power BarList), and how many proposals are open.
 *
 * → 200 `ChainDetailResponse` (`@/lib/chain/types`) · 400 unknown chain ·
 *   429 rate limited · 503 when nothing could be read, or (with Retry-After,
 *   `error: "upstream_timeout"`) when a cold read is still running.
 *
 * Replaces the indexer-history stub this path used to serve: an account's
 * history belongs to `/api/activity`, and a public chain page must not take
 * an address.
 */

import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson } from "@/lib/server/respond";
import { badRequest, parseChainId } from "@/lib/server/validate";
import type { ServerChainEntry } from "@/lib/server/chains";
import type { FiatCurrency } from "@/lib/token/types";
import { within } from "@/lib/server/chain/lcd";
import { allFailed, parseCurrency, SINGLE_CHAIN_BUDGET_MS, stillLoading } from "@/lib/server/chain/request";
import { readChainDetail, statsUnavailable } from "@/lib/server/chain/stats";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ chainId: string }> }) {
  let chain: ServerChainEntry;
  let currency: FiatCurrency;
  try {
    const { chainId } = await ctx.params;
    chain = parseChainId(decodeURIComponent(chainId));
    currency = parseCurrency(req.nextUrl.searchParams.get("currency"));
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, { scope: "chain-detail", capacity: 30, refillPerSecond: 1 });
  if (limited) return limited;

  const detail = await within(readChainDetail(chain, currency), SINGLE_CHAIN_BUDGET_MS, () => null);
  if (!detail) return stillLoading(`${chain.chainName} is still loading; try again in a few seconds`);
  if (statsUnavailable(detail.chain) && detail.validatorSet === null) {
    return allFailed(`${chain.chainName} could not be read right now`);
  }
  return publicJson(detail, { maxAge: 60, sMaxAge: 300, swr: 600 });
}
