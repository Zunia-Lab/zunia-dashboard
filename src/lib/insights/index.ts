"use client";

/**
 * Insights for the current chain scope: `useInsights()` runs the rules in
 * `./rules.ts` over the reads every wallet page already makes.
 *
 * It asks the shared `useApi` store for the same URLs the Overview and the
 * Insights page read themselves (portfolio, staking, chain stats, voting
 * proposals with the wallet as voter, security review), so calling it costs
 * no extra request. Everything follows the scope: the Zunia mark gives
 * insights across every followed chain of the MAIN/TEST slice, a chain on the
 * rail gives that chain's only.
 *
 * Items appear as soon as balances and staking positions are in; governance,
 * chain economics and the security review add theirs when they land, so a
 * slow node delays its own cards, not the list.
 *
 * What the reader opened or cleared is left out of `items` (see
 * `./dismissals.ts`) and counted in `hidden`; `all` keeps the full list for
 * figures that are facts rather than suggestions (the "Claim all" emphasis).
 * With insights turned off in Settings, `items` is empty and `enabled` false.
 */

import { useCallback, useMemo } from "react";
import { useNow } from "@/components/ui/hooks";
import { findChain } from "@/lib/chains";
import { useChainStats } from "@/lib/data/chains";
import { useProposals } from "@/lib/data/governance";
import { usePortfolio } from "@/lib/data/portfolio";
import { useSecurityReview, useStakingPositions } from "@/lib/data/staking";
import type { FeeChain } from "@/lib/tx/fees";
import type { ApiState } from "@/lib/useApi";
import { useWallet } from "@/lib/connect/context";
import { useChainScope } from "@/lib/useChainScope";
import { useStoredValue } from "@/lib/useStoredValue";
import { usePrefs } from "@/providers/PrefsProvider";
import { dismissInsights, EMPTY_BOOK, INSIGHT_DISMISSALS_KEY, readBook, restoreInsights, splitDismissed, type DismissalBook } from "./dismissals";
import { CHAIN_NOTICES, deriveInsights, type Insight } from "./rules";

export * from "./rules";
export { INSIGHT_REST_MS } from "./dismissals";

export interface InsightsState {
  /** What to show: most severe first (see `deriveInsights`), without what the reader hid. Empty without a wallet, or with insights off. */
  items: Insight[];
  /** Everything the rules found, hidden ones included. */
  all: Insight[];
  /** Found but hidden by the reader (opened or cleared), most severe first. */
  hiddenItems: Insight[];
  /** Insights are on (Settings). */
  enabled: boolean;
  /** Hide these (the reader opened or cleared them). */
  dismiss: (insights: readonly Insight[]) => void;
  /** Hide everything currently shown. */
  clearAll: () => void;
  /** Show everything this account hid again. */
  restore: () => void;
  /** Balances or staking positions are still on their first read. */
  loading: boolean;
  /** Reads that failed, in words ("Staking positions: node timed out"). Partial lists stay usable. */
  errors: string[];
  /** A source is refetching, or still shows the previous scope's answer. */
  refreshing: boolean;
}

/** The voting-proposals read Overview and Insights share (same URL, one request). */
export const INSIGHT_PROPOSALS = { status: "voting" } as const;

function failure(label: string, state: Pick<ApiState<unknown>, "status" | "error">): string | null {
  return state.status === "error" ? `${label}: ${state.error?.message ?? "the read failed"}` : null;
}

export function useInsights(): InsightsState {
  const portfolio = usePortfolio();
  const staking = useStakingPositions();
  const stats = useChainStats();
  const proposals = useProposals(INSIGHT_PROPOSALS);
  const security = useSecurityReview();
  const { hideAmounts, currency: preferred, insightsOn } = usePrefs();
  const { scopedChainIds } = useChainScope();
  const { account } = useWallet();
  const [stored, setStored] = useStoredValue<DismissalBook>(INSIGHT_DISMISSALS_KEY, EMPTY_BOOK);
  const now = useNow();

  // Gas prices and display names from the client catalog: the rules estimate
  // claim fees and fee reserves from the same figures the signing flow uses.
  const catalog = useMemo(() => {
    const feeChains: Record<string, FeeChain> = {};
    const chainNames: Record<string, string> = {};
    for (const chainId of [...scopedChainIds, ...Object.keys(CHAIN_NOTICES)]) {
      const entry = findChain(chainId);
      if (!entry) continue;
      chainNames[chainId] = entry.chainName;
      feeChains[chainId] = entry;
    }
    return { feeChains, chainNames };
  }, [scopedChainIds]);

  const currency = portfolio.data?.currency ?? preferred;
  const items = useMemo(() => {
    if (now === null || (!portfolio.data && !staking.data)) return [];
    return deriveInsights({
      now,
      currency,
      hideAmounts,
      portfolio: portfolio.data,
      staking: staking.data,
      chainStats: stats.data,
      proposals: proposals.data,
      security: security.data,
      feeChains: catalog.feeChains,
      chainNames: catalog.chainNames,
    });
  }, [now, currency, hideAmounts, portfolio.data, staking.data, stats.data, proposals.data, security.data, catalog]);

  const address = account?.address ?? "";
  const book = useMemo(() => readBook(stored), [stored]);
  const { visible, hidden } = useMemo(() => splitDismissed(items, book[address], now ?? 0), [items, book, address, now]);
  // Each write reads the stored book afresh (functional update), so two tabs
  // or two quick clicks cannot drop each other's records.
  const dismiss = useCallback(
    (insights: readonly Insight[]) => {
      if (!address || insights.length === 0) return;
      setStored((prev) => dismissInsights(readBook(prev), address, insights, Date.now()));
    },
    [address, setStored],
  );
  const clearAll = useCallback(() => dismiss(visible), [dismiss, visible]);
  const restore = useCallback(() => {
    if (address) setStored((prev) => restoreInsights(readBook(prev), address));
  }, [address, setStored]);

  // Cheap enough to build on every render; each state object is new anyway.
  const errors = [
    failure("Balances", portfolio),
    failure("Staking positions", staking),
    failure("Chain economics", stats),
    failure("Governance", proposals),
    failure("Security review", security),
  ].filter((line): line is string => line !== null);
  for (const chain of staking.data?.chains ?? []) {
    if (chain.status === "error") errors.push(`Staking on ${catalog.chainNames[chain.chainId] ?? chain.chainId}: ${chain.error ?? "unreadable"}`);
  }
  for (const check of security.data?.checked ?? []) {
    if (check.status === "error") errors.push(`Security review on ${catalog.chainNames[check.chainId] ?? check.chainId}: could not be checked`);
  }

  const sources = [portfolio, staking, stats, proposals, security];
  return {
    items: insightsOn ? visible : [],
    all: items,
    hiddenItems: insightsOn ? hidden : [],
    enabled: insightsOn,
    dismiss,
    clearAll,
    restore,
    loading: portfolio.loading || staking.loading || (now === null && (portfolio.status !== "idle" || staking.status !== "idle")),
    errors,
    refreshing: sources.some((source) => source.refreshing || source.stale),
  };
}
