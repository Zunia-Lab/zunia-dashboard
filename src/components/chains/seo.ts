/**
 * Which chain pages ask to be indexed, and what their metadata says.
 *
 * The design spec makes chain pages "indexable for curated mainnets": the
 * catalog has 222 mainnets, many with dead endpoints, and an indexed page of
 * dashes costs the whole site crawl budget. The curated list is the one the
 * sitemap advertises (`INDEXED_CHAIN_IDS`, one shared module, so a page and
 * the sitemap never say two different things). Every other chain page
 * renders the same, `noindex, follow`, so its links still count. Testnets
 * never index.
 *
 * The share card comes from the landing's `publicPageMetadata`: a page that
 * sets its own `openGraph` / `twitter` replaces the root layout's objects
 * whole, and the root's file-based share image only applies to its own
 * segment, so these pages shared as a bare "summary" card with no picture,
 * site name or locale. The helper restates all of them.
 */

import type { Metadata } from "next";
import { publicPageMetadata } from "@/components/landing/seo";
import type { ChainEntry } from "@/lib/chains";
import { INDEXED_CHAIN_IDS } from "@/lib/server/indexed-chains";

export const INDEXED_CHAINS: ReadonlySet<string> = new Set(INDEXED_CHAIN_IDS);

export function chainIndexable(chain: Pick<ChainEntry, "chainId" | "network">): boolean {
  return chain.network === "mainnet" && INDEXED_CHAINS.has(chain.chainId);
}

export function chainMetadata(chain: ChainEntry): Metadata {
  const path = `/chains/${encodeURIComponent(chain.chainId)}`;
  const testnet = chain.network === "testnet";
  // Most catalog testnets already say so in their name ("Terp Testnet").
  const testnetName = /testnet/i.test(chain.chainName) ? chain.chainName : `${chain.chainName} testnet`;
  const title = testnet
    ? `${testnetName} (${chain.chainId}): staking and validators`
    : `${chain.chainName} (${chain.coinDenom}) staking APR, validators and economics`;
  const description = testnet
    ? `${testnetName} (${chain.chainId}): live block status, staking parameters, validator set and governance, read from public chain data.`
    : `${chain.chainName} (${chain.chainId}): block-time corrected staking APR, real yield after inflation, bonded ratio, unbonding period, Nakamoto coefficient, governance and the ${chain.coinDenom} price, live from public chain data.`;
  const index = chainIndexable(chain);
  return {
    ...publicPageMetadata({ title, description, path }),
    // The helper indexes every page; here only the curated mainnets.
    robots: { index, follow: true, googleBot: { index, follow: true } },
  };
}
