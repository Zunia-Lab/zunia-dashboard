import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChainDetailPage } from "@/components/chains/ChainDetailPage";
import { chainMetadata } from "@/components/chains/seo";
import { findChain, type ChainEntry } from "@/lib/chains";

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
  return <ChainDetailPage chain={chain} />;
}
