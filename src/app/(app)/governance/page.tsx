import type { Metadata } from "next";
import { GovernancePage } from "@/components/governance/GovernancePage";
import { publicPageMetadata } from "@/components/landing/seo";
import { findChain } from "@/lib/chains";
import { DEFAULT_FOLLOWED } from "@/lib/followed-defaults";
import { proposalsInitial } from "@/lib/server/page-initial";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// The shared public-page metadata names the root share image explicitly: a
// page that sets its own openGraph / twitter loses the root's file-based one,
// and this segment holds no image file of its own (the proposal pages do).
export const metadata: Metadata = publicPageMetadata({
  title: "Cosmos governance",
  description:
    "Live Cosmos governance: proposals in voting across Osmosis, Cosmos Hub, Safrochain and more, tallies against quorum and threshold, deadlines, and how your stake votes.",
  path: "/governance",
});

/**
 * `?chain=` as the page's `ChainLink` reads it: a catalog chain id (the first
 * value of a repeated key, as `useSearchParams().get` reads it), else null.
 */
function linkOf(params: Record<string, string | string[] | undefined>): string | null {
  const raw = Array.isArray(params.chain) ? params.chain[0] : params.chain;
  return raw && findChain(raw) ? raw : null;
}

export default async function Page({ searchParams }: Props) {
  // Rendered per request: the query decides which networks the list covers.
  // The page gets that answer up front, so its first render lists them
  // instead of waiting for the browser to read the address bar, and the
  // first HTML carries their proposals (titles, tallies, links to each
  // proposal's page) when the list is read within a short budget.
  const link = linkOf(await searchParams);
  // The networks of that first render: the linked one, or the followed
  // mainnets of a first visit (the scope before the stored one arrives).
  const chainIds = link ? [link] : DEFAULT_FOLLOWED.filter((id) => findChain(id)?.network === "mainnet");
  return <GovernancePage link={link} initial={await proposalsInitial(chainIds)} />;
}
