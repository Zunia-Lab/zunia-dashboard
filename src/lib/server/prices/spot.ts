/**
 * Spot prices by token identity, in USD, EUR or GBP.
 *
 * One call prices a whole portfolio: identities are reduced to the assets
 * they may be priced as (`priceSubjectOf`: proven, known decimals, mainnet),
 * duplicates collapse (ATOM on the Hub and on Osmosis share one price), and
 * each source is read once for all of them — Numia's full list, the Coinstore
 * markets named in `EXCHANGE_PRICE_SOURCES`, then one CoinGecko batch for
 * whatever is still unquoted. Every source can fail on its own; the answer
 * then carries what the others gave plus an `errors` entry, and the assets
 * that source would have priced say `source-unavailable` rather than looking
 * like they have no market.
 *
 * Currency: every source quotes USD (Coinstore quotes USDT, converted at
 * Tether's USD price when known, at par otherwise). EUR and GBP apply one FX
 * rate from CoinGecko's Tether quotes. Without that rate the answer stays in
 * USD and says so in `currencyFallback`, never mislabelled.
 */

import "server-only";

import { describeUpstreamError } from "@/lib/server/http";
import { osmosisDenomOf } from "@/lib/token/identity";
import type { FiatCurrency, SpotPrice, TokenIdentity } from "@/lib/token/types";
import type { CurrencyFallback, UnpricedReason, UpstreamIssue } from "@/lib/token/wire";
import { coinstoreBars } from "./coinstore";
import { geckoAvailable, geckoFx, geckoQuotes, type FxRates } from "./coingecko";
import { within } from "./deadline";
import { numiaTokens, type NumiaSnapshot } from "./numia";
import { quoteFromBars, type ExchangeQuote } from "./parse";
import {
  convertSpot,
  isSpot,
  isSubject,
  mergeSubjects,
  numiaRowFor,
  priceSubjectOf,
  rateFor,
  spotFor,
  type PriceSubject,
} from "./rules";

export interface CurrencyContext {
  /** What the numbers are in. */
  currency: FiatCurrency;
  /** Units of `currency` per USD. */
  rate: number;
  currencyFallback?: CurrencyFallback;
  /** Tether in USD, when CoinGecko answered. */
  usdtUsd: number | null;
  errors: UpstreamIssue[];
}

/**
 * The currency an answer can be given in. USD needs nothing; EUR and GBP need
 * the FX rate, read only when asked for (or when a USDT market needs it).
 */
export async function currencyContext(requested: FiatCurrency, needUsdt = false): Promise<CurrencyContext> {
  const errors: UpstreamIssue[] = [];
  let fx: FxRates | null = null;
  if (requested !== "usd" || needUsdt) {
    try {
      fx = await geckoFx();
    } catch (error) {
      if (requested !== "usd") errors.push({ scope: "fx", message: describeUpstreamError(error) });
    }
  }
  const rate = rateFor(requested, fx);
  if (rate === null) {
    return {
      currency: "usd",
      rate: 1,
      currencyFallback: { requested, reason: "Exchange rate unavailable; values are in USD" },
      usdtUsd: fx?.usdtUsd ?? null,
      errors,
    };
  }
  return { currency: requested, rate, usdtUsd: fx?.usdtUsd ?? null, errors };
}

/** The pricing subject of an identity, with its origin's canonical Osmosis voucher added. */
export function subjectOf(identity: TokenIdentity): PriceSubject | { unpriced: UnpricedReason } {
  const canonical =
    identity.proven && identity.originChainId && identity.originDenom
      ? osmosisDenomOf(identity.originChainId, identity.originDenom)
      : null;
  return priceSubjectOf(identity, canonical);
}

export interface SpotResult extends CurrencyContext {
  /** By price-subject key (= the identity key of a priceable identity), converted. */
  prices: Map<string, SpotPrice>;
  /** By identity key, for identities that got no price. */
  unpriced: Map<string, UnpricedReason>;
  /** The Numia snapshot used, when read (markets and asset pages reuse it). */
  numia: NumiaSnapshot | null;
}

export async function getSpotPrices(
  identities: readonly TokenIdentity[],
  requested: FiatCurrency,
): Promise<SpotResult> {
  const subjects = new Map<string, PriceSubject>();
  const unpriced = new Map<string, UnpricedReason>();
  for (const identity of identities) {
    const subject = subjectOf(identity);
    if (!isSubject(subject)) {
      unpriced.set(identity.key, subject.unpriced);
      continue;
    }
    const known = subjects.get(subject.key);
    subjects.set(subject.key, known ? mergeSubjects(known, subject) : subject);
  }
  return priceSubjects([...subjects.values()], requested, unpriced);
}

