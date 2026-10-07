/**
 * The Cosmos markets list: every asset Osmosis trades with real liquidity
 * (Numia), named by token identity, plus SAF from Coinstore.
 *
 * - **Listing floor.** Rows under $1,000 of pool liquidity, or without a
 *   price, are left out: thin pools print fiction and dead listings clutter.
 * - **One row per asset.** Numia lists every Osmosis denom; two vouchers of
 *   one origin asset (an old channel's ATOM, a legacy STARS) collapse into
 *   one row keyed by the asset key, keeping the deepest market (the one a
 *   portfolio prices the asset from), the canonical voucher on a tie.
 * - **Names from identity.** A row the verified table knows reads as the rest
 *   of the app reads it (USDC.n, USDC.axl, allUSDC); an `ibc/` row it does
 *   not know is traced on Osmosis's LCD first (hash-verified, canonical
 *   channels only for "proven"). A row nothing proves keeps Numia's symbol,
 *   flagged `verified: false`, and when that symbol claims a name a real
 *   asset has, it carries a hash of its denom (`USDC·6B99`) exactly as the
 *   identity rules mark unlisted tokens.
 * - **Sparklines** (7 days, hourly closes stamped at each hour's end) for the
 *   40 most liquid rows and SAF; the rest get `null`, not a fake flat line.
 *
 * Cached 3 minutes per currency; the history reads behind sparklines are
 * cached 30 minutes each by `numia.ts`.
 */

import "server-only";

import { cached } from "@/lib/server/cache";
import { describeUpstreamError, mapLimit } from "@/lib/server/http";
import { assetKeyOf, heldIdentity, identifyHeldDenoms, osmosisDenomOf, toTokenIdentity } from "@/lib/token/identity";
import { claimsKnownName, hashTag, type HeldTokenIdentity } from "@/lib/token/engine";
import type { FiatCurrency, PricePoint } from "@/lib/token/types";
import type { MarketAsset, MarketSourceStatus, MarketsResponse, UpstreamIssue } from "@/lib/token/wire";
import { coinstoreBars } from "./coinstore";
import { numiaChart, numiaTokens, NUMIA_LABEL, NUMIA_URL, type NumiaSnapshot } from "./numia";
import { barCloses, quoteFromBars, type NumiaToken } from "./parse";
import { EXCHANGE_PRICE_SOURCES, ownMarketCap } from "./rules";
import { DAY_MS, HOUR_MS, roundSignificant } from "./series";
import { within } from "./deadline";
import { currencyContext } from "./spot";

/** Pool liquidity (USD) below which an Osmosis listing is left out. */
export const LISTING_FLOOR_USD = 1_000;
/** Rows that get a 7-day sparkline, by liquidity. */
export const SPARKLINE_ROWS = 40;
/** How long one build waits for trace lookups of listed vouchers the table lacks. */
const TRACE_BUDGET_MS = 6_000;

interface Candidate {
  row: NumiaToken;
  held: HeldTokenIdentity;
  key: string;
  verified: boolean;
  canonical: boolean;
}

function candidateOf(row: NumiaToken): Candidate {
  const held = heldIdentity("osmosis-1", row.denom);
  const verified = held.provenance !== "unknown" && held.listed && held.proven;
  const canonical =
    verified && held.originChainId !== null && held.originDenom !== null
      ? osmosisDenomOf(held.originChainId, held.originDenom) === row.denom
      : false;
  return { row, held, key: assetKeyOf(held), verified, canonical };
}

/**
 * The row an asset is listed by: a verified voucher over an unverified one,
 * then the deepest market (the same market its spot price comes from in a
 * portfolio, `numiaRowFor`), then the token table's canonical voucher.
 */
function better(a: Candidate, b: Candidate): Candidate {
  if (a.verified !== b.verified) return a.verified ? a : b;
  const depth = (a.row.liquidity ?? 0) - (b.row.liquidity ?? 0);
  if (depth !== 0) return depth > 0 ? a : b;
  if (a.canonical !== b.canonical) return a.canonical ? a : b;
  return a;
}

