/**
 * The contract of `/api/portfolio`, `/api/portfolio/history`, `/api/prices`,
 * `/api/prices/history`, `/api/markets` and `/api/assets/[key]`, and the
 * narrowing the browser applies to what comes back.
 *
 * The payload left this application one request ago, which is exactly why it
 * is checked (same rule as `lib/interchain/wire.ts`): a proxy, a stale deploy
 * or an offline service worker can put something else on the wire, and a
 * component that renders a half-typed row shows "undefined" where an amount
 * should be. A row that does not narrow is dropped; a response that does not
 * narrow is `null`, which `useApi` reports as a parse failure — never as a
 * wallet holding nothing.
 *
 * Client-safe: types and pure functions only.
 */

import type {
  FiatCurrency,
  PricePoint,
  PriceRange,
  PriceSource,
  SpotPrice,
  TokenIdentity,
  TokenKind,
  TokenProvenance,
} from "./types";

/* -------------------------------------------------------------------------- *
 * Shared
 * -------------------------------------------------------------------------- */

/** A part of a read that failed while the rest answered (partial data beats no data). */
export interface UpstreamIssue {
  chainId?: string;
  /** What failed: "bank", "delegations", "rewards", "unbonding", "prices:numia", "history:<key>"… */
  scope: string;
  message: string;
}

/** Set when the requested currency could not be served and the numbers are in USD. */
export interface CurrencyFallback {
  requested: FiatCurrency;
  reason: string;
}

/** Why an asset shows "—" instead of a value. */
export type UnpricedReason =
  /** Decimals unknown: the amount cannot be scaled, so it is never valued. */
  | "decimals-unknown"
  /** Held on a testnet: no market. */
  | "testnet"
  /** Origin not proven (unknown voucher, unlisted token, non-canonical route). */
  | "unproven"
  /** No source quotes it. */
  | "no-market"
  /** A source that would quote it could not be read just now. */
  | "source-unavailable";

export const UNPRICED_TEXT: Readonly<Record<UnpricedReason, string>> = {
  "decimals-unknown": "Decimals unknown, so the amount cannot be valued",
  testnet: "Testnet token: no market",
  unproven: "Origin not proven, so it is not priced as the asset it claims to be",
  "no-market": "No market quotes this token",
  "source-unavailable": "Price source unreachable right now",
};

/* -------------------------------------------------------------------------- *
 * /api/portfolio
 * -------------------------------------------------------------------------- */

/** Base-unit integer strings. */
export interface PortfolioAmounts {
  liquid: string;
  staked: string;
  rewards: string;
  unbonding: string;
}

export interface PortfolioAsset {
  identity: TokenIdentity;
  /** Chain the asset is held on (= identity.chainId). */
  chainId: string;
  amounts: PortfolioAmounts;
  /** Whole units across the four buckets; null when decimals are unknown. */
  total: number | null;
  price: SpotPrice | null;
  /** total × price; null when unpriced. */
  value: number | null;
  /** Value change over 24 h at today's amount; null without a 24 h change. */
  change24hAbs: number | null;
  /** Set when `price` is null. */
  unpriced?: UnpricedReason;
}

export interface PortfolioChain {
  chainId: string;
  chainName: string;
  iconUrl: string | null;
  address: string;
  status: "ok" | "error";
  /** Why the chain could not be read (status "error"). */
  error?: string;
  /** Priced value held on this chain; null when the read failed or nothing held could be priced. */
  value: number | null;
  /** Priced value per bucket; null exactly when `value` is. */
  liquid: number | null;
  staked: number | null;
  rewards: number | null;
  unbonding: number | null;
  change24hAbs: number | null;
  /** Assets with a non-zero amount on this chain. */
  assetCount: number;
  /** The chain's staking ticker under the identity rule ("ATOM", "SAF"). */
  nativeSymbol: string;
}

export interface PortfolioTotals {
  /** Net worth of what could be priced; null when assets are held but none could be priced. */
  value: number | null;
  liquid: number;
  staked: number;
  rewards: number;
  unbonding: number;
  /** Σ value × c / (100 + c) over priced assets with a known 24 h change c (today's holdings). */
  change24hAbs: number | null;
  /** change24hAbs over the 24-h-ago value of those same assets, in percent. */
  change24hPct: number | null;
  /** The same over 7 days, from each price's 7 d change (CoinGecko quotes have none: left out). */
  change7dAbs: number | null;
  change7dPct: number | null;
  /** Σ value of priced assets (never null). */
  pricedValue: number;
  unpricedAssetCount: number;
  assetCount: number;
  /** Chains read successfully that hold at least one asset. */
  chainCount: number;
}

