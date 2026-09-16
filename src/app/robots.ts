import type { MetadataRoute } from "next";

/**
 * Allow crawlers (and OG preview bots) to fetch pages and assets.
 * Indexing is disabled via root metadata robots: noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    host: "https://wallet.zunialab.com",
  };
}
