import type { Metadata } from "next";
import { GovernancePage } from "@/components/governance/GovernancePage";
import { publicPageMetadata } from "@/components/landing/seo";

// The shared public-page metadata names the root share image explicitly: a
// page that sets its own openGraph / twitter loses the root's file-based one,
// and this segment holds no image file of its own (the proposal pages do).
export const metadata: Metadata = publicPageMetadata({
  title: "Cosmos governance",
  description:
    "Live Cosmos governance: proposals in voting across Osmosis, Cosmos Hub, Safrochain and more, tallies against quorum and threshold, deadlines, and how your stake votes.",
  path: "/governance",
});

export default function Page() {
  return <GovernancePage />;
}