export interface PortfolioResponse {
  /** The currency every value is in (USD when `currencyFallback` is set). */
  currency: FiatCurrency;
  currencyFallback?: CurrencyFallback;
  updatedAt: number;
  totals: PortfolioTotals;
  chains: PortfolioChain[];
  /** Non-zero holdings, most valuable first, unpriced after priced. */
  assets: PortfolioAsset[];
  errors?: UpstreamIssue[];
}

/* -------------------------------------------------------------------------- *
 * /api/portfolio/history
 * -------------------------------------------------------------------------- */

/** `1D` and `7D` are hourly, longer ranges daily. */
export type PortfolioHistoryRange = "1D" | "7D" | "30D" | "90D" | "1Y";

export const PORTFOLIO_HISTORY_METHOD = "Today's holdings × historical prices";

export interface PortfolioHistoryResponse {
  currency: FiatCurrency;
  currencyFallback?: CurrencyFallback;
  range: PortfolioHistoryRange;
  resolution: "hour" | "day";
  /** Value of today's holdings at each time; the last point is now, at spot prices. */
  points: PricePoint[];
  estimate: true;
  method: string;
  /** A caveat on the method, e.g. "USD price history converted at today's EUR rate". */
  note?: string;
  coverage: {
    /** Share (0–1) of today's priced value whose history is in the curve. */
    pricedValueShare: number;
    /** Asset keys left out of the curve (no history, or beyond the charted set). */
    missing: string[];
    /** Assets whose history starts inside the range; held flat at their first price before `from`. */
    partial: { key: string; symbol: string; from: number }[];
  };
  updatedAt: number;
  errors?: UpstreamIssue[];
}

/* -------------------------------------------------------------------------- *
 * /api/prices and /api/prices/history
 * -------------------------------------------------------------------------- */

export interface PricesResponse {
  currency: FiatCurrency;
  currencyFallback?: CurrencyFallback;
  updatedAt: number;
  /** By requested asset key; null when unpriced (`unpriced` says why). */
  prices: Record<string, SpotPrice | null>;
  unpriced: Record<string, UnpricedReason>;
  errors?: UpstreamIssue[];
}

export interface PriceHistoryCoverage {
  /** First and last point, epoch ms; null when empty. */
  from: number | null;
  to: number | null;
  points: number;
  /** The history reaches back to the start of the range. */
  complete: boolean;
}

export interface PriceHistoryResponse {
  key: string;
  range: PriceRange;
  currency: FiatCurrency;
  currencyFallback?: CurrencyFallback;
  resolution: "hour" | "day";
  points: PricePoint[];
  source: PriceSource | null;
  /** "Numia · Osmosis", "Coinstore SAF/USDT", "CoinGecko". */
  label: string | null;
  coverage: PriceHistoryCoverage;
  updatedAt: number;
  errors?: UpstreamIssue[];
}

/* -------------------------------------------------------------------------- *
 * /api/markets and /api/assets/[key]
 * -------------------------------------------------------------------------- */

export interface MarketSourceStatus {
  id: PriceSource;
  label: string;
  url: string;
  ok: boolean;
  /** Epoch ms of the data served; null when unread. */
  at: number | null;
}

export interface MarketAsset {
  /** Asset key (see TokenIdentity.key): links to /assets/[key]. */
  key: string;
  symbol: string;
  name: string;
  logoUrl?: string;
  price: number;
  change24h: number | null;
  change7d: number | null;
  /** In the response currency. */
  volume24h: number | null;
  /** Osmosis pool liquidity, in the response currency; null off Osmosis. */
  liquidity: number | null;
  /**
   * CoinGecko's market cap (via Numia), for Cosmos-native assets only. Null
   * for bridged or alloyed representations of an outside asset (USDC.n,
   * allBTC, ETH.axl), whose CoinGecko figure is the outside asset's, so a sum
   * over this list is a Cosmos figure.
   */
  marketCap: number | null;
  /** Hourly closes over 7 days (top 40 by liquidity, and SAF); null otherwise. */
  sparkline7d: number[] | null;
  coinGeckoId?: string;
  osmosisDenom?: string;
  /** Swappable on Osmosis (pool liquidity at or above the listing floor). */
  tradable: boolean;
  /** Home chain (the proven origin), when known. */
  chainId?: string;
  /** False when the token is not in Zunia's verified token table (named by the source only). */
  verified: boolean;
  source: PriceSource;
}

