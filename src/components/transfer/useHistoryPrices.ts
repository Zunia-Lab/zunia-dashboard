"use client";

/**
 * Today's price of every token that moved in a set of activity rows, for the
 * "value at today's prices" figures (sent, moved out, received).
 *
 * Priced by identity key through `/api/prices`, not from the portfolio: a
 * token sent away last week and no longer held has no portfolio row, and
 * reading prices from there would quietly turn it into "unpriced". Figures
 * built on this are estimates and must say so (`flowSummary().method`), and
 * they are formatted in the response's currency.
 */

import { useMemo } from "react";
import { priceMapFrom, type PriceMap } from "@/lib/activity/analytics";
import type { ActivityItem } from "@/lib/activity/types";
import { useSpotPrices } from "@/lib/data/prices";

export interface HistoryPrices {
  prices: PriceMap;
  /** The currency the prices are in; null until the first answer. */
  currency: string | null;
  /** First read in flight (a refresh keeps the previous prices). */
  loading: boolean;
}

export function useHistoryPrices(items: readonly ActivityItem[]): HistoryPrices {
  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) for (const amount of item.amounts) set.add(amount.identity.key);
    return [...set];
  }, [items]);
  const state = useSpotPrices(keys);
  const prices = useMemo(() => priceMapFrom(state.data?.prices), [state.data]);
  return { prices, currency: state.data?.currency ?? null, loading: keys.length > 0 && !state.data && state.loading };
}
