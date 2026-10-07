/**
 * The `/api/swap/*` contract: request and response shapes, and the narrowing
 * the browser runs on every answer before it renders or signs anything.
 *
 * Shared by the route handlers (which build these) and src/lib/data/swap.ts
 * (which reads them). Pure; no server-only imports.
 *
 * Conventions (the dashboard API's): every success carries `updatedAt` (epoch
 * ms); a pair that cannot be swapped for a known reason is a 200 with
 * `blocked: {code, message}` (the message is user-facing, sentence case); bad
 * input is a 400 `{error, message}`; the router or the venue unreachable is a
 * 503 `{error, message}`. Amounts are base-unit decimal strings, never
 * numbers. Percentages are numbers on the 0-100 scale. Unknown is `null`, never
 * 0, and every figure that is an estimate says so (`estimate`, `minOutKind`).
 */

import { SWAP_PATHS, type SwapPath } from "@/lib/swap/path";
import { isRecord } from "@/lib/swap/types";
import { tableFromWire, type XcsRouteTable } from "@/lib/swap/xcs";
import type { TokenIdentity } from "@/lib/token/types";

/* -------------------------------------------------------------------------- *
 * POST /api/swap/quote
 * -------------------------------------------------------------------------- */

/** What the browser asks the quote for. */
export interface SwapQuoteRequest {
  readonly fromChainId: string;
  /** Exact bank denom held on `fromChainId`. */
  readonly fromDenom: string;
  readonly toChainId: string;
  /** Exact bank denom wanted on `toChainId`. */
  readonly toDenom: string;
  /**
   * Base units the swap sells: what is left after the Zunia fee
   * (`swapFeeFor(fromChainId, total).net`, src/lib/swap/fee.ts). The fee
   * itself never reaches the venue.
   */
  readonly amount: string;
  /** Tolerance on the 0-100 scale, in (0, 50]. */
  readonly slippagePercent: number;
  /**
   * Optional: the From's denom on Osmosis as the browser's identity rows name
   * it. A hint only: the server proves it on chain (hash-verified trace plus
   * the channel's counterparty) before using it, and refuses a mismatch.
   */
  readonly fromVenueDenom?: string;
  /** Optional: the To's denom on Osmosis, proved the same way. */
  readonly toVenueDenom?: string;
}

/** Why a pair has no signable quote; the `message` is shown as is. */
export type SwapBlockedCode =
  | "testnet"
  | "same-token"
  | "not-traded"
  | "venue-denom-unknown"
  | "variant-mismatch"
  | "no-pool-route"
  | "routes-invalid"
  | "no-floor"
  | "no-contract-route"
  | "route-unreadable"
  | "route-unpriced"
  | "venue-unavailable"
  | "delivery-unavailable"
  | "inbound-unavailable";

export const SWAP_BLOCKED_CODES: readonly SwapBlockedCode[] = [
  "testnet",
  "same-token",
  "not-traded",
  "venue-denom-unknown",
  "variant-mismatch",
  "no-pool-route",
  "routes-invalid",
  "no-floor",
  "no-contract-route",
  "route-unreadable",
  "route-unpriced",
  "venue-unavailable",
  "delivery-unavailable",
  "inbound-unavailable",
];

/** One pool of a route. `spread` and `takerFee` are percentages, absent when the router did not say. */
export interface SwapRoutePool {
  readonly id: string;
  readonly tokenOutDenom: string;
  readonly spread?: number;
  readonly takerFee?: number;
}

/** One split of an order: the input it takes, what it pays, and its pools in order. */
export interface SwapRouteSplit {
  readonly inAmount: string;
  readonly outAmount: string;
  readonly pools: readonly SwapRoutePool[];
}

export interface SwapRouteWire {
  /** The route to draw: the only one, the contract's own, or the largest split. */
  readonly pools: readonly SwapRoutePool[];
  /**
   * Every split, in the router's order: present for the pool paths (one entry
   * for a single route). The poolmanager message is built from exactly these.
   */
  readonly splits?: readonly SwapRouteSplit[];
}

/** The crosschain-swaps contract a contract-path quote was checked against. */
export interface SwapContractWire {
  readonly address: string;
  /** The contract was read off the chain and its label matched. Never true by configuration alone. */
  readonly verified: boolean;
  readonly label: string | null;
  readonly codeId: string | null;
}