/**
 * Points per sparkline. They are drawn 56–88 px wide, so the full ~165 hourly
 * closes of a week were 63 KB of a 125 KB payload that five pages poll every
 * three minutes and keep in localStorage; 48 points still has a point per
 * two pixels at the widest.
 */
const MAX_SPARK_POINTS = 48;

/**
 * The last 7 days of hourly closes, rounded, oldest first, thinned to at most
 * {@link MAX_SPARK_POINTS} by keeping every n-th close. The first and the last
 * close are always kept, so the line starts and ends where the 7-day change
 * and the trend tone are measured.
 */
function sparkline(points: readonly PricePoint[], now: number, scale: number): number[] | null {
  const from = now - 7 * DAY_MS;
  const closes = points.filter((point) => point.t >= from).map((point) => roundSignificant(point.v * scale, 6));
  if (closes.length < 2) return null;
  if (closes.length <= MAX_SPARK_POINTS) return closes;
  const step = Math.ceil((closes.length - 1) / (MAX_SPARK_POINTS - 1));
  const thinned = closes.filter((_, index) => index % step === 0);
  const last = closes[closes.length - 1] as number;
  if ((closes.length - 1) % step !== 0) thinned.push(last);
  return thinned;
}

/**
 * Names the listed `ibc/` rows the token table does not know, through the
 * same hash-verified LCD trace lookups a portfolio read uses (at most 32 per
 * build; a miss is not asked again for half an hour, a proven trace is kept
 * for the process). Without it, a well-known asset that reached Osmosis over
 * a route the table lacks (stBAND, a newer chain's coin) would be listed as an
 * unverified look-alike, and its asset page would name it `IBC·XXXX`. Never
 * fails the list: what cannot be traced stays unverified.
 */
async function traceUnknownVouchers(rows: readonly NumiaToken[], errors: UpstreamIssue[]): Promise<void> {
  const unknown = rows
    .filter((row) => row.denom.startsWith("ibc/") && heldIdentity("osmosis-1", row.denom).provenance === "unknown")
    .sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0))
    .map((row) => row.denom);
  if (unknown.length === 0) return;
  try {
    // Bounded: a slow LCD costs this build the names, not the list. The
    // lookups finish in the background and the next build has them.
    await within(identifyHeldDenoms("osmosis-1", unknown), TRACE_BUDGET_MS);
  } catch (error) {
    errors.push({ chainId: "osmosis-1", scope: "markets:identity", message: describeUpstreamError(error) });
  }
}

export function getMarkets(currency: FiatCurrency): Promise<MarketsResponse> {
  return cached(`markets:v2:${currency}`, { ttlMs: 3 * 60_000, staleMs: 10 * 60_000, errorTtlMs: 15_000 }, () =>
    buildMarkets(currency),
  );
}

