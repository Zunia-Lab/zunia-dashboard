import type { Metadata } from "next";
import { BridgePage } from "@/components/transfer/BridgePage";
import { readBridgePrefill, type SearchParams } from "@/components/transfer/prefill";

const DESCRIPTION =
  "Move tokens between Cosmos chains over native IBC: the route is planned and every channel checked before you sign, then followed until it lands.";

export const metadata: Metadata = {
  title: "Bridge",
  description: DESCRIPTION,
  alternates: { canonical: "/bridge" },
  openGraph: { title: "Bridge · Zunia", description: DESCRIPTION, url: "/bridge" },
  robots: { index: false, follow: false },
};

/**
 * Deep links: `?from=<chainId>&to=<chainId>&amount=&asset=<denom>`, or the
 * swap page's row keys (`from=osmosis-1:ibc/…`). Shape-checked here; the
 * client checks them again against the catalog and the wallet's balances.
 */
export default async function Bridge({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const prefill = readBridgePrefill(await searchParams);
  return <BridgePage prefill={prefill} />;
}