/** How the output reaches a To on another chain: one ICS20 hop out of Osmosis. */
export interface SwapDeliveryWire {
  readonly destChainId: string;
  /** Osmosis's end of the channel: what the transfer leaves on. */
  readonly channelId: string;
  readonly port: string;
  /** The denom that arrives on `destChainId`: always exactly the To's denom. */
  readonly arrivalDenom: string;
  /** `unwind`: the token goes home over the channel it came by. `wrap`: an Osmosis token leaves as a voucher. */
  readonly kind: "unwind" | "wrap";
  /** `unconfirmed`: the channel is open but its light client's status could not be read. */
  readonly clientStatus: "active" | "unconfirmed";
}

/** How the funds reach Osmosis on the contract path from another chain: one ICS20 hop in. */
export interface SwapInboundWire {
  readonly sourceChainId: string;
  /** The source chain's end of the channel: what the signed transfer leaves on. */
  readonly channelId: string;
  readonly port: string;
  /** Osmosis's end of the same channel. */
  readonly venueChannelId: string;
  readonly kind: "unwind" | "wrap";
  readonly clientStatus: "active" | "unconfirmed";
}

/** The price part of a quote, shared by a signable quote and a blocked one that could still be priced. */
export interface SwapQuotePrice {
  readonly path: SwapPath;
  /**
   * True when the figures are not what this signature would trade: `move-first`
   * (priced as if the tokens were already on Osmosis). `method` says how.
   */
  readonly estimate: boolean;
  readonly method?: string;
  /** The chain whose account signs: Osmosis for the pool paths, the funds' chain otherwise. */
  readonly signingChainId: string;
  /** Base units sold (the request's `amount`). */
  readonly amountIn: string;
  /** Base units the router says the swap pays today. */
  readonly amountOut: string;
  /**
   * The floor. `exact`: the pool paths' `token_out_min_amount`, a number in
   * the signed message. `twap-estimate`: the contract path's TWAP rule
   * evaluated at today's price; the contract enforces the rule, not this
   * number. `null` when it rounds to nothing.
   */
  readonly minOut: string | null;
  readonly minOutKind: "exact" | "twap-estimate";
  /** Percent; positive is against the user; `null` when the router did not report it. */
  readonly priceImpact: number | null;
  /**
   * Osmosis's taker fee over the order, in percent (SQS `effective_fee`, each
   * split weighted by its share). The pools' own spread factors are NOT in
   * it: they are per pool, as `route…spread`. Label it "Osmosis taker fee",
   * never "total fees". `null` when not reported.
   */
  readonly effectiveFee: number | null;
  /**
   * The pools' spot price before this trade, in display units: how much of the
   * To one whole From is worth (compare with `rate.toPerFrom`, this trade's
   * own). `null` when not reported or when either side's decimals are unknown.
   */
  readonly spotPrice: number | null;
  /** This quote's own rate in display units, both ways; `null` where a side's decimals are unknown. */
  readonly rate: { readonly toPerFrom: string | null; readonly fromPerTo: string | null };
  readonly decimals: { readonly from: number | null; readonly to: number | null };
  readonly route: SwapRouteWire;
  /** What the venue sells and buys, as Osmosis names them. */
  readonly venueInputDenom: string;
  readonly venueOutputDenom: string;
  readonly contract?: SwapContractWire;
  readonly delivery?: SwapDeliveryWire;
  readonly inbound?: SwapInboundWire;
  readonly slippagePercent: number;
  /** The contract path's TWAP window, seconds. */
  readonly twapWindowSeconds?: number;
  /**
   * When the router gave the price (epoch ms). On the wire it is the server's
   * clock; `useSwapQuote` moves it (and `expiresAt`) onto the browser's clock
   * ({@link quoteOnClientClock}), which is the clock every expiry check runs
   * on.
   */
  readonly quotedAt: number;
  /** `quotedAt + QUOTE_TTL_MS`: signing is refused from this instant. */
  readonly expiresAt: number;
  readonly warnings: readonly string[];
}

export interface SwapQuoteOk extends SwapQuotePrice {
  readonly updatedAt: number;
  readonly blocked?: undefined;
}

