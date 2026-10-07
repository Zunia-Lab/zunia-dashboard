/**
 * Reading what the market-data sources answer. Pure, so every shape is
 * tested; the `*.server` neighbours do the reads.
 *
 * The rule throughout: a field that does not read as a finite number is
 * `null`, never `0`. A price of zero and a price nobody knows are different
 * facts, and the UI says so differently ("—" with a reason vs "$0.00").
 */

import type { PricePoint } from "@/lib/token/types";

type Fields = Record<string, unknown>;

function asRecord(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

/** A finite number, from a number or a numeric string; null otherwise. */
export function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** A finite, strictly positive number (prices, opens); null otherwise. */
function positive(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/* -------------------------------------------------------------------------- *
 * Numia (public Osmosis API)
 * -------------------------------------------------------------------------- */

/** One row of `https://public-osmosis-api.numia.xyz/tokens/v2/all`. */
export interface NumiaToken {
  /** Osmosis assetlist symbol. NOT unique: eight rows read "USDC". */
  symbol: string;
  /** The Osmosis bank denom (`ibc/` hashes uppercase): the identity to match on. */
  denom: string;
  name: string;
  exponent: number | null;
  coinGeckoId: string | null;
  /** USD. */
  price: number | null;
  /** Percent. */
  change24h: number | null;
  change7d: number | null;
  /** USD over 24 h. */
  volume24h: number | null;
  /** USD in Osmosis pools. */
  liquidity: number | null;
  /** CoinGecko's market cap as Numia relays it, USD. */
  marketCap: number | null;
}

/** Normalises an Osmosis denom for matching: `ibc/` hashes uppercase, the rest exact. */
export function osmosisDenomKey(denom: string): string {
  return denom.startsWith("ibc/") ? `ibc/${denom.slice(4).toUpperCase()}` : denom;
}

/** Rows that do not read are dropped; the list is never an error for one bad row. */
export function parseNumiaTokens(body: unknown): NumiaToken[] {
  if (!Array.isArray(body)) return [];
  const out: NumiaToken[] = [];
  for (const raw of body) {
    const row = asRecord(raw);
    if (!row) continue;
    const denom = text(row.denom, 256);
    const symbol = text(row.symbol, 64);
    if (!denom || !symbol) continue;
    const exponent = finite(row.exponent);
    out.push({
      symbol,
      denom: osmosisDenomKey(denom),
      name: text(row.name, 128) ?? symbol,
      exponent: exponent !== null && Number.isInteger(exponent) && exponent >= 0 && exponent <= 30 ? exponent : null,
      coinGeckoId: text(row.coingecko_id, 128),
      price: positive(row.price),
      change24h: finite(row.price_24h_change),
      change7d: finite(row.price_7d_change),
      volume24h: finite(row.volume_24h),
      liquidity: finite(row.liquidity),
      marketCap: positive(row.coingecko_mcap),
    });
  }
  return out;
}

/**
 * A candle's close, stamped when it happened: at the candle's **end**, not
 * its start. Candle APIs key each bar by its open time, but the close is the
 * price at the end of the bar; stamping it at the start would put tomorrow's
 * price on today's date (a daily chart one day early, its "yesterday" point
 * already showing today's price). The bar still being formed closes "now":
 * its close is the latest trade, so it is stamped at the read time. A bar that
 * starts in the future (clock skew) is dropped.
 */
export function candleClose(startMs: number, stepMs: number, close: number, now: number): PricePoint | null {
  if (startMs >= now) return null;
  return { t: Math.min(startMs + stepMs, now), v: close };
}

/**
 * Closes from `/tokens/v2/historical/{denom}/chart?tf=…` (`[{time (s, bar
 * start), close, …}]`) as points at each bar's close time, oldest first.
 * `stepMs` is the timeframe (`tf` minutes × 60 000).
 */
export function parseNumiaChart(body: unknown, stepMs: number, now: number): PricePoint[] {
  if (!Array.isArray(body)) return [];
  const points: PricePoint[] = [];
  for (const raw of body) {
    const row = asRecord(raw);
    const time = finite(row?.time);
    const close = positive(row?.close);
    if (time === null || close === null || time <= 0) continue;
    const point = candleClose(time * 1000, stepMs, close, now);
    if (point) points.push(point);
  }
  return sortUnique(points);
}

/* -------------------------------------------------------------------------- *
 * Coinstore (SAF/USDT)
 * -------------------------------------------------------------------------- */

/** One candle of `https://api.coinstore.com/api/v1/market/kline/{market}`. */
export interface Bar {
  /** Candle start, epoch ms. */
  t: number;
  open: number;
  close: number;
  /** Quote-currency (USDT) volume of the candle; 0 when absent. */
  quoteVolume: number;
}

/** Candles, oldest first; unreadable candles are skipped. */
export function parseCoinstoreKlines(body: unknown): Bar[] {
  const items = asRecord(asRecord(body)?.data)?.item;
  if (!Array.isArray(items)) return [];
  const bars: Bar[] = [];
  for (const raw of items) {
    const row = asRecord(raw);
    const start = finite(row?.startTime);
    const open = positive(row?.open);
    const close = positive(row?.close);
    if (start === null || start <= 0 || open === null || close === null) continue;
    bars.push({ t: start * 1000, open, close, quoteVolume: Math.max(0, finite(row?.amount) ?? 0) });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars.filter((bar, index) => index === 0 || bar.t !== bars[index - 1]?.t);
}

/** Candle closes as points at each bar's close time (see {@link candleClose}), `scale` applied (USDT → USD). */
export function barCloses(bars: readonly Bar[], stepMs: number, now: number, scale = 1): PricePoint[] {
  const points: PricePoint[] = [];
  for (const bar of bars) {
    const point = candleClose(bar.t, stepMs, bar.close * scale, now);
    if (point) points.push(point);
  }
  return sortUnique(points);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface ExchangeQuote {
  /** Quote currency (USDT). */
  price: number;
  change24h: number | null;
  change7d: number | null;
  /** Quote currency over the last 24 h of candles. */
  volume24h: number;
  /** Start of the newest candle, epoch ms. */
  lastAt: number;
}

/**
 * Last price and changes from hourly candles: the newest close against the
 * open of the first candle inside the window. Time-based rather than "the
 * last 24 bars": an hour without trades has no candle, and 24 bars would then
 * reach back further than 24 hours.
 */
export function quoteFromBars(bars: readonly Bar[]): ExchangeQuote | null {
  const last = bars[bars.length - 1];
  if (!last) return null;
  const openAt = (windowMs: number): number | null => {
    const from = last.t - windowMs + HOUR_MS;
    const first = bars.find((bar) => bar.t >= from);
    // A window the candles do not reach back to has no honest change.
    if (!first || (bars[0] && bars[0].t > from)) return null;
    return first.open;
  };
  const open24 = openAt(DAY_MS);
  const open7d = openAt(7 * DAY_MS);
  const from24 = last.t - DAY_MS + HOUR_MS;
  return {
    price: last.close,
    change24h: open24 ? ((last.close - open24) / open24) * 100 : null,
    change7d: open7d ? ((last.close - open7d) / open7d) * 100 : null,
    volume24h: bars.filter((bar) => bar.t >= from24).reduce((sum, bar) => sum + bar.quoteVolume, 0),
    lastAt: last.t,
  };
}

/* -------------------------------------------------------------------------- *
 * CoinGecko
 * -------------------------------------------------------------------------- */

export interface GeckoQuote {
  usd: number;
  change24h: number | null;
}

/** `/simple/price?ids=…&vs_currencies=usd&include_24hr_change=true`. */
export function parseGeckoSimple(body: unknown): Map<string, GeckoQuote> {
  const out = new Map<string, GeckoQuote>();
  const root = asRecord(body);
  if (!root) return out;
  for (const [id, raw] of Object.entries(root)) {
    const row = asRecord(raw);
    const usd = positive(row?.usd);
    if (usd === null || id.length > 128) continue;
    out.set(id, { usd, change24h: finite(row?.usd_24h_change) });
  }
  return out;
}

/** USD → EUR and GBP from Tether's quotes (`ids=tether&vs_currencies=usd,eur,gbp`). */
export function parseGeckoFx(body: unknown): { eur: number; gbp: number } | null {
  const tether = asRecord(asRecord(body)?.tether);
  const usd = positive(tether?.usd);
  const eur = positive(tether?.eur);
  const gbp = positive(tether?.gbp);
  if (usd === null || eur === null || gbp === null) return null;
  // A rate far from any plausible USD/EUR or USD/GBP is a broken answer.
  const toEur = eur / usd;
  const toGbp = gbp / usd;
  if (toEur < 0.5 || toEur > 2 || toGbp < 0.4 || toGbp > 2) return null;
  return { eur: toEur, gbp: toGbp };
}

/** Supply and all-time figures for one CoinGecko id, in the requested currency. */
export interface GeckoMarket {
  marketCap: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  /** Across every venue CoinGecko tracks (not only Osmosis). */
  volume24h: number | null;
  ath: number | null;
  /** Percent from the all-time high to now (negative below it). */
  athChangePct: number | null;
  athAt: number | null;
}

/** `/coins/markets?vs_currency=…&ids=…`: one row per id; unreadable fields are null. */
export function parseGeckoMarkets(body: unknown): Map<string, GeckoMarket> {
  const out = new Map<string, GeckoMarket>();
  if (!Array.isArray(body)) return out;
  for (const raw of body) {
    const row = asRecord(raw);
    const id = text(row?.id, 128);
    if (!row || !id) continue;
    const athAt = Date.parse(text(row.ath_date, 64) ?? "");
    out.set(id, {
      marketCap: positive(row.market_cap),
      circulatingSupply: positive(row.circulating_supply),
      totalSupply: positive(row.total_supply),
      volume24h: finite(row.total_volume),
      ath: positive(row.ath),
      athChangePct: finite(row.ath_change_percentage),
      athAt: Number.isFinite(athAt) ? athAt : null,
    });
  }
  return out;
}

/** `/coins/{id}/market_chart`: `{prices: [[ms, price], …]}`, oldest first. */
export function parseGeckoChart(body: unknown): PricePoint[] {
  const prices = asRecord(body)?.prices;
  if (!Array.isArray(prices)) return [];
  const points: PricePoint[] = [];
  for (const raw of prices) {
    if (!Array.isArray(raw)) continue;
    const t = finite(raw[0]);
    const v = positive(raw[1]);
    if (t === null || v === null || t <= 0) continue;
    points.push({ t, v });
  }
  return sortUnique(points);
}

function sortUnique(points: PricePoint[]): PricePoint[] {
  points.sort((a, b) => a.t - b.t);
  return points.filter((point, index) => index === 0 || point.t !== points[index - 1]?.t);
}
