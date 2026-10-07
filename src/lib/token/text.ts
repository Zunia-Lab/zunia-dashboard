/**
 * The words for a token identity, for client components, and how a search
 * reads them (`tokenSearchRank`).
 *
 * Small and table-free on purpose: identities arrive inside API payloads, and
 * the browser should be able to label them ("Noble USDC · on Osmosis",
 * "Unlisted token · on Osmosis") without shipping the 200 KB identity tables.
 * The rules are the extension's `tokenText` (zunia-extension
 * lib/token-identity.ts @ 1453e7a), read off the trimmed `TokenIdentity`.
 *
 * "Native" means the chain's own coin or a local token a registry lists, and
 * nothing else: an unlisted local token (an impostor `factory/…/USDC.n`
 * included) reads "Unlisted token", the way a voucher nothing proves reads
 * "Unknown origin".
 */

import type { TokenIdentity, TokenKind } from "./types";

export type TokenTextVariant = "pill" | "row" | "sentence" | "a11y";

/** The single short form of a denom. */
export function shortDenom(denom: string): string {
  if (denom.startsWith("factory/")) {
    const parts = denom.split("/");
    const sub = parts[parts.length - 1] ?? denom;
    const creator = parts[1] ?? "";
    const clipped = creator.length > 12 ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : creator;
    return clipped ? `factory/${clipped}/${sub}` : denom;
  }
  if (denom.startsWith("ibc/")) {
    return denom.length <= 20 ? denom : `ibc/${denom.slice(4, 8)}…${denom.slice(-6)}`;
  }
  const bridged = /^(erc20:0x|peggy0x|gravity0x)([0-9a-fA-F]{12,})$/.exec(denom);
  if (bridged) return `${bridged[1]}${(bridged[2] ?? "").slice(0, 4)}…${(bridged[2] ?? "").slice(-4)}`;
  return denom;
}

/** Minted where it is held and listed by nobody: never called native. */
export function isUnlistedLocal(
  identity: Pick<TokenIdentity, "provenance" | "listed" | "originChainId" | "chainId">,
): boolean {
  return (
    identity.provenance !== "unknown" && identity.listed === false && identity.originChainId === identity.chainId
  );
}

/**
 * - `pill`: `on Osmosis`.
 * - `row`: `Native on Injective`, `Noble USDC · on Osmosis`,
 *   `Alloyed USDC · Osmosis only`, `Unlisted token · on Osmosis`,
 *   `Unknown origin · on Osmosis · ibc/498A…6BA6E4`.
 * - `sentence`: `USDC.n (Noble USDC) on Osmosis`, `ATOM on Cosmos Hub`.
 * - `a11y`: `USDC from Noble, on Osmosis`, `ATOM, native on Cosmos Hub`.
 */
export function tokenText(identity: TokenIdentity, variant: TokenTextVariant): string {
  const held = identity.chainName ?? identity.chainId;
  const unknown = identity.provenance === "unknown";
  const home = !unknown && identity.originChainId === identity.chainId;
  const unlisted = isUnlistedLocal(identity);
  switch (variant) {
    case "pill":
      return `on ${held}`;
    case "row":
      if (unknown) return `Unknown origin · on ${held} · ${shortDenom(identity.denom)}`;
      if (unlisted) return `Unlisted token · on ${held}`;
      if (identity.alloyed && home) return `${identity.name} · ${held} only`;
      return home ? `Native on ${held}` : `${identity.name} · on ${held}`;
    case "sentence":
      if (unknown) return `unknown token ${shortDenom(identity.denom)} on ${held}`;
      if (unlisted) return `${identity.ticker} (unlisted token) on ${held}`;
      return home ? `${identity.ticker} on ${held}` : `${identity.ticker} (${identity.name}) on ${held}`;
    case "a11y":
      if (unknown) return `Unknown token ${shortDenom(identity.denom)}, on ${held}`;
      if (unlisted) return `${identity.ticker}, unlisted token, on ${held}`;
      if (identity.alloyed || identity.listed === false) return `${identity.name}, on ${held}`;
      return home
        ? `${identity.ticker}, native on ${held}`
        : `${identity.family ?? identity.ticker} from ${identity.originChainName ?? "an unknown chain"}, on ${held}`;
  }
}

