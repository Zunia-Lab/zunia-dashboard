"use client";

import { useMemo } from "react";
import { useChainScope } from "@/lib/useChainScope";
import {
  DEFAULT_FOLLOWED,
  FOLLOWED_KEY,
  useFollowedChains,
} from "@/lib/useFollowedChains";
import { useJsonState, type JsonError } from "@/lib/useJson";
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

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function baseUnits(value: unknown): string {
  return typeof value === "string" && /^-?\d+$/.test(value) ? value : "0";
}

/**
 * One holding, or null when the row cannot be rendered. Rows are dropped rather
 * than passed through half-typed: AssetRow prints symbol / amount / value
 * directly, so a missing field would surface to the user as "undefined".
 */
function readHolding(raw: unknown): ChainHolding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.chainId !== "string" || typeof row.symbol !== "string") {
    return null;
  }
  return {
    chainId: row.chainId,
    chainName:
      typeof row.chainName === "string" ? row.chainName : row.chainId,
    symbol: row.symbol,
    iconUrl: typeof row.iconUrl === "string" ? row.iconUrl : undefined,
    address: typeof row.address === "string" ? row.address : "",
    decimals: numberOr(row.decimals, 6),
    available: baseUnits(row.available),
    staked: baseUnits(row.staked),
    rewards: baseUnits(row.rewards),
    amount: numberOr(row.amount, 0),
    price: nullableNumber(row.price),
    change24h: nullableNumber(row.change24h),
    value: nullableNumber(row.value),
    error: typeof row.error === "string" ? row.error : undefined,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * /api/portfolio answers 200 either with a snapshot or with a placeholder
 * ({ error, stub }), so the aggregates the pages render are checked here
 * instead of trusted. A payload without them is a failed read, not a wallet
 * holding nothing.
 *
 * Every field a consumer reads is narrowed or defaulted rather than asserted:
 * the previous `value as unknown as PortfolioSnapshot` let a payload with the
 * four checked fields and nothing else through, and useNotifications then
 * rendered "Across undefined chains".
 */
function readSnapshot(raw: unknown): PortfolioSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.total !== "number" ||
    typeof value.staked !== "number" ||
    typeof value.claimable !== "number" ||
    !Array.isArray(value.holdings)
  ) {
    return null;
  }
  return {
    total: value.total,
    staked: value.staked,
    claimable: value.claimable,
    change24h:
      typeof value.change24h === "number" && Number.isFinite(value.change24h)
        ? value.change24h
        : null,
    pricedChains: numberOr(value.pricedChains, 0),
    unpricedChains: numberOr(value.unpricedChains, 0),
    holdings: value.holdings
      .map(readHolding)
      .filter((row): row is ChainHolding => row !== null),
    skipped: stringArray(value.skipped),
    currency: typeof value.currency === "string" ? value.currency : undefined,
    stub: value.stub === true,
    source: typeof value.source === "string" ? value.source : undefined,
  };
}

/**
 * Reads the connected account's holdings across the current chain scope.
 * Zunia mark = every followed chain. A rail icon = that chain only.
 */
export function usePortfolio(): PortfolioResult {
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

  const { data, error, loading } = useJsonState<unknown>(url);

  return useMemo(() => {
    const connected = Boolean(account);
    if (!connected) {
      return {
        snapshot: null,
        status: "idle",
        loading: false,
        error: null,
        sample: false,
        connected,
      };
    }
    if (loading) {
      return {
        snapshot: null,
        status: "loading",
        loading: true,
        error: null,
        sample: false,
        connected,
      };
    }

    const snapshot = readSnapshot(data);
    if (!snapshot) {
      return {
        snapshot: null,
        status: "error",
        loading: false,
        error: error ?? {
          kind: "parse",
          message: "Portfolio read returned no balances",
        },
        sample: false,
        connected,
      };
    }

    return {
      snapshot,
      status: "ready",
      loading: false,
      error: null,
      sample: snapshot.stub === true || snapshot.source === "stub",
      connected,
    };
  }, [account, data, error, loading]);
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
