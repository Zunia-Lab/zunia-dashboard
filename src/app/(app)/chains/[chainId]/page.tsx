import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ChainDetailPage } from "@/components/chains/ChainDetailPage";
import { chainMetadata } from "@/components/chains/seo";
import { findChain, type ChainEntry } from "@/lib/chains";
import { chainDetailInitial } from "@/lib/server/page-initial";

type Props = { params: Promise<{ chainId: string }> };

/** The route segment arrives encoded when the id has reserved characters; decode defensively. */
function chainFrom(raw: string): ChainEntry | undefined {
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* malformed escape: look the raw text up as is */
  }
  return findChain(id) ?? findChain(raw);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chainId } = await params;
  const chain = chainFrom(chainId);
  if (!chain) return { title: "Chain not found", robots: { index: false, follow: true } };
  return chainMetadata(chain);
}

export default async function Page({ params }: Props) {
  const { chainId } = await params;
  const chain = chainFrom(chainId);
  if (!chain) notFound();
  // Per request (never a copy cached at first view): the first HTML carries
  // the chain's figures as they are now, read through the detail route's
  // cache within a short budget. Past it, or when the node answers nothing,
  // the page renders as before and the browser reads (and explains) it.
  await connection();
  return <ChainDetailPage chain={chain} initial={await chainDetailInitial(chain.chainId)} />;
}
