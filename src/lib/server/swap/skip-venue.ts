/**
 * Is Skip Go's entry point on Osmosis the contract this release was reviewed
 * against, right now? Asked before any one-signature swap names it in a
 * packet memo: a wrong address there takes the tokens to a contract that
 * will not send them back.
 *
 * The rules are src/lib/swap/venue.ts `skipVenueFromContractInfo` (shipped
 * address, code 1241, its label, no admin). Fails closed with a sentence the
 * swap page shows as is. Cached 10 minutes when verified, 30 s otherwise so
 * a flaky LCD recovers quickly.
 */

import "server-only";

import { SKIP_ENTRY_POINT, SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { cached } from "@/lib/server/cache";
import { UpstreamError, fetchJson } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { skipVenueFromContractInfo, venueOff, type SwapVenue } from "@/lib/swap/venue";

const VERIFIED_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 30_000;

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
        : "Zunia could not reach Osmosis to confirm its swap contract, so one-signature swaps stay off until that check succeeds.",
    );
  }
  return skipVenueFromContractInfo(address, body);
}

class VenueUnavailable extends Error {
  readonly venue: SwapVenue;
  constructor(venue: SwapVenue) {
    super(venue.reason ?? "swap venue unavailable");
    this.name = "VenueUnavailable";
    this.venue = venue;
  }
}

/** The entry point, verified. Never throws: an unusable one is `address: null` with the reason. */
export async function skipVenue(): Promise<SwapVenue> {
  const address = SKIP_ENTRY_POINT;
  try {
    return await cached(`swap:skip-venue:${address}`, { ttlMs: VERIFIED_TTL_MS, staleMs: 0, errorTtlMs: FAILED_TTL_MS }, async () => {
      const venue = await check(address);
      if (!venue.address) throw new VenueUnavailable(venue);
      return venue;
    });
  } catch (failed) {
    if (failed instanceof VenueUnavailable) return failed.venue;
    return venueOff(address, "Zunia could not confirm Osmosis's swap contract, so one-signature swaps stay off for now.");
  }
}
