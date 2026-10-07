/**
 * How well a token answers a picker search, so the token the user means
 * comes first and Enter picks it.
 *
 * Plain substring matching over every word of an identity (what the pickers
 * did) answered "osmo" with every Cosmos Hub token, because "cOSMOs Hub" and
 * "cOSMOshub-4" contain it, and kept the list's group order: OSMO was row 17
 * and Enter picked ATOM. Here what a token *is* outranks where it sits, and a
 * chain or a name matches only at the start of one of its words ("hub" finds
 * the Hub, "osmo" no longer finds "Cosmos"). Tickers, families and aliases
 * still match anywhere inside ("btc" finds allBTC and WBTC.osmo, "atom" finds
 * stATOM), and so do denoms (a pasted `ibc/27BC…` hash).
 *
 * Pure and table-free (only the identity type), so the transfer pickers can
 * share it from `@/lib/token/text` once it moves there.
 */

import type { TokenIdentity } from "@/lib/token/types";

/** What may sit before a word: space, the separators of tickers, chain ids and denoms, the name's middle dot. */
const WORD_BREAK = /[\s._\-/·()]/;

/** `query` starts a word of `text`: "hub" in "Cosmos Hub", never "osmo" in "Cosmos". */
function startsWord(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  for (let at = lower.indexOf(query); at !== -1; at = lower.indexOf(query, at + 1)) {
    if (at === 0 || WORD_BREAK.test(lower[at - 1] ?? "")) return true;
  }
  return false;
}

/** Rank added to every match of a token nothing proves or nobody lists. */
const UNPROVEN = 10;

/**
 * A picker search's rank for one token (lower is better), `null` when it does
 * not match. `query` arrives trimmed and lowercased (the kit's Combobox does
 * it).
 *
 * - 0 the exact ticker; 1 a ticker that starts with it;
 * - 2 an exact family or alias ("usdc" for USDC.n, "axlusdc");
 * - 3 inside a ticker, family or alias ("btc" in allBTC);
 * - 4 the start of a word of the name ("noble" in "Noble USDC");
 * - 5 the start of a word of a chain's name or id: where the row sits
 *   (`chainName`, the picker row's own), where the identity is held, where it
 *   comes from;
 * - 6 inside a denom (a pasted `ibc/` hash, `factory/…`).
 *
 * Unproven or unlisted tokens rank after every proven match
 * ({@link UNPROVEN}), so an impostor `factory/…/BTC.rt` never outranks allBTC.
 */
export function tokenSearchRank(identity: TokenIdentity, query: string, chainName?: string): number | null {
  if (!query) return null;
  const ticker = identity.ticker.toLowerCase();
  const tags = [identity.family, ...(identity.aliases ?? [])].flatMap((tag) => (tag ? [tag.toLowerCase()] : []));
  const chains = [chainName, identity.chainName, identity.chainId, identity.originChainName, identity.originChainId];
  const rank =
    ticker === query
      ? 0
      : ticker.startsWith(query)
        ? 1
        : tags.includes(query)
          ? 2
          : ticker.includes(query) || tags.some((tag) => tag.includes(query))
            ? 3
            : startsWord(identity.name, query)
              ? 4
              : chains.some((chain) => chain !== undefined && startsWord(chain, query))
                ? 5
                : [identity.denom, identity.originDenom].some((denom) => denom?.toLowerCase().includes(query))
                  ? 6
                  : null;
  if (rank === null) return null;
  return identity.proven && identity.listed !== false ? rank : rank + UNPROVEN;
}
