/**
 * GET /api/markets?currency=usd|eur|gbp
 *
 * Cosmos assets traded on Osmosis (Numia, ≥ $1,000 pool liquidity, one row
 * per asset, named by token identity) plus SAF from Coinstore SAF/USDT, with
 * 7-day sparklines for the 40 most liquid. Public market data: identical for
 * every visitor, so Cloudflare and the browser may cache it briefly.
 * Contract: `MarketsResponse` in `lib/token/wire.ts`; rules in
 * `lib/server/prices/markets.ts`.
 */

import type { NextRequest } from "next/server";
import { getMarkets } from "@/lib/server/prices/markets";
import { publicJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, parseEnum } from "@/lib/server/validate";
import type { FiatCurrency } from "@/lib/token/types";

export const runtime = "nodejs";

const CURRENCIES: readonly FiatCurrency[] = ["usd", "eur", "gbp"];

export async function GET(req: NextRequest) {
  let currency: FiatCurrency;
  try {
    currency = parseEnum(req.nextUrl.searchParams.get("currency")?.toLowerCase(), CURRENCIES, "usd", "currency");
  } catch (error) {
    return badRequest(error);
  }
  try {
    return publicJson(await getMarkets(currency), { maxAge: 60, sMaxAge: 120, swr: 600 });
  } catch {
    return upstreamFailure("Market data is unavailable right now. Try again in a moment.", 503);
  }
}