export interface SwapQuoteBlocked {
  readonly updatedAt: number;
  readonly blocked: { readonly code: SwapBlockedCode; readonly message: string };
  readonly path?: SwapPath;
  /** The price, when one was read before the pair was refused: for display only, never signed. */
  readonly preview?: SwapQuotePrice;
}

export type SwapQuoteResponse = SwapQuoteOk | SwapQuoteBlocked;

/* -------------------------------------------------------------------------- *
 * GET /api/swap/assets
 * -------------------------------------------------------------------------- */

/** A token the swap can deliver: listed on Osmosis (`venue`), or delivered home to its issuer (`home`). */
export interface SwapAsset {
  /** `${chainId}:${denom}`. */
  readonly key: string;
  readonly chainId: string;
  /** Exact bank denom on `chainId`. Signed as is. */
  readonly denom: string;
  readonly identity: TokenIdentity;
  /** The denom Osmosis trades for this asset. */
  readonly osmosisDenom: string;
  /** The identity's exponent, `null` when SQS disagrees with it (amounts then only by Max). */
  readonly decimals: number | null;
  /** SQS's exponent for `osmosisDenom`: the witness every row naming this asset is checked against. */
  readonly listedDecimals: number;
  readonly kind: "venue" | "home";
  /** USD of pool liquidity on Osmosis (SQS `total_liquidity_cap`); `null` when not reported. */
  readonly liquidity: number | null;
  /** USD per whole token on Osmosis (SQS, quoted in alloyed USDC); `null` when not priced. */
  readonly price: number | null;
  readonly tradable: boolean;
  readonly reason?: string;
}

export interface SwapVenueWire {
  readonly chainId: string;
  readonly contract: SwapContractWire | null;
  /** Why the contract path is off, when it is. */
  readonly reason: string | null;
}

export interface SwapAssetsResponse {
  readonly updatedAt: number;
  readonly venue: "osmosis-1";
  readonly network: "mainnet" | "testnet";
  readonly assets: readonly SwapAsset[];
  /** The contract's route table with each denom's proven origin; `null` when it could not be read (gates nothing). */
  readonly routeTable: XcsRouteTable | null;
  readonly contract: SwapVenueWire;
  /**
   * How many tokens SQS lists, and how many of them are offered on Osmosis:
   * proven by token identity, verified and not flagged unstable by Osmosis.
   */
  readonly counts: { readonly listed: number; readonly identified: number };
  readonly priceSource: "osmosis-sqs";
  readonly errors?: readonly { readonly chainId?: string; readonly scope: string; readonly message: string }[];
}

/* -------------------------------------------------------------------------- *
 * GET /api/swap/routes
 * -------------------------------------------------------------------------- */

export interface SwapRoutesResponse {
  readonly updatedAt: number;
  readonly venue: SwapVenueWire;
  readonly table: XcsRouteTable | null;
  readonly summary: { readonly routes: number; readonly denoms: number; readonly readAt: number | null };
  readonly errors?: readonly { readonly scope: string; readonly message: string }[];
}

/* -------------------------------------------------------------------------- *
 * Narrowing (browser side)
 * -------------------------------------------------------------------------- */

const AMOUNT = /^(0|[1-9]\d*)$/;

function str(value: unknown): value is string {
  return typeof value === "string";
}

function numOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function strOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function readPool(raw: unknown): SwapRoutePool | null {
  if (!isRecord(raw) || !str(raw.id) || !/^[1-9]\d*$/.test(raw.id) || !str(raw.tokenOutDenom)) return null;
  if (raw.spread !== undefined && !(typeof raw.spread === "number" && Number.isFinite(raw.spread))) return null;
  if (raw.takerFee !== undefined && !(typeof raw.takerFee === "number" && Number.isFinite(raw.takerFee))) return null;
  return {
    id: raw.id,
    tokenOutDenom: raw.tokenOutDenom,
    ...(raw.spread !== undefined ? { spread: raw.spread as number } : {}),
    ...(raw.takerFee !== undefined ? { takerFee: raw.takerFee as number } : {}),
  };
}

function readPools(raw: unknown): SwapRoutePool[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SwapRoutePool[] = [];
  for (const entry of raw) {
    const pool = readPool(entry);
    if (!pool) return null;
    out.push(pool);
  }
  return out;
}

