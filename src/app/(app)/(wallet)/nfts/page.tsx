import type { Metadata } from "next";
import { NftsPage } from "@/components/nft/NftsPage";

const DESCRIPTION =
  "The CW721 NFTs your wallet holds on Cosmos networks that run CosmWasm, collection by collection, with where the list comes from and how complete it is. Artwork stays off until you turn it on.";

export const metadata: Metadata = {
  title: "NFTs",
  description: DESCRIPTION,
  alternates: { canonical: "/nfts" },
  openGraph: { title: "NFTs · Zunia", description: DESCRIPTION, url: "/nfts" },
  // Personal page: what it shows depends on the connected wallet.
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default function NftsRoute() {
  return <NftsPage />;
}
