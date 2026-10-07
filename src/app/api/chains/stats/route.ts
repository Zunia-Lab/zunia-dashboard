/**
 * GET /api/chains/stats?chains=<csv, ≤ 40>[&currency=usd|eur|gbp]
 *
 * Staking economics and decentralisation figures per chain — naive vs actual
 * APR, actual inflation, real yield, bonded ratio, unbonding, Nakamoto
 * coefficient, block time, halt flag, slashing and gov parameters — for the
 * Chains compare table, Compare, Overview's chain header and Insights. Each
 * chain's native token price is in `currency` (default usd).
 *
 * → 200 `ChainStatsResponse` (`@/lib/chain/types`), chains in request order;
 *   a chain that partly failed still has its other figures, with `reasons`
 *   and `errors` saying what is missing.
 * → 400 bad input · 429 rate limited · 503 when every chain was read and none
 *   answered. A chain past the request budget is listed in `errors` ("Timed
 *   out") with a 200, never a 503: it is still loading, not down.
 *
 * Public, identical for every visitor: cached by the browser and Cloudflare
 * (60 s / 5 min) on top of the server-side reads (30–60 min for economics).
 */

import type { NextRequest } from "next/server";
import { mapLimit } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson } from "@/lib/server/respond";
import { badRequest, ParamError, parseChainList } from "@/lib/server/validate";
import type { FiatCurrency } from "@/lib/token/types";
import type { ChainStats, ChainStatsResponse, PartError } from "@/lib/chain/types";
import { allFailed, oldest, parseCurrency, unknownChainErrors } from "@/lib/server/chain/request";
import { attachNativePrices, readChainStats, statsUnavailable } from "@/lib/server/chain/stats";
import { remaining, within } from "@/lib/server/chain/lcd";

export const runtime = "nodejs";

/**
 * A cold chain needs ~15 reads; past this request-wide budget the response
 * goes out without the chains still loading (their reads finish into the
 * cache, so the next request has them).
 */
const BUDGET_MS = 12_000;

export async function GET(req: NextRequest) {
  let parsed: ReturnType<typeof parseChainList>;
  let currency: FiatCurrency;
  try {
    parsed = parseChainList(req.nextUrl.searchParams.get("chains"), 40);
    if (parsed.chains.length === 0 && parsed.unknown.length === 0) {
      throw new ParamError("chains_required", "chains is required (comma-separated chain ids)");
    }
    currency = parseCurrency(req.nextUrl.searchParams.get("currency"));
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, {
    scope: "chain-stats",
    capacity: 40,
    refillPerSecond: 0.5,
    cost: Math.max(1, Math.ceil(parsed.chains.length / 4)),
  });
  if (limited) return limited;

  // A slow chain keeps loading into the cache after the deadline; this
  // response lists it as timed out instead of holding every other chain.
  const startedAt = Date.now();
  const results = await mapLimit(parsed.chains, 20, (chain) =>
    within<{ stats: ChainStats | null; asOf: number | null }>(
      readChainStats(chain),
      remaining(startedAt, BUDGET_MS),
      () => ({ stats: null, asOf: null }),
    ),
  );

  const chains: ChainStats[] = [];
  const errors: PartError[] = unknownChainErrors(parsed.unknown);
  const times: Array<number | null> = [];
  let timedOut = 0;
  results.forEach((result, index) => {
    const chain = parsed.chains[index];
    if (!result.stats) {
      timedOut += 1;
      if (chain) errors.push({ chainId: chain.chainId, scope: "chain", message: "Timed out; try again shortly" });
      return;
    }
    chains.push(result.stats);
    times.push(result.asOf);
  });

  // A chain still loading is not a failure: its read finishes into the cache
  // and the next poll has it. So a timeout always answers 200, with the
  // per-chain `errors` saying which chains are still loading — the compare
  // views can then say "loading" rather than "could not be read". Only when
  // every chain was actually read, and every one failed, is it a 503.
  if (parsed.chains.length > 0 && timedOut === 0 && chains.every(statsUnavailable)) {
    return allFailed("No requested chain could be read right now");
  }

  const body: ChainStatsResponse = {
    updatedAt: oldest(times),
    currency,
    chains: await attachNativePrices(chains, currency),
    ...(parsed.unknown.length ? { unknown: parsed.unknown } : {}),
    ...(errors.length ? { errors } : {}),
  };
  return publicJson(body, { maxAge: 60, sMaxAge: 300, swr: 600 });
}
