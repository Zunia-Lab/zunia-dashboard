/**
 * GET /api/prices?keys=<assetKey>,…&currency=usd|eur|gbp
 *
 * Spot prices by asset key (`TokenIdentity.key`, e.g. `cosmoshub-4:uatom`,
 * `noble-1:uusdc`, `safrochain-1:usaf`; a location key such as
 * `osmosis-1:ibc/2739…` resolves to its proven origin). At most 100 keys.
 * Each price carries its source and label; a key with no price is `null` with
 * the reason in `unpriced`. Public market data.
 * Contract: `PricesResponse` in `lib/token/wire.ts`.
 */

import type { NextRequest } from "next/server";
import { getSpotPrices } from "@/lib/server/prices/spot";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, ParamError, parseEnum } from "@/lib/server/validate";
import { identityForAssetKey, toTokenIdentity } from "@/lib/token/identity";
import type { FiatCurrency, SpotPrice, TokenIdentity } from "@/lib/token/types";
import type { PricesResponse, UnpricedReason } from "@/lib/token/wire";

export const runtime = "nodejs";

const CURRENCIES: readonly FiatCurrency[] = ["usd", "eur", "gbp"];
const MAX_KEYS = 100;

export async function GET(req: NextRequest) {
  let currency: FiatCurrency;
  const requested = new Map<string, TokenIdentity>();
  try {
    const params = req.nextUrl.searchParams;
    currency = parseEnum(params.get("currency")?.toLowerCase(), CURRENCIES, "usd", "currency");
    const keys = [...new Set((params.get("keys") ?? "").split(",").map((key) => key.trim()).filter(Boolean))];
    if (keys.length === 0) throw new ParamError("keys_required", "keys is required (assetKey,…)");
    if (keys.length > MAX_KEYS) throw new ParamError("keys_too_many", `At most ${MAX_KEYS} keys per request`);
    for (const key of keys) {
      const held = identityForAssetKey(key);
      if (!held) throw new ParamError("key_invalid", `Not an asset key: ${key.slice(0, 80)}`);
      requested.set(key, toTokenIdentity(held));
    }
  } catch (error) {
    return badRequest(error);
  }

  // Each distinct key can cost an upstream read on a cold cache; a client
  // walking every asset key must not spend everyone's upstream budget.
  const limited = rateLimit(req, { scope: "prices", capacity: 120, refillPerSecond: 4, cost: 1 });
  if (limited) return limited;

  try {
    const spot = await getSpotPrices([...requested.values()], currency);
    const prices: Record<string, SpotPrice | null> = {};
    const unpriced: Record<string, UnpricedReason> = {};
    for (const [key, identity] of requested) {
      const price = spot.prices.get(identity.key) ?? null;
      prices[key] = price;
      if (!price) unpriced[key] = spot.unpriced.get(identity.key) ?? "no-market";
    }
    const body: PricesResponse = { currency: spot.currency, updatedAt: Date.now(), prices, unpriced };
    if (spot.currencyFallback) body.currencyFallback = spot.currencyFallback;
    if (spot.errors.length > 0) body.errors = spot.errors;
    return publicJson(body, { maxAge: 30, sMaxAge: 60, swr: 300 });
  } catch {
    return upstreamFailure("Prices are unavailable right now.", 503);
  }
}
