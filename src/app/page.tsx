import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { landingDescription, mainnetCount } from "@/components/landing/content";
import { SITE_NAME } from "@/components/landing/seo";
import { SWAP_FEE_BPS } from "@/config/fees";
import { feeRateText } from "@/lib/swap/fee";

const TITLE = "Zunia — Every Cosmos chain, one decision desk";
const MAINNETS = mainnetCount();
const DESCRIPTION = landingDescription(MAINNETS);

/**
 * The one page search engines should lead with: indexable, canonical at the
 * root. The share image is the root `opengraph-image`: this page shares its
 * segment, where file metadata wins over an `images` entry, so none is given
 * (pages in other segments restate it, see components/landing/seo.ts).
 */
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@ZuniaLab",
    creator: "@ZuniaLab",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function HomePage() {
  return <LandingPage mainnets={MAINNETS} feeRate={feeRateText(SWAP_FEE_BPS)} />;
}
