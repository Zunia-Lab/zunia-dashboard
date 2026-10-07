/**
 * How an amount of one denom reads, for history rows, transaction detail and
 * signing summaries, where the denom may be a packet denom
 * (`transfer/channel-141/uosmo`) rather than a bank denom.
 *
 * Ported from zunia-extension lib/coin-display.ts @ 1453e7a. Every name comes
 * from the identity engine; this module only decides which identity a denom
 * from those surfaces refers to. Pure: needs the catalog installed (the app
 * gets it through `./identity`).
 */

import { uniqueIssuerOf } from "./catalog";
import { identityOf, type HeldTokenIdentity } from "./engine";
import { shortDenom } from "./text";

/** How to show an amount of one denom. */
export interface CoinDisplay {
  symbol: string;
  decimals: number;
  /** False when nothing names the denom; amounts are then raw base units. */
  known: boolean;
}

/** `transfer/channel-0/uosmo` is `uosmo` after the hops that carried it. */
export function baseDenomOf(denom: string): string {
  return denom.replace(/^(?:[a-z0-9._-]+\/channel-\d+\/)+/i, "");
}

const named = (identity: HeldTokenIdentity | undefined): identity is HeldTokenIdentity =>
  identity !== undefined && identity.provenance !== "unknown" && identity.decimalsKnown;

/**
 * The identity a denom from a message or a fee refers to on `chainId`.
 *
 * A bank denom (`uatom`, `ibc/…`, `erc20:…`) is the holding chain's own. A
 * packet denom is not: its channel numbers belong to the sender, so mapping
 * them from the receiving chain would name the wrong issuer. Such a denom, and
 * a bare base denom the holding chain does not issue, is named only when
 * exactly one registry chain issues its base; otherwise it stays unknown.
 */
function displayIdentity(chainId: string, denom: string): HeldTokenIdentity | undefined {
  const base = baseDenomOf(denom);
  if (base === denom) {
    const own = identityOf(chainId, denom);
    if (named(own) || denom.startsWith("ibc/")) return own;
  }
  if (base.startsWith("ibc/")) return undefined;
  const issuer = uniqueIssuerOf(base);
  // The exact spelling the message carries, on its issuer: the catalog's own
  // spelling may differ in case (Injective's erc20 rows), and that is another,
  // empty denom.
  return issuer ? identityOf(issuer.entry.chainId, base) : undefined;
}

export function coinDisplay(chainId: string, denom: string): CoinDisplay {
  const identity = displayIdentity(chainId, denom);
  if (named(identity)) {
    return { symbol: identity.ticker, decimals: identity.decimals, known: true };
  }
  return { symbol: shortDenom(denom), decimals: 0, known: false };
}
