/**
 * The full chain catalog, server side only: everything in `@/lib/chains`
 * plus the endpoints and lists the browser never needs.
 *
 * Every upstream host the server reads comes from here, which is what keeps
 * request handlers from ever being pointed at a host by a request.
 */

import "server-only";
import raw from "@/data/chain-catalog.json";
import type { ChainEntry } from "@/lib/chains";

export interface ServerChainEntry extends ChainEntry {
  rpc?: string;
  rest?: string;
  /** Cosmostation / registry directory names for validator moniker images. */
  logoSlugs?: string[];
  currencies?: Array<{ coinDenom: string; coinMinimalDenom: string; coinDecimals: number; coinGeckoId?: string }>;
  /** Ethermint public key type for coin-type-60 chains (e.g. Injective). */
  ethPubKeyTypeUrl?: string;
}

export const SERVER_CHAINS = raw as ServerChainEntry[];

const BY_ID = new Map(SERVER_CHAINS.map((chain) => [chain.chainId, chain]));

export function findServerChain(chainId: string): ServerChainEntry | undefined {
  return BY_ID.get(chainId);
}

/** The chain's REST (LCD) base without a trailing slash, or null. */
export function restOf(chainId: string): string | null {
  const rest = BY_ID.get(chainId)?.rest?.replace(/\/+$/, "");
  return rest && rest.startsWith("https://") ? rest : rest ?? null;
}

/** The chain's CometBFT RPC base without a trailing slash, or null. */
export function rpcOf(chainId: string): string | null {
  return BY_ID.get(chainId)?.rpc?.replace(/\/+$/, "") ?? null;
}