function readRoute(raw: unknown): SwapRouteWire | null {
  if (!isRecord(raw)) return null;
  const pools = readPools(raw.pools);
  if (!pools) return null;
  if (raw.splits === undefined) return { pools };
  if (!Array.isArray(raw.splits)) return null;
  const splits: SwapRouteSplit[] = [];
  for (const entry of raw.splits) {
    if (!isRecord(entry) || !str(entry.inAmount) || !AMOUNT.test(entry.inAmount)) return null;
    if (!str(entry.outAmount) || !AMOUNT.test(entry.outAmount)) return null;
    const splitPools = readPools(entry.pools);
    if (!splitPools || splitPools.length === 0) return null;
    splits.push({ inAmount: entry.inAmount, outAmount: entry.outAmount, pools: splitPools });
  }
  return { pools, splits };
}

function readClientStatus(value: unknown): value is "active" | "unconfirmed" {
  return value === "active" || value === "unconfirmed";
}

function readPrice(raw: unknown): SwapQuotePrice | null {
  if (!isRecord(raw)) return null;
  const path = raw.path;
  if (!str(path) || !(SWAP_PATHS as readonly string[]).includes(path)) return null;
  if (typeof raw.estimate !== "boolean") return null;
  if (raw.method !== undefined && !str(raw.method)) return null;
  if (!str(raw.signingChainId) || !str(raw.amountIn) || !AMOUNT.test(raw.amountIn)) return null;
  if (!str(raw.amountOut) || !AMOUNT.test(raw.amountOut)) return null;
  if (!(raw.minOut === null || (str(raw.minOut) && AMOUNT.test(raw.minOut)))) return null;
  if (raw.minOutKind !== "exact" && raw.minOutKind !== "twap-estimate") return null;
  if (!numOrNull(raw.priceImpact) || !numOrNull(raw.effectiveFee) || !numOrNull(raw.spotPrice)) return null;
  const rate = raw.rate;
  if (!isRecord(rate) || !strOrNull(rate.toPerFrom) || !strOrNull(rate.fromPerTo)) return null;
  const decimals = raw.decimals;
  if (!isRecord(decimals) || !numOrNull(decimals.from) || !numOrNull(decimals.to)) return null;
  const route = readRoute(raw.route);
  if (!route) return null;
  if (!str(raw.venueInputDenom) || !str(raw.venueOutputDenom)) return null;
  if (typeof raw.slippagePercent !== "number" || !Number.isFinite(raw.slippagePercent)) return null;
  if (typeof raw.quotedAt !== "number" || typeof raw.expiresAt !== "number") return null;
  if (!Array.isArray(raw.warnings) || !raw.warnings.every(str)) return null;

  let contract: SwapContractWire | undefined;
  if (raw.contract !== undefined) {
    const c = raw.contract;
    if (!isRecord(c) || !str(c.address) || typeof c.verified !== "boolean" || !strOrNull(c.label) || !strOrNull(c.codeId)) {
      return null;
    }
    contract = { address: c.address, verified: c.verified, label: c.label, codeId: c.codeId };
  }
  let delivery: SwapDeliveryWire | undefined;
  if (raw.delivery !== undefined) {
    const d = raw.delivery;
    if (
      !isRecord(d) ||
      !str(d.destChainId) ||
      !str(d.channelId) ||
      !str(d.port) ||
      !str(d.arrivalDenom) ||
      (d.kind !== "unwind" && d.kind !== "wrap") ||
      !readClientStatus(d.clientStatus)
    ) {
      return null;
    }
    delivery = {
      destChainId: d.destChainId,
      channelId: d.channelId,
      port: d.port,
      arrivalDenom: d.arrivalDenom,
      kind: d.kind,
      clientStatus: d.clientStatus,
    };
  }
  let inbound: SwapInboundWire | undefined;
  if (raw.inbound !== undefined) {
    const i = raw.inbound;
    if (
      !isRecord(i) ||
      !str(i.sourceChainId) ||
      !str(i.channelId) ||
      !str(i.port) ||
      !str(i.venueChannelId) ||
      (i.kind !== "unwind" && i.kind !== "wrap") ||
      !readClientStatus(i.clientStatus)
    ) {
      return null;
    }
    inbound = {
      sourceChainId: i.sourceChainId,
      channelId: i.channelId,
      port: i.port,
      venueChannelId: i.venueChannelId,
      kind: i.kind,
      clientStatus: i.clientStatus,
    };
  }
  if (raw.twapWindowSeconds !== undefined && !(typeof raw.twapWindowSeconds === "number")) return null;

  return {
    path: path as SwapPath,
    estimate: raw.estimate,
    ...(raw.method !== undefined ? { method: raw.method as string } : {}),
    signingChainId: raw.signingChainId,
    amountIn: raw.amountIn,
    amountOut: raw.amountOut,
    minOut: raw.minOut,
    minOutKind: raw.minOutKind,
    priceImpact: raw.priceImpact,
    effectiveFee: raw.effectiveFee,
    spotPrice: raw.spotPrice,
    rate: { toPerFrom: rate.toPerFrom, fromPerTo: rate.fromPerTo },
    decimals: { from: decimals.from, to: decimals.to },
    route,
    venueInputDenom: raw.venueInputDenom,
    venueOutputDenom: raw.venueOutputDenom,
    ...(contract ? { contract } : {}),
    ...(delivery ? { delivery } : {}),
    ...(inbound ? { inbound } : {}),
    slippagePercent: raw.slippagePercent,
    ...(raw.twapWindowSeconds !== undefined ? { twapWindowSeconds: raw.twapWindowSeconds as number } : {}),
    quotedAt: raw.quotedAt,
    expiresAt: raw.expiresAt,
    warnings: raw.warnings as string[],
  };
}

