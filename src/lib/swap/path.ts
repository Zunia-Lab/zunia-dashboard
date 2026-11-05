/**
 * Which way a swap reaches Osmosis for one pair.
 *
 * Funds on another chain swap in one signature there: an ICS20 transfer to
 * Skip Go's entry point on Osmosis whose memo swaps them along the quoted
 * pools and delivers the output (./skip.ts). Funds on Osmosis swap in its own
 * pools (./pool.ts), and a To on another chain gets the swap's floor in the
 * same transaction. Moving the funds to Osmosis first is left only for a
 * token that cannot reach Osmosis in one canonical hop, which the quote
 * decides (src/lib/server/swap/quote.ts).
 *
 * Pure: no network, no storage, safe in the browser and in node:test.
 */

import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";

/**
 * - `contract`: the funds are on another chain. One transfer to Skip's entry
 *   point on Osmosis, whose memo swaps them and delivers the output wherever
 *   the To is. One signature, on the funds' chain; no OSMO needed.
 * - `pool`: the funds and the To are both on Osmosis. One poolmanager swap.
 * - `pool-deliver`: the funds are on Osmosis and the To is on another chain.
 *   One transaction: the swap, then a transfer of its guaranteed minimum.
 * - `move-first`: the funds cannot reach Osmosis in one canonical hop. They
 *   move there first (Send); the swap there is then `pool` or `pool-deliver`.
 */
export type SwapPath = "contract" | "pool" | "pool-deliver" | "move-first";

export const SWAP_PATHS: readonly SwapPath[] = ["contract", "pool", "pool-deliver", "move-first"];

/**
 * The path for selling `from` and buying `to` as far as the two chains tell:
 * the pools for funds on Osmosis, one signature through the entry point for
 * funds anywhere else. The quote may still answer `move-first` for a token
 * whose way to Osmosis it cannot prove.
 */
export function swapPathFor(from: { readonly chainId: string }, to: { readonly chainId: string }): SwapPath {
  if (from.chainId === SWAP_VENUE_CHAIN_ID) return to.chainId === SWAP_VENUE_CHAIN_ID ? "pool" : "pool-deliver";
  return "contract";
}

/** Whether the path signs a poolmanager swap now. */
export function isPoolPath(path: SwapPath | null | undefined): path is "pool" | "pool-deliver" {
  return path === "pool" || path === "pool-deliver";
}

/** The chain whose account signs a swap on `path`: Osmosis for the pools, the funds' chain otherwise. */
export function signingChainFor(path: SwapPath, fromChainId: string): string {
  return isPoolPath(path) ? SWAP_VENUE_CHAIN_ID : fromChainId;
}
