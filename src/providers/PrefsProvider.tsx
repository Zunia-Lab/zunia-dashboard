"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useStoredValue } from "@/lib/useStoredValue";

const HIDE_KEY = "zunia.dashboard.hideAmounts";
const CURRENCY_KEY = "zunia.dashboard.currency";

export type FiatCurrency = "usd" | "eur" | "gbp";

interface Prefs {
  hideAmounts: boolean;
  toggleHideAmounts: () => void;
  currency: FiatCurrency;
  setCurrency: (value: FiatCurrency) => void;
  /** Replaces a rendered amount with dots while privacy mode is on. */
  mask: (value: string) => string;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [hideAmounts, setHideAmounts] = useStoredValue(HIDE_KEY, false);
  const [currency, setCurrency] = useStoredValue<FiatCurrency>(
    CURRENCY_KEY,
    "usd",
  );

  const toggleHideAmounts = useCallback(
    () => setHideAmounts(!hideAmounts),
    [hideAmounts, setHideAmounts],
  );

  const value = useMemo<Prefs>(
    () => ({
      hideAmounts,
      toggleHideAmounts,
      currency,
      setCurrency,
      mask: (raw: string) => (hideAmounts ? "••••" : raw),
    }),
    [hideAmounts, toggleHideAmounts, currency, setCurrency],
  );

  return (
    <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
  );
}

export function usePrefs(): Prefs {
  const value = useContext(PrefsContext);
  if (!value) throw new Error("usePrefs must be used inside PrefsProvider");
  return value;
}
