"use client";

/**
 * Money formatters for the Overview's charts and plain-text slots.
 *
 * The kit's <Money/> masks itself in privacy mode; chart tooltips, axis
 * labels, donut centres and legend values are plain strings, so they get
 * formatters that mask the same way. Stable identities (memoised on the
 * currency and the privacy flag) because charts recompute their drawing when
 * a formatter changes.
 */

import { useMemo } from "react";
import type { TickFormatter } from "@/components/charts";
import { MASK, currencySymbol, formatFiat } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";

export interface MoneyFormatters {
  /** Privacy mode is on. */
  hidden: boolean;
  /** "$1,234.56" (or "••••"). */
  full: (value: number) => string;
  /** "$12.4k" (or "••••"). */
  compact: (value: number) => string;
  /**
   * What a holding is worth: "$12.4k", "$46.80", "<$0.01" (or "••••"). Cents
   * at most: the eight decimals a sub-cent price needs are noise on a
   * position worth $0.00000001.
   */
  holding: (value: number) => string;
  /** Axis labels: "$12k"; empty in privacy mode (the shape stays, the scale goes). */
  tick: TickFormatter;
}

export function useMoneyFormatters(currency: string): MoneyFormatters {
  const { hideAmounts } = usePrefs();
  return useMemo(() => {
    const symbol = currencySymbol(currency);
    return {
      hidden: hideAmounts,
      full: (value: number) => (hideAmounts ? MASK : formatFiat(value, currency)),
      compact: (value: number) => (hideAmounts ? MASK : formatFiat(value, currency, { compact: true })),
      holding: (value: number) => (hideAmounts ? MASK : formatFiat(value, currency, { compact: true, precision: 2 })),
      tick: (value, { affix }) => (hideAmounts ? "" : affix(value, symbol)),
    };
  }, [currency, hideAmounts]);
}