export interface MarketsResponse {
  currency: FiatCurrency;
  currencyFallback?: CurrencyFallback;
  updatedAt: number;
  sources: MarketSourceStatus[];
  /** Most liquid first; SAF (no pool) after the Osmosis-traded assets. */
  assets: MarketAsset[];
  errors?: UpstreamIssue[];
}

export interface AssetMarket {
  price: number | null;
  change24h: number | null;
  change7d: number | null;
  /** On the market `source` names (Osmosis pools for Numia, the exchange for Coinstore). */
  volume24h: number | null;
  /** Osmosis pool liquidity; null off Osmosis. */
  liquidity: number | null;
  /** CoinGecko's market cap (relayed by Numia, else read directly); Cosmos-native assets only. */
  marketCap: number | null;
  source: PriceSource | null;
  label: string | null;
  url?: string;
  /**
   * Set when the figures are an Osmosis denom's own market for a token the
   * identity rules do not prove (an unknown voucher, an unlisted local
   * token): how Osmosis lists it. The UI says "unverified" next to it; the
   * price is that denom's own, never the asset its symbol claims to be.
   */
  listedAs?: { symbol: string; name: string };
}

/**
 * Supply and all-time figures from CoinGecko, in the response currency, for
 * an asset whose CoinGecko id describes this very token (not for USDC.n or
 * allBTC, whose id is the outside asset's).
 */
export interface AssetStats {
  marketCap: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  /** 24 h volume across every venue CoinGecko tracks (not only Osmosis). */
  volume24h: number | null;
  ath: number | null;
  /** Percent from the all-time high to now (negative below it). */
  athChangePct: number | null;
  athAt: number | null;
  source: "coingecko";
  label: string;
  url: string;
  /** Epoch ms of the answer. */
  at: number;
}

export interface AssetDetailResponse {
  /** The canonical key (a location key of a proven voucher resolves to its origin key). */
  key: string;
  identity: TokenIdentity | null;
  currency: FiatCurrency;
  currencyFallback?: CurrencyFallback;
  market: AssetMarket;
  /** Null when the asset has no CoinGecko id of its own, or CoinGecko did not answer (see `errors`). */
  stats: AssetStats | null;
  /** Daily closes over 30 days, then the newest price, in the response currency. */
  history30d: PricePoint[];
  historySource: string | null;
  /** Chains the verified token table knows this asset to be held on. */
  holdersChains?: string[];
  updatedAt: number;
  errors?: UpstreamIssue[];
}

/* -------------------------------------------------------------------------- *
 * Narrowing
 * -------------------------------------------------------------------------- */

type Fields = Record<string, unknown>;

function record(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function base(value: unknown): string {
  return typeof value === "string" && /^\d+$/.test(value) ? value : "0";
}

const CURRENCIES: readonly FiatCurrency[] = ["usd", "eur", "gbp"];
const SOURCES: readonly PriceSource[] = ["numia", "coingecko", "coinstore", "osmosis-sqs"];
const KINDS: readonly TokenKind[] = ["native", "ibc", "factory", "cw20", "erc20", "peggy", "other"];
const PROVENANCES: readonly TokenProvenance[] = ["native", "catalog", "table", "channel-walk", "unknown"];
const REASONS: readonly UnpricedReason[] = ["decimals-unknown", "testnet", "unproven", "no-market", "source-unavailable"];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function currencyOf(value: unknown): FiatCurrency | null {
  return oneOf(value, CURRENCIES);
}

function fallbackOf(value: unknown): CurrencyFallback | undefined {
  const row = record(value);
  const requested = currencyOf(row?.requested);
  const reason = str(row?.reason);
  return requested && reason ? { requested, reason } : undefined;
}

function issuesOf(value: unknown): UpstreamIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: UpstreamIssue[] = [];
  for (const raw of value) {
    const row = record(raw);
    const scope = str(row?.scope);
    const message = str(row?.message);
    if (!scope || !message) continue;
    const chainId = str(row?.chainId);
    out.push(chainId ? { chainId, scope, message } : { scope, message });
  }
  return out;
}

export function readPoints(value: unknown): PricePoint[] {
  if (!Array.isArray(value)) return [];
  const out: PricePoint[] = [];
  for (const raw of value) {
    const row = record(raw);
    const t = num(row?.t);
    const v = num(row?.v);
    if (t !== null && v !== null) out.push({ t, v });
  }
  return out;
}

