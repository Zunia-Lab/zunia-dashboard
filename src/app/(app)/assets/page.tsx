import type { Metadata } from "next";
import { AssetsPage } from "@/components/assets/AssetsPage";

const DESCRIPTION =
  "Every token your wallet holds across the Cosmos chains you follow: value, 24 h and 7 d moves, allocation, staking coverage and a CSV export. Non-custodial.";

export const metadata: Metadata = {
  title: "Assets",
  description: DESCRIPTION,
  alternates: { canonical: "/assets" },
  openGraph: { title: "Assets · Zunia", description: DESCRIPTION, url: "/assets" },
  // A wallet page: what it shows depends on who is connected.
  robots: { index: false, follow: true },
};

export default function Page() {
  return <AssetsPage />;
}
