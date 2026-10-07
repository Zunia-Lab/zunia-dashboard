/**
 * What Compare knows about each entity it can show: a chain (whose coin
 * stands in for it on price rows) or an asset from the markets feed (which
 * also gets its chain's staking figures when it is what that chain stakes,
 * e.g. ATOM ↔ Cosmos Hub). Pure: built from the client catalog and the
 * markets answer.
 */

import { CHAINS, type ChainEntry } from "@/lib/chains";
import type { MarketAsset } from "@/lib/token/wire";
import { nativeAssetKey } from "@/components/chains/model";
import { refKey, type EntityRef } from "./model";

export interface Entity {
  ref: EntityRef;
  /** `refKey(ref)`: the stable id for colours, React keys and the URL. */
  id: string;
  /** "Cosmos Hub", "Noble USDC". */
  name: string;
  /** Ticker used on price rows and in the chart: "ATOM", "USDC.n". */
  ticker: string;
  /** Second line: the chain id, or the asset's chain. */
  sub: string;
  logo?: string;
  /** Asset key the price history is read with; null when nothing can be priced. */
  priceKey: string | null;
  /**
   * The chain whose staking figures may apply: the chain itself, or the
   * chain this asset is the catalog coin of. For an asset the page still
   * checks the chain's staking denom once its stats arrive (a chain's coin
   * is not always what it stakes).
   */
  stakingChain: ChainEntry | null;
  market: MarketAsset | null;
  /** Its own page in the dashboard. */
  href: string;
}

let nativeIndex: Map<string, ChainEntry> | null = null;

/** The chain whose staking token has this asset key (`cosmoshub-4:uatom` → Cosmos Hub). */
export function chainOfNativeKey(key: string): ChainEntry | null {
  if (!nativeIndex) nativeIndex = new Map(CHAINS.map((chain) => [nativeAssetKey(chain), chain]));
  return nativeIndex.get(key) ?? null;
}

const chainIndex = new Map(CHAINS.map((chain) => [chain.chainId, chain]));

export function resolveEntity(ref: EntityRef, marketByKey: ReadonlyMap<string, MarketAsset>): Entity | null {
  if (ref.kind === "chain") {
    const chain = chainIndex.get(ref.id);
    if (!chain) return null;
    const priceKey = chain.network === "mainnet" ? nativeAssetKey(chain) : null;
    return {
      ref,
      id: refKey(ref),
      name: chain.chainName,
      ticker: chain.coinDenom,
      sub: chain.chainId,
      logo: chain.iconUrl,
      priceKey,
      stakingChain: chain,
      market: priceKey ? (marketByKey.get(priceKey) ?? null) : null,
      href: `/chains/${encodeURIComponent(chain.chainId)}`,
    };
  }
  const market = marketByKey.get(ref.id) ?? null;
  const native = chainOfNativeKey(ref.id);
  const tail = ref.id.slice(ref.id.lastIndexOf(":") + 1);
  return {
    ref,
    id: refKey(ref),
    name: market?.name ?? (native ? `${native.chainName} ${native.coinDenom}` : tail),
    ticker: market?.symbol ?? native?.coinDenom ?? tail.slice(0, 12),
    // "Native to", not "staking token of": a chain's coin is not always what it stakes (Noble: USDC vs ustake).
    sub: native ? `Native to ${native.chainName}` : (market?.chainId ? (chainIndex.get(market.chainId)?.chainName ?? market.chainId) : "Asset"),
    logo: market?.logoUrl ?? native?.iconUrl,
    priceKey: ref.id,
    stakingChain: native,
    market,
    href: `/assets/${encodeURIComponent(ref.id)}`,
  };
}
