"use client";

/**
 * The legacy portfolio shape, served from the new `/api/portfolio`.
 *
 * Overview, Staking, the asset page and the notification feed were written
 * against `PortfolioSnapshot` (one holding per chain, native coin only). They
 * keep working on the multi-asset route through this adapter until Phase B
 * rebuilds them on `@/lib/data/portfolio`. New code should use that module.
 *
 * What the adapter keeps and what changed:
 * - still one holding per chain (pages key rows by chain id): the chain's
 *   native coin amounts, with `value` now the priced value of *everything*
 *   the account holds on that chain (IBC tokens included), so the holdings
 *   still sum to `total`;
 * - `total` is the priced value; unpriced assets are left out, never valued at
 *   zero, exactly as before;
 * - a chain that could not be read keeps its row with `error` set;
 * - chains the wallet cannot name an address on are in `skipped`.
 */

import { useMemo } from "react";
import { findChain } from "@/lib/chains";
import { usePortfolio as usePortfolioV2 } from "@/lib/data/portfolio";
import type { PortfolioResponse } from "@/lib/token/wire";
import {
  DEFAULT_FOLLOWED,
  FOLLOWED_KEY,
  useFollowedChains,
} from "@/lib/useFollowedChains";
import type { JsonError } from "@/lib/useJson";
import { useWallet } from "@/providers/WalletProvider";

export { DEFAULT_FOLLOWED, FOLLOWED_KEY, useFollowedChains };

export interface ChainHolding {
  chainId: string;
  chainName: string;
  symbol: string;
  iconUrl?: string;
  address: string;
  decimals: number;
  available: string;
  staked: string;
  rewards: string;
  amount: number;
  price: number | null;
  change24h: number | null;
  value: number | null;
  error?: string;
}

export interface PortfolioSnapshot {
  total: number;
  staked: number;
  claimable: number;
  change24h: number | null;
  pricedChains: number;
  unpricedChains: number;
  holdings: ChainHolding[];
  skipped: string[];
  currency?: string;
  stub?: boolean;
  /** "public-lcd" for a real read, "stub" for a placeholder payload. */
  source?: string;
}

export type PortfolioStatus = "idle" | "loading" | "error" | "ready";

export interface PortfolioResult {
  /** Null unless status is "ready". A failed read has no numbers. */
  snapshot: PortfolioSnapshot | null;
  status: PortfolioStatus;
  loading: boolean;
  error: JsonError | null;
  /** The route answered with placeholder rows, not with a chain read. */
  sample: boolean;
  connected: boolean;
}

/** The legacy one-row-per-chain view of a multi-asset answer. */
export function legacySnapshot(data: PortfolioResponse, skipped: readonly string[]): PortfolioSnapshot {
  const holdings: ChainHolding[] = data.chains.map((chain) => {
    // The staking coin is the asset whose ticker the chain row shows.
    const stakingDenom = findChain(chain.chainId)?.coinMinimalDenom;
    const own = data.assets.filter((asset) => asset.chainId === chain.chainId && asset.identity.decimals !== null);
    const native =
      own.find((asset) => asset.identity.denom === stakingDenom) ?? own.find((asset) => asset.identity.kind === "native");
    const holding: ChainHolding = {
      chainId: chain.chainId,
      chainName: chain.chainName,
      symbol: native?.identity.ticker ?? chain.nativeSymbol,
      address: chain.address,
      decimals: native?.identity.decimals ?? 6,
      available: native?.amounts.liquid ?? "0",
      staked: native?.amounts.staked ?? "0",
      rewards: native?.amounts.rewards ?? "0",
      amount: native?.total ?? 0,
      price: native?.price?.price ?? null,
      change24h: native?.price?.change24h ?? null,
      value: chain.value,
    };
    const icon = chain.iconUrl ?? native?.identity.logoUrl;
    if (icon) holding.iconUrl = icon;
    if (chain.status === "error") holding.error = chain.error ?? "Chain unreachable";
    return holding;
  });
  holdings.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return {
    total: data.totals.pricedValue,
    staked: data.totals.staked,
    claimable: data.totals.rewards,
    change24h: data.totals.change24hPct,
    pricedChains: data.chains.filter((chain) => chain.status === "ok" && (chain.value ?? 0) > 0).length,
    unpricedChains: data.chains.filter((chain) => chain.status === "ok" && chain.assetCount > 0 && chain.value === null)
      .length,
    holdings,
    skipped: [...skipped],
    currency: data.currency,
    source: "public-lcd",
  };
}

/**
 * Reads the connected account's holdings across the current chain scope.
 * Zunia mark = every followed chain. A rail icon = that chain only.
 */
export function usePortfolio(): PortfolioResult {
  const { account } = useWallet();
  const state = usePortfolioV2();
  const { data, error, status, accounts } = state;

  return useMemo<PortfolioResult>(() => {
    const connected = Boolean(account);
    if (!connected) {
      return { snapshot: null, status: "idle", loading: false, error: null, sample: false, connected };
    }
    if (data) {
      return {
        snapshot: legacySnapshot(data, accounts.skipped),
        status: "ready",
        loading: false,
        error: null,
        sample: false,
        connected,
      };
    }
    if (status === "error") {
      return {
        snapshot: null,
        status: "error",
        loading: false,
        error: error
          ? { kind: error.kind, message: error.message, ...(error.status !== undefined ? { status: error.status } : {}) }
          : { kind: "parse", message: "Portfolio read returned no balances" },
        sample: false,
        connected,
      };
    }
    if (status === "idle") {
      // Connected, but no scoped chain has an address to read.
      return {
        snapshot: {
          total: 0,
          staked: 0,
          claimable: 0,
          change24h: null,
          pricedChains: 0,
          unpricedChains: 0,
          holdings: [],
          skipped: accounts.skipped,
          source: "public-lcd",
        },
        status: "ready",
        loading: false,
        error: null,
        sample: false,
        connected,
      };
    }
    return { snapshot: null, status: "loading", loading: true, error: null, sample: false, connected };
  }, [account, data, error, status, accounts.skipped]);
}

/**
 * Compact magnitude: 2 decimals + k / M / Bn.
 * Examples: 20.34k, 1.50M, 2.10Bn, 12.50
 */
export function formatCompact(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return "0.00";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(fractionDigits)}Bn`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(fractionDigits)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(fractionDigits)}k`;
  }
  return `${sign}${abs.toFixed(fractionDigits)}`;
}

export function formatFiat(value: number, currency = "USD"): string {
  if (!Number.isFinite(value)) return formatFiat(0, currency);
  const sign = value < 0 ? "-" : "";
  const symbol =
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? "$";
  return `${sign}${symbol}${formatCompact(Math.abs(value), 2)}`;
}

/** Base units to a compact display string (2 decimals, k/M/Bn). */
export function formatAmount(base: string, decimals: number): string {
  if (!base) return "0.00";
  let negative = false;
  let raw = base.trim();
  if (raw.startsWith("-")) {
    negative = true;
    raw = raw.slice(1);
  }
  if (!/^\d+$/.test(raw)) return "0.00";
  const digits = raw.padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals) : "0";
  const value = Number(`${whole}.${fraction}`);
  if (!Number.isFinite(value)) return "0.00";
  return formatCompact(negative ? -value : value, 2);
}
