"use client";

/**
 * Data hooks of the staking area, composed from the shared data layer:
 *
 * - `useStakingView()` — the staking page's whole model (positions, totals,
 *   timeline, idle balances) for the current scope;
 * - `useChainStakingContext(chainId)` — what a stake / unstake / move / claim
 *   sheet needs about one chain: your positions there, the staking token,
 *   its price and APR, your liquid balance and the fee reserve.
 *
 * Everything reads same-origin `/api/*` through the shared `useApi` store, so
 * a sheet opened from the staking page reuses the page's answers whenever
 * the URLs match (single-chain scope) and costs one cached read otherwise.
 */

import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/components/ui";
import { findChain } from "@/lib/chains";
import type { ChainStats, StakingChain } from "@/lib/chain/types";
import { useChainStats } from "@/lib/data/chains";
import { usePortfolio } from "@/lib/data/portfolio";
import { useStakingPositions } from "@/lib/data/staking";
import { useWallet } from "@/lib/connect/context";
import { readPortfolioResponse, type PortfolioResponse } from "@/lib/token/wire";
import { apiUrl, useApi } from "@/lib/useApi";
import { usePrefs } from "@/providers/PrefsProvider";
import {
  buildStakingView,
  feeReserve,
  stakeable,
  toWhole,
  valueOf,
  type StakingView,
} from "./model";

/** Catalog name and icon, for chains the stats did not answer for. */
export function chainMeta(chainId: string): { chainName: string; iconUrl: string | null } {
  const chain = findChain(chainId);
  return { chainName: chain?.chainName ?? chainId, iconUrl: chain?.iconUrl ?? null };
}

/** The catalog's display name of a chain ("Cosmos Hub"), else its id. */
export function chainNameOf(chainId: string): string {
  return findChain(chainId)?.chainName ?? chainId;
}

/** The staking denom of a chain: the stats' bond denom, else the catalog's coin. */
function stakingDenomOf(chainId: string, stats: ChainStats | null, staking: StakingChain | null): string | null {
  return staking?.denom ?? stats?.nativeDenom ?? findChain(chainId)?.coinMinimalDenom ?? null;
}

/** Liquid amount of `denom` on `chainId` in a portfolio answer (base units), or null when absent. */
export function liquidOf(portfolio: PortfolioResponse | null, chainId: string, denom: string | null): string | null {
  if (!portfolio || !denom) return null;
  const chain = portfolio.chains.find((entry) => entry.chainId === chainId);
  if (!chain || chain.status !== "ok") return null;
  const asset = portfolio.assets.find((entry) => entry.chainId === chainId && entry.identity.denom === denom);
  // The chain was read and holds none of it: zero, not unknown.
  return asset ? asset.amounts.liquid : "0";
}

export interface IdleItem {
  chainId: string;
  chainName: string;
  iconUrl: string | null;
  symbol: string;
  decimals: number | null;
  denom: string;
  liquid: string;
  reserve: string;
  idle: string;
  idleWhole: number | null;
  idleValue: number | null;
  /** What a typical validator pays: chain actual APR × (1 − median commission). */
  apr: number | null;
  yearlyWhole: number | null;
  yearlyValue: number | null;
  /** Actual inflation: what an idle balance loses in share of supply per year. */
  inflation: number | null;
}

export interface StakingViewState {
  view: StakingView | null;
  idle: IdleItem[];
  /** Currency of every value (the stats answer's, which follows the preference). */
  currency: string;
  loading: boolean;
  /**
   * The answer on screen belongs to the previous scope while the new one
   * loads: cards dim (a background poll does not, it just refreshes).
   */
  pending: boolean;
  /**
   * Chain stats (prices, APR, unbonding period) are still on their first
   * read: anything priced or APR-derived is not known yet, so it shows a
   * skeleton rather than "unpriced" or "APR unavailable".
   */
  statsLoading: boolean;
  /** The stats read failed with nothing to show: prices and APRs are unknown, not missing. */
  statsError: boolean;
  /** Reads the stats again (the APR card's Retry). */
  retryStats: () => void;
  /** Liquid balances (for the idle card) are still loading. */
  idleLoading: boolean;
  /** Liquid balances could not be read: "nothing idle" would be a guess. */
  idleError: boolean;
  /** The positions read failed outright (nothing to show). */
  error: { message: string } | null;
  retry: () => void;
  /** Chains in scope the wallet has no address on. */
  skipped: string[];
  /** Raw states for cards that need them. */
  statsFor: (chainId: string) => ChainStats | null;
  chainIds: string[];
  /** The scope is one chain. */
  single: boolean;
}

