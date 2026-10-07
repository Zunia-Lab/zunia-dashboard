/**
 * Which price an asset may wear, and from where. Pure: the rules are tested
 * without a network.
 *
 * The pricing rule (zunia-extension lib/home-assets.ts `priceChainOf`
 * @ 1453e7a, restated for per-asset prices):
 *
 * - **Unknown decimals are never valued.** The amount cannot be scaled, so any
 *   value would be off by powers of ten.
 * - **A voucher takes its origin's price only when its identity is proven**
 *   (hash-verified table row, catalog listing, or a walk over registry-
 *   canonical channels). An unproven walk could be a look-alike chain claiming
 *   a real chain's id; it stays unpriced and counted.
 * - **Testnet coins have no market.** Never valued, whatever a symbol match
 *   would say.
 *
 * Sources, in priority order:
 *
 * 1. an exchange market named for the asset (SAF on Coinstore SAF/USDT: no
 *    aggregator lists it);
 * 2. Numia's Osmosis prices, matched by the asset's Osmosis denom (exact),
 *    or — only for an asset with no Osmosis denom at all — by a symbol that is
 *    unique in Numia's list and agrees on decimals and CoinGecko id;
 * 3. CoinGecko by the identity's `coinGeckoId`.
 */

import type { FiatCurrency, PriceSource, SpotPrice, TokenIdentity } from "@/lib/token/types";
import type { UnpricedReason } from "@/lib/token/wire";
import { osmosisDenomKey, type ExchangeQuote, type GeckoQuote, type NumiaToken } from "./parse";

export type { UnpricedReason };

/** A coin priced from one exchange market (ported from zunia-extension config/prices.ts). */
export interface ExchangePriceSource {
  readonly exchange: "coinstore";
  /** Name shown beside the price. */
  readonly name: string;
  /** Market symbol in the exchange's API. */
  readonly market: string;
  /** Market as people read it. */
  readonly pair: string;
  /** The market's public page, linked from the price. */
  readonly url: string;
}

/**
 * By asset key. One market is a thinner signal than an aggregate, so a price
 * from here always carries its label ("Coinstore SAF/USDT") next to it.
 */
export const EXCHANGE_PRICE_SOURCES: Readonly<Record<string, ExchangePriceSource>> = {
  // SAF, Safrochain's coin: on Coinstore's SAF/USDT market, not on CoinGecko.
  "safrochain-1:usaf": {
    exchange: "coinstore",
    name: "Coinstore",
    market: "SAFUSDT",
    pair: "SAF/USDT",
    url: "https://www.coinstore.com/spot/SAFUSDT",
  },
};

/** What a price lookup needs to know about an asset. */
export interface PriceSubject {
  /** The identity's (origin) key: every holding of the asset shares one price. */
  key: string;
  symbol: string;
  /** Null only for a venue subject ({@link venueSubjectOf}), which never matches by symbol. */
  decimals: number | null;
  exchange: ExchangePriceSource | null;
  /**
   * The asset's Osmosis denoms: where this holding trades, plus the table's
   * canonical voucher of its origin. Two vouchers of one proven asset (ATOM
   * over channel-0 and an older route) are one asset; its price is that of
   * its deepest Osmosis market.
   */
  osmosisDenoms: readonly string[];
  coinGeckoId: string | null;
}

/**
 * The asset an identity may be priced as, or why it may not.
 * `canonicalOsmosisDenom` is the token table's preferred Osmosis voucher of
 * the identity's origin (`osmosisDenomOf`), when the caller can look it up.
 */
export function priceSubjectOf(
  identity: TokenIdentity,
  canonicalOsmosisDenom?: string | null,
): PriceSubject | { unpriced: UnpricedReason } {
  if (identity.decimals === null) return { unpriced: "decimals-unknown" };
  if (identity.testnet) return { unpriced: "testnet" };
  if (!identity.proven) return { unpriced: "unproven" };
  const denoms = [identity.osmosisDenom, canonicalOsmosisDenom]
    .filter((denom): denom is string => typeof denom === "string" && denom.length > 0)
    .map(osmosisDenomKey);
  return {
    key: identity.key,
    symbol: identity.ticker,
    decimals: identity.decimals,
    exchange: EXCHANGE_PRICE_SOURCES[identity.key] ?? null,
    osmosisDenoms: [...new Set(denoms)],
    // An alloy's CoinGecko id is its family's (allBTC -> "bitcoin"): the
    // outside asset's price, not the alloy's own Osmosis market, which can sit
    // well below it (allBTC traded ~11% under Bitcoin when this was written,
    // and allXRP at a quarter of XRP). Never borrowed: while Numia is down an
    // alloy reads "source-unavailable", like any other Osmosis-only asset.
    // This one id feeds the CoinGecko spot batch, `spotFor`'s fallback and the
    // history's `market_chart` fallback, so all three stop borrowing it.
    coinGeckoId: identity.alloyed ? null : (identity.coinGeckoId ?? null),
  };
}

