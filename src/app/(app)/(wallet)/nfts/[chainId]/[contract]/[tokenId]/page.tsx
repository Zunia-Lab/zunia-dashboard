import type { Metadata } from "next";
import { NftDetailPage } from "@/components/nft/NftDetailPage";
import { findChain } from "@/lib/chains";

type Params = Promise<{ chainId: string; contract: string; tokenId: string }>;

/** A segment as written; one encoded twice still lands. */
function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function read(params: Params) {
  const { chainId, contract, tokenId } = await params;
  return { chainId: decode(chainId), contract: decode(contract), tokenId: decode(tokenId) };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { chainId, contract, tokenId } = await read(params);
  const chainName = findChain(chainId)?.chainName ?? chainId;
  const shortId = tokenId.length > 16 ? `${tokenId.slice(0, 14)}…` : tokenId;
  const title = `NFT #${shortId} on ${chainName}`;
  const description = `CW721 token ${shortId} of contract ${contract.slice(0, 16)}… on ${chainName}: owner, traits and metadata read from the chain, and a reviewed move to another address.`;
  const canonical = `/nfts/${encodeURIComponent(chainId)}/${encodeURIComponent(contract)}/${encodeURIComponent(tokenId)}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title: `${title} · Zunia`, description, url: canonical },
    // A wallet page in the information architecture: no search result.
    robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
  };
}

export default async function NftDetailRoute({ params }: { params: Params }) {
  const { chainId, contract, tokenId } = await read(params);
  return <NftDetailPage chainId={chainId} contract={contract} tokenId={tokenId} />;
}
