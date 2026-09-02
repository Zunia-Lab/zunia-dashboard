import raw from "@/data/chain-catalog.json";

export interface ChainEntry {
  chainId: string;
  chainName: string;
  bech32Prefix: string;
  coinType: number;
  network: "mainnet" | "testnet";
  coinDenom: string;
  coinMinimalDenom: string;
  coinDecimals: number;
  feeDenom: string;
  feeMinimalDenom: string;
  feeDecimals: number;
  /** Price-feed id; absent for most of the registry, which stays unpriced. */
  coinGeckoId?: string;
  rpc?: string;
  rest?: string;
  iconUrl?: string;
}

export const CHAINS = raw as ChainEntry[];

/** Chains the product leads with, in the order they should appear. */
const PINNED = ["safrochain-1", "cosmoshub-4", "osmosis-1"];

function rank(chainId: string): number {
  const index = PINNED.indexOf(chainId);
  return index === -1 ? PINNED.length : index;
}

export function sortChains(entries: ChainEntry[]): ChainEntry[] {
  return [...entries].sort((a, b) => {
    const byRank = rank(a.chainId) - rank(b.chainId);
    if (byRank !== 0) return byRank;
    return a.chainName.localeCompare(b.chainName);
  });
}

export function findChain(chainId: string): ChainEntry | undefined {
  return CHAINS.find((chain) => chain.chainId === chainId);
}

export function searchChains(
  query: string,
  network?: "mainnet" | "testnet",
): ChainEntry[] {
  const needle = query.trim().toLowerCase();
  const filtered = CHAINS.filter((chain) => {
    if (network && chain.network !== network) return false;
    if (!needle) return true;
    return (
      chain.chainName.toLowerCase().includes(needle) ||
      chain.chainId.toLowerCase().includes(needle) ||
      chain.coinDenom.toLowerCase().includes(needle)
    );
  });
  return sortChains(filtered);
}
