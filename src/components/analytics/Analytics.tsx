"use client";

/**
 * Google Analytics 4, behind an explicit choice.
 *
 * Mounted once in Providers. It does nothing (no bar, no script, no request)
 * unless an ID is configured, this is a production build and the page is on
 * the real host. Even then gtag.js is only fetched after "Allow analytics",
 * and withdrawing stops it and deletes its cookies. What is sent is a page
 * view with a sanitized path and title (see lib/analytics/sanitize.ts): no
 * address, hash, amount or typed text, and no custom events.
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { GA_MEASUREMENT_ID } from "@/config/analytics";
import {
  analyticsConfigured,
  analyticsHostOk,
  disableAnalytics,
  enableAnalytics,
  sendPageView,
  type AnalyticsEnv,
} from "@/lib/analytics/consent";
import { LINKS } from "@/components/landing/content";
import { usePrefs } from "@/providers/PrefsProvider";

export const ANALYTICS_CONFIGURED = analyticsConfigured(GA_MEASUREMENT_ID, process.env.NODE_ENV);

const noop = () => () => {};
const browserEnv = () => ({ document, window }) as unknown as AnalyticsEnv;

/** True only in the browser, on the real host. */
export function useAnalyticsAvailable(): boolean {
  return useSyncExternalStore(
    noop,
    () => ANALYTICS_CONFIGURED && analyticsHostOk(window.location.hostname),
    () => false,
  );
}

export function Analytics() {
  const available = useAnalyticsAvailable();
  const { analytics, setAnalytics } = usePrefs();
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  const granted = available && analytics === "granted";

  useEffect(() => {
    if (!available) return;
    const env = browserEnv();
    if (!granted) {
      if (last.current !== null || analytics === "denied") disableAnalytics(GA_MEASUREMENT_ID, env);
      last.current = null;
      return;
    }
    enableAnalytics(GA_MEASUREMENT_ID, env);
    // The title settles a moment after a route change.
    const timer = window.setTimeout(() => {
      last.current = sendPageView(env, pathname, last.current);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [available, granted, analytics, pathname]);

  if (!available || analytics !== null) return null;
  return (
    <div
      role="region"
      aria-label="Analytics choice"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex w-full max-w-[640px] flex-col gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline-strong)] bg-[var(--d-card-2)] p-4 shadow-lg sm:flex-row sm:items-center">
        <p className="flex-1 text-[13px] leading-[1.5] text-fg-muted">
          Allow anonymous page-view analytics? Only page names are sent, never addresses, amounts or anything you type.{" "}
          <a href={LINKS.privacy} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-2">
            Privacy policy
          </a>
        </p>
        <div className="grid shrink-0 grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAnalytics("granted")}>
            Allow analytics
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAnalytics("denied")}>
            No thanks
          </Button>
        </div>
      </div>
    </div>
  );
}
