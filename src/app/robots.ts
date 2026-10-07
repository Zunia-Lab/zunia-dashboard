import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * Crawl rules. Indexing itself is decided per page (`robots` metadata); this
 * file only keeps crawlers out of what is never a page:
 *
 * - `/dev/` holds component playgrounds, not product pages.
 *
 * `/api/` stays crawlable, on purpose. The public pages (`/`, `/markets`,
 * `/chains` and `/chains/<id>`, `/validators` and `/validators/<address>`,
 * `/governance` and its proposal pages, `/compare`, `/assets/<key>`) send
 * their headings, copy and metadata in the first HTML, and the detail pages a
 * first server read as well (a validator's profile, a proposal with its
 * tally, an asset's name and logo). `/markets`, `/validators`, `/governance`
 * and `/chains/<id>` also render their first answer on the server (the market
 * table, the bonded set, the proposal list, the chain's price and block), when
 * it arrives within the page's time budget. Everything else live (the landing
 * preview, the `/chains` table, `/compare`, an asset's chart, a first answer
 * that missed its budget, every refresh) is read in the browser from
 * `/api/*`. Google's and Bing's renderers apply robots.txt to those fetches
 * too, so a disallowed `/api/` makes them render (and index) those parts'
 * error states: "Market data unavailable", no validator or proposal links.
 * What keeps the JSON itself out of search is the `X-Robots-Tag: noindex`
 * header every `/api` response carries (next.config.ts), and a crawler can
 * only see that header on a URL it is allowed to fetch.
 *
 * Wallet pages stay crawlable for the same reason: a disallowed URL can still
 * be indexed from links, while an allowed one lets the crawler read its
 * `noindex`. No `Host:` line — it was a Yandex-only extension. The sitemap is
 * named on the public origin (`@/lib/site`), whichever host served this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dev/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