/** A token identity from a payload; null when the fields a row renders are missing. */
export function readIdentity(value: unknown): TokenIdentity | null {
  const row = record(value);
  const key = str(row?.key);
  const chainId = str(row?.chainId);
  const denom = str(row?.denom);
  const ticker = str(row?.ticker);
  const name = str(row?.name);
  const kind = oneOf(row?.kind, KINDS);
  const provenance = oneOf(row?.provenance, PROVENANCES);
  if (!row || !key || !chainId || !denom || !ticker || !name || !kind || !provenance) return null;
  const decimals = num(row.decimals);
  const identity: TokenIdentity = {
    key,
    chainId,
    denom,
    kind,
    ticker,
    name,
    decimals: decimals !== null && Number.isInteger(decimals) && decimals >= 0 ? decimals : null,
    provenance,
    proven: row.proven === true,
  };
  const optional = ["logoUrl", "originChainId", "originDenom", "coinGeckoId", "osmosisDenom", "chainName", "originChainName", "family", "path", "bridge"] as const;
  for (const field of optional) {
    const v = str(row[field]);
    if (v) identity[field] = v;
  }
  if (typeof row.testnet === "boolean") identity.testnet = row.testnet;
  if (typeof row.alloyed === "boolean") identity.alloyed = row.alloyed;
  if (typeof row.listed === "boolean") identity.listed = row.listed;
  if (Array.isArray(row.aliases)) identity.aliases = row.aliases.filter((a): a is string => typeof a === "string");
  return identity;
}

export function readSpot(value: unknown): SpotPrice | null {
  const row = record(value);
  const price = num(row?.price);
  const source = oneOf(row?.source, SOURCES);
  const at = num(row?.at);
  if (price === null || !source || at === null) return null;
  const spot: SpotPrice = { price, change24h: num(row?.change24h), source, at };
  if (row && "change7d" in row) spot.change7d = num(row.change7d);
  const label = str(row?.label);
  const url = str(row?.url);
  if (label) spot.label = label;
  if (url) spot.url = url;
  return spot;
}

function readAsset(value: unknown): PortfolioAsset | null {
  const row = record(value);
  const identity = readIdentity(row?.identity);
  const chainId = str(row?.chainId);
  const amounts = record(row?.amounts);
  if (!row || !identity || !chainId || !amounts) return null;
  const asset: PortfolioAsset = {
    identity,
    chainId,
    amounts: {
      liquid: base(amounts.liquid),
      staked: base(amounts.staked),
      rewards: base(amounts.rewards),
      unbonding: base(amounts.unbonding),
    },
    total: num(row.total),
    price: readSpot(row.price),
    value: num(row.value),
    change24hAbs: num(row.change24hAbs),
  };
  const reason = oneOf(row.unpriced, REASONS);
  if (reason) asset.unpriced = reason;
  return asset;
}

function readChain(value: unknown): PortfolioChain | null {
  const row = record(value);
  const chainId = str(row?.chainId);
  const status = row?.status === "ok" || row?.status === "error" ? row.status : null;
  if (!row || !chainId || !status) return null;
  const chain: PortfolioChain = {
    chainId,
    chainName: str(row.chainName) ?? chainId,
    iconUrl: str(row.iconUrl),
    address: str(row.address) ?? "",
    status,
    value: num(row.value),
    liquid: num(row.liquid),
    staked: num(row.staked),
    rewards: num(row.rewards),
    unbonding: num(row.unbonding),
    change24hAbs: num(row.change24hAbs),
    assetCount: num(row.assetCount) ?? 0,
    nativeSymbol: str(row.nativeSymbol) ?? "",
  };
  const error = str(row.error);
  if (error) chain.error = error;
  return chain;
}

export function readPortfolioResponse(raw: unknown): PortfolioResponse | null {
  const root = record(raw);
  const currency = currencyOf(root?.currency);
  const totals = record(root?.totals);
  const updatedAt = num(root?.updatedAt);
  if (!root || !currency || !totals || updatedAt === null || !Array.isArray(root.chains) || !Array.isArray(root.assets)) {
    return null;
  }
  const pricedValue = num(totals.pricedValue);
  if (pricedValue === null) return null;
  const response: PortfolioResponse = {
    currency,
    updatedAt,
    totals: {
      value: num(totals.value),
      liquid: num(totals.liquid) ?? 0,
      staked: num(totals.staked) ?? 0,
      rewards: num(totals.rewards) ?? 0,
      unbonding: num(totals.unbonding) ?? 0,
      change24hAbs: num(totals.change24hAbs),
      change24hPct: num(totals.change24hPct),
      change7dAbs: num(totals.change7dAbs),
      change7dPct: num(totals.change7dPct),
      pricedValue,
      unpricedAssetCount: num(totals.unpricedAssetCount) ?? 0,
      assetCount: num(totals.assetCount) ?? 0,
      chainCount: num(totals.chainCount) ?? 0,
    },
    chains: root.chains.map(readChain).filter((row): row is PortfolioChain => row !== null),
    assets: root.assets.map(readAsset).filter((row): row is PortfolioAsset => row !== null),
  };
  const fallback = fallbackOf(root.currencyFallback);
  if (fallback) response.currencyFallback = fallback;
  const errors = issuesOf(root.errors);
  if (errors && errors.length > 0) response.errors = errors;
  return response;
}

