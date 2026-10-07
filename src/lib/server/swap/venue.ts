/**
 * Is the crosschain-swaps contract this deployment would put in a swap memo
 * really that contract, right now?
 *
 * The address is a candidate (`XCS_CONTRACT_CANDIDATES`, or the server's
 * environment override, read through `xcsContractAddress()` in
 * src/lib/server/interchain-config.ts), never a fact. Every route that names
 * the contract goes through this check: the swap engine, and the route
 * planner and transfer tracker under `/api/interchain/*`. Before any contract path is
 * offered, the venue chain is asked for the contract's info, and the answer
 * must name a CrossChainSwaps contract running a code id this release was
 * reviewed against (the rules: src/lib/swap/venue.ts). A well-formed address
 * with nothing (or something else) behind it would accept an ibc-hooks memo
 * and never act on it, stranding the transfer at an address nobody controls.
 *
 * Fails closed with a named reason, which callers show as is (so it never
 * names a setting or a host). A check that could not *run* (the LCD is down)
 * is worded differently from a check that ran and said no. Cached 10 minutes
 * when verified (a migrated contract stops being offered within that), 30 s
 * otherwise so a flaky LCD recovers quickly.
 */

import "server-only";

import { SWAP_VENUE_CHAIN_ID, XCS_CONTRACT_CANDIDATES } from "@/config/interchain";
import { cached } from "@/lib/server/cache";
import { UpstreamError, fetchJson } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { xcsContractAddress } from "@/lib/server/interchain-config";
import { venueFromContractInfo, venueOff, type SwapVenue } from "@/lib/swap/venue";
import { looksLikeAddress } from "@/lib/swap/xcs";

export type { SwapVenue };

const VERIFIED_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 30_000;

/** The configured candidate: the server override when set, else the shipped one. */
export function xcsCandidate(): { address: string | null; source: "env" | "config" } {
  const override = xcsContractAddress();
  if (override) return { address: override, source: "env" };
  return { address: XCS_CONTRACT_CANDIDATES[0] ?? null, source: "config" };
}

async function check(address: string): Promise<SwapVenue> {
  const rest = restOf(SWAP_VENUE_CHAIN_ID);
  if (!rest) return venueOff(address, "Osmosis has no REST endpoint in this build's catalog, so the swap contract cannot be checked.");
  let body: unknown;
  try {
    body = await fetchJson<unknown>(`${rest}/cosmwasm/wasm/v1/contract/${encodeURIComponent(address)}`, {
      timeoutMs: 8_000,
      retries: 1,
    });
  } catch (error) {
    const absent = error instanceof UpstreamError && error.kind === "http" && (error.status === 404 || error.status === 400);
    return venueOff(
      address,
      absent
        ? `Osmosis has no contract at ${address}, so Zunia will not route a swap through it.`
        : "Zunia could not reach Osmosis to confirm its swap contract, so contract swaps stay off until that check succeeds.",
    );
  }
  return venueFromContractInfo(address, body);
}

/** Carries a failed check through the cache, which keeps failures for 30 s only. */
class VenueUnavailable extends Error {
  readonly venue: SwapVenue;
  constructor(venue: SwapVenue) {
    super(venue.reason ?? "swap venue unavailable");
    this.name = "VenueUnavailable";
    this.venue = venue;
  }
}

/**
 * The venue, verified. Never throws: an unusable venue is `address: null`
 * with the reason; the pool paths do not need it and keep working.
 */
export async function swapVenue(): Promise<SwapVenue> {
  const { address, source } = xcsCandidate();
  if (!address) return venueOff(null, "No swap contract is configured for this deployment, so contract swaps are off.");
  if (!looksLikeAddress(address)) {
    // The reason travels to the browser, so it names no setting; the operator
    // knows which one they set.
    return venueOff(
      null,
      source === "env"
        ? "This deployment's swap contract setting is not a contract address, so contract swaps are off."
        : "The swap contract this release ships is not a contract address, so contract swaps are off.",
    );
  }
  try {
    return await cached(`swap:venue:${address}`, { ttlMs: VERIFIED_TTL_MS, staleMs: 0, errorTtlMs: FAILED_TTL_MS }, async () => {
      const venue = await check(address);
      // A failed check is thrown so the cache keeps it for 30 s, not 10 min.
      if (!venue.address) throw new VenueUnavailable(venue);
      return venue;
    });
  } catch (failed) {
    if (failed instanceof VenueUnavailable) return failed.venue;
    return venueOff(address, "Zunia could not confirm Osmosis's swap contract, so contract swaps stay off for now.");
  }
}
