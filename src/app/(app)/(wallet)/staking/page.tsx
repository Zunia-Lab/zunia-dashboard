import type { Metadata } from "next";
import { StakingPage } from "@/components/staking/StakingPage";

const DESCRIPTION =
  "Your stake on every Cosmos network you follow: positions and validator risk, actual APR, rewards to claim or restake, unbonding dates and idle balance to stake.";

export const metadata: Metadata = {
  title: "Staking",
  description: DESCRIPTION,
  alternates: { canonical: "/staking" },
  openGraph: { title: "Staking · Zunia", description: DESCRIPTION, url: "/staking" },
  // Personal page: what it shows depends on the connected wallet.
  robots: { index: false, follow: true },
};

export default function StakingRoute() {
  return <StakingPage />;
}