/** Narrow a `/api/swap/quote` body; `null` for anything that is not one. */
export function readSwapQuoteResponse(raw: unknown): SwapQuoteResponse | null {
  if (!isRecord(raw) || typeof raw.updatedAt !== "number") return null;
  if (raw.blocked !== undefined) {
    const blocked = raw.blocked;
    if (!isRecord(blocked) || !str(blocked.code) || !str(blocked.message)) return null;
    if (!(SWAP_BLOCKED_CODES as readonly string[]).includes(blocked.code)) return null;
    if (raw.path !== undefined && !(str(raw.path) && (SWAP_PATHS as readonly string[]).includes(raw.path))) return null;
    const preview = raw.preview === undefined ? undefined : readPrice(raw.preview);
    if (raw.preview !== undefined && !preview) return null;
    return {
      updatedAt: raw.updatedAt,
      blocked: { code: blocked.code as SwapBlockedCode, message: blocked.message },
      ...(raw.path !== undefined ? { path: raw.path as SwapPath } : {}),
      ...(preview ? { preview } : {}),
    };
  }
  const price = readPrice(raw);
  return price ? { ...price, updatedAt: raw.updatedAt } : null;
}

/**
 * A quote's timestamps moved from the server's clock onto the browser's.
 *
 * The server stamps `quotedAt`/`expiresAt` with its own clock, but the expiry
 * checks (`priceExpired`, the auto-requote, `checkSwapTx`) run on the
 * browser's `Date.now()`. A machine whose clock is ahead by more than 20 s
 * would see every price expired on arrival (and requote in a loop); one that
 * is behind would keep signing a price long dead. Only differences between
 * the server's own stamps are trusted: the price had `expiresAt − updatedAt`
 * left when the server answered, and that is counted from `receivedAt`, the
 * browser's time when the answer arrived (later than the server's answer by
 * the download time only, a few milliseconds). Both spans are clamped to
 * `ttlMs`. A blocked answer's display-only `preview` moves the same way.
 */
export function quoteOnClientClock(response: SwapQuoteResponse, receivedAt: number, ttlMs: number): SwapQuoteResponse {
  const clamp = (value: number) => Math.min(Math.max(value, 0), ttlMs);
  const moved = (price: SwapQuotePrice) => ({
    quotedAt: receivedAt - clamp(response.updatedAt - price.quotedAt),
    expiresAt: receivedAt + clamp(price.expiresAt - response.updatedAt),
  });
  if (response.blocked !== undefined) {
    return response.preview ? { ...response, preview: { ...response.preview, ...moved(response.preview) } } : response;
  }
  return { ...response, ...moved(response) };
}