const HISTORY_RANGES: readonly PortfolioHistoryRange[] = ["1D", "7D", "30D", "90D", "1Y"];

export function readPortfolioHistoryResponse(raw: unknown): PortfolioHistoryResponse | null {
  const root = record(raw);
  const currency = currencyOf(root?.currency);
  const range = oneOf(root?.range, HISTORY_RANGES);
  const coverage = record(root?.coverage);
  const updatedAt = num(root?.updatedAt);
  if (!root || !currency || !range || !coverage || updatedAt === null || !Array.isArray(root.points)) return null;
  const partial: PortfolioHistoryResponse["coverage"]["partial"] = [];
  if (Array.isArray(coverage.partial)) {
    for (const rawRow of coverage.partial) {
      const row = record(rawRow);
      const key = str(row?.key);
      const from = num(row?.from);
      if (key && from !== null) partial.push({ key, symbol: str(row?.symbol) ?? key, from });
    }
  }
  const response: PortfolioHistoryResponse = {
    currency,
    range,
    resolution: root.resolution === "hour" ? "hour" : "day",
    points: readPoints(root.points),
    estimate: true,
    method: str(root.method) ?? PORTFOLIO_HISTORY_METHOD,
    coverage: {
      pricedValueShare: num(coverage.pricedValueShare) ?? 0,
      missing: Array.isArray(coverage.missing) ? coverage.missing.filter((k): k is string => typeof k === "string") : [],
      partial,
    },
    updatedAt,
  };
  const note = str(root.note);
  if (note) response.note = note;
  const fallback = fallbackOf(root.currencyFallback);
  if (fallback) response.currencyFallback = fallback;
  const errors = issuesOf(root.errors);
  if (errors && errors.length > 0) response.errors = errors;
  return response;
}

const PRICE_RANGES: readonly PriceRange[] = ["1D", "7D", "30D", "90D", "1Y"];

export function readPriceHistoryResponse(raw: unknown): PriceHistoryResponse | null {
  const root = record(raw);
  const key = str(root?.key);
  const range = oneOf(root?.range, PRICE_RANGES);
  const currency = currencyOf(root?.currency);
  const coverage = record(root?.coverage);
  const updatedAt = num(root?.updatedAt);
  if (!root || !key || !range || !currency || !coverage || updatedAt === null) return null;
  const response: PriceHistoryResponse = {
    key,
    range,
    currency,
    resolution: root.resolution === "hour" ? "hour" : "day",
    points: readPoints(root.points),
    source: oneOf(root.source, SOURCES),
    label: str(root.label),
    coverage: {
      from: num(coverage.from),
      to: num(coverage.to),
      points: num(coverage.points) ?? 0,
      complete: coverage.complete === true,
    },
    updatedAt,
  };
  const fallback = fallbackOf(root.currencyFallback);
  if (fallback) response.currencyFallback = fallback;
  const errors = issuesOf(root.errors);
  if (errors && errors.length > 0) response.errors = errors;
  return response;
}

export function readPricesResponse(raw: unknown): PricesResponse | null {
  const root = record(raw);
  const currency = currencyOf(root?.currency);
  const prices = record(root?.prices);
  const updatedAt = num(root?.updatedAt);
  if (!root || !currency || !prices || updatedAt === null) return null;
  const out: PricesResponse = { currency, updatedAt, prices: {}, unpriced: {} };
  for (const [key, value] of Object.entries(prices)) out.prices[key] = readSpot(value);
  const unpriced = record(root.unpriced);
  for (const [key, value] of Object.entries(unpriced ?? {})) {
    const reason = oneOf(value, REASONS);
    if (reason) out.unpriced[key] = reason;
  }
  const fallback = fallbackOf(root.currencyFallback);
  if (fallback) out.currencyFallback = fallback;
  const errors = issuesOf(root.errors);
  if (errors && errors.length > 0) out.errors = errors;
  return out;
}

