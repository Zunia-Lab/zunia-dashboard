/**
 * Browser-side calls to `/api/interchain/*` and `/api/ibc/*`.
 *
 * Every response goes through a reader in `wire.ts` before a component sees it,
 * and every failure comes back as the same `InterchainFailure` shape whether it
 * originated in the engine, in a handler, or in the transport. A screen that
 * has to tell "the chain said no" apart from "the request never landed" reads
 * `code`; a screen that just needs a sentence reads `message`.
 *
 * Nothing here talks to a chain. That is the point: the handlers hold the
 * engine, so a visitor's IP never reaches 332 public REST endpoints.
 */

import {
  readBalancesResponse,
  readChannelCheckResponse,
  readChannelsResponse,
  readPlanResponse,
  readTxStatusResponse,
  readQuoteResponse,
  readSwapConfigResponse,
  readTraceResponse,
  type BalancesResponse,
  type ChannelCheckResponse,
  type ChannelsResponse,
  type InterchainFailure,
  type PlanResponse,
  type QuoteResponse,
  type RoutePlanWire,
  type SwapConfigResponse,
  type TrackResponse,
  type TxStatusResponse,
} from "./wire";

/** The request was cancelled by the caller; screens render nothing for this. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function transportFailure(error: unknown): InterchainFailure {
  if (isAbort(error)) {
    return { ok: false, code: "aborted", message: "Cancelled." };
  }
  return {
    ok: false,
    code: "lcd-unreachable",
    message:
      error instanceof Error
        ? `The dashboard could not reach its own API. ${error.message}`
        : "The dashboard could not reach its own API.",
  };
}

/**
 * GET one of this app's own JSON routes.
 *
 * Exported so `lib/nft/client.ts` uses this transport rather than growing a
 * second one: a transport failure has to reach the UI as the same
 * `InterchainFailure` shape whether the route was `/api/interchain/*` or
 * `/api/nft/*`, and two copies of that mapping is two chances to disagree.
 */
export async function getJson(
  url: string,
  signal?: AbortSignal,
): Promise<unknown | InterchainFailure> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    return (await response.json()) as unknown;
  } catch (error) {
    return transportFailure(error);
  }
}

async function postJson(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown | InterchainFailure> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    return (await response.json()) as unknown;
  } catch (error) {
    return transportFailure(error);
  }
}

export async function fetchSwapConfig(
  signal?: AbortSignal,
): Promise<SwapConfigResponse> {
  return readSwapConfigResponse(await getJson("/api/interchain/config", signal));
}

export async function fetchBalances(
  params: { chainId: string; address: string },
  signal?: AbortSignal,
): Promise<BalancesResponse> {
  const query = new URLSearchParams({
    chainId: params.chainId,
    address: params.address,
  });
  return readBalancesResponse(
    await getJson(`/api/interchain/balances?${query.toString()}`, signal),
  );
}

export async function fetchTxStatus(
  params: { chainId: string; hash: string },
  signal?: AbortSignal,
): Promise<TxStatusResponse> {
  const query = new URLSearchParams({
    chainId: params.chainId,
    hash: params.hash,
  });
  return readTxStatusResponse(
    await getJson(`/api/interchain/tx?${query.toString()}`, signal),
  );
}

export async function fetchChannels(
  params: { source: string; dest: string },
  signal?: AbortSignal,
): Promise<ChannelsResponse> {
  const query = new URLSearchParams({
    source: params.source,
    dest: params.dest,
  });
  return readChannelsResponse(
    await getJson(`/api/ibc/channels?${query.toString()}`, signal),
  );
}

export async function checkChannel(
  params: { source: string; channel: string; dest?: string },
  signal?: AbortSignal,
): Promise<ChannelCheckResponse> {
  const query = new URLSearchParams({
    source: params.source,
    channel: params.channel,
  });
  if (params.dest) query.set("dest", params.dest);
  return readChannelCheckResponse(
    await getJson(`/api/ibc/channel?${query.toString()}`, signal),
  );
}

/** One hop the user set by hand. Mirrors the engine's `RouteHopOverride`. */
export interface HopOverrideInput {
  readonly hopIndex?: number;
  readonly fromChainId?: string;
  readonly toChainId?: string;
  readonly channelId: string;
  readonly port?: string;
  readonly counterpartyChannelId?: string;
}

export interface PlanInput {
  readonly sourceChainId: string;
  readonly destChainId: string;
  readonly inputDenom: string;
  /** Base units. Never a display amount. */
  readonly amount: string;
  readonly sender: string;
  readonly recipient: string;
  /**
   * What the swap should buy, named the way a user picks it: a chain and that
   * chain's own denom. The handler derives the venue-side denom, because it
   * depends on the channel the venue received that token over.
   */
  readonly outputAsset?: {
    readonly originChainId: string;
    readonly baseDenom: string;
  };
  readonly slippagePercent?: number;
  readonly allowSwap: boolean;
  readonly maxHops?: number;
  /**
   * Where stranded swap output can be reclaimed from. Always sent for a swap:
   * without it the engine writes `"do_nothing"` into the memo and funds a
   * failed payout leaves behind are unrecoverable.
   */
  readonly recoveryAddress?: string;
  readonly overrides?: readonly HopOverrideInput[];
}

export async function fetchPlan(
  input: PlanInput,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  return readPlanResponse(await postJson("/api/interchain/plan", input, signal));
}

export interface QuoteInput {
  readonly chainId: string;
  readonly tokenInDenom: string;
  readonly tokenInAmount: string;
  readonly tokenOutDenom: string;
  readonly slippagePercent: number;
}

export async function fetchQuote(
  input: QuoteInput,
  signal?: AbortSignal,
): Promise<QuoteResponse> {
  return readQuoteResponse(await postJson("/api/interchain/quote", input, signal));
}

export interface TrackInput {
  readonly plan: RoutePlanWire;
  readonly sourceTxHash: string;
  readonly expectedAmount?: string;
  readonly recoveryAddress?: string;
}

export async function fetchTrace(
  input: TrackInput,
  signal?: AbortSignal,
): Promise<TrackResponse> {
  return readTraceResponse(await postJson("/api/interchain/track", input, signal));
}
