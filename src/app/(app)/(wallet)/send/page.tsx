import type { Metadata } from "next";
import { readSendPrefill, type SearchParams } from "@/components/transfer/prefill";
import { SendPage } from "@/components/transfer/SendPage";

const DESCRIPTION =
  "Send any token you hold to an address on the same chain, or across Cosmos over IBC. Every detail is reviewed before your wallet signs.";

export const metadata: Metadata = {
  title: "Send",
  description: DESCRIPTION,
  alternates: { canonical: "/send" },
  openGraph: { title: "Send · Zunia", description: DESCRIPTION, url: "/send" },
  // A wallet page: nothing here is meant for search.
  robots: { index: false, follow: false },
};

/**
 * Deep links (`?asset=chainId:denom&to=<address>&amount=`) are read here and
 * passed down as plain props; the client checks them again against the
 * wallet's balances before anything is offered.
 */
export default async function Send({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const prefill = readSendPrefill(await searchParams);
  return <SendPage prefill={prefill} />;
}
