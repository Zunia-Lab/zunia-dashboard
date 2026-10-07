import type { Metadata } from "next";
import { connection } from "next/server";
import { publicPageMetadata } from "@/components/landing/seo";
import { MarketsPage } from "@/components/markets/MarketsPage";
import { marketsInitial } from "@/lib/server/page-initial";

const TITLE = "Cosmos markets: prices, volume and liquidity";
const DESCRIPTION =
  "Live prices, 24 h and 7 d moves, Osmosis liquidity, volume and market cap for the Cosmos assets Osmosis trades, plus SAF on Coinstore. Every figure shows its source.";

// Public market data, the page search engines should find (index, follow).
// The shared helper restates the share image: a page's own openGraph and
// twitter objects replace the root layout's whole, and the file-based
// opengraph-image went with them (link previews had no picture and a
// "summary" card).
export const metadata: Metadata = publicPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/markets" });

export default async function Page() {
  // Rendered per request, so the first HTML carries the list as it is now
  // (the server cache's answer, read within a short budget), never one baked
  // in at build time. Past the budget the page renders as a skeleton the
  // browser fills, as before.
  await connection();
  return <MarketsPage initial={await marketsInitial()} />;
}