/**
 * How long the first positions answer waits for the first prices before it
 * is shown unpriced. Positions usually land a tenth of a second before the
 * stats; shown at once they would sort by name (every value unknown), then
 * jump into value order when the prices arrive, under the user's cursor. A
 * cold stats read can take seconds, so the wait is capped: past it the
 * positions show in tokens and the priced figures keep their skeletons.
 */
const FIRST_PRICES_WAIT_MS = 2_500;

/**
 * The staking page's model for the current scope. `view` is null until the
 * first positions answer (and, briefly, the first prices: see
 * `FIRST_PRICES_WAIT_MS`); then it follows refreshes (the previous answer
 * stays on screen while a new scope loads, flagged by `pending`).
 */
export function useStakingView(): StakingViewState {
  const positions = useStakingPositions();
  const chainIds = useMemo(() => positions.accounts.map((account) => account.chainId), [positions.accounts]);
  const stats = useChainStats(chainIds);
  const portfolio = usePortfolio();
  const now = useNow();

  const raw = positions.data?.chains;
  const statsFor = stats.statsFor;
  const statsLoading = stats.loading || (stats.status === "idle" && chainIds.length > 0);
  // Only the first load waits: a scope change keeps the previous prices on
  // screen (`stale`), so `statsLoading` is false then and nothing is held.
  const [pricesWaitOver, setPricesWaitOver] = useState(false);
  const holding = Boolean(raw) && statsLoading && !pricesWaitOver;
  useEffect(() => {
    if (!holding) return;
    const timer = window.setTimeout(() => setPricesWaitOver(true), FIRST_PRICES_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [holding]);
  const view = useMemo(() => {
    if (!raw || holding) return null;
    return buildStakingView({ chains: raw, stats: statsFor, chainMeta, now: now ?? 0 });
  }, [raw, holding, statsFor, now]);

  const portfolioData = portfolio.data;
  const idle = useMemo<IdleItem[]>(() => {
    if (!portfolioData) return [];
    const items: IdleItem[] = [];
    for (const chainId of chainIds) {
      const chainStats = statsFor(chainId);
      const staking = raw?.find((chain) => chain.chainId === chainId) ?? null;
      const denom = stakingDenomOf(chainId, chainStats, staking);
      const liquid = liquidOf(portfolioData, chainId, denom);
      if (!denom || liquid === null) continue;
      const catalog = findChain(chainId);
      const reserve = feeReserve(catalog ?? null, denom);
      const idleUnits = stakeable(liquid, reserve);
      if (idleUnits === "0") continue;
      const decimals = staking?.decimals ?? chainStats?.nativeDecimals ?? (catalog?.coinMinimalDenom === denom ? catalog.coinDecimals : null);
      const price = chainStats?.price?.price ?? null;
      const idleWhole = toWhole(idleUnits, decimals);
      const idleValue = valueOf(idleWhole, price);
      // Dust is not an opportunity: under a cent (or a millionth of a token
      // when unpriced) the fee would eat it.
      if (idleValue !== null ? idleValue < 0.01 : (idleWhole ?? 0) < 1e-6) continue;
      const chainApr = chainStats?.apr.actual ?? null;
      const median = chainStats?.medianCommission ?? null;
      const apr = chainApr !== null && median !== null ? chainApr * (1 - median) : null;
      const yearlyWhole = idleWhole !== null && apr !== null ? idleWhole * apr : null;
      items.push({
        chainId,
        chainName: chainStats?.chainName ?? chainMeta(chainId).chainName,
        iconUrl: chainStats?.iconUrl ?? chainMeta(chainId).iconUrl,
        symbol: staking?.symbol || chainStats?.nativeSymbol || catalog?.coinDenom || "",
        decimals,
        denom,
        liquid,
        reserve,
        idle: idleUnits,
        idleWhole,
        idleValue,
        apr,
        yearlyWhole,
        yearlyValue: valueOf(yearlyWhole, price),
        inflation: chainStats?.inflation.actual ?? null,
      });
    }
    return items.sort((a, b) => (b.idleValue ?? -1) - (a.idleValue ?? -1));
  }, [portfolioData, chainIds, statsFor, raw]);

  return {
    view,
    idle,
    currency: stats.data?.currency ?? portfolio.data?.currency ?? "usd",
    loading: positions.loading || (positions.status === "idle" && positions.accounts.length > 0) || holding,
    pending: positions.stale || stats.stale,
    statsLoading,
    statsError: stats.status === "error" && !stats.data,
    retryStats: stats.refetch,
    idleLoading: portfolio.loading || (portfolio.status === "idle" && positions.accounts.length > 0),
    idleError: portfolio.status === "error" && !portfolio.data,
    error: positions.status === "error" && !positions.data ? { message: positions.error?.message ?? "Staking positions could not be read." } : null,
    retry: () => {
      positions.refetch();
      stats.refetch();
    },
    skipped: positions.skipped,
    statsFor,
    chainIds,
    single: chainIds.length === 1,
  };
}

/* -------------------------------------------------------------------------- */
/* One chain, for the sheets                                                   */
/* -------------------------------------------------------------------------- */

export interface ChainStakingContext {
  chainId: string;
  chainName: string;
  /** The wallet's address on the chain, or null. */
  address: string | null;
  staking: StakingChain | null;
  stakingLoading: boolean;
  /**
   * Why your positions on the chain are unknown (the read failed, or the
   * chain answered without them); null when they were read. A sheet must
   * not say "nothing staked here" then.
   */
  stakingError: string | null;
  retryStaking: () => void;
  stats: ChainStats | null;
  denom: string | null;
  symbol: string;
  decimals: number | null;
  price: number | null;
  currency: string;
  /** Liquid balance of the staking denom (base units); null while unknown. */
  liquid: string | null;
  liquidLoading: boolean;
  /** Fee reserve kept back (base units). */
  reserve: string;
  /** liquid − reserve, never negative. */
  available: string | null;
  unbondingDays: number | null;
}

/**
 * Everything a staking sheet needs about `chainId`. Reads the positions and
 * the balance for that chain only (one account), so the sheet works from any
 * page, in any scope.
 */
export function useChainStakingContext(chainId: string | null): ChainStakingContext | null {
  const { addressFor } = useWallet();
  const { currency: preferred } = usePrefs();
  const ids = useMemo(() => (chainId ? [chainId] : []), [chainId]);
  const positions = useStakingPositions({ chainIds: ids });
  const stats = useChainStats(ids);
  const address = chainId ? addressFor(chainId) : null;
  const balanceUrl =
    chainId && address ? apiUrl("/api/portfolio", { accounts: `${chainId}:${address}`, currency: preferred }) : null;
  const balance = useApi<PortfolioResponse>(balanceUrl, {
    parse: readPortfolioResponse,
    keepPreviousData: false,
    refreshMs: 60_000,
  });

  return useMemo(() => {
    if (!chainId) return null;
    const catalog = findChain(chainId);
    const chainStats = stats.statsFor(chainId);
    const staking = positions.chainFor(chainId);
    const denom = stakingDenomOf(chainId, chainStats, staking);
    const decimals =
      staking?.decimals ?? chainStats?.nativeDecimals ?? (catalog && catalog.coinMinimalDenom === denom ? catalog.coinDecimals : null);
    const liquid = liquidOf(balance.data, chainId, denom);
    const reserve = denom ? feeReserve(catalog ?? null, denom) : "0";
    const chainName = chainStats?.chainName ?? catalog?.chainName ?? chainId;
    const stakingError =
      positions.status === "error" && !positions.data
        ? (positions.error?.message ?? `Your stake on ${chainName} could not be read.`)
        : staking && (staking.status === "error" || staking.totals.staked === null)
          ? (staking.error ?? `Your stake on ${chainName} could not be read.`)
          : null;
    return {
      chainId,
      chainName,
      address,
      staking,
      stakingLoading: positions.loading,
      stakingError,
      retryStaking: positions.refetch,
      stats: chainStats,
      denom,
      symbol: staking?.symbol || chainStats?.nativeSymbol || catalog?.coinDenom || "",
      decimals,
      price: chainStats?.price?.price ?? null,
      currency: stats.data?.currency ?? preferred,
      liquid,
      liquidLoading: balance.loading,
      reserve,
      available: liquid === null ? null : stakeable(liquid, reserve),
      unbondingDays: chainStats?.unbondingDays ?? null,
    };
  }, [chainId, stats, positions, address, balance.data, balance.loading, preferred]);
}
