"use client";

import { useEffect } from "react";
import { ThemeProvider, useTheme } from "@zunialab/ui";
import { THEME_COLORS, THEME_STORAGE_KEY, applyDocumentTheme, resolveBootTheme } from "@/components/shell/theme-boot";
import { Toaster } from "@/components/ui";
import { useServiceWorkerBridge } from "@/lib/data/push";
import { PrefsProvider } from "@/providers/PrefsProvider";
import { WalletProvider } from "@/providers/WalletProvider";

/**
 * App-wide state. There is no global wallet gate any more: public pages
 * (markets, chains, governance…) render without a wallet, and wallet pages
 * gate themselves through `<Page access="wallet">`.
 *
 * The toast queue and the service-worker bridge (notification clicks,
 * "refresh after a push") live here rather than in the app frame so the
 * full-bleed landing page gets them too.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  useBootThemeGuard();
  return (
    <ThemeProvider defaultTheme="dark">
      <ThemeColorSync />
      <PrefsProvider>
        <WalletProvider>
          <ServiceWorkerBridge />
          {children}
          <Toaster />
        </WalletProvider>
      </PrefsProvider>
    </ThemeProvider>
  );
}

/**
 * ThemeProvider reads storage in its first effect but, in the same pass,
 * applies the theme it started with ("dark"), so a visitor who chose light
 * would see the page turn dark for a frame before turning back. This
 * component's effects run after its children's in that same pass (parents
 * last), before anything paints: it re-applies what the boot script painted,
 * by the same rule (`theme-boot.ts`), and ThemeProvider's next render agrees.
 */
function useBootThemeGuard() {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* blocked storage: the default applies */
    }
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyDocumentTheme(document, resolveBootTheme(stored, systemDark));
  }, []);
}

/** The browser chrome (address bar, PWA title bar) follows the theme on screen. */
function ThemeColorSync() {
  const { resolved } = useTheme();
  useEffect(() => {
    for (const meta of Array.from(document.querySelectorAll('meta[name="theme-color"]'))) {
      meta.setAttribute("content", THEME_COLORS[resolved]);
    }
  }, [resolved]);
  return null;
}

function ServiceWorkerBridge() {
  useServiceWorkerBridge();
  return null;
}
