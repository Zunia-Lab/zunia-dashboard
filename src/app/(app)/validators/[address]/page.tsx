import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { chainIndexable } from "@/components/chains/seo";
import { publicPageMetadata } from "@/components/landing/seo";
import { ValidatorDetailPage } from "@/components/validators/ValidatorDetailPage";
import { formatPercent } from "@/lib/format";
import { lookupValidator } from "./lookup";

type Props = {
  params: Promise<{ address: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve({ params, searchParams }: Props) {
  const [{ address }, query] = await Promise.all([params, searchParams]);
  const chain = typeof query.chain === "string" ? query.chain : typeof query.chainId === "string" ? query.chainId : null;
  return lookupValidator(address, chain);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const lookup = await resolve(props);
  if (lookup.kind === "invalid" || lookup.kind === "missing") notFound();
  const canonical = `/validators/${encodeURIComponent(lookup.operator)}?chain=${encodeURIComponent(lookup.chainId)}`;
  const moniker = lookup.kind === "found" ? lookup.profile.moniker : null;
  const title = moniker ? `${moniker} · ${lookup.chainName} validator` : `${lookup.chainName} validator`;
  const description =
    lookup.kind === "found"
      ? `${lookup.profile.moniker} on ${lookup.chainName}: ${formatPercent(lookup.profile.commission.rate * 100, { digits: 1 })} commission (cap ${formatPercent(
          lookup.profile.commission.maxRate * 100,
          { digits: 0 },
        )}), voting power and rank, uptime, self-delegation, slashes and the APR its delegators earn.`
      : `A ${lookup.chainName} validator: commission, voting power, uptime and the APR its delegators earn.`;
  // A validator that was read, on a curated mainnet (the list /chains/<id>
  // and /validators?chain= index): spec §1. The rest render `noindex, follow`.
  const index = lookup.kind === "found" && chainIndexable(lookup);
  return {
    // Share image and X card too: a page that sets its own `openGraph`
    // replaces the root's whole, image included (see the helper).
    ...publicPageMetadata({ title, description, path: canonical }),
    robots: { index, follow: true, googleBot: { index, follow: true } },
  };
}

export default async function ValidatorRoute(props: Props) {
  const lookup = await resolve(props);
  if (lookup.kind === "invalid" || lookup.kind === "missing") notFound();
  return (
    <ValidatorDetailPage
      chainId={lookup.chainId}
      operator={lookup.operator}
      initial={lookup.kind === "found" ? lookup.profile : null}
    />
  );
}
