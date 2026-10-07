import type { Metadata } from "next";
import { ComingSoonPage } from "@/components/coming-soon/ComingSoon";
import { publicPageMetadata } from "@/components/landing/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Apps (coming soon)",
  description: "Zunia Apps: a curated, safety-checked directory of Cosmos apps that open with Zunia. Coming very soon.",
  path: "/apps",
});

export default function AppsPage() {
  return <ComingSoonPage id="apps" />;
}