function readMarketAsset(value: unknown): MarketAsset | null {
  const row = record(value);
  const key = str(row?.key);
  const symbol = str(row?.symbol);
  const price = num(row?.price);
  const source = oneOf(row?.source, SOURCES);
  if (!row || !key || !symbol || price === null || !source) return null;
  const asset: MarketAsset = {
    key,
    symbol,
    name: str(row.name) ?? symbol,
    price,
    change24h: num(row.change24h),
    change7d: num(row.change7d),
    volume24h: num(row.volume24h),
    liquidity: num(row.liquidity),
    marketCap: num(row.marketCap),
    sparkline7d: Array.isArray(row.sparkline7d)
      ? row.sparkline7d.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      : null,
    tradable: row.tradable === true,
    verified: row.verified === true,
    source,
  };
  const optional = ["logoUrl", "coinGeckoId", "osmosisDenom", "chainId"] as const;
  for (const field of optional) {
    const v = str(row[field]);
    if (v) asset[field] = v;
  }
  return asset;
}

export function readMarketsResponse(raw: unknown): MarketsResponse | null {
  const root = record(raw);
  const currency = currencyOf(root?.currency);
  const updatedAt = num(root?.updatedAt);
  if (!root || !currency || updatedAt === null || !Array.isArray(root.assets)) return null;
  const sources: MarketSourceStatus[] = [];
  for (const rawSource of Array.isArray(root.sources) ? root.sources : []) {
    const row = record(rawSource);
    const id = oneOf(row?.id, SOURCES);
    if (!row || !id) continue;
    sources.push({ id, label: str(row.label) ?? id, url: str(row.url) ?? "", ok: row.ok === true, at: num(row.at) });
  }
  const response: MarketsResponse = {
    currency,
    updatedAt,
    sources,
    assets: root.assets.map(readMarketAsset).filter((row): row is MarketAsset => row !== null),
  };
  const fallback = fallbackOf(root.currencyFallback);
  if (fallback) response.currencyFallback = fallback;
  const errors = issuesOf(root.errors);
  if (errors && errors.length > 0) response.errors = errors;
  return response;
}

function readStats(value: unknown): AssetStats | null {
  const row = record(value);
  const at = num(row?.at);
  if (!row || row.source !== "coingecko" || at === null) return null;
  return {
    marketCap: num(row.marketCap),
    circulatingSupply: num(row.circulatingSupply),
    totalSupply: num(row.totalSupply),
    volume24h: num(row.volume24h),
    ath: num(row.ath),
    athChangePct: num(row.athChangePct),
    athAt: num(row.athAt),
    source: "coingecko",
    label: str(row.label) ?? "CoinGecko",
    url: str(row.url) ?? "",
    at,
  };
}

export function readAssetDetailResponse(raw: unknown): AssetDetailResponse | null {
  const root = record(raw);
  const key = str(root?.key);
  const currency = currencyOf(root?.currency);
  const market = record(root?.market);
  const updatedAt = num(root?.updatedAt);
  if (!root || !key || !currency || !market || updatedAt === null) return null;
  const response: AssetDetailResponse = {
    key,
    identity: readIdentity(root.identity),
    currency,
    market: {
      price: num(market.price),
      change24h: num(market.change24h),
      change7d: num(market.change7d),
      volume24h: num(market.volume24h),
      liquidity: num(market.liquidity),
      marketCap: num(market.marketCap),
      source: oneOf(market.source, SOURCES),
      label: str(market.label),
    },
    stats: readStats(root.stats),
    history30d: readPoints(root.history30d),
    historySource: str(root.historySource),
    updatedAt,
  };
  const url = str(market.url);
  if (url) response.market.url = url;
  const listedAs = record(market.listedAs);
  const listedSymbol = str(listedAs?.symbol);
  if (listedSymbol) response.market.listedAs = { symbol: listedSymbol, name: str(listedAs?.name) ?? listedSymbol };
  if (Array.isArray(root.holdersChains)) {
    response.holdersChains = root.holdersChains.filter((c): c is string => typeof c === "string");
  }
  const fallback = fallbackOf(root.currencyFallback);
  if (fallback) response.currencyFallback = fallback;
  const errors = issuesOf(root.errors);
  if (errors && errors.length > 0) response.errors = errors;
  return response;
}
