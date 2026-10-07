import type { Metadata } from "next";
import { SwapPage } from "@/components/swap/SwapPage";
import { readSwapLink } from "@/components/swap/swap-link";

const DESCRIPTION =
  "Swap any Osmosis pair from the chain you hold it on: live routes, price impact, every fee including the 0.5% Zunia fee, and the pair's rate history. Non-custodial: you sign in your own wallet.";

export const metadata: Metadata = {
  title: "Swap",
  description: DESCRIPTION,
  alternates: { canonical: "/swap" },
  openGraph: { title: "Swap · Zunia", description: DESCRIPTION, url: "/swap" },
  // A wallet page: its content is the visitor's own balances.
  robots: { index: false, follow: true },
};

/**
 * `/swap?from=<chainId>:<denom>&to=<chainId>:<denom>&amount=` opens the form
 * on that pair (asset keys work too). The form applies a link when it first
 * sees it and again whenever another one arrives; it is not keyed by it, so a
 * refresh of the same page never resets what the user typed.
 */
export default async function SwapRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SwapPage link={readSwapLink(await searchParams)} />;
}
