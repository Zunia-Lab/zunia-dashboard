"use client";

/**
 * `GET /api/markets`: Cosmos assets traded on Osmosis (Numia) plus SAF
 * (Coinstore SAF/USDT), in the user's currency, refreshed every 3 minutes
 * (the server's cache period). Public: no wallet needed.
 */

import { apiUrl, useApi, type ApiInitial, type ApiState } from "@/lib/useApi";
import { readMarketsResponse, type MarketAsset, type MarketsResponse } from "@/lib/token/wire";
import { usePrefs } from "@/providers/PrefsProvider";

export type { MarketAsset, MarketsResponse };

/**
 * The Cosmos market list in the user's currency. `initial`: the same route
 * read on the server for the first HTML (used only while the URL matches,
 * i.e. in the currency it was read in).
 */
export function useMarkets(initial?: ApiInitial | null): ApiState<MarketsResponse> {
  const { currency } = usePrefs();
  return useApi<MarketsResponse>(apiUrl("/api/markets", { currency }), {
    parse: readMarketsResponse,
    keepPreviousData: true,
    refreshMs: 180_000,
    initial,
  });
}
