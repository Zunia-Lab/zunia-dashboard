import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon/ComingSoon";
import { publicPageMetadata } from "@/components/landing/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Missions (coming soon)",
  description:
    "Zunia Missions: quests across the interchain. Stake, vote, bridge and explore to earn XP and seasonal rewards. Coming very soon.",
  path: "/missions",
});

export default function MissionsPage() {
  return <ComingSoonPage id="missions" />;
}
