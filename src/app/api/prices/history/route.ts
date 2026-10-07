/**
 * GET /api/prices/history?key=<assetKey>&range=1D|7D|30D|90D|1Y&currency=usd|eur|gbp
 *
 * One asset's price history: hourly for 1D/7D, daily beyond, from the source
 * the pricing rule picks (Coinstore for SAF, Numia by Osmosis denom, else
 * CoinGecko), ending on the newest price. `coverage` says how far back the
 * data really goes. An Osmosis denom the pricing rule refuses (unknown
 * origin, unlisted) is charted from its own Osmosis market, the one Markets
 * lists, never from the asset it claims to be; anything else that may not be
 * priced (testnet, an unknown voucher off Osmosis) answers with no points and
 * `source: null`. Public market data, cached at the source (30 min hourly,
 * 6 h daily). Contract: `PriceHistoryResponse` in `lib/token/wire.ts`.
 *
 * EUR and GBP are USD history converted at today's rate (there is no
 * historical FX source here), and the answer says so in `note`, so a past
 * high or low is never shown as if it were the price people paid in pounds.
 */

import type { NextRequest } from "next/server";
import { getPriceHistory } from "@/lib/server/prices/history";
import { roundSignificant } from "@/lib/server/prices/series";
import { currencyContext } from "@/lib/server/prices/spot";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, ParamError, parseEnum } from "@/lib/server/validate";
import { parseAssetKey, resolveAssetKey, toTokenIdentity } from "@/lib/token/identity";
import type { FiatCurrency, PriceRange, TokenIdentity } from "@/lib/token/types";
import type { PriceHistoryResponse } from "@/lib/token/wire";

export const runtime = "nodejs";

const CURRENCIES: readonly FiatCurrency[] = ["usd", "eur", "gbp"];
const RANGES: readonly PriceRange[] = ["1D", "7D", "30D", "90D", "1Y"];

export async function GET(req: NextRequest) {
  let currency: FiatCurrency;
  let range: PriceRange;
  let key: string;
  try {
    const params = req.nextUrl.searchParams;
    currency = parseEnum(params.get("currency")?.toLowerCase(), CURRENCIES, "usd", "currency");
    range = parseEnum(params.get("range")?.toUpperCase(), RANGES, "7D", "range");
    key = (params.get("key") ?? "").trim();
    if (!key) throw new ParamError("key_required", "key is required");
    if (!parseAssetKey(key)) throw new ParamError("key_invalid", "Not an asset key (chainId:denom)");
  } catch (error) {
    return badRequest(error);
  }

  // Each distinct key can cost an upstream read on a cold cache; a client
  // walking every asset key must not spend everyone's upstream budget.
  const limited = rateLimit(req, { scope: "price-history", capacity: 60, refillPerSecond: 1, cost: 1 });
  if (limited) return limited;

  const held = await resolveAssetKey(key);
  if (!held) return badRequest(new ParamError("key_invalid", "Not an asset key (chainId:denom)"));
  const identity: TokenIdentity = toTokenIdentity(held);

  try {
    const context = await currencyContext(currency, true);
    const { history, errors } = await getPriceHistory(identity, range, { usdtUsd: context.usdtUsd, market: true });
    // Every source that could have answered failed: that is an outage, not "no history".
    if (history.source === null && errors.length > 0) {
      return upstreamFailure("Price history is unavailable right now.", 503);
    }
    // `note` says what a non-USD chart is: USD history at today's rate, the
    // same sentence /api/portfolio/history sends. It rides outside
    // `PriceHistoryResponse` until lib/token/wire.ts declares it there.
    const body: PriceHistoryResponse & { note?: string } = {
      key: identity.key,
      range,
      currency: context.currency,
      resolution: history.resolution,
      points: history.points.map((point) => ({ t: point.t, v: roundSignificant(point.v * context.rate) })),
      source: history.source,
      label: history.label,
      coverage: history.coverage,
      updatedAt: Date.now(),
    };
    if (context.currencyFallback) body.currencyFallback = context.currencyFallback;
    if (context.currency !== "usd" && body.points.length > 0) {
      body.note = `USD price history converted at today's ${context.currency.toUpperCase()} rate`;
    }
    const issues = [...context.errors, ...errors];
    if (issues.length > 0) body.errors = issues;
    return publicJson(body, { maxAge: 120, sMaxAge: 300, swr: 1800 });
  } catch {
    return upstreamFailure("Price history is unavailable right now.", 503);
  }
}
