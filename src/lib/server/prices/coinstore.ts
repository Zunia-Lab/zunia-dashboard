/**
 * Coinstore's public candles: the one source for SAF, which no aggregator
 * lists (same rule as the extension: the price says where it comes from,
 * "Coinstore SAF/USDT").
 *
 * Two reads cover everything: 200 hourly candles (spot, 24 h and 7 d change,
 * 24 h volume, the 7-day sparkline and 1D/7D history) refreshed every
 * minute, and 400 daily candles (30D…1Y history; the market opened
 * 2026-07-19) refreshed every six hours.
 */

import "server-only";

import { cached } from "@/lib/server/cache";
import { fetchJson } from "@/lib/server/http";
import { parseCoinstoreKlines, type Bar } from "./parse";

const KLINES = "https://api.coinstore.com/api/v1/market/kline";

export type CoinstorePeriod = "60min" | "1day";

export interface CoinstoreCandles {
  bars: Bar[];
  /** Epoch ms of the read. */
  at: number;
}

export function coinstoreBars(market: string, period: CoinstorePeriod): Promise<CoinstoreCandles> {
  if (!/^[A-Z0-9]{2,20}$/.test(market)) return Promise.reject(new Error("invalid market"));
  const size = period === "60min" ? 200 : 400;
  const ttlMs = period === "60min" ? 60_000 : 6 * 60 * 60_000;
  return cached(
    `coinstore:kline:${market}:${period}:${size}`,
    { ttlMs, staleMs: period === "60min" ? 10 * 60_000 : ttlMs, errorTtlMs: 20_000 },
    async () => {
      const body = await fetchJson(`${KLINES}/${market}?period=${period}&size=${size}`, {
        timeoutMs: 8_000,
        retries: 1,
        hostConcurrency: 2,
      });
      const bars = parseCoinstoreKlines(body);
      if (bars.length === 0) throw new Error("Coinstore returned no candles");
      return { bars, at: Date.now() };
    },
  );
}
