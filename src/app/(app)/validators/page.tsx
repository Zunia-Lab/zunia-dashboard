import type { Metadata } from "next";
import { connection } from "next/server";
import { chainIndexable } from "@/components/chains/seo";
import { publicPageMetadata } from "@/components/landing/seo";
import { ValidatorsPage } from "@/components/validators/ValidatorsPage";
import { findChain } from "@/lib/chains";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function chainOf(params: Record<string, string | string[] | undefined>) {
  const raw = typeof params.chain === "string" ? params.chain : null;
  return raw ? findChain(raw) : undefined;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const chain = chainOf(await searchParams);
  const title = chain ? `${chain.chainName} validators` : "Cosmos validators";
  const description = chain
    ? `Compare every active ${chain.chainName} validator: voting power and the Nakamoto set, commission today and how high it can rise in 30 days, uptime, and the APR delegators actually earn.`
    : "Compare validators on Safrochain, Cosmos Hub, Osmosis and other Cosmos chains: voting-power concentration, commission limits, uptime and real staking APR.";
  const canonical = chain ? `/validators?chain=${encodeURIComponent(chain.chainId)}` : "/validators";
  // Curated mainnets only, the same list as /chains/<id> (spec §1): the
  // catalog has some 220 mainnets, many wound down or with dead endpoints,
  // and an indexed page of dashes costs the whole site crawl budget. Others
  // render the same, `noindex, follow`, so their links still count.
  const index = !chain || chainIndexable(chain);
  return {
    // Share image and X card too: a page that sets its own `openGraph`
    // replaces the root's whole, image included (see the helper).
    ...publicPageMetadata({ title, description, path: canonical }),
    robots: { index, follow: true, googleBot: { index, follow: true } },
  };
}

export default async function ValidatorsRoute() {
  // Rendered per request, never prerendered. The body reads `?chain=` with
  // useSearchParams (it rewrites the query in place when a chip is picked).
  // In a prerendered page that hook bails out to the browser up to the
  // nearest Suspense boundary, so the HTML a crawler got for
  // `/validators?chain=osmosis-1` held an empty boundary where the page
  // belongs. At request time the hook has the real query and does not
  // suspend, so no boundary is needed and the chain's page is in the first
  // HTML (this route sits outside the wallet pages' loading boundary too).
  await connection();
  return <ValidatorsPage />;
}