async function buildMarkets(requested: FiatCurrency): Promise<MarketsResponse> {
  const now = Date.now();
  const errors: UpstreamIssue[] = [];
  const saf = EXCHANGE_PRICE_SOURCES["safrochain-1:usaf"];
  const [context, numia, safCandles] = await Promise.all([
    currencyContext(requested, true),
    numiaTokens().then(
      (snapshot): NumiaSnapshot | null => snapshot,
      (error: unknown) => {
        errors.push({ scope: "markets:numia", message: describeUpstreamError(error) });
        return null;
      },
    ),
    saf
      ? coinstoreBars(saf.market, "60min").catch((error: unknown) => {
          errors.push({ scope: `markets:coinstore:${saf.market}`, message: describeUpstreamError(error) });
          return null;
        })
      : Promise.resolve(null),
  ]);
  errors.push(...context.errors);
  const rate = context.rate;
  const usdt = context.usdtUsd ?? 1;

  const listed = (numia?.rows ?? []).filter(
    (row) => row.price !== null && (row.liquidity ?? 0) >= LISTING_FLOOR_USD,
  );
  await traceUnknownVouchers(listed, errors);

  // One row per asset key, best voucher kept.
  const byKey = new Map<string, Candidate>();
  for (const row of listed) {
    const candidate = candidateOf(row);
    const current = byKey.get(candidate.key);
    byKey.set(candidate.key, current ? better(current, candidate) : candidate);
  }
  const rows = [...byKey.values()].sort((a, b) => (b.row.liquidity ?? 0) - (a.row.liquidity ?? 0));

  const sparklines = await mapLimit(rows.slice(0, SPARKLINE_ROWS), 8, async (candidate) => {
    try {
      return sparkline(await numiaChart(candidate.row.denom, 60), now, rate);
    } catch {
      return null;
    }
  });

  const takenSymbols = new Set(rows.filter((c) => c.verified).map((c) => c.held.ticker.toUpperCase()));
  const assets: MarketAsset[] = rows.map((candidate, index) => {
    const { row, held } = candidate;
    let symbol = candidate.verified ? held.ticker : row.symbol;
    if (!candidate.verified && (claimsKnownName(symbol) || takenSymbols.has(symbol.toUpperCase()))) {
      symbol = `${symbol}·${hashTag(row.denom)}`;
    }
    const marketCap = candidate.verified ? ownMarketCap(toTokenIdentity(held), row.marketCap) : null;
    const asset: MarketAsset = {
      key: candidate.key,
      symbol,
      name: candidate.verified ? held.name : row.name,
      price: roundSignificant((row.price ?? 0) * rate, 8),
      change24h: row.change24h,
      change7d: row.change7d,
      volume24h: row.volume24h === null ? null : row.volume24h * rate,
      liquidity: row.liquidity === null ? null : row.liquidity * rate,
      marketCap: marketCap === null ? null : marketCap * rate,
      sparkline7d: index < SPARKLINE_ROWS ? (sparklines[index] ?? null) : null,
      osmosisDenom: row.denom,
      tradable: true,
      verified: candidate.verified,
      source: "numia",
    };
    if (candidate.verified && held.logoUrl) asset.logoUrl = held.logoUrl;
    const geckoId = held.coinGeckoId ?? row.coinGeckoId;
    if (geckoId) asset.coinGeckoId = geckoId;
    if (candidate.verified && held.originChainId) asset.chainId = held.originChainId;
    return asset;
  });

  // SAF from its exchange market. If Osmosis ever lists it above the floor,
  // the row above keeps its pool figures and takes the exchange price.
  if (saf && safCandles) {
    const quote = quoteFromBars(safCandles.bars);
    if (quote) {
      const identity = heldIdentity("safrochain-1", "usaf");
      const price = roundSignificant(quote.price * usdt * rate, 8);
      const line = sparkline(barCloses(safCandles.bars, HOUR_MS, safCandles.at, usdt), now, rate);
      const existing = assets.find((asset) => asset.key === "safrochain-1:usaf");
      if (existing) {
        existing.price = price;
        existing.change24h = quote.change24h;
        existing.change7d = quote.change7d;
        existing.sparkline7d = line;
        existing.source = "coinstore";
      } else {
        const row: MarketAsset = {
          key: "safrochain-1:usaf",
          symbol: identity.ticker,
          name: identity.name,
          price,
          change24h: quote.change24h,
          change7d: quote.change7d,
          volume24h: quote.volume24h * usdt * rate,
          liquidity: null,
          marketCap: null,
          sparkline7d: line,
          tradable: false,
          chainId: "safrochain-1",
          verified: true,
          source: "coinstore",
        };
        if (identity.logoUrl) row.logoUrl = identity.logoUrl;
        assets.push(row);
      }
    }
  }

  const sources: MarketSourceStatus[] = [
    { id: "numia", label: NUMIA_LABEL, url: NUMIA_URL, ok: numia !== null, at: numia?.at ?? null },
  ];
  if (saf) {
    sources.push({
      id: "coinstore",
      label: `${saf.name} ${saf.pair}`,
      url: saf.url,
      ok: safCandles !== null,
      at: safCandles?.at ?? null,
    });
  }

  if (!numia && !safCandles) throw new Error("No market source answered");
  const response: MarketsResponse = {
    currency: context.currency,
    updatedAt: now,
    sources,
    assets,
  };
  if (context.currencyFallback) response.currencyFallback = context.currencyFallback;
  if (errors.length > 0) response.errors = errors;
  return response;
}
