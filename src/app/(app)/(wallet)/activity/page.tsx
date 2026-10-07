import type { Metadata } from "next";
import { ActivityPage } from "@/components/activity/ActivityPage";
import { parseFilters } from "@/components/activity/view";

const TITLE = "Activity";
const DESCRIPTION =
  "Every transaction of your Zunia wallet across Cosmos chains: transfers, IBC, swaps, staking and votes, with fees, flows and how far back each chain's history goes.";

// A wallet page: the history is personal, so it stays out of search engines.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/activity" },
  openGraph: { title: `${TITLE} · Zunia`, description: DESCRIPTION, url: "/activity" },
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Filters arrive in the URL (`?range=7d&kind=swaps&failed=1&q=…`) so other
  // pages can deep-link a filtered view; the client keeps them in sync.
  const initialFilters = parseFilters(await searchParams);
  return <ActivityPage initialFilters={initialFilters} />;
}