/** The venue whose own markets a venue subject may show. */
const VENUE_CHAIN = "osmosis-1";

/**
 * The market an asset page may show for an Osmosis denom the pricing rule
 * refuses to price (unknown origin, an unlisted local token, unknown
 * decimals): that exact denom's own pool market, which Markets lists too.
 *
 * Never used to value a holding. It names no origin and borrows no other
 * asset's price: the quote is for this very denom, so an impostor
 * `factory/…/USDC.n` shows what its own pool trades it at, never USDC's
 * price. Never by symbol, never by CoinGecko id (the id would be a claim).
 */
export function venueSubjectOf(identity: TokenIdentity): PriceSubject | null {
  if (identity.chainId !== VENUE_CHAIN || identity.testnet) return null;
  return {
    key: identity.key,
    symbol: identity.ticker,
    decimals: identity.decimals,
    exchange: null,
    osmosisDenoms: [osmosisDenomKey(identity.denom)],
    coinGeckoId: null,
  };
}

/** One subject for two holdings of the same asset: every Osmosis denom either knows. */
export function mergeSubjects(a: PriceSubject, b: PriceSubject): PriceSubject {
  return {
    ...a,
    exchange: a.exchange ?? b.exchange,
    osmosisDenoms: [...new Set([...a.osmosisDenoms, ...b.osmosisDenoms])],
    coinGeckoId: a.coinGeckoId ?? b.coinGeckoId,
  };
}

export function isSubject(value: PriceSubject | { unpriced: UnpricedReason }): value is PriceSubject {
  return "key" in value;
}

/* -------------------------------------------------------------------------- *
 * Numia matching
 * -------------------------------------------------------------------------- */

export interface NumiaIndex {
  byDenom: ReadonlyMap<string, NumiaToken>;
  bySymbol: ReadonlyMap<string, readonly NumiaToken[]>;
  /**
   * The asset key the identity rules prove an Osmosis denom to be, or null
   * when they prove nothing. Lets a symbol match refuse a row that is known
   * to be another asset. Optional so the matching stays testable without
   * the token tables.
   */
  assetKeyOf?: (osmosisDenom: string) => string | null;
}

export function indexNumia(
  rows: readonly NumiaToken[],
  assetKeyOf?: (osmosisDenom: string) => string | null,
): NumiaIndex {
  const byDenom = new Map<string, NumiaToken>();
  const bySymbol = new Map<string, NumiaToken[]>();
  for (const row of rows) {
    if (!byDenom.has(row.denom)) byDenom.set(row.denom, row);
    const list = bySymbol.get(row.symbol);
    if (list) list.push(row);
    else bySymbol.set(row.symbol, [row]);
  }
  return assetKeyOf ? { byDenom, bySymbol, assetKeyOf } : { byDenom, bySymbol };
}

/**
 * Pools thinner than this print fiction: a $40 pool can quote a token at
 * anything. Such a price is ignored and the next source is tried.
 */
export const MIN_PRICING_LIQUIDITY_USD = 100;

function liquidEnough(row: NumiaToken): boolean {
  return row.liquidity !== null && row.liquidity >= MIN_PRICING_LIQUIDITY_USD;
}

/**
 * Numia's row for an asset. By Osmosis denom when the asset has one — the
 * deepest priced market among its denoms, and nothing else, because another
 * row with the same symbol is another asset (eight Numia rows read "USDC").
 * By symbol only for an asset with no Osmosis denom at all, and only when the
 * symbol is unique in the list, the decimals and CoinGecko ids agree, and the
 * identity rules do not prove that row to be some other asset.
 */
export function numiaRowFor(subject: PriceSubject, index: NumiaIndex): NumiaToken | null {
  if (subject.osmosisDenoms.length > 0) {
    let best: NumiaToken | null = null;
    for (const denom of subject.osmosisDenoms) {
      const row = index.byDenom.get(denom);
      if (!row || row.price === null || !liquidEnough(row)) continue;
      if (!best || (row.liquidity ?? 0) > (best.liquidity ?? 0)) best = row;
    }
    return best;
  }
  const rows = index.bySymbol.get(subject.symbol);
  if (!rows || rows.length !== 1) return null;
  const row = rows[0];
  if (!row || row.price === null || !liquidEnough(row)) return null;
  if (subject.decimals === null || (row.exponent !== null && row.exponent !== subject.decimals)) return null;
  if (row.coinGeckoId && subject.coinGeckoId && row.coinGeckoId !== subject.coinGeckoId) return null;
  const provenAs = index.assetKeyOf?.(row.denom) ?? null;
  if (provenAs !== null && provenAs !== subject.key) return null;
  return row;
}

/* -------------------------------------------------------------------------- *
 * Choosing the spot price
 * -------------------------------------------------------------------------- */

