/**
 * One row per asset across chains, from `/api/portfolio`'s per-chain rows.
 *
 * The API answers one row per denom per chain (ATOM on the Hub and ATOM on
 * Osmosis are two rows) because that is what can be sent, swapped or staked.
 * Allocation by asset, "top assets", the Assets page's "By asset" grouping and
 * concentration (HHI) need the asset instead, so they group by
 * `identity.key`: proven vouchers share their origin's key, while an
 * unproven voucher keeps its own location key and is never merged with the
 * asset it claims to be.
 *
 * Client-safe and pure (types and arithmetic only), so it is tested.
 */

import type { SpotPrice, TokenIdentity } from "./types";
import type { PortfolioAsset, UnpricedReason } from "./wire";

export interface AssetGroup {
  /** The asset key shared by every row (`identity.key`). */
  key: string;
  /** The identity to name the group by: the origin chain's own row when held there, else the most valuable row's. */
  identity: TokenIdentity;
  /** The per-chain rows, most valuable first (unpriced last). */
  rows: PortfolioAsset[];
  /** Whole units across chains; null when a row's decimals are unknown (amounts cannot be added). */
  total: number | null;
  /** Σ of the rows' values; null when no row could be priced. */
  value: number | null;
  /** The price every priced row shares (one asset, one price); null when unpriced. */
  price: SpotPrice | null;
  /** Σ of the rows' 24 h value changes; null when none is known. */
  change24hAbs: number | null;
  /** Why the group has no value, when it has none. */
  unpriced?: UnpricedReason;
  /** Chains the asset is held on, in row order. */
  chainIds: string[];
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  let known = false;
  let sum = 0;
  for (const value of values) {
    if (value === null) continue;
    known = true;
    sum += value;
  }
  return known ? sum : null;
}

/**
 * Groups rows by asset key, most valuable first, unpriced groups last (by
 * ticker). Order inside a group follows the API's order (value, then ticker).
 */
export function groupAssets(assets: readonly PortfolioAsset[]): AssetGroup[] {
  const byKey = new Map<string, PortfolioAsset[]>();
  for (const asset of assets) {
    const rows = byKey.get(asset.identity.key);
    if (rows) rows.push(asset);
    else byKey.set(asset.identity.key, [asset]);
  }
  const groups: AssetGroup[] = [];
  for (const [key, rows] of byKey) {
    const first = rows[0] as PortfolioAsset;
    const home = rows.find((row) => row.identity.originChainId === row.chainId) ?? first;
    const value = sumOrNull(rows.map((row) => row.value));
    const group: AssetGroup = {
      key,
      identity: home.identity,
      rows,
      total: rows.some((row) => row.total === null) ? null : rows.reduce((sum, row) => sum + (row.total ?? 0), 0),
      value,
      price: rows.find((row) => row.price !== null)?.price ?? null,
      change24hAbs: sumOrNull(rows.map((row) => row.change24hAbs)),
      chainIds: [...new Set(rows.map((row) => row.chainId))],
    };
    if (value === null) {
      const reason = rows.find((row) => row.unpriced)?.unpriced;
      if (reason) group.unpriced = reason;
    }
    groups.push(group);
  }
  return groups.sort((a, b) => {
    if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
    if (a.value !== null && b.value === null) return -1;
    if (a.value === null && b.value !== null) return 1;
    return a.identity.ticker.localeCompare(b.identity.ticker);
  });
}
