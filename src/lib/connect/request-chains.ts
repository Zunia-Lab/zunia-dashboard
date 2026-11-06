/**
 * Ask the wallet for the chains it has not shared an address on.
 *
 * A connect asks for the followed chains once. A chain followed or selected
 * afterwards (or one the wallet did not know then, like Injective, Evmos,
 * Dymension, Initia: coin type 60 with keccak addresses) has no key, and its
 * address cannot be derived from a coin-118 one, so every page that reads it
 * shows "No address for these networks". This asks for exactly those chains,
 * one wallet prompt each, on the click that wants them.
 *
 * Pure over `ensure` so it is tested without a wallet.
 */

export interface RequestChainsResult {
  /** Chains the wallet now has an address for. */
  added: string[];
  /** Chains it did not, with a reason for a person. */
  failed: Array<{ chainId: string; error: unknown }>;
}

export async function requestChains(
  chainIds: readonly string[],
  ensure: (chainId: string) => Promise<unknown>,
): Promise<RequestChainsResult> {
  const result: RequestChainsResult = { added: [], failed: [] };
  for (const chainId of new Set(chainIds)) {
    try {
      await ensure(chainId);
      result.added.push(chainId);
    } catch (error) {
      result.failed.push({ chainId, error });
    }
  }
  return result;
}
