import type { Metadata } from "next";
import { ComparePage } from "@/components/compare/ComparePage";
import { publicPageMetadata } from "@/components/landing/seo";

const TITLE = "Compare Cosmos chains and tokens side by side";
const DESCRIPTION =
  "Compare up to four Cosmos chains or tokens: indexed price performance, drawdown and volatility, block-time corrected staking APR, real yield, inflation, unbonding and Nakamoto coefficient, with the best value of each row marked.";

// Every selection is the same page: one canonical URL without `?ids=`. The
// helper also restates the share image and the large card, which a page's
// own `openGraph` would otherwise drop (shared `?ids=` links had no picture).
export const metadata: Metadata = publicPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/compare" });

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Reads `?ids=` on the server so a shared link renders its own selection in
 * the first HTML (names, logos, the table's columns) instead of the default
 * set followed by a swap.
 */
export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  const raw = Array.isArray(params.ids) ? params.ids[0] : params.ids;
  return <ComparePage initialIds={typeof raw === "string" ? raw : null} />;
}
