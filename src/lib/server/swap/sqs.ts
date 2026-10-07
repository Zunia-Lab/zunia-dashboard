/**
 * The Osmosis router (SQS), read from the server.
 *
 * Two hosts in priority order (`SWAP_ROUTER_ENDPOINTS`): the second is tried
 * only when the first does not answer at all (network, timeout, 5xx, 429). A
 * 4xx is the router answering about the pair ("no routes were provided for
 * the pair"), which the other host would answer the same way, so it is
 * reported as "no route" rather than retried.
 *
 * Caching: quotes for 5 s (the form requotes every 20 s, so a burst of
 * identical requests from several tabs costs one upstream read), token
 * metadata and pool metadata for 10 minutes and 60 s. A cached quote carries
 * the time it was read (`readAt`), so the price's 20-second life is counted
 * from the router's answer, not from whichever request reused it. Every read
 * goes through `fetchJson`, so it has a hard timeout and the per-host cap.
 */

import "server-only";

import { SWAP_ROUTER_ENDPOINTS } from "@/config/interchain";
import { cached } from "@/lib/server/cache";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import { parseOsmosisTokenMetadata, parseSqsQuote, SqsAnswerError, type OsmosisListing, type SqsQuote } from "@/lib/swap/sqs";
import { isRecord } from "@/lib/swap/types";

const QUOTE_TIMEOUT_MS = 9_000;
const METADATA_TIMEOUT_MS = 15_000;
const QUOTE_CACHE_MS = 5_000;

/** The router answered, but not with a usable route; or it could not be reached. */
export class SqsError extends Error {
  readonly code: "no-route" | "unreachable" | "malformed";
  constructor(code: "no-route" | "unreachable" | "malformed", message: string) {
    super(message);
    this.name = "SqsError";
    this.code = code;
  }
}

function hostRetryable(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return true;
  if (error.kind === "network" || error.kind === "timeout") return true;
  return error.kind === "http" && (error.status === 429 || (error.status ?? 0) >= 500);
}

/**
 * Whether a failed read is the router answering about the request rather
 * than the router being down: a 4xx ("no routes were provided for the pair"),
 * or a plain 500, which is how SQS reports a pair it cannot price at this
 * size ("panic: division by zero" for a dust amount, seen 2026-10-07 on both
 * hosts). Gateway statuses (502/503/504), 429, timeouts and network errors
 * are outages.
 */
function answeredAboutRequest(error: unknown): boolean {
  if (!(error instanceof UpstreamError) || error.kind !== "http") return false;
  const status = error.status ?? 0;
  return (status >= 400 && status < 500 && status !== 429) || status === 500;
}

/** GET `path` from the first router host that answers. */
async function sqsGet(path: string, timeoutMs: number): Promise<unknown> {
  let lastError: unknown = null;
  let answered = 0;
  for (const host of SWAP_ROUTER_ENDPOINTS) {
    try {
      return await fetchJson<unknown>(`${host}${path}`, { timeoutMs, hostConcurrency: 8 });
    } catch (error) {
      lastError = error;
      if (answeredAboutRequest(error)) answered += 1;
      if (!hostRetryable(error)) break;
    }
  }
  // A 4xx stops at the first host; a 500 counts only when every host tried
  // gave it, so one sick replica still reads as an outage, not as "no route".
  const status = lastError instanceof UpstreamError ? (lastError.status ?? 0) : 0;
  if (answeredAboutRequest(lastError) && (status !== 500 || answered === SWAP_ROUTER_ENDPOINTS.length)) {
    throw new SqsError("no-route", "The Osmosis router has no route for this pair at this amount.");
  }
  throw new SqsError("unreachable", "The Osmosis router could not be reached.");
}

/** A router quote and when the router gave it (epoch ms, this server's clock). */
export interface PricedQuote {
  readonly quote: SqsQuote;
  readonly readAt: number;
}

function parsed(body: unknown): PricedQuote {
  const readAt = Date.now();
  try {
    return { quote: parseSqsQuote(body), readAt };
  } catch (error) {
    if (error instanceof SqsAnswerError && error.code === "no-route") {
      throw new SqsError("no-route", "The Osmosis router has no route for this pair at this amount.");
    }
    throw new SqsError("malformed", "The Osmosis router answered with a quote Zunia could not read.");
  }
}

