/**
 * The dashboard's public address, in one place for everything that names it:
 * the root layout's `metadataBase` (which makes every canonical link, `og:url`
 * and share-image URL absolute on it), robots.txt's Sitemap line, the sitemap
 * entries, the landing page's structured data, the host printed on the share
 * cards, the 404 page and the landing footer, and the site address Zunia
 * Mobile is shown when it connects.
 *
 * `https://app.zunialab.com` since the v2 launch (2026-10-07). The old
 * `wallet.zunialab.com` answers a permanent redirect to it (nginx, zunia-infra),
 * so nothing may name the old host any more: a canonical link that points at a
 * redirect asks search engines to index a page that is not there.
 *
 * `NEXT_PUBLIC_SITE_URL` overrides the default for a preview or staging host.
 * It is a build-time value: Next inlines `NEXT_PUBLIC_*` into the browser
 * bundle, and the prerendered pages, metadata files and share images are
 * written by the build, so a change needs a rebuild. Only the origin of the
 * value is kept (the app is served at the root of its host), and a value that
 * is not an http(s) URL falls back to the default: a typo would otherwise put
 * a broken host into every canonical link, or stop the root layout from
 * rendering (`new URL` throws on it).
 *
 * Neither `"use client"` nor `server-only`: the layout and the metadata routes
 * read it on the server, the wallet provider in the browser. Pure, so
 * `node --test` covers it.
 */

/** The canonical public origin when no override is set. */
export const DEFAULT_SITE_URL = "https://app.zunialab.com";

/** The origin of `raw` (scheme, host and port; no path, no trailing slash), or the default. */
export function siteUrlFrom(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_SITE_URL;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : DEFAULT_SITE_URL;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

/**
 * The site's origin, `https://app.zunialab.com` in production. No trailing
 * slash: append paths as `${SITE_URL}/markets`. The variable is named in full
 * (never `process.env[name]`), which is what lets Next inline it.
 */
export const SITE_URL: string = siteUrlFrom(process.env.NEXT_PUBLIC_SITE_URL);

/** The host alone, as printed for people: `app.zunialab.com` (with the port, if the URL has one). */
export const SITE_HOST: string = new URL(SITE_URL).host;
