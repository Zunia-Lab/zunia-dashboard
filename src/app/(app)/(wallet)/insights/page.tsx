import type { Metadata } from "next";
import { InsightsPage } from "@/components/insights/InsightsPage";

const DESCRIPTION =
  "What to do next across your Cosmos wallet: rewards worth claiming, votes closing, idle balances that could earn, validator and chain risks, concentration, and a security review of who can act for your accounts.";

export const metadata: Metadata = {
  title: "Insights",
  description: DESCRIPTION,
  alternates: { canonical: "/insights" },
  openGraph: { title: "Insights · Zunia", description: DESCRIPTION, url: "/insights" },
  // Personal page: what it shows depends on the connected wallet.
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default function InsightsRoute() {
  return <InsightsPage />;
}
