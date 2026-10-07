"use client";

/**
 * Which coin each chain stakes, from chain stats (the staking module's own
 * `bond_denom`), plus the stats themselves for callers that also show APR.
 *
 * A chain that reports no bonded validator (a consumer chain secured by
 * another, a set that could not be read) offers no "Stake": the action would
 * lead nowhere.
 */

import { useMemo } from "react";
import { useChainStats, type ChainStatsState } from "@/lib/data/chains";
import type { BondDenomOf } from "./links";

export function useBondDenoms(chainIds?: readonly string[] | null): { bondDenomOf: BondDenomOf; stats: ChainStatsState } {
  const stats = useChainStats(chainIds);
  const chains = stats.data?.chains;
  const bondDenomOf = useMemo<BondDenomOf>(() => {
    const map = new Map<string, string>();
    for (const chain of chains ?? []) {
      if (chain.nativeDenom && (chain.activeValidators ?? 0) > 0) map.set(chain.chainId, chain.nativeDenom);
    }
    return (chainId) => map.get(chainId);
  }, [chains]);
  return { bondDenomOf, stats };
}