/** The single label for a token kind. */
export function tokenKindLabel(kind: TokenKind): string {
  switch (kind) {
    case "native":
      return "Native";
    case "ibc":
      return "IBC";
    case "factory":
      return "Factory";
    case "erc20":
      return "ERC-20";
    case "peggy":
      return "Peggy";
    case "cw20":
      return "CW20";
    case "other":
      return "Asset";
  }
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * How well a token answers a search, so the token the user means comes first
 * (and Enter picks it) in every picker and list that searches tokens: the
 * swap's token pickers, the Send / Bridge token picker, the Assets table.
 *
 * Plain substring matching over every word of an identity (what they all
 * did) answered "osmo" with every Cosmos Hub token, because "cOSMOs Hub" and
 * "cOSMOshub-4" contain it, and kept the list's group order: OSMO was row 17
 * and Enter picked ATOM. Here what a token *is* outranks where it sits, and a
 * chain or a name matches only at the start of one of its words ("hub" finds
 * the Hub, "osmo" no longer finds "Cosmos"). Tickers, families and aliases
 * still match anywhere inside ("btc" finds allBTC and WBTC.osmo, "atom" finds
 * stATOM), and so do denoms (a pasted `ibc/27BC…` hash).
 */

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

/** Rank added to every match of a token nothing proves or nobody lists: past the last proven rule (7). */
const UNPROVEN = 10;

/**
 * A search's rank for one token (lower is better), `null` when it does not
 * match. `query` arrives trimmed and lowercased (the kit's Combobox does it;
 * other callers do the same).
 *
 * - 0 the exact ticker; 1 a ticker that starts with it;
 * - 2 an exact family or alias ("usdc" for USDC.n, "axlusdc");
 * - 3 inside the ticker ("btc" in allBTC, "eth" in wstETH);
 * - 4 inside a family or alias. After the ticker because an alias often
 *   spells a route, not the asset: "eth" is inside USDC.axl's
 *   "USDC.eth.axl", and the USDC a wallet holds must not come before wstETH;
 * - 5 the start of a word of the name ("noble" in "Noble USDC");
 * - 6 the start of a word of a chain's name or id: where the row sits
 *   (`chainName`, a picker row's own), where the identity is held, where it
 *   comes from;
 * - 7 inside a denom (a pasted `ibc/` hash, `factory/…`).
 *
 * Unproven or unlisted tokens rank after every proven match
 * ({@link UNPROVEN}), so an impostor `factory/…/BTC.rt` never outranks allBTC.
 */
export function tokenSearchRank(identity: TokenIdentity, query: string, chainName?: string): number | null {
  if (!query) return null;
  const rank = matchRank(identity, query, chainName);
  if (rank === null) return null;
  return identity.proven && identity.listed !== false ? rank : rank + UNPROVEN;
}

/** {@link tokenSearchRank} before the unproven offset: the first rule that matches. */
function matchRank(identity: TokenIdentity, query: string, chainName: string | undefined): number | null {
  const ticker = identity.ticker.toLowerCase();
  if (ticker === query) return 0;
  if (ticker.startsWith(query)) return 1;
  const tags = [identity.family, ...(identity.aliases ?? [])].flatMap((tag) => (tag ? [tag.toLowerCase()] : []));
  if (tags.includes(query)) return 2;
  if (ticker.includes(query)) return 3;
  if (tags.some((tag) => tag.includes(query))) return 4;
  if (startsWord(identity.name, query)) return 5;
  const chains = [chainName, identity.chainName, identity.chainId, identity.originChainName, identity.originChainId];
  if (chains.some((chain) => chain !== undefined && startsWord(chain, query))) return 6;
  if ([identity.denom, identity.originDenom].some((denom) => denom?.toLowerCase().includes(query))) return 7;
  return null;
}
