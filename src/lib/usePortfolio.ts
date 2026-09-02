"use client";

import { useMemo } from "react";
import { useChainScope } from "@/lib/useChainScope";
import {
  DEFAULT_FOLLOWED,
  FOLLOWED_KEY,
  useFollowedChains,
} from "@/lib/useFollowedChains";
import { useJson } from "@/lib/useJson";
import { useWallet } from "@/providers/WalletProvider";
import { usePrefs } from "@/providers/PrefsProvider";

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
}

const PORTFOLIO_ERROR: PortfolioSnapshot = {
  total: 0,
  staked: 0,
  claimable: 0,
  change24h: null,
  pricedChains: 0,
  unpricedChains: 0,
  holdings: [],
  skipped: [],
  stub: true,
};

/**
 * Reads the connected account's holdings across the current chain scope.
 * Zunia mark = every followed chain. A rail icon = that chain only.
 */
export function usePortfolio() {
  const { account } = useWallet();
  const { scopedChainIds } = useChainScope();
  const { currency } = usePrefs();

  const url = account
    ? `/api/portfolio?${new URLSearchParams({
        address: account.address,
        chainId: account.chainId,
        chains: scopedChainIds.join(","),
        currency,
      }).toString()}`
    : null;

  const data = useJson<PortfolioSnapshot>(url, PORTFOLIO_ERROR);

  return useMemo(
    () => ({
      snapshot: data,
      loading: Boolean(account) && data === null,
      connected: Boolean(account),
    }),
    [account, data, currency],
  );
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