/**
 * The router's best order for selling `amount` of `tokenInDenom` for
 * `tokenOutDenom`, split across routes when that pays more (no `singleRoute`:
 * poolmanager signs a split order as `MsgSplitRouteSwapExactAmountIn`).
 */
export function sqsQuote(input: {
  readonly tokenInDenom: string;
  readonly amount: string;
  readonly tokenOutDenom: string;
}): Promise<PricedQuote> {
  const query = new URLSearchParams({
    tokenIn: `${input.amount}${input.tokenInDenom}`,
    tokenOutDenom: input.tokenOutDenom,
  });
  const key = `swap:sqs:quote:${query.toString()}`;
  return cached(key, { ttlMs: QUOTE_CACHE_MS, staleMs: 0, errorTtlMs: 2_000 }, async () =>
    parsed(await sqsGet(`/router/quote?${query.toString()}`, QUOTE_TIMEOUT_MS)),
  );
}

/**
 * The price of exactly `route` (pool ids and the denom each pays out, in
 * order): the contract path's quote, because the crosschain-swaps contract
 * swaps only along its own table's route. `tokenOutDenom` and `poolID` are
 * positional comma-separated lists.
 */
export function sqsDirectQuote(input: {
  readonly tokenInDenom: string;
  readonly amount: string;
  readonly route: readonly { readonly poolId: string; readonly tokenOutDenom: string }[];
}): Promise<PricedQuote> {
  const query = new URLSearchParams({
    tokenIn: `${input.amount}${input.tokenInDenom}`,
    tokenOutDenom: input.route.map((hop) => hop.tokenOutDenom).join(","),
    poolID: input.route.map((hop) => hop.poolId).join(","),
  });
  const key = `swap:sqs:direct:${query.toString()}`;
  return cached(key, { ttlMs: QUOTE_CACHE_MS, staleMs: 0, errorTtlMs: 2_000 }, async () =>
    parsed(await sqsGet(`/router/custom-direct-quote?${query.toString()}`, QUOTE_TIMEOUT_MS)),
  );
}

/** Every token the router lists (`preview: false`), parsed. Cached 10 minutes. */
export function sqsListings(): Promise<OsmosisListing[]> {
  return cached("swap:sqs:metadata", { ttlMs: 10 * 60_000, staleMs: 50 * 60_000, errorTtlMs: 15_000 }, async () => {
    const listings = parseOsmosisTokenMetadata(await sqsGet("/tokens/metadata", METADATA_TIMEOUT_MS));
    if (listings.length === 0) throw new SqsError("malformed", "The Osmosis router listed no tokens.");
    return listings;
  });
}

/** Liquidity and price per Osmosis denom, as the router reports them. */
export interface PoolMetadata {
  /** USD of liquidity across pools; `null` when not reported or zero. */
  readonly liquidity: number | null;
  /** USD per whole token (quoted in alloyed USDC); `null` when not reported or zero. */
  readonly price: number | null;
}

function positiveNumber(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  // The router answers "0" for a token it cannot price: that is "unknown",
  // never a confident zero.
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `/tokens/pool-metadata` for every listed denom. Cached 60 s. */
export function sqsPoolMetadata(): Promise<ReadonlyMap<string, PoolMetadata>> {
  return cached("swap:sqs:pool-metadata", { ttlMs: 60_000, staleMs: 4 * 60_000, errorTtlMs: 15_000 }, async () => {
    const body = await sqsGet("/tokens/pool-metadata", METADATA_TIMEOUT_MS);
    if (!isRecord(body)) throw new SqsError("malformed", "The Osmosis router's pool metadata was unreadable.");
    const out = new Map<string, PoolMetadata>();
    for (const [denom, row] of Object.entries(body)) {
      if (!isRecord(row)) continue;
      out.set(denom, { liquidity: positiveNumber(row.total_liquidity_cap), price: positiveNumber(row.price) });
    }
    return out;
  });
}
