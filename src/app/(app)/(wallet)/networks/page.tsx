import type { Metadata } from "next";
import { NetworksPage } from "@/components/chains/NetworksPage";
import { publicPageMetadata } from "@/components/landing/seo";

const TITLE = "Manage networks";
const DESCRIPTION = "Choose which Cosmos chains the Zunia dashboard follows: order them, add from the catalog, remove the rest.";

export const metadata: Metadata = {
  // The share image and card restated (a page's own `openGraph` drops the
  // root's picture): a link to it pasted in a chat still gets one.
  ...publicPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/networks" }),
  // Renders without a wallet (the list lives in the browser) but it is a
  // personal settings page: no search result.
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default function Page() {
  return <NetworksPage />;
}
