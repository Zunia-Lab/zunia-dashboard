"use client";

/**
 * Chain economics for the browser: `useChainStats` (many chains: the Chains
 * compare table, Compare, Insights, Overview's per-chain columns) and
 * `useChainDetail` (one chain's page and the single-chain header).
 *
 * Both read through the shared `useApi` store, so ten cards asking for the
 * same scope send one request, and a scope change keeps the previous answer
 * on screen (flagged `stale`) until the new one lands. Figures follow the
 * contract in `@/lib/chain/types`: fractions 0..1, base-unit strings, `null`
 * with a `reasons[field]` when unknown.
 */

import { useMemo } from "react";
import { rec } from "@/lib/chain/parse";
import type { ChainDetailResponse, ChainStats, ChainStatsResponse } from "@/lib/chain/types";
import { apiUrl, useApi, type ApiInitial, type ApiState } from "@/lib/useApi";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";

export type { ChainDetailResponse, ChainStats, ChainStatsResponse } from "@/lib/chain/types";

/** The route accepts at most this many chains per request. */
export const MAX_STATS_CHAINS = 40;

function readStats(raw: unknown): ChainStatsResponse | null {
  const body = rec(raw);
  return body && Array.isArray(body.chains) ? (raw as ChainStatsResponse) : null;
}

function readDetail(raw: unknown): ChainDetailResponse | null {
  const body = rec(raw);
  return body && rec(body.chain) ? (raw as ChainDetailResponse) : null;
}

export interface ChainStatsState extends ApiState<ChainStatsResponse> {
  /** The chain ids asked for (scope by default), capped at 40. */
  chainIds: string[];
  /** Stats of one chain from the current answer. */
  statsFor: (chainId: string) => ChainStats | null;
}

/**
 * Stats for `chainIds`, or for the current scope (selected chain, or every
 * followed chain on the MAIN/TEST slice) when omitted. Prices come in the
 * user's display currency (`data.currency`). Refreshes every 5 min.
 */
export function useChainStats(chainIds?: readonly string[] | null): ChainStatsState {
  const { scopedChainIds } = useChainScope();
  const { currency } = usePrefs();
  const key = (chainIds ?? scopedChainIds).filter(Boolean).slice(0, MAX_STATS_CHAINS).join(",");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);
  const state = useApi<ChainStatsResponse>(key ? apiUrl("/api/chains/stats", { chains: key, currency }) : null, {
    parse: readStats,
    keepPreviousData: true,
    refreshMs: 5 * 60_000,
    dedupeMs: 60_000,
  });
  const chains = state.data?.chains;
  const statsFor = useMemo(() => {
    const byId = new Map((chains ?? []).map((chain) => [chain.chainId, chain]));
    return (chainId: string) => byId.get(chainId) ?? null;
  }, [chains]);
  return { ...state, chainIds: ids, statsFor };
}

/**
 * One chain's detail (stats, validator-set summary, open proposals), price in
 * the user's display currency. Refreshes every 2 min.
 */
export function useChainDetail(chainId: string | null | undefined, initial?: ApiInitial | null): ApiState<ChainDetailResponse> {
  const { currency } = usePrefs();
  return useApi<ChainDetailResponse>(chainId ? apiUrl(`/api/chains/${encodeURIComponent(chainId)}`, { currency }) : null, {
    parse: readDetail,
    keepPreviousData: true,
    refreshMs: 2 * 60_000,
    dedupeMs: 30_000,
    // The same route read on the server for the first HTML (used only while the URL matches).
    initial,
  });
}