function readIdentity(raw: unknown): TokenIdentity | null {
  // The identity is display data (never signed); the fields the swap engine
  // reads are checked, the rest pass through as the server sent them.
  if (!isRecord(raw) || !str(raw.key) || !str(raw.chainId) || !str(raw.denom) || !str(raw.ticker)) return null;
  if (!str(raw.kind) || !str(raw.name) || !str(raw.provenance) || typeof raw.proven !== "boolean") return null;
  if (!(raw.decimals === null || (typeof raw.decimals === "number" && Number.isInteger(raw.decimals)))) return null;
  for (const key of ["originChainId", "originDenom", "osmosisDenom", "logoUrl", "coinGeckoId"] as const) {
    if (raw[key] !== undefined && !str(raw[key])) return null;
  }
  return raw as unknown as TokenIdentity;
}

/** Narrow a `/api/swap/assets` body; `null` for anything that is not one. */
export function readSwapAssetsResponse(raw: unknown): SwapAssetsResponse | null {
  if (!isRecord(raw) || typeof raw.updatedAt !== "number" || raw.venue !== "osmosis-1") return null;
  if (raw.network !== "mainnet" && raw.network !== "testnet") return null;
  if (!Array.isArray(raw.assets)) return null;
  const assets: SwapAsset[] = [];
  for (const entry of raw.assets) {
    if (!isRecord(entry) || !str(entry.key) || !str(entry.chainId) || !str(entry.denom) || !str(entry.osmosisDenom)) {
      return null;
    }
    const identity = readIdentity(entry.identity);
    if (!identity) return null;
    if (!(entry.decimals === null || (typeof entry.decimals === "number" && Number.isInteger(entry.decimals)))) return null;
    if (typeof entry.listedDecimals !== "number" || !Number.isInteger(entry.listedDecimals)) return null;
    if (entry.kind !== "venue" && entry.kind !== "home") return null;
    if (!numOrNull(entry.liquidity) || !numOrNull(entry.price) || typeof entry.tradable !== "boolean") return null;
    if (entry.reason !== undefined && !str(entry.reason)) return null;
    assets.push({
      key: entry.key,
      chainId: entry.chainId,
      denom: entry.denom,
      identity,
      osmosisDenom: entry.osmosisDenom,
      decimals: entry.decimals,
      listedDecimals: entry.listedDecimals,
      kind: entry.kind,
      liquidity: entry.liquidity,
      price: entry.price,
      tradable: entry.tradable,
      ...(entry.reason !== undefined ? { reason: entry.reason as string } : {}),
    });
  }
  const routeTable = raw.routeTable === null ? null : tableFromWire(raw.routeTable);
  if (raw.routeTable !== null && !routeTable) return null;
  const contract = readVenue(raw.contract);
  if (!contract) return null;
  const counts = raw.counts;
  if (!isRecord(counts) || typeof counts.listed !== "number" || typeof counts.identified !== "number") return null;
  const errors = readErrors(raw.errors);
  return {
    updatedAt: raw.updatedAt,
    venue: "osmosis-1",
    network: raw.network,
    assets,
    routeTable,
    contract,
    counts: { listed: counts.listed, identified: counts.identified },
    priceSource: "osmosis-sqs",
    ...(errors ? { errors } : {}),
  };
}

/** The `errors` of a partial answer: each `{scope, message, chainId?}` of strings, else dropped. */
function readErrors(raw: unknown): { chainId?: string; scope: string; message: string }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { chainId?: string; scope: string; message: string }[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !str(entry.scope) || !str(entry.message)) continue;
    out.push({
      scope: entry.scope,
      message: entry.message,
      ...(str(entry.chainId) ? { chainId: entry.chainId } : {}),
    });
  }
  return out.length > 0 ? out : null;
}

function readVenue(raw: unknown): SwapVenueWire | null {
  if (!isRecord(raw) || !str(raw.chainId) || !strOrNull(raw.reason)) return null;
  if (raw.contract === null) return { chainId: raw.chainId, contract: null, reason: raw.reason };
  const c = raw.contract;
  if (!isRecord(c) || !str(c.address) || typeof c.verified !== "boolean" || !strOrNull(c.label) || !strOrNull(c.codeId)) {
    return null;
  }
  return {
    chainId: raw.chainId,
    contract: { address: c.address, verified: c.verified, label: c.label, codeId: c.codeId },
    reason: raw.reason,
  };
}
