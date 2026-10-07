/**
 * Metadata for the proposal pages (server only: imported by
 * [chainId]/[id]/page.tsx; the list page uses the shared public-page helper).
 *
 * A route's `openGraph` / `twitter` / `robots` replace the root layout's
 * objects whole (Next merges metadata shallowly per field), so each one is
 * restated in full here. The root's file-based image does not reach a page
 * that sets its own openGraph / twitter: proposal pages get their card from
 * the sibling [chainId]/[id]/opengraph-image.tsx and twitter-image.tsx, which
 * Next adds only while these objects carry no `images` key at all. So this
 * helper must never set one, not even `images: undefined` (Next checks
 * `hasOwnProperty("images")` and then skips the file image).
 */

import type { Metadata } from "next";

const SITE_NAME = "Zunia";

export function governanceMetadata({
  title,
  description,
  path,
  index,
}: {
  title: string;
  description: string;
  /** Canonical path, e.g. "/governance/osmosis-1/1049". */
  path: string;
  /** Public, indexable page (false for not-found / unavailable states). */
  index: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      // OGP wants language_TERRITORY ("en" alone is invalid), as the root sends.
      locale: "en_US",
      url: path,
      title: `${title} · ${SITE_NAME}`,
      description,
    },
    twitter: {
      card: "summary_large_image",
      site: "@ZuniaLab",
      creator: "@ZuniaLab",
      title: `${title} · ${SITE_NAME}`,
      description,
    },
    robots: index
      ? { index: true, follow: true, googleBot: { index: true, follow: true } }
      : { index: false, follow: true, googleBot: { index: false, follow: true } },
  };
}

/** A description sentence of at most `max` characters, cut at a word. */
export function clipDescription(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
