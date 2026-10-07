/**
 * What a denom is, for display. Never signed: signing uses the exact denom.
 *
 * Shapes ported from zunia-extension `lib/token-identity.ts` (TokenIdentity),
 * trimmed to what the dashboard renders. Safe to import from client code (types
 * only); the identification tables live in `@/lib/token/identity`, which is
 * server-side by convention because the tables are large.
 *
 * Every field added after the first contract is optional, so a consumer
 * written against the original shape keeps compiling.
 */

export type TokenKind = "native" | "ibc" | "factory" | "cw20" | "erc20" | "peggy" | "other";

export type TokenProvenance = "native" | "catalog" | "table" | "channel-walk" | "unknown";

export interface TokenIdentity {
  /**
   * Stable key for grouping the same asset across chains (origin-based):
   * `${originChainId}:${originDenom}` when the identity is proven, so ATOM on
   * the Hub and ATOM on Osmosis share `cosmoshub-4:uatom`; otherwise the
   * location `${chainId}:${denom}`, so an unproven voucher is never merged
   * with (or priced as) the real asset it claims to be. This is the key the
   * asset pages and `/api/assets/[key]` use.
   */
  key: string;
  /** Chain the denom is held on. */
  chainId: string;
  /** Exact on-chain denom. */
  denom: string;
  kind: TokenKind;
  /** Display ticker, e.g. "USDC.n", "ATOM", "IBC·498A". */
  ticker: string;
  /** Human name, e.g. "Noble USDC", "Unknown token". */
  name: string;
  /** Null when decimals are unknown: amounts must then be shown in base units. */
  decimals: number | null;
  logoUrl?: string;
  originChainId?: string;
  originDenom?: string;
  coinGeckoId?: string;
  /** The denom of this asset on Osmosis, when it trades there. */
  osmosisDenom?: string;
  provenance: TokenProvenance;
  /** True when the identity is proven (hash-verified / canonical channel walk). */
  proven: boolean;
  testnet?: boolean;
  /** Display name of the holding chain ("Osmosis"). */
  chainName?: string;
  /** Display name of the origin chain ("Noble"), when the origin is known. */
  originChainName?: string;
  /** The asset without issuer decorations: "USDC" for USDC.n and USDC.axl. */
  family?: string;
  /** IBC trace path on the holding chain ("transfer/channel-750"); absent for a local denom. */
  path?: string;
  /** Bridge that carried it into Cosmos, as its ticker tag ("axl", "wh", "eureka"…). */
  bridge?: string;
  /** An Osmosis alloy (transmuter share), ticker `all` + family. */
  alloyed?: boolean;
  /**
   * Something names it: the chain's own coin, a catalog currency, a table row
   * or a known bridge contract. False for an unknown voucher and for a local
   * token nobody lists (anyone's `factory/<self>/USDC.n`), which the UI must
   * call "Unlisted", never "Native".
   */
  listed?: boolean;
  /** Other names users have seen ("USDC.noble", "axlUSDC"), for search. */
  aliases?: string[];
}

export interface PricePoint {
  /** Epoch milliseconds. */
  t: number;
  v: number;
}

export type PriceSource = "numia" | "coingecko" | "coinstore" | "osmosis-sqs";

export interface SpotPrice {
  price: number;
  /** Percent, e.g. -3.2 for -3.2 %. Null when the source has none. */
  change24h: number | null;
  change7d?: number | null;
  source: PriceSource;
  /** Epoch ms of the read. */
  at: number;
  /** Where the number comes from, as the UI shows it ("Coinstore SAF/USDT", "Numia · Osmosis"). */
  label?: string;
  /** The market page behind `label`, when there is one. */
  url?: string;
}

/** Fiat currencies the dashboard answers in. USD is native; the others go through one FX rate. */
export type FiatCurrency = "usd" | "eur" | "gbp";

/** Ranges a price chart offers. `1D` and `7D` are hourly; longer ranges are daily. */
export type PriceRange = "1D" | "7D" | "30D" | "90D" | "1Y";
