import type { Metadata } from "next";
import { OverviewPage } from "@/components/overview/OverviewPage";

const DESCRIPTION =
  "Net worth, staking yield, allocation, insights and activity across every Cosmos chain you follow, from your own wallet.";

/**
 * A wallet page: useful only with a connected wallet, so kept out of search
 * (noindex), while crawlers may still follow its links to the public pages
 * (markets, chains, governance), as on the other wallet pages.
 */
export const metadata: Metadata = {
  title: "Overview",
  description: DESCRIPTION,
  alternates: { canonical: "/overview" },
  openGraph: {
    title: "Overview · Zunia",
    description: DESCRIPTION,
    url: "/overview",
  },
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
};

export default function OverviewRoute() {
  return <OverviewPage />;
}
