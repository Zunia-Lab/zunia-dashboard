/**
 * Price a swap and say how it would be signed.
 *
 * POST /api/swap/quote   (application/json, same origin only)
 *   {fromChainId, fromDenom, toChainId, toDenom, amount, slippagePercent,
 *    fromVenueDenom?, toVenueDenom?}
 *   `amount` is base units of `fromDenom` NET of the 0.5% Zunia fee (the
 *   browser computes `swapFeeFor` first; the fee never reaches the venue).
 * → 200 SwapQuoteOk      the path, the price, the floor, the route and every
 *                         proved fact the messages are built from
 *                         (src/lib/swap/wire.ts)
 * → 200 {updatedAt, blocked:{code, message}, path?, preview?}
 *                         the pair cannot be swapped, for the reason given
 * → 400 {error, message}  bad input (including a body that is not JSON)
 * → 403 {error, message}  a request from another site
 * → 429                   rate limited
 * → 503 {error:"upstream_failed", message}  the Osmosis router is unreachable,
 *                         or the quote took longer than a price lives (20 s)
 *
 * Same origin only: a cross-site page could otherwise make every visitor's
 * browser spend this server's upstream budget (router, LCDs). Private
 * (`no-store`): a quote is keyed by what one wallet is about to sell. Rate
 * limited per client: a cold quote can fan out to the router and three LCDs
 * (route gate, traces, both channel ends).
 */

import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";
import { badRequest } from "@/lib/server/validate";
import { QuoteUnavailable, quoteSwapWithin } from "@/lib/server/swap/quote";
import { parseQuoteRequest, readBoundedJson } from "@/lib/server/swap/request";
import { sameOriginProblem } from "@/lib/tx/server/request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const foreign = sameOriginProblem(req);
  if (foreign) return foreign;
  const limited = rateLimit(req, { scope: "swap-quote", capacity: 30, refillPerSecond: 0.5 });
  if (limited) return limited;

  let request;
  try {
    request = parseQuoteRequest(await readBoundedJson(req));
  } catch (error) {
    return badRequest(error);
  }

  try {
    return privateJson(await quoteSwapWithin(request));
  } catch (error) {
    const message =
      error instanceof QuoteUnavailable ? error.message : "The swap could not be priced right now. Try again in a moment.";
    return privateJson({ error: "upstream_failed", message }, { status: 503 });
  }
}
