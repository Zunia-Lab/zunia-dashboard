import type { MetadataRoute } from "next";

import { INDEXED_CHAIN_IDS } from "@/lib/server/indexed-chains";
import { SITE_URL } from "@/lib/site";

/**
 * The public, indexable surface (spec §1). Written out rather than derived
 * from `lib/nav.ts`: "renders without a wallet" (nav `access: "public"`) is not
 * the same decision as "belongs in search" — Settings and Manage networks
 * render without a wallet and are still noindex.
 *
 * Absolute URLs on the public origin (`@/lib/site`, app.zunialab.com),
 * whichever host served the file: an entry on any other host, the old
 * wallet.zunialab.com included, would advertise a redirect.
 *
 * Every entry must answer 200 with an indexable page. `/mobile` is not one any
 * more: Zunia Mobile is a way to connect (an option of the Connect wallet
 * modal), so `/mobile` is a permanent redirect to `/?connect=mobile`
 * (next.config.ts) and a redirect has no place in a sitemap.
 */
const PAGES: ReadonlyArray<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/markets", changeFrequency: "hourly", priority: 0.9 },
  { path: "/chains", changeFrequency: "daily", priority: 0.8 },
  { path: "/validators", changeFrequency: "daily", priority: 0.7 },
  { path: "/governance", changeFrequency: "daily", priority: 0.7 },
  { path: "/compare", changeFrequency: "weekly", priority: 0.6 },
  { path: "/missions", changeFrequency: "monthly", priority: 0.3 },
  { path: "/apps", changeFrequency: "monthly", priority: 0.3 },
];

/**
 * Chains whose detail and validator pages are worth a search result. The list
 * lives in `lib/server/indexed-chains.ts`, shared with the chain pages' own
 * `index`/`noindex` decision, so the sitemap never advertises a page that asks
 * not to be indexed.
 */
const CURATED_CHAINS = INDEXED_CHAIN_IDS;

/**
 * No `lastModified`: these pages show live data, and a build timestamp would
 * claim every page changed at the last deploy. Search engines ignore a
 * lastmod they cannot trust; leaving it out keeps the signal honest.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = PAGES.map(({ path, changeFrequency, priority }) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    changeFrequency,
    priority,
  }));

  const chainPages: MetadataRoute.Sitemap = CURATED_CHAINS.flatMap((chainId, index) => {
    const id = encodeURIComponent(chainId);
    const home = index === 0;
    return [
      {
        url: `${SITE_URL}/chains/${id}`,
        changeFrequency: "daily" as const,
        priority: home ? 0.7 : 0.6,
      },
      {
        url: `${SITE_URL}/validators?chain=${id}`,
        changeFrequency: "daily" as const,
        priority: home ? 0.6 : 0.5,
      },
    ];
  });

  return [...pages, ...chainPages];
}
