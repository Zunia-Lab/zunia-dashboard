/**
 * Where an asset's actions go, with the asset prefilled.
 *
 * One spelling for every page that links to an action, so Send, Swap,
 * Bridge and Staking parse a single shape: a holding is
 * `<chainId>:<exact denom>` (the row key the swap engine and the swap intent
 * already use), URL-encoded as a query value. The asset page itself is keyed
 * by the identity key (`TokenIdentity.key`), path-encoded.
 *
 * Pure: no React, no I/O.
 */

import type { TokenIdentity } from "@/lib/token/types";

/** A holding as the action pages read it: `<chainId>:<denom>`. */
export function holdingKey(chainId: string, denom: string): string {
  return `${chainId}:${denom}`;
}

/** `/assets/<identity key>`: the asset page (market part public, position with a wallet). */
export function assetHref(key: string): string {
  return `/assets/${encodeURIComponent(key)}`;
}

/** Send this holding from its chain. */
export function sendHref(chainId: string, denom: string): string {
  return `/send?asset=${encodeURIComponent(holdingKey(chainId, denom))}`;
}

/** Sell this holding on the Swap page (its documented `from` deep link). */
export function swapFromHref(chainId: string, denom: string): string {
  return `/swap?from=${encodeURIComponent(holdingKey(chainId, denom))}`;
}

/** Buy this asset on the Swap page (`to` = the asset's home holding key). */
export function swapToHref(key: string): string {
  return `/swap?to=${encodeURIComponent(key)}`;
}

/** Move this holding to another chain over IBC. */
export function bridgeHref(chainId: string, denom: string): string {
  return `/bridge?asset=${encodeURIComponent(holdingKey(chainId, denom))}&from=${encodeURIComponent(chainId)}`;
}

/** Delegate this chain's staking coin. */
export function stakeHref(chainId: string): string {
  return `/staking?action=delegate&chain=${encodeURIComponent(chainId)}`;
}

/**
 * A chain's bond denom as its staking module reports it (chain stats), or
 * nothing while unknown. The catalog's main coin is not a safe guess: Noble's
 * is USDC, its staking token is `ustake`.
 */
export type BondDenomOf = (chainId: string) => string | undefined;

/**
 * The chain's own staking coin, held on that chain: the only holding a
 * "Stake" action makes sense for (an IBC voucher of ATOM on Osmosis cannot
 * be delegated on Osmosis). Unknown bond denom: not offered.
 */
export function isStakingCoin(identity: Pick<TokenIdentity, "kind" | "chainId" | "denom">, bondDenomOf: BondDenomOf): boolean {
  if (identity.kind !== "native") return false;
  return bondDenomOf(identity.chainId) === identity.denom;
}