export interface SpotInputs {
  /** Null when Numia could not be read. */
  numia: NumiaIndex | null;
  numiaAt: number;
  /** Exchange quotes by market symbol; a missing or null entry was not readable. */
  exchange: ReadonlyMap<string, ExchangeQuote | null>;
  exchangeAt: number;
  /** CoinGecko quotes by id; ids absent were not quoted (or not read). */
  gecko: ReadonlyMap<string, GeckoQuote>;
  geckoAt: number;
  /** False when CoinGecko could not be asked, so a missing quote is not "no market". */
  geckoRead: boolean;
  /** USDT in USD for exchange quotes; null takes USDT at par (the label names the USDT pair). */
  usdtUsd: number | null;
}

export const SOURCE_LABEL: Readonly<Record<PriceSource, string>> = {
  numia: "Numia · Osmosis",
  coingecko: "CoinGecko",
  coinstore: "Coinstore",
  "osmosis-sqs": "Osmosis SQS",
};

/** The USD spot price for `subject`, or why there is none. */
export function spotFor(subject: PriceSubject, inputs: SpotInputs): SpotPrice | { unpriced: UnpricedReason } {
  let unavailable = false;
  if (subject.exchange) {
    const quote = inputs.exchange.get(subject.exchange.market);
    if (quote) {
      const usdt = inputs.usdtUsd ?? 1;
      return {
        price: quote.price * usdt,
        change24h: quote.change24h,
        change7d: quote.change7d,
        source: "coinstore",
        at: inputs.exchangeAt,
        label: `${subject.exchange.name} ${subject.exchange.pair}`,
        url: subject.exchange.url,
      };
    }
    unavailable = true;
  }
  if (inputs.numia) {
    const row = numiaRowFor(subject, inputs.numia);
    if (row && row.price !== null) {
      return {
        price: row.price,
        change24h: row.change24h,
        change7d: row.change7d,
        source: "numia",
        at: inputs.numiaAt,
        label: SOURCE_LABEL.numia,
      };
    }
  } else if (subject.osmosisDenoms.length > 0) {
    unavailable = true;
  }
  if (subject.coinGeckoId) {
    const quote = inputs.gecko.get(subject.coinGeckoId);
    if (quote) {
      return {
        price: quote.usd,
        change24h: quote.change24h,
        change7d: null,
        source: "coingecko",
        at: inputs.geckoAt,
        label: SOURCE_LABEL.coingecko,
      };
    }
    if (!inputs.geckoRead) unavailable = true;
  }
  return { unpriced: unavailable ? "source-unavailable" : "no-market" };
}

export function isSpot(value: SpotPrice | { unpriced: UnpricedReason }): value is SpotPrice {
  return "price" in value;
}

/** A USD spot price in another currency, at `rate` units per USD. Changes are the USD changes. */
export function convertSpot(spot: SpotPrice, rate: number): SpotPrice {
  return rate === 1 ? spot : { ...spot, price: spot.price * rate };
}

/**
 * Families whose CoinGecko figures describe supply that mostly lives outside
 * Cosmos: the multi-issuer families (all USDC, all bitcoin), and assets an
 * issuer mints natively on many chains at once, Noble among them (Ondo's USDY:
 * its $2B+ market cap is Ethereum's and Solana's as much as Noble's).
 */
const OUTSIDE_SUPPLY_FAMILIES: ReadonlySet<string> = new Set(["USDC", "USDT", "DAI", "ETH", "WBTC", "BTC", "USDY"]);

/**
 * The market cap (or any supply figure) an asset may show. Numia relays
 * CoinGecko's figure for the row's CoinGecko id, and for a bridged or alloyed
 * representation of an outside asset that id is the outside asset's: USDC.n,
 * USDC.inj and allUSDC would each show USDC's whole $74B, and allBTC
 * Bitcoin's. Summed into a "Cosmos market cap" that is fiction, so only
 * Cosmos-native assets keep it.
 */
export function ownMarketCap(
  identity: Pick<TokenIdentity, "proven" | "alloyed" | "bridge" | "family">,
  marketCap: number | null,
): number | null {
  if (marketCap === null || !hasOwnSupply(identity)) return null;
  return marketCap;
}

/** Whether supply figures for the asset's CoinGecko id describe this token (see {@link ownMarketCap}). */
export function hasOwnSupply(identity: Pick<TokenIdentity, "proven" | "alloyed" | "bridge" | "family">): boolean {
  if (!identity.proven || identity.alloyed || identity.bridge) return false;
  return !(identity.family && OUTSIDE_SUPPLY_FAMILIES.has(identity.family));
}

/** Currencies with a rate; USD needs none. */
export function rateFor(currency: FiatCurrency, fx: { eur: number; gbp: number } | null): number | null {
  if (currency === "usd") return 1;
  if (!fx) return null;
  return currency === "eur" ? fx.eur : fx.gbp;
}
