/**
 * GET /api/portfolio/history?accounts=…&currency=usd|eur|gbp&range=1D|7D|30D|90D|1Y
 *
 * The value of today's holdings over time: Σ today's amount × historical
 * price, hourly up to 7 days and daily beyond, ending "now" at spot prices.
 * An estimate, and it says so (`estimate: true`, `method`, `coverage`); see
 * `lib/server/portfolio/history.ts`. Private (keyed by addresses). The price
 * series behind it are cached server side (30 min hourly, 6 h daily) and the
 * holdings for 30 s, so the curve follows the hero after a transfer.
 * Contract: `PortfolioHistoryResponse` in `lib/token/wire.ts`.
 *
 * No partial curves: when more than a sliver of today's value has no readable
 * history right now, the answer is a 503 rather than a curve of the rest —
 * `upstream_timeout` with `Retry-After: 5` while a series is only late (the
 * read keeps filling the cache, so a retry a few seconds later usually draws
 * the whole curve), `upstream_failed` when the sources failed.
 */

import type { NextRequest } from "next/server";
import { stillLoading } from "@/lib/server/chain/request";
import { parseAccounts } from "@/lib/server/portfolio/accounts";
import { HistoryIncomplete, portfolioHistory } from "@/lib/server/portfolio/history";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, parseEnum } from "@/lib/server/validate";
import type { FiatCurrency } from "@/lib/token/types";
import type { PortfolioHistoryRange } from "@/lib/token/wire";

export const runtime = "nodejs";

const CURRENCIES: readonly FiatCurrency[] = ["usd", "eur", "gbp"];
const RANGES: readonly PortfolioHistoryRange[] = ["1D", "7D", "30D", "90D", "1Y"];

export async function GET(req: NextRequest) {
  let accounts;
  let currency: FiatCurrency;
  let range: PortfolioHistoryRange;
  try {
    const params = req.nextUrl.searchParams;
    accounts = parseAccounts(params.get("accounts"));
    currency = parseEnum(params.get("currency")?.toLowerCase(), CURRENCIES, "usd", "currency");
    range = parseEnum(params.get("range")?.toUpperCase(), RANGES, "30D", "range");
  } catch (error) {
    return badRequest(error);
  }

  // Cheaper per chain than /api/portfolio: the holdings come from the same
  // 30 s cache and the price series are shared by every visitor, so a user
  // flipping 7D → 30D → 1Y on a wide scope is not throttled.
  const limited = rateLimit(req, {
    scope: "portfolio-history",
    capacity: 64,
    refillPerSecond: 1,
    cost: Math.max(1, Math.ceil(accounts.length / 4)),
  });
  if (limited) return limited;

  try {
    const body = await portfolioHistory(accounts, currency, range);
    return privateJson(body);
  } catch (error) {
    if (error instanceof HistoryIncomplete && error.loading) {
      return stillLoading("Price history is still loading; try again in a few seconds");
    }
    return upstreamFailure("The value history could not be computed right now.", 503);
  }
}
