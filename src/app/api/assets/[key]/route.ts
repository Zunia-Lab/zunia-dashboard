/**
 * GET /api/assets/[key]?currency=usd|eur|gbp
 *
 * The public half of an asset page: who the asset is (token identity), its
 * market (price, 24 h / 7 d, volume, liquidity, market cap, with the source
 * that gave them), CoinGecko's supply and all-time figures when the asset has
 * an id of its own, 30 days of daily prices, and the chains the verified token
 * table knows it to be held on. `key` is an asset key, URL-encoded
 * (`cosmoshub-4%3Auatom`, `osmosis-1%3Aibc%2F2739…`); a location key of a
 * proven voucher resolves to its origin, so both URLs show one asset, and an
 * `ibc/` key the tables do not know is traced on its chain first.
 *
 * An Osmosis denom the pricing rule refuses (unknown origin, unlisted local
 * token) shows its own Osmosis market, the row Markets lists, with
 * `market.listedAs` saying how Osmosis names it; it never wears the price of
 * the asset its symbol claims. Holdings are not here: they come from
 * `/api/portfolio`. Contract: `AssetDetailResponse` in `lib/token/wire.ts`.
 */

import type { NextRequest } from "next/server";
import { describeUpstreamError } from "@/lib/server/http";
import { geckoMarket } from "@/lib/server/prices/coingecko";
import { getPriceHistory } from "@/lib/server/prices/history";
import { hasOwnSupply, isSubject, numiaRowFor, ownMarketCap, venueSubjectOf } from "@/lib/server/prices/rules";
import { roundSignificant } from "@/lib/server/prices/series";
import { getSpotPrices, priceSubjects, readExchangeQuotes, subjectOf } from "@/lib/server/prices/spot";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, ParamError, parseEnum } from "@/lib/server/validate";
import { chainsHolding, parseAssetKey, resolveAssetKey, toTokenIdentity } from "@/lib/token/identity";
import type { FiatCurrency, TokenIdentity } from "@/lib/token/types";
import type { AssetDetailResponse, AssetMarket, AssetStats, UpstreamIssue } from "@/lib/token/wire";

export const runtime = "nodejs";

const CURRENCIES: readonly FiatCurrency[] = ["usd", "eur", "gbp"];

function decodeKey(raw: string): string {
  // Next hands the segment over decoded; a client that double-encoded still
  // lands on the asset rather than a 400.
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** CoinGecko's supply and all-time figures, for an asset whose id is its own. Never rejects. */
async function statsFor(
  identity: TokenIdentity,
  currency: FiatCurrency,
): Promise<{ stats: AssetStats | null; error: UpstreamIssue | null }> {
  const id = identity.coinGeckoId;
  if (!id || !hasOwnSupply(identity)) return { stats: null, error: null };
  try {
    const market = await geckoMarket(id, currency);
    if (!market) return { stats: null, error: null };
    return {
      stats: {
        ...market,
        source: "coingecko",
        label: "CoinGecko",
        url: `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`,
        at: Date.now(),
      },
      error: null,
    };
  } catch (error) {
    return { stats: null, error: { scope: "stats:coingecko", message: describeUpstreamError(error) } };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  let currency: FiatCurrency;
  let key: string;
  try {
    currency = parseEnum(req.nextUrl.searchParams.get("currency")?.toLowerCase(), CURRENCIES, "usd", "currency");
    key = decodeKey((await params).key).trim();
    if (!parseAssetKey(key)) throw new ParamError("key_invalid", "Not an asset key (chainId:denom)");
  } catch (error) {
    return badRequest(error);
  }

  // Each distinct key can cost upstream reads on a cold cache (a trace
  // lookup, a chart, CoinGecko); a client walking every asset key must not
  // spend everyone's upstream budget.
  const limited = rateLimit(req, { scope: "asset-detail", capacity: 60, refillPerSecond: 1, cost: 2 });
  if (limited) return limited;

  const held = await resolveAssetKey(key);
  if (!held) return badRequest(new ParamError("key_invalid", "Not an asset key (chainId:denom)"));
  const identity = toTokenIdentity(held);

  try {
    // The pricing rule's subject, else (an Osmosis denom it refuses) the
    // denom's own Osmosis market.
    const strict = subjectOf(identity);
    const venue = isSubject(strict) ? null : venueSubjectOf(identity);
    const subject = isSubject(strict) ? strict : venue;
    const spot = venue ? await priceSubjects([venue], currency) : await getSpotPrices([identity], currency);
    const price = spot.prices.get(identity.key) ?? null;
    const market: AssetMarket = {
      price: price?.price ?? null,
      change24h: price?.change24h ?? null,
      change7d: price?.change7d ?? null,
      volume24h: null,
      liquidity: null,
      marketCap: null,
      source: price?.source ?? null,
      label: price?.label ?? null,
    };
    if (price?.url) market.url = price.url;

    // Volume, liquidity and market cap from the Osmosis row when there is one,
    // else the exchange market's 24 h volume. Never from another asset's row.
    if (subject) {
      const row = spot.numia ? numiaRowFor(subject, spot.numia.index) : null;
      if (row) {
        market.volume24h = row.volume24h === null ? null : row.volume24h * spot.rate;
        market.liquidity = row.liquidity === null ? null : row.liquidity * spot.rate;
        const cap = ownMarketCap(identity, row.marketCap);
        market.marketCap = cap === null ? null : cap * spot.rate;
        if (venue && !identity.proven) market.listedAs = { symbol: row.symbol, name: row.name };
      } else if (subject.exchange) {
        const exchange = await readExchangeQuotes(new Set([subject.exchange.market]));
        const quote = exchange.quotes.get(subject.exchange.market);
        if (quote) market.volume24h = quote.volume24h * (spot.usdtUsd ?? 1) * spot.rate;
      }
    }

    const [{ history, errors }, { stats, error: statsError }] = await Promise.all([
      getPriceHistory(identity, "30D", { usdtUsd: spot.usdtUsd, market: true }),
      statsFor(identity, spot.currency),
    ]);
    // Both are CoinGecko's figure; Numia only relays it, and not for every id.
    if (market.marketCap === null && stats?.marketCap) market.marketCap = stats.marketCap;

    const body: AssetDetailResponse = {
      key: identity.key,
      identity,
      currency: spot.currency,
      market,
      stats,
      history30d: history.points.map((point) => ({ t: point.t, v: roundSignificant(point.v * spot.rate) })),
      historySource: history.label,
      holdersChains: chainsHolding(identity.key),
      updatedAt: Date.now(),
    };
    if (spot.currencyFallback) body.currencyFallback = spot.currencyFallback;
    const issues = [...spot.errors, ...errors, ...(statsError ? [statsError] : [])];
    if (issues.length > 0) body.errors = issues;
    return publicJson(body, { maxAge: 60, sMaxAge: 120, swr: 600 });
  } catch {
    return upstreamFailure("This asset's market data is unavailable right now.", 503);
  }
}
