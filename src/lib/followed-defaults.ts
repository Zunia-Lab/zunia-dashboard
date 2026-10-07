/**
 * First-visit defaults for the followed chains: the home chain, the Hub, the
 * swap venue, and two active networks. Neutron (wound down) and Noble (left
 * Cosmos) are not defaults any more; users can still follow them.
 *
 * In a module of its own, without "use client", so server code reads the same
 * list the browser starts from: a public page's server-read first answer must
 * ask for exactly the chains its client hook will ask for (the cache key is
 * the URL), and the boot-time cache warm-up should warm what first visits
 * read. `@/lib/useFollowedChains` re-exports it.
 */
export const DEFAULT_FOLLOWED = ["safrochain-1", "cosmoshub-4", "osmosis-1", "celestia", "akashnet-2"];
