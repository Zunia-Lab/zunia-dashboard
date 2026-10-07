/**
 * CoinGecko, best effort: the fallback price for assets Numia does not quote,
 * the FX rate behind EUR and GBP, and history for assets without an Osmosis
 * market.
 *
 * Unauthenticated calls from a shared server IP are answered with 429 often
 * enough that nothing may depend on this source: every caller treats a
 * failure as "not quoted right now". Three things keep the call count low:
 *
 * - quotes are kept per id for two minutes (process-wide), and only the ids
 *   that are missing or old are asked for, up to 250 per request. An old
 *   quote (up to 15 minutes) is served at once while one refresh runs in the
 *   background, each price carrying its true age (`at`); only an id with no
 *   servable quote makes the request wait for CoinGecko — which is often slow
 *   or 429 from a shared IP, and used to cost every third 60-second portfolio
 *   poll up to the 8-second timeout;
 * - a 429 starts a one-minute cooldown during which nothing is sent at all,
 *   so a rate-limited window is not made longer by retries;
 * - charts and FX are cached for tens of minutes to hours.
 *
 * `COINGECKO_API_KEY` (optional) is sent as `x-cg-demo-api-key`; with
 * `COINGECKO_API_PLAN=pro` it goes to `pro-api.coingecko.com` as
 * `x-cg-pro-api-key` instead. Never logged, never echoed.
 */

import "server-only";

import { cached } from "@/lib/server/cache";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import type { FiatCurrency, PricePoint } from "@/lib/token/types";
import {
  parseGeckoChart,
  parseGeckoFx,
  parseGeckoMarkets,
  parseGeckoSimple,
  type GeckoMarket,
  type GeckoQuote,
} from "./parse";

export const GECKO_LABEL = "CoinGecko";
export const GECKO_URL = "https://www.coingecko.com";

const QUOTE_TTL_MS = 120_000;
/** A quote older than this is not served even when a refresh fails. */
const QUOTE_MAX_AGE_MS = 15 * 60_000;
const COOLDOWN_MS = 60_000;
const BATCH = 250;
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function config(): { base: string; headers: Record<string, string> } {
  const key = process.env.COINGECKO_API_KEY?.trim();
  const pro = process.env.COINGECKO_API_PLAN?.trim() === "pro";
  if (key && pro) return { base: "https://pro-api.coingecko.com/api/v3", headers: { "x-cg-pro-api-key": key } };
  if (key) return { base: "https://api.coingecko.com/api/v3", headers: { "x-cg-demo-api-key": key } };
  return { base: "https://api.coingecko.com/api/v3", headers: {} };
}

interface GeckoState {
  quotes: Map<string, { quote: GeckoQuote | null; at: number }>;
  cooldownUntil: number;
}

const STATE_KEY = "__zuniaCoinGeckoState";

function state(): GeckoState {
  const g = globalThis as unknown as Record<string, GeckoState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = { quotes: new Map(), cooldownUntil: 0 };
    g[STATE_KEY] = s;
  }
  return s;
}

/** Whether CoinGecko may be asked right now (not inside a 429 cooldown). */
export function geckoAvailable(): boolean {
  return Date.now() >= state().cooldownUntil;
}

async function geckoGet(path: string, timeoutMs = 8_000): Promise<unknown> {
  const s = state();
  const { base, headers } = config();
  // Inside a cooldown nothing is sent; the caller sees the 429 that started it.
  if (Date.now() < s.cooldownUntil) throw new UpstreamError("http", new URL(base).host, 429);
  try {
    return await fetchJson(`${base}${path}`, { timeoutMs, headers, hostConcurrency: 2 });
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "http" && (error.status === 429 || error.status === 403)) {
      s.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    throw error;
  }
}

export interface GeckoQuotes {
  quotes: Map<string, GeckoQuote>;
  /** False when some ids could not be asked (cooldown or failure). */
  read: boolean;
  /** Oldest quote served, epoch ms. */
  at: number;
}

/**
 * Ask CoinGecko for one batch of ids and remember every answer, an id it
 * answered without included ("not quoted", remembered like a quote).
 *
 * The inner cache stays `staleMs: 0` on purpose: a stale answer from it would
 * be stamped with `Date.now()` below and served as fresh. Staleness is decided
 * per id from `at`, in `geckoQuotes`.
 */
async function refreshQuotes(chunk: readonly string[]): Promise<void> {
  const found = await cached(
    `coingecko:simple:${chunk.join(",")}`,
    { ttlMs: QUOTE_TTL_MS, staleMs: 0, errorTtlMs: 30_000 },
    async () =>
      parseGeckoSimple(
        await geckoGet(`/simple/price?ids=${encodeURIComponent(chunk.join(","))}&vs_currencies=usd&include_24hr_change=true`),
      ),
  );
  const at = Date.now();
  const s = state();
  for (const id of chunk) s.quotes.set(id, { quote: found.get(id) ?? null, at });
}

