/**
 * /assets/[key]: one asset. `key` is the asset key (`TokenIdentity.key`,
 * `cosmoshub-4:uatom`), URL-encoded (`cosmoshub-4%3Auatom`).
 *
 * The market half (price chart, market stats, provenance, staking
 * economics) is public; the position half (holdings by chain, actions,
 * related activity) needs a wallet and says so inline.
 *
 * The identity is resolved here on the server from the bundled tables (an
 * `ibc/` key the tables do not know is traced on its chain, briefly), so the
 * name, ticker and logo are in the first HTML, the metadata names the asset,
 * and a key that cannot exist (bad shape, unknown chain) gets the not-found
 * page with a real 404 status (`parseAssetKey` is the only way
 * `resolveAssetKey` returns null): the `notFound()` below sets the status,
 * because this page sits outside the wallet pages' loading boundary and so
 * does not stream before it runs. A proven
 * voucher's location key (`osmosis-1:ibc/2739…`) resolves to its origin,
 * which is also the canonical URL, so both addresses are one page.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AssetDetailPage } from "@/components/assets/AssetDetailPage";
import { isUnlisted } from "@/components/assets/holdings";
import { assetHref } from "@/components/assets/links";
import { publicPageMetadata } from "@/components/landing/seo";
import { resolveAssetKey, toTokenIdentity } from "@/lib/token/identity";
import type { TokenIdentity } from "@/lib/token/types";

type Params = Promise<{ key: string }>;

/** The segment as an asset key; a client that encoded it twice still lands. */
function decodeKey(raw: string): string {
  if (!raw.includes("%")) return raw.trim();
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/** One resolution per request, shared by the metadata and the page. */
const identityFor = cache(async (raw: string): Promise<TokenIdentity | null> => {
  const held = await resolveAssetKey(decodeKey(raw), 2_500);
  return held ? toTokenIdentity(held) : null;
});

/** Worth a search result: a named, proven mainnet asset (not an unknown voucher or a testnet coin). */
function indexable(identity: TokenIdentity): boolean {
  return identity.proven && !isUnlisted(identity) && identity.testnet !== true;
}

/** ", issued on Noble", or nothing when the name already says it ("Cosmos Hub ATOM"). */
function originLine(identity: TokenIdentity): string {
  const where = identity.chainName ?? identity.chainId;
  if (identity.provenance === "unknown") return `, an unidentified token on ${where}`;
  const origin = identity.originChainName ?? where;
  return identity.name.includes(origin) ? "" : `, issued on ${origin}`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const identity = await identityFor((await params).key);
  if (!identity) {
    return { title: "Asset not found", robots: { index: false, follow: false } };
  }
  const canonical = assetHref(identity.key);
  const listed = indexable(identity);
  const title = listed ? `${identity.ticker} price, chart and market data` : `${identity.ticker}: token details`;
  // An unknown or unlisted token has no market to promise: say what the page does show.
  const description = listed
    ? `${identity.name} (${identity.ticker})${originLine(identity)}: live price, 24 h and 7 d change, liquidity, ` +
      `market cap, price history and on-chain provenance. Track your ${identity.ticker} across Cosmos chains with Zunia.`
    : `${identity.name} (${identity.ticker})${originLine(identity)}: where it comes from, how it was identified, ` +
      `and your balance. Zunia never values an unverified token as the asset it claims to be.`;
  // The market half is public and shareable: the helper restates the share
  // image and the large card (a page's own openGraph / twitter would drop the
  // root's). Robots stay this page's: index a proven listed asset, never an
  // unknown voucher.
  return {
    ...publicPageMetadata({ title, description, path: canonical }),
    robots: listed ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function Page({ params }: { params: Params }) {
  const identity = await identityFor((await params).key);
  if (!identity) notFound();
  return <AssetDetailPage assetKey={identity.key} initialIdentity={identity} />;
}
