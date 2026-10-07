/**
 * Metadata for the public pages of the app frame (`/missions` and `/apps`
 * here; the markets, chains, validators, governance, compare and asset pages
 * reuse it): indexable, canonical, with the share image named explicitly.
 *
 * Why the image is restated: Next merges metadata shallowly per field, so a
 * page that sets its own `openGraph` / `twitter` replaces the root layout's
 * objects whole — and the root's file-based `opengraph-image` goes with them
 * (the link previews of those pages had no picture). The landing page `/`
 * does not need this: it sits in the same segment as the image file, and
 * file metadata wins there.
 *
 * Pure (types only), so server pages import it without pulling in a client
 * module.
 */

import type { Metadata } from "next";

/**
 * The site's public name, the one search results and share cards should
 * show: `og:site_name` here and on `/`, and the landing page's WebSite
 * structured data (Google reads a site's name from that first). The same
 * word as the root layout's application name and title template.
 */
export const SITE_NAME = "Zunia";

/** Alt text of the share image; `app/opengraph-image.tsx` exports the same string. */
export const SHARE_IMAGE_ALT = "Zunia — Every Cosmos chain. One decision desk.";

const SHARE_IMAGE = { width: 1200, height: 630, alt: SHARE_IMAGE_ALT, type: "image/png" } as const;

export interface PublicPageMetadataInput {
  /** Page title; the root template adds " · Zunia" in the document title. */
  title: string;
  description: string;
  /** Canonical path, e.g. "/apps". */
  path: string;
}

export function publicPageMetadata({ title, description, path }: PublicPageMetadataInput): Metadata {
  // Link previews get no title template, so the brand is added here.
  const shareTitle = `${title} · ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: shareTitle,
      description,
      images: [{ url: "/opengraph-image", ...SHARE_IMAGE }],
    },
    twitter: {
      card: "summary_large_image",
      site: "@ZuniaLab",
      creator: "@ZuniaLab",
      title: shareTitle,
      description,
      images: [{ url: "/twitter-image", ...SHARE_IMAGE }],
    },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  };
}
