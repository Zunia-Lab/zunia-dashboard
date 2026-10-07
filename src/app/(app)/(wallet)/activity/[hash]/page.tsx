import type { Metadata } from "next";
import { TxDetailPage } from "@/components/activity/TxDetailPage";
import { isTxHash, normalizeHash } from "@/components/activity/view";
import { findChain } from "@/lib/chains";
import { shortenHash } from "@/lib/format";

interface Props {
  params: Promise<{ hash: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text?.trim() ? text.trim().slice(0, 96) : null;
}

/**
 * The chain from `?chainId=` (what notifications and the activity list link
 * with) or `?chain=` (the rest of the dashboard's convention). Only a chain in
 * the catalog is passed on; anything else is reported back as asked-for.
 */
async function resolve(props: Props) {
  const [{ hash: raw }, search] = await Promise.all([props.params, props.searchParams]);
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const hash = isTxHash(decoded) ? normalizeHash(decoded) : decoded.slice(0, 128);
  const requested = first(search.chainId) ?? first(search.chain);
  const chain = requested ? findChain(requested) : undefined;
  return { hash, chainId: chain?.chainId ?? null, chainName: chain?.chainName ?? null, requested };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { hash, chainId, chainName } = await resolve(props);
  const valid = isTxHash(hash);
  const title = valid ? `Transaction ${shortenHash(hash, 6, 4)}` : "Transaction";
  const description = valid
    ? `Status, fee, gas, decoded messages, token movements and IBC packets of transaction ${hash}${chainName ? ` on ${chainName}` : ""}.`
    : "A transaction on a Cosmos chain, decoded.";
  const path = valid ? `/activity/${hash}${chainId ? `?chainId=${encodeURIComponent(chainId)}` : ""}` : "/activity";
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} · Zunia`, description, url: path },
    // Readable by anyone with the link, but a hash page is not a search result.
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  };
}

export default async function Page(props: Props) {
  const { hash, chainId, requested } = await resolve(props);
  return <TxDetailPage hash={hash} chainId={chainId} requestedChain={chainId ? null : requested} />;
}
