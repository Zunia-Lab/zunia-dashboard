"use client";

/**
 * Spot prices and price history by asset key, in the user's currency.
 *
 * An asset key is `TokenIdentity.key` (`cosmoshub-4:uatom`, `noble-1:uusdc`,
 * `safrochain-1:usaf`); pass the identity itself and its key is used. Public
 * data: these reads need no wallet.
 */

import { apiUrl, useApi, type ApiState } from "@/lib/useApi";
import type { PriceRange, TokenIdentity } from "@/lib/token/types";
import {
  readPriceHistoryResponse,
  readPricesResponse,
  type PriceHistoryResponse,
  type PricesResponse,
} from "@/lib/token/wire";
import { usePrefs } from "@/providers/PrefsProvider";

export type { PriceHistoryResponse, PricesResponse, PriceRange };

function keyOf(target: string | Pick<TokenIdentity, "key"> | null | undefined): string | null {
  if (!target) return null;
  const key = typeof target === "string" ? target : target.key;
  return key.length > 0 ? key : null;
}

/**
 * `GET /api/prices/history` for one asset. Hourly for 1D/7D, daily beyond;
 * `coverage` says how far back the data really goes and `source`/`label`
 * where it comes from.
 */
export function usePriceHistory(
  target: string | Pick<TokenIdentity, "key"> | null | undefined,
  range: PriceRange,
): ApiState<PriceHistoryResponse> {
  const { currency } = usePrefs();
  const key = keyOf(target);
  const url = key ? apiUrl("/api/prices/history", { key, range, currency }) : null;
  return useApi<PriceHistoryResponse>(url, {
    parse: readPriceHistoryResponse,
    keepPreviousData: true,
    dedupeMs: 5 * 60_000,
  });
}

/** `GET /api/prices` for up to 100 asset keys, refreshed every minute. */
export function useSpotPrices(keys: readonly string[]): ApiState<PricesResponse> {
  const { currency } = usePrefs();
  const list = [...new Set(keys.filter((key) => key.length > 0))].sort().slice(0, 100);
  const url = list.length > 0 ? apiUrl("/api/prices", { keys: list.join(","), currency }) : null;
  return useApi<PricesResponse>(url, {
    parse: readPricesResponse,
    keepPreviousData: true,
    refreshMs: 60_000,
  });
}
