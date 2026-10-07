/**
 * The tokens a swap can deliver: every token the Osmosis router lists that
 * token identity proves, delivered on Osmosis, plus each of them delivered
 * home to the chain that issues it.
 *
 * Ported from zunia-extension lib/osmosis-assets.ts (`osmosisSwapAssets`) and
 * lib/swap-assets.ts (`deliveryOf`) @ 1453e7a. SQS is a freshness filter and a
 * decimals witness only: its rows carry no origin (just a symbol, a name,
 * decimals and a CoinGecko id), and on its own it lists 1,300+ rows, LP shares
 * and zero-supply tokens included. What a token *is* comes from token identity
 * (`identifyDenom`); a row nothing proves is not offered, and the response
 * says how many were left out (`counts`).
 *
 * The Osmosis side is the token table's Osmosis rows that Osmosis verifies
 * and does not flag unstable (106 rows on 2026-10-05 in the extension), kept
 * while SQS still lists them. A home row is offered only for a voucher whose
 * first hop lands on its listed origin over the registry's canonical channel,
 * on a catalog mainnet, never a CW20, and only when the issuer's own identity
 * names this very voucher as its Osmosis denom; the quote then proves the
 * one-hop transfer home on chain before anything is signed
 * (src/lib/server/swap/names.ts).
 *
 * Prices and liquidity are the router's (`/tokens/pool-metadata`, quoted in
 * alloyed USDC): a token it cannot price is `null`, never 0.
 */

import "server-only";

import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { findServerChain } from "@/lib/server/chains";
import { sqsListings, sqsPoolMetadata, type PoolMetadata } from "@/lib/server/swap/sqs";
import { swapVenue } from "@/lib/server/swap/venue";
import { loadXcsTable } from "@/lib/server/swap/xcs-table";
import { sameDenom } from "@/lib/swap/denoms";
import type { OsmosisListing } from "@/lib/swap/sqs";
import type { SwapAsset, SwapAssetsResponse } from "@/lib/swap/wire";
import { canonicalCounterpartyOf, tokenTableRows, type TokenTableRow } from "@/lib/token/engine";
import { identifyDenom } from "@/lib/token/identity";
import type { TokenIdentity } from "@/lib/token/types";

const VENUE = SWAP_VENUE_CHAIN_ID;

/** The router could not list anything: there is no asset list to give. The route answers 503. */
export class AssetsUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetsUnavailable";
  }
}

/** The identity's exponent, unless SQS lists the Osmosis denom with another one. */
function vetoedDecimals(identity: TokenIdentity, listing: OsmosisListing): number | null {
  return identity.decimals !== null && identity.decimals === listing.decimals ? identity.decimals : null;
}

/**
 * The issuer's row for an Osmosis voucher (the extension's `deliveryOf`):
 * only for a voucher whose first hop lands on its listed origin, over the
 * registry's canonical channel, on a catalog mainnet, and only when the
 * issuer's identity names this voucher as its Osmosis denom (the quote
 * compares the two and refuses another variant). Never for a CW20 origin:
 * `cw20:<contract>` is not a bank denom, so the delivered coin would be a
 * contract balance the wallet cannot read or send.
 */
function homeRow(row: TokenTableRow, listing: OsmosisListing, meta: PoolMetadata | undefined): SwapAsset | null {
  const { originChainId, originDenom } = row;
  if (!row.path || !row.channelId || row.counterpartyChainId !== originChainId) return null;
  if (originChainId === VENUE || /^cw20:/i.test(originDenom)) return null;
  const chain = findServerChain(originChainId);
  if (!chain || chain.network !== "mainnet") return null;
  if (canonicalCounterpartyOf(VENUE, row.channelId) !== originChainId) return null;
  const home = identifyDenom(originChainId, originDenom);
  if (home.provenance === "unknown" || !home.osmosisDenom || !sameDenom(home.osmosisDenom, listing.denom)) return null;
  return {
    key: `${originChainId}:${originDenom}`,
    chainId: originChainId,
    denom: originDenom,
    identity: home,
    osmosisDenom: listing.denom,
    decimals: vetoedDecimals(home, listing),
    listedDecimals: listing.decimals,
    kind: "home",
    liquidity: meta?.liquidity ?? null,
    price: meta?.price ?? null,
    tradable: true,
  };
}

/**
 * The swap's To list from Osmosis's side, for a From on `network`. A testnet
 * From gets no rows: the only venue is Osmosis mainnet.
 */
export async function swapAssets(network: "mainnet" | "testnet"): Promise<SwapAssetsResponse> {
  const errors: { scope: string; message: string }[] = [];
  const venuePromise = swapVenue();
  let listings: OsmosisListing[];
  try {
    listings = await sqsListings();
  } catch {
    throw new AssetsUnavailable("The Osmosis router could not be reached, so the tokens it trades cannot be listed right now.");
  }
  let meta: ReadonlyMap<string, PoolMetadata> = new Map();
  try {
    meta = await sqsPoolMetadata();
  } catch {
    errors.push({ scope: "prices", message: "Osmosis prices and liquidity could not be read; they show as unknown." });
  }
  const venue = await venuePromise;
  const routeTable = venue.address ? await loadXcsTable(venue.address) : null;
  if (venue.address && !routeTable) {
    errors.push({ scope: "route-table", message: "The swap contract's route table could not be read; no pair is gated by it." });
  }

  const assets: SwapAsset[] = [];
  const seen = new Set<string>();
  let identified = 0;
  if (network === "mainnet") {
    // The table's Osmosis rows Osmosis verifies and does not flag unstable.
    const rows = new Map<string, TokenTableRow>();
    for (const row of tokenTableRows(VENUE)) {
      if (row.verified && row.stable) rows.set(row.denom, row);
    }
    for (const listing of listings) {
      const row = rows.get(listing.denom);
      const identity = identifyDenom(VENUE, listing.denom);
      // Osmosis's own coin has no table row (it is the chain's native coin).
      if (identity.provenance === "unknown" || (!row && identity.provenance !== "native")) continue;
      identified += 1;
      const rowMeta = meta.get(listing.denom);
      const key = `${VENUE}:${listing.denom}`;
      if (!seen.has(key)) {
        seen.add(key);
        assets.push({
          key,
          chainId: VENUE,
          denom: listing.denom,
          identity,
          osmosisDenom: listing.denom,
          decimals: vetoedDecimals(identity, listing),
          listedDecimals: listing.decimals,
          kind: "venue",
          liquidity: rowMeta?.liquidity ?? null,
          price: rowMeta?.price ?? null,
          tradable: true,
        });
      }
      const home = row ? homeRow(row, listing, rowMeta) : null;
      if (home && !seen.has(home.key)) {
        seen.add(home.key);
        assets.push(home);
      }
    }
  }

  return {
    updatedAt: Date.now(),
    venue: "osmosis-1",
    network,
    assets,
    routeTable,
    contract: { chainId: venue.chainId, contract: venue.contract, reason: venue.reason },
    counts: { listed: listings.length, identified },
    priceSource: "osmosis-sqs",
    ...(errors.length > 0 ? { errors } : {}),
  };
}
