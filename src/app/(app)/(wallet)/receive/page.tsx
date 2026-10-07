import type { Metadata } from "next";
import { readReceiveChain, type SearchParams } from "@/components/transfer/prefill";
import { ReceivePage } from "@/components/transfer/ReceivePage";

const DESCRIPTION =
  "Your address on every Cosmos chain you follow, as a QR code and as text, with the checks that keep a deposit on the right network.";

export const metadata: Metadata = {
  title: "Receive",
  description: DESCRIPTION,
  alternates: { canonical: "/receive" },
  openGraph: { title: "Receive · Zunia", description: DESCRIPTION, url: "/receive" },
  robots: { index: false, follow: false },
};

/** `?chain=<chainId>` opens on that chain's address (the account menu links here). */
export default async function Receive({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const chainId = readReceiveChain(await searchParams);
  return <ReceivePage {...(chainId ? { chainId } : {})} />;
}
