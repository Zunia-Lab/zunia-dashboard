/**
 * The visitor's analytics choice and the gtag lifecycle that follows it.
 *
 * Nothing here runs, and nothing is fetched from Google, until the choice is
 * "granted". Everything takes its environment as an argument so the order of
 * events (consent first, then the script) is testable without a browser.
 */

import { ANALYTICS_HOST } from "@/config/analytics";
import { sanitizePageView } from "./sanitize";

/** Versioned: a change of what is collected asks again by bumping the suffix. */
export const CONSENT_KEY = "zunia.dashboard.analytics.v1";
export type Consent = "granted" | "denied";

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";
const SCRIPT_ATTR = "data-zunia-ga";

export function parseConsent(raw: string | null): Consent | null {
  try {
    const value = raw === null ? null : JSON.parse(raw);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

/** Analytics exists only in a production build, on the one real host, with an ID. */
export function analyticsConfigured(id: string, nodeEnv: string | undefined): boolean {
  return id !== "" && nodeEnv === "production";
}
export function analyticsHostOk(hostname: string): boolean {
  return hostname === ANALYTICS_HOST;
}

/** The slice of the browser the loader touches. */
export interface AnalyticsEnv {
  document: {
    title: string;
    referrer: string;
    cookie: string;
    head: { appendChild(node: unknown): unknown };
    createElement(tag: string): { src: string; async: boolean; setAttribute(k: string, v: string): void };
    querySelectorAll(selector: string): ArrayLike<{ remove(): void }>;
  };
  window: Record<string, unknown> & { location: { origin: string; hostname: string } };
}

type Gtag = (...args: unknown[]) => void;

export function isLoaded(env: AnalyticsEnv): boolean {
  return typeof env.window.gtag === "function";
}

/** Loads gtag.js with consent mode v2 and the privacy configuration. Idempotent. */
export function enableAnalytics(id: string, env: AnalyticsEnv): void {
  const { window, document } = env;
  window[`ga-disable-${id}`] = false;
  if (isLoaded(env)) return;
  const dataLayer = (window.dataLayer = (window.dataLayer as unknown[] | undefined) ?? []);
  // gtag.js reads `arguments` objects off the data layer, not arrays.
  const gtag: Gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  window.gtag = gtag;
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
  gtag("js", new Date());
  gtag("config", id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `${GTAG_SRC}?id=${encodeURIComponent(id)}`;
  script.setAttribute(SCRIPT_ATTR, "");
  document.head.appendChild(script);
}

/**
 * One page_view with a sanitized location, path and title. The referrer is
 * overridden too (gtag would send document.referrer, which can be a deep link
 * with an address): it is the previous sanitized page, or an outside site's
 * origin only.
 */
export function sendPageView(env: AnalyticsEnv, pathname: string, previous: string | null): string {
  const { origin } = env.window.location;
  const view = sanitizePageView(origin, pathname, env.document.title);
  if (isLoaded(env)) {
    let referrer = previous ?? "";
    if (previous === null) {
      try {
        const ref = new URL(env.document.referrer);
        referrer = ref.origin === origin ? "" : ref.origin;
      } catch {
        referrer = "";
      }
    }
    (env.window.gtag as Gtag)("event", "page_view", { ...view, page_referrer: referrer });
  }
  return view.page_location;
}

/** Cookie names Google Analytics sets: `_ga`, `_ga_<stream>`, `_gid`, `_gat*`. */
export function gaCookieNames(cookie: string): string[] {
  return cookie
    .split(";")
    .map((part) => part.split("=")[0]!.trim())
    .filter((name) => name === "_ga" || name === "_gid" || name.startsWith("_ga_") || name.startsWith("_gat"));
}

/** Withdrawal: stop sending, remove the script and the data layer, delete the cookies. */
export function disableAnalytics(id: string, env: AnalyticsEnv): void {
  const { window, document } = env;
  window[`ga-disable-${id}`] = true;
  for (const node of Array.from(document.querySelectorAll(`script[${SCRIPT_ATTR}]`))) node.remove();
  delete window.gtag;
  delete window.dataLayer;
  const host = window.location.hostname;
  const parts = host.split(".");
  const domains = new Set<string | null>([null, host, `.${host}`]);
  for (let i = 1; i < parts.length - 1; i += 1) domains.add(`.${parts.slice(i).join(".")}`);
  for (const name of gaCookieNames(document.cookie)) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
    }
  }
}