/**
 * Prices subjects already chosen: the pricing rule's (`getSpotPrices`), or a
 * venue subject an asset page shows the market of (`venueSubjectOf`). Keys of
 * subjects without a price land in `unpriced`, next to whatever the caller
 * passed in there.
 */
export async function priceSubjects(
  list: readonly PriceSubject[],
  requested: FiatCurrency,
  unpriced: Map<string, UnpricedReason> = new Map(),
): Promise<SpotResult> {
  const subjects = new Map(list.map((subject) => [subject.key, subject]));
  const markets = new Set<string>();
  for (const subject of subjects.values()) if (subject.exchange) markets.add(subject.exchange.market);
  const needNumia = [...subjects.values()].some((subject) => !subject.exchange || subject.osmosisDenoms.length > 0);

  const [context, numia, exchange] = await Promise.all([
    currencyContext(requested, markets.size > 0),
    needNumia ? readNumia() : Promise.resolve({ snapshot: null, error: null }),
    readExchangeQuotes(markets),
  ]);
  const errors = [...context.errors, ...exchange.errors];
  if (numia.error) errors.push({ scope: "prices:numia", message: numia.error });

  // CoinGecko only for what nothing else quotes.
  const geckoIds = new Set<string>();
  for (const subject of subjects.values()) {
    if (!subject.coinGeckoId) continue;
    if (subject.exchange && exchange.quotes.get(subject.exchange.market)) continue;
    if (numia.snapshot && numiaRowFor(subject, numia.snapshot.index)) continue;
    geckoIds.add(subject.coinGeckoId);
  }
  const gecko =
    geckoIds.size > 0
      ? await geckoQuotes([...geckoIds])
      : { quotes: new Map(), read: geckoAvailable(), at: Date.now() };
  if (geckoIds.size > 0 && !gecko.read) {
    errors.push({ scope: "prices:coingecko", message: "CoinGecko did not answer; some prices may be missing" });
  }

  const prices = new Map<string, SpotPrice>();
  for (const subject of subjects.values()) {
    const spot = spotFor(subject, {
      numia: numia.snapshot?.index ?? null,
      numiaAt: numia.snapshot?.at ?? 0,
      exchange: exchange.quotes,
      exchangeAt: exchange.at,
      gecko: gecko.quotes,
      geckoAt: gecko.at,
      geckoRead: gecko.read,
      usdtUsd: context.usdtUsd,
    });
    if (isSpot(spot)) prices.set(subject.key, convertSpot(spot, context.rate));
    else unpriced.set(subject.key, spot.unpriced);
  }

  return { ...context, errors, prices, unpriced, numia: numia.snapshot };
}

/**
 * How long a price answer waits for Numia's list on a cold cache. The list is
 * ~1 MB and usually arrives in 2–3 s; a slow minute must not hold a portfolio
 * past what the proxies wait for. The read keeps going and the next answer
 * has it; this one says the prices it would have given are unavailable.
 */
const NUMIA_BUDGET_MS = 12_000;

async function readNumia(): Promise<{ snapshot: NumiaSnapshot | null; error: string | null }> {
  try {
    const read = await within(numiaTokens(), NUMIA_BUDGET_MS);
    return read.done ? { snapshot: read.value, error: null } : { snapshot: null, error: "Numia did not answer in time" };
  } catch (error) {
    return { snapshot: null, error: describeUpstreamError(error) };
  }
}

/** Spot quotes of the exchange markets in `markets`, from their hourly candles. */
export async function readExchangeQuotes(
  markets: ReadonlySet<string>,
): Promise<{ quotes: Map<string, ExchangeQuote | null>; at: number; errors: UpstreamIssue[] }> {
  const quotes = new Map<string, ExchangeQuote | null>();
  const errors: UpstreamIssue[] = [];
  let at = Date.now();
  await Promise.all(
    [...markets].map(async (market) => {
      try {
        const candles = await coinstoreBars(market, "60min");
        quotes.set(market, quoteFromBars(candles.bars));
        at = Math.min(at, candles.at);
      } catch (error) {
        quotes.set(market, null);
        errors.push({ scope: `prices:coinstore:${market}`, message: describeUpstreamError(error) });
      }
    }),
  );
  return { quotes, at, errors };
}
