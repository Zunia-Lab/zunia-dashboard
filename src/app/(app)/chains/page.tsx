import type { Metadata } from "next";
import { ChainsPage } from "@/components/chains/ChainsPage";
import { publicPageMetadata } from "@/components/landing/seo";

const TITLE = "Cosmos chains compared: staking APR, real yield, validators";
const DESCRIPTION =
  "Every Cosmos mainnet side by side: block-time corrected staking APR, real yield after inflation, bonded ratio, unbonding period, Nakamoto coefficient and live block status, from public chain data.";

// Public and useful without a wallet: the helper lifts the root layout's
// noindex, and restates the share image, site name and large card (a page's
// own `openGraph` replaces the root's whole, picture included).
export const metadata: Metadata = publicPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/chains" });

export default function Page() {
  return <ChainsPage />;
}
