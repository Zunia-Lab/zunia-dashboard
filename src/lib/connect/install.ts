/**
 * Where a visitor without the Zunia extension can get it, matched to the
 * browser they are in.
 *
 * - A Chromium browser on a computer (Chrome, Brave, Edge, Opera, Arc,
 *   Vivaldi…) installs the Chrome Web Store build.
 * - Firefox and Safari need their own store's build, not published yet, so
 *   the page sends them to the download section of zunialab.com, which says
 *   where each build stands.
 * - Phones and tablets cannot run the Chrome Web Store build at all: the
 *   download section too (on iPhone and iPad only Safari runs extensions,
 *   whichever browser the page is open in, so they read as Safari).
 *
 * Pure (a user agent in, words and a link out), so `node --test` covers
 * every browser.
 */

/** zunia-website `Availability`. */
export type Availability = "available" | "review" | "development" | "planned";

/** The browser builds of the extension. */
export type ExtensionBuild = "chromium" | "firefox" | "safari";

/**
 * Where each build of the Zunia extension stands: the dashboard's copy of
 * zunia-website src/content/site.ts `DOWNLOADS` (Chrome available, Safari
 * in review, Firefox planned).
 *
 * Update it when a store approves the extension: set the build to
 * "available" with its listing, here and in the website's `DOWNLOADS`
 * together. That browser then gets "Add to <browser>" and its store link
 * instead of the download section.
 */
export const ZUNIA_EXTENSION_BUILDS: Readonly<Record<ExtensionBuild, { availability: Availability; listing: string | null }>> = {
  chromium: { availability: "available", listing: "https://chromewebstore.google.com/detail/zunia/ngokakoekdogobjmokipglbcclelgajk" },
  safari: { availability: "review", listing: null },
  firefox: { availability: "planned", listing: null },
};

/** The website's download section: every build, every app, and where each stands. */
export const ZUNIA_DOWNLOAD_PAGE = "https://zunialab.com/#download";

export interface BrowserInfo {
  /** Which build of a browser extension it takes. */
  build: ExtensionBuild;
  /** The browser's name for "Add to …" ("Chrome" for an unnamed Chromium: the store says so too). */
  name: string;
  /** A phone or tablet: no extension store build runs there (iPhone and iPad: Safari's, once it is out). */
  mobile: boolean;
  /** A Chromium browser on a computer: where a Chrome Web Store listing installs. */
  chromiumDesktop: boolean;
}

export interface BrowserHints {
  /** `navigator.brave` is there: Brave sends Chrome's user agent, word for word. */
  brave?: boolean;
}

/**
 * The browser behind a user agent. An empty one (the server, the hydration
 * pass) reads as Chrome on a computer, the most common case.
 */
export function browserFor(userAgent: string, hints: BrowserHints = {}): BrowserInfo {
  const ua = userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return { build: "safari", name: "Safari", mobile: true, chromiumDesktop: false };
  const mobile = /Android|Mobi|Tablet|Silk\//.test(ua);
  if (/Firefox\/|FxiOS\//.test(ua)) return { build: "firefox", name: "Firefox", mobile, chromiumDesktop: false };
  const chromium = /Chrome\/|Chromium\/|CriOS\/|Edg\/|EdgA\/|OPR\//.test(ua) || hints.brave === true;
  if (!chromium && /Safari\//.test(ua)) return { build: "safari", name: "Safari", mobile, chromiumDesktop: false };
  let name = "Chrome";
  if (/Edg\/|EdgA\//.test(ua)) name = "Edge";
  else if (/OPR\//.test(ua)) name = "Opera";
  else if (/Vivaldi\//.test(ua)) name = "Vivaldi";
  else if (hints.brave === true) name = "Brave";
  return { build: "chromium", name, mobile, chromiumDesktop: !mobile };
}

/** What the Zunia row offers in place of Connect when the extension is not in this browser. */
export interface ZuniaInstallHint {
  /** `store`: the extension's listing (one click to install). `website`: the download section of zunialab.com. */
  kind: "store" | "website";
  url: string;
  /** The row's action: "Add to Brave", "Get Zunia". */
  action: string;
  /** The row's line under the name. */
  line: string;
  /** Where the build stands, as the row's chip; null when the row says it all. */
  chip: { label: string; tone: "recommended" | "soon" } | null;
}

const BUILD_NAME: Record<ExtensionBuild, string> = { chromium: "Chrome", firefox: "Firefox", safari: "Safari" };

/** The Zunia row's offer for this browser (see the header). */
export function zuniaInstallHint(browser: BrowserInfo): ZuniaInstallHint {
  const website = { kind: "website" as const, url: ZUNIA_DOWNLOAD_PAGE, action: "Get Zunia" };
  if (browser.mobile && browser.build !== "safari") {
    return { ...website, line: "Extensions run in desktop browsers — see zunialab.com", chip: null };
  }
  const build = ZUNIA_EXTENSION_BUILDS[browser.build];
  if (build.availability === "available" && build.listing) {
    return {
      kind: "store",
      url: build.listing,
      action: `Add to ${browser.name}`,
      line: browser.build === "chromium" ? "Free on the Chrome Web Store." : `Free for ${browser.name}.`,
      chip: { label: "Recommended", tone: "recommended" },
    };
  }
  const name = BUILD_NAME[browser.build];
  if (build.availability === "review") {
    return { ...website, line: `In review for ${name} — see zunialab.com`, chip: { label: "In review", tone: "soon" } };
  }
  return { ...website, line: `Coming to ${name} — see zunialab.com`, chip: { label: "Coming soon", tone: "soon" } };
}
