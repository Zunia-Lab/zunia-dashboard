"use client";

/**
 * The connected wallet's portfolio across the current chain scope.
 *
 * Scope comes from `useChainScope` (Zunia mark = every followed chain of the
 * MAIN/TEST slice; a rail icon = that chain), currency from `usePrefs`, and
 * the address on each chain from the wallet's `addressFor` (its own key from
 * `getKey(chainId)`, else a same-key-scheme re-encoding). A chain the wallet
 * cannot name an address on is skipped and listed in `skipped`, never
 * guessed — a coin-type-60 chain is a different key entirely.
 *
 * `scope: "followed"` reads every followed chain of the MAIN/TEST slice
 * whatever chain the rail has selected: the rail's hover cards and the scope
 * popover show a value and a share of net worth for every chain, not only the
 * selected one. In "All chains" scope both read the same URL, so they share
 * one request.
 *
 * Reads go through `useApi` with `keepPreviousData`: switching the scope or
 * the currency keeps the last answer on screen (flagged `stale`) until the
 * new one lands, and a refresh dims instead of flashing a skeleton.
 */

import { useMemo } from "react";
import { findChain } from "@/lib/chains";
import { apiUrl, useApi, type ApiState } from "@/lib/useApi";
import { useChainScope } from "@/lib/useChainScope";
import {
  readPortfolioHistoryResponse,
  readPortfolioResponse,
  type PortfolioHistoryRange,
  type PortfolioHistoryResponse,
  type PortfolioResponse,
} from "@/lib/token/wire";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";

export type { PortfolioHistoryRange, PortfolioHistoryResponse, PortfolioResponse };

/** The server's cap; a scope wider than this reads its first 32 chains (in followed order). */
const MAX_ACCOUNTS = 32;

export interface PortfolioAccounts {
  /** Scoped chains read, with their address, sorted by chain id (a stable cache key). */
  accounts: { chainId: string; address: string }[];
  /** Scoped chains the wallet could not name an address on (another key scheme, a phone that did not approve it). */
  skipped: string[];
  /** Scoped chains with an address left out because the scope is wider than 32 chains. */
  overLimit: string[];
  /** The `accounts` query value, or null when there is nothing to read. */
  param: string | null;
}

/**
 * Which chains a portfolio read covers: the current scope (the rail's
 * selection, else every followed chain of the slice), or every followed chain
 * of the slice whatever is selected.
 */
export type PortfolioScope = "current" | "followed";

export interface PortfolioOptions {
  /** Default "current". */
  scope?: PortfolioScope;
}

/** Every chain of `scope` the current wallet can name an address on. */
export function usePortfolioAccounts(scope: PortfolioScope = "current"): PortfolioAccounts {
  const { account, addressFor } = useWallet();
  const { scopedChainIds, followedOnNetwork } = useChainScope();
  const chainIds = scope === "followed" ? followedOnNetwork : scopedChainIds;

  return useMemo(() => {
    if (!account) return { accounts: [], skipped: [], overLimit: [], param: null };
    const accounts: { chainId: string; address: string }[] = [];
    const skipped: string[] = [];
    for (const chainId of chainIds) {
      const address = addressFor(chainId);
      // The server refuses the whole request for one address under the wrong
      // prefix (400): a chain the wallet cannot name correctly is skipped here
      // instead, so it costs that chain, not the portfolio.
      const prefix = findChain(chainId)?.bech32Prefix;
      if (address && prefix && address.startsWith(`${prefix}1`)) accounts.push({ chainId, address });
      else skipped.push(chainId);
    }
    // The first 32 in the user's own order (followed order is priority), then
    // sorted so the same set always makes the same URL (one cache entry).
    const read = accounts.slice(0, MAX_ACCOUNTS).sort((a, b) => a.chainId.localeCompare(b.chainId));
    return {
      accounts: read,
      skipped,
      overLimit: accounts.slice(MAX_ACCOUNTS).map((entry) => entry.chainId),
      param: read.length > 0 ? read.map((entry) => `${entry.chainId}:${entry.address}`).join(",") : null,
    };
  }, [account, addressFor, chainIds]);
}

export type PortfolioState = ApiState<PortfolioResponse> & { accounts: PortfolioAccounts };

/**
 * `GET /api/portfolio` for the scope, polled every minute while the tab is
 * visible. `data` is null until the first answer; `status` tells an empty
 * wallet ("ready" with no assets) from a failed read ("error"), and "idle"
 * means there is nothing to read (no wallet, or no scoped chain has an
 * address: see `accounts.skipped`). Format money with `data.currency`, not
 * the stored preference: without an FX rate the answer is in USD
 * (`data.currencyFallback`).
 */
export function usePortfolio(options: PortfolioOptions = {}): PortfolioState {
  const accounts = usePortfolioAccounts(options.scope);
  const { currency } = usePrefs();
  const url = accounts.param ? apiUrl("/api/portfolio", { accounts: accounts.param, currency }) : null;
  const state = useApi<PortfolioResponse>(url, {
    parse: readPortfolioResponse,
    keepPreviousData: true,
    refreshMs: 60_000,
  });
  return { ...state, accounts };
}

/**
 * `GET /api/portfolio/history`: the value of today's holdings over `range`
 * (an estimate — see `PortfolioHistoryResponse.method` and `coverage`).
 * Refreshed every 5 minutes; the newest point is "now" at spot prices.
 */
export function usePortfolioHistory(
  range: PortfolioHistoryRange,
  options: PortfolioOptions = {},
): ApiState<PortfolioHistoryResponse> {
  const accounts = usePortfolioAccounts(options.scope);
  const { currency } = usePrefs();
  const url = accounts.param
    ? apiUrl("/api/portfolio/history", { accounts: accounts.param, currency, range })
    : null;
  return useApi<PortfolioHistoryResponse>(url, {
    parse: readPortfolioHistoryResponse,
    keepPreviousData: true,
    dedupeMs: 5 * 60_000,
    refreshMs: 5 * 60_000,
  });
}
