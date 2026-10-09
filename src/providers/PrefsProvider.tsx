"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { syncPushPrivacy } from "@/lib/data/push";
import { VIEW_STORAGE_KEY } from "@/components/shell/theme-boot";
import { useStoredValue } from "@/lib/useStoredValue";

const HIDE_KEY = "zunia.dashboard.hideAmounts";
const CURRENCY_KEY = "zunia.dashboard.currency";
/**
 * Load NFT artwork from third-party hosts.
 *
 * Its own key, off by default, and never folded into a general "show images"
 * setting. An NFT's `token_uri` and `image` point wherever the minter chose, so
 * rendering them is a request from this device to a stranger's server — one
 * that only happens for tokens this account holds, which makes the request
 * itself a statement about holdings. The dashboard's other reads all run in a
 * route handler for exactly this reason; artwork is the one thing the browser
 * has to fetch itself, so it is the one thing that needs a switch.
 */
const NFT_MEDIA_KEY = "zunia.dashboard.nftMedia";
/**
 * Show insights (Overview row, Insights page). On by default: they are worked
 * out on this device from reads the pages make anyway, and the reader can
 * turn them off in Settings.
 */
const INSIGHTS_KEY = "zunia.dashboard.insights.on";
/**
 * Lite or Pro. Pro (the full analytical dashboard) is the default; Lite keeps
 * what a holder needs to see and act, without the analysis. The head script
 * reads the same key to set `html[data-view]` before paint.
 */
const VIEW_KEY = VIEW_STORAGE_KEY;

export type ViewMode = "lite" | "pro";

export type FiatCurrency = "usd" | "eur" | "gbp";

interface Prefs {
  hideAmounts: boolean;
  toggleHideAmounts: () => void;
  currency: FiatCurrency;
  setCurrency: (value: FiatCurrency) => void;
  /** Replaces a rendered amount with dots while privacy mode is on. */
  mask: (value: string) => string;
  /** The user's stored answer to "load NFT artwork". Default false. */
  nftMedia: boolean;
  setNftMedia: (value: boolean) => void;
  /**
   * Whether artwork may actually be loaded right now.
   *
   * False whenever privacy mode is on, whatever {@link nftMedia} says. Hiding
   * balances on screen while this device announces every NFT the account holds
   * to a list of third-party hosts would make the privacy control decorative.
   * `nftMediaBlockedReason` is the sentence that says so.
   */
  nftMediaAllowed: boolean;
  nftMediaBlockedReason: string | null;
  /** Insights on the Overview and the Insights page. Default true. */
  insightsOn: boolean;
  setInsightsOn: (value: boolean) => void;
  /** Lite or Pro (default). */
  viewMode: ViewMode;
  setViewMode: (value: ViewMode) => void;
  /** Shorthand for `viewMode === "lite"`. */
  lite: boolean;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [hideAmounts, setHideAmounts] = useStoredValue(HIDE_KEY, false);
  const [currency, setCurrency] = useStoredValue<FiatCurrency>(
    CURRENCY_KEY,
    "usd",
  );
  const [nftMedia, setNftMedia] = useStoredValue(NFT_MEDIA_KEY, false);
  const [insightsOn, setInsightsOn] = useStoredValue(INSIGHTS_KEY, true);
  const [storedView, setViewMode] = useStoredValue<ViewMode>(VIEW_KEY, "pro");
  const viewMode: ViewMode = storedView === "lite" ? "lite" : "pro";

  // CSS reads the view from <html data-view> (the `lite:` variant): keep it in
  // step with this tab's toggle and another tab's (through `storage`).
  useEffect(() => {
    document.documentElement.setAttribute("data-view", viewMode);
  }, [viewMode]);

  const toggleHideAmounts = useCallback(
    () => setHideAmounts((prev) => !prev),
    [setHideAmounts],
  );

  // Privacy mode covers OS notifications too: the service worker masks a push
  // with no tab open, so it needs the setting where it can read it. Re-run on
  // every change (this tab's toggle, another tab's through `storage`).
  useEffect(() => {
    void syncPushPrivacy();
  }, [hideAmounts]);

  const value = useMemo<Prefs>(
    () => ({
      hideAmounts,
      toggleHideAmounts,
      currency,
      setCurrency,
      mask: (raw: string) => (hideAmounts ? "••••" : raw),
      nftMedia,
      setNftMedia,
      nftMediaAllowed: nftMedia && !hideAmounts,
      nftMediaBlockedReason: hideAmounts
        ? "Privacy mode is on, so artwork stays off: loading it would tell every host named in your tokens which NFTs this account holds."
        : null,
      insightsOn,
      setInsightsOn,
      viewMode,
      setViewMode,
      lite: viewMode === "lite",
    }),
    [hideAmounts, toggleHideAmounts, currency, setCurrency, nftMedia, setNftMedia, insightsOn, setInsightsOn, viewMode, setViewMode],
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
