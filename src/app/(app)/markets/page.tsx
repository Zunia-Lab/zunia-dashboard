import type { Metadata } from "next";
import { publicPageMetadata } from "@/components/landing/seo";
import { MarketsPage } from "@/components/markets/MarketsPage";

const TITLE = "Cosmos markets: prices, volume and liquidity";
const DESCRIPTION =
  "Live prices, 24 h and 7 d moves, Osmosis liquidity, volume and market cap for the Cosmos assets Osmosis trades, plus SAF on Coinstore. Every figure shows its source.";

// Public market data, the page search engines should find (index, follow).
// The shared helper restates the share image: a page's own openGraph and
// twitter objects replace the root layout's whole, and the file-based
// opengraph-image went with them (link previews had no picture and a
// "summary" card).
export const metadata: Metadata = publicPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/markets" });

export default function Page() {
  return <MarketsPage />;
}
