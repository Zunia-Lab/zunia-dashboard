"use client";

/**
 * Balances on the Swap page never need a manual reload.
 *
 * - On entering the page (and when the selected chains change) and whenever
 *   the tab regains focus or becomes visible, the portfolio is read again.
 *   The cached figures stay on screen meanwhile (`useApi` keeps its frame).
 * - After a swap is signed, the page's balances (the source chain among them)
 *   are re-read once it is in a block (the sign hook does it), and the
 *   destination chain's balance is watched every 8 s for up to 3 minutes
 *   (`@/lib/swap/balance-watch`) until it changes or the tracker reports the
 *   swap over: delivered, refunded or failed. A swap that ended without the
 *   balance moving (a refund, a failed delivery) is re-read once more after
 *   the server's 30 s balance cache lapses.
 */

import { useCallback, useEffect, useRef } from "react";
import { apiUrl, revalidateApi } from "@/lib/useApi";
import { liquidBalance, watchBalance, WATCH_SETTLE_RECHECK_MS } from "@/lib/swap/balance-watch";
import { readPortfolioResponse, type PortfolioResponse } from "@/lib/token/wire";
import type { FiatCurrency } from "@/lib/token/types";
import type { SignedSwap } from "./ReviewDialog";

const PORTFOLIO_PREFIX = "/api/portfolio";

/** One chain's liquid balance of a denom, read on its own (the page's scope may not hold that chain). `null` when the read failed. */
async function readLiquid(chainId: string, address: string, denom: string, currency: FiatCurrency | string): Promise<string | null> {
  try {
    const response = await fetch(apiUrl("/api/portfolio", { accounts: `${chainId}:${address}`, currency }), { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const portfolio = readPortfolioResponse(await response.json());
    if (!portfolio) return null;
    const chain = portfolio.chains.find((entry) => entry.chainId === chainId);
    if (!chain || chain.status !== "ok") return null;
    return liquidBalance(portfolio.assets, chainId, denom);
  } catch {
    return null;
  }
}

export interface SwapBalanceSync {
  /** Call as the signature starts: remembers the destination balance as it is before the swap. */
  captureBaseline: (to: { chainId: string; denom: string }, reviewId: number) => void;
  /** Call once the swap is broadcast: starts the post-swap watch. */
  watch: (swap: SignedSwap) => void;
  /** The tracker reports this swap over (delivered, refunded, failed). */
  trackerSettled: (txHash: string) => void;
}

export function useSwapBalanceSync(options: {
  /** `usePortfolio().refetch` */
  refetch: () => Promise<void>;
  /** The portfolio read's key (`accounts.param`): a change is a new scope to read. */
  scopeKey: string | null;
  portfolio: PortfolioResponse | null;
  currency: string;
}): SwapBalanceSync {
  const { refetch, scopeKey, portfolio, currency } = options;

  const refetchRef = useRef(refetch);
  const portfolioRef = useRef(portfolio);
  const currencyRef = useRef(currency);
  useEffect(() => {
    refetchRef.current = refetch;
    portfolioRef.current = portfolio;
    currencyRef.current = currency;
  });

  // (a) Entering, a new scope, and the tab coming back.
  useEffect(() => {
    if (scopeKey === null) return;
    void refetchRef.current();
    const again = () => {
      if (document.visibilityState === "visible") void refetchRef.current();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [scopeKey]);

  // (b, c) After a swap.
  const alive = useRef(true);
  const watchId = useRef(0);
  const settled = useRef(new Set<string>());
  const baseline = useRef<{ reviewId: number; value: string | null } | null>(null);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const captureBaseline = useCallback((to: { chainId: string; denom: string }, reviewId: number) => {
    const current = portfolioRef.current;
    // Only a chain the page has read can give a baseline; otherwise the first watch read becomes it.
    const read = current?.chains.some((chain) => chain.chainId === to.chainId && chain.status === "ok");
    baseline.current = { reviewId, value: current && read ? liquidBalance(current.assets, to.chainId, to.denom) : null };
  }, []);

  const watch = useCallback((swap: SignedSwap) => {
    const id = ++watchId.current;
    const { to } = swap.review;
    const before = baseline.current && baseline.current.reviewId === swap.review.id ? baseline.current.value : null;
    // The source chain: re-read now (the sign hook did on inclusion; this also covers a read already in flight).
    revalidateApi(PORTFOLIO_PREFIX);
    void (async () => {
      const end = await watchBalance({
        baseline: before,
        read: async () => {
          // A broadcast not yet in a block moves the source balance later: keep the page's figures current too.
          if (!swap.confirmed) revalidateApi(PORTFOLIO_PREFIX);
          return readLiquid(to.chainId, swap.review.recipient, to.denom, currencyRef.current);
        },
        isFinished: () => settled.current.has(swap.txHash),
        isCancelled: () => !alive.current || watchId.current !== id,
      });
      if (end === "cancelled") return;
      revalidateApi(PORTFOLIO_PREFIX);
      if (end === "finished") {
        const timer = window.setTimeout(() => {
          timers.current.delete(timer);
          revalidateApi(PORTFOLIO_PREFIX);
        }, WATCH_SETTLE_RECHECK_MS);
        timers.current.add(timer);
      }
    })();
  }, []);

  const trackerSettled = useCallback((txHash: string) => {
    settled.current.add(txHash);
  }, []);

  return { captureBaseline, watch, trackerSettled };
}
