/**
 * The words for a token identity, for client components.
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

/** Everything a search should match: ticker, family, aliases, names, chains, denoms. */
export function tokenKeywords(identity: TokenIdentity): string[] {
  const words = [
    identity.ticker,
    identity.family ?? "",
    ...(identity.aliases ?? []),
    identity.name,
    identity.originChainName ?? "",
    identity.originChainId ?? "",
    identity.chainName ?? "",
    identity.chainId,
    identity.denom,
    identity.originDenom ?? "",
  ];
  return [...new Set(words.filter((word) => word.length > 0))];
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