/** USD quotes for `ids` (invalid ids are ignored). Never rejects. */
export async function geckoQuotes(ids: readonly string[]): Promise<GeckoQuotes> {
  const s = state();
  const now = Date.now();
  const wanted = [...new Set(ids.filter((id) => ID.test(id)))].sort();
  const due = wanted.filter((id) => {
    const entry = s.quotes.get(id);
    return !entry || now - entry.at > QUOTE_TTL_MS;
  });
  const servable = (id: string) => {
    const entry = s.quotes.get(id);
    return entry !== undefined && now - entry.at <= QUOTE_MAX_AGE_MS;
  };
  // Old but servable: answer now, refresh behind the answer.
  const behind = due.filter(servable);
  // Nothing to serve: this request waits for CoinGecko.
  const wait = due.filter((id) => !servable(id));
  for (let i = 0; i < behind.length; i += BATCH) {
    void refreshQuotes(behind.slice(i, i + BATCH)).catch(() => undefined);
  }
  let read = true;
  for (let i = 0; i < wait.length; i += BATCH) {
    try {
      await refreshQuotes(wait.slice(i, i + BATCH));
    } catch {
      read = false;
    }
  }
  // Inside a 429 cooldown the background refresh cannot run either; say so,
  // so the answer's "CoinGecko did not answer" note stays truthful.
  if (behind.length > 0 && !geckoAvailable()) read = false;
  const quotes = new Map<string, GeckoQuote>();
  let oldest = now;
  for (const id of wanted) {
    const entry = s.quotes.get(id);
    if (!entry || now - entry.at > QUOTE_MAX_AGE_MS || !entry.quote) continue;
    quotes.set(id, entry.quote);
    oldest = Math.min(oldest, entry.at);
  }
  // Keep the store bounded: drop entries nobody could be served any more.
  if (s.quotes.size > 5_000) {
    for (const [id, entry] of s.quotes) if (now - entry.at > QUOTE_MAX_AGE_MS) s.quotes.delete(id);
  }
  return { quotes, read, at: oldest };
}

export interface FxRates {
  /** EUR per USD. */
  eur: number;
  /** GBP per USD. */
  gbp: number;
  /** Tether's USD price, for converting USDT-quoted markets. */
  usdtUsd: number;
  at: number;
}

/** USD → EUR/GBP from Tether's quotes, cached 10 minutes (served up to an hour old). */
export function geckoFx(): Promise<FxRates> {
  return cached("coingecko:fx:tether", { ttlMs: 10 * 60_000, staleMs: 50 * 60_000, errorTtlMs: 30_000 }, async () => {
    const body = await geckoGet("/simple/price?ids=tether&vs_currencies=usd,eur,gbp");
    const fx = parseGeckoFx(body);
    const usd = (body as { tether?: { usd?: unknown } } | null)?.tether?.usd;
    if (!fx || typeof usd !== "number") throw new Error("CoinGecko returned no FX rate");
    return { ...fx, usdtUsd: usd, at: Date.now() };
  });
}

/**
 * Market cap, supply and all-time high for one id, in `currency` (CoinGecko
 * quotes EUR and GBP itself, so an all-time high is the one people saw in
 * that currency, not today's rate applied to a USD figure). Cached 10 minutes.
 */
export function geckoMarket(id: string, currency: FiatCurrency): Promise<GeckoMarket | null> {
  if (!ID.test(id)) return Promise.resolve(null);
  return cached(
    `coingecko:market:${currency}:${id}`,
    { ttlMs: 10 * 60_000, staleMs: 50 * 60_000, errorTtlMs: 60_000 },
    async () =>
      parseGeckoMarkets(
        await geckoGet(`/coins/markets?vs_currency=${currency}&ids=${encodeURIComponent(id)}&sparkline=false`),
      ).get(id) ?? null,
  );
}

export type GeckoDays = 2 | 8 | 31 | 91 | 365;

/**
 * USD price history; hourly up to 8 days, daily beyond. An id CoinGecko does
 * not know (404: delisted, renamed) has no history, which is cached like an
 * answer rather than asked again every minute.
 */
export function geckoChart(id: string, days: GeckoDays): Promise<PricePoint[]> {
  if (!ID.test(id)) return Promise.resolve([]);
  const ttlMs = days <= 8 ? 30 * 60_000 : 6 * 60 * 60_000;
  const interval = days > 8 ? "&interval=daily" : "";
  return cached(`coingecko:chart:${id}:${days}`, { ttlMs, staleMs: ttlMs, errorTtlMs: 60_000 }, async () => {
    try {
      return parseGeckoChart(
        await geckoGet(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}${interval}`, 10_000),
      );
    } catch (error) {
      if (error instanceof UpstreamError && error.kind === "http" && error.status === 404) return [];
      throw error;
    }
  });
}
