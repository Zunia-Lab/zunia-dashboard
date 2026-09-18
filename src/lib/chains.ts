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
  /**
   * Gas price tiers in whole fee-denom units per gas unit.
   *
   * Present in the shipped catalog and previously unread, which is why every
   * fee estimate used a flat 0.025 — right for the Hub, wrong for Osmosis
   * (0.1 average) and wrong for Safrochain (0.075). See `feeForChain`.
   */
  gasPriceStep?: { low: number; average: number; high: number };
  /**
   * Registry capability flags, e.g. `["cosmwasm"]`.
   *
   * Absent from the generated catalog today. `@zunialab/interchain` reads the
   * absence as "nobody said" rather than "no", which is why cross-chain swap
   * still plans; declaring it `[]` here would turn that into a hard no.
   */
  features?: string[];
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

/**
 * Catalog chains whose bech32 prefix matches, best first.
 *
 * The read scope (which chains to query) is not the same thing as the chain an
 * address was produced on: picking Osmosis in the left rail while the wallet is
 * connected on Cosmos Hub must still identify the address as a `cosmos1…`.
 * `hint` is the caller's claim about the origin chain and wins when it is
 * consistent with the address itself; otherwise mainnet entries come first,
 * because a mainnet address re-encoded onto a testnet prefix is the rarer case.
 */
export function findChainsByPrefix(
  prefix: string,
  hint?: string | null,
): ChainEntry[] {
  const matches = CHAINS.filter((chain) => chain.bech32Prefix === prefix);
  return matches.sort((a, b) => {
    if (hint) {
      if (a.chainId === hint) return -1;
      if (b.chainId === hint) return 1;
    }
    if (a.network !== b.network) return a.network === "mainnet" ? -1 : 1;
    return rank(a.chainId) - rank(b.chainId);
  });
}
