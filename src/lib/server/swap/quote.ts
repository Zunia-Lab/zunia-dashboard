/**
 * One swap quote: which path a pair takes, what Osmosis would pay, the floor
 * the message will carry, and every on-chain fact the browser needs to build
 * the messages, each one proved before it is handed over.
 *
 * Ported from the extension's planning (zunia-extension lib/pool-swap.ts
 * `planPoolSwap`, lib/route-plan.ts `quoteOnVenue`, and the SwapScreen's path
 * logic @ 1453e7a), reshaped as one server call so the browser never talks to
 * an LCD or the router itself:
 *
 * 1. Name both sides on Osmosis (an Osmosis row is its own name; any other
 *    side is proved by src/lib/server/swap/names.ts when its path needs it).
 * 2. Ask the contract's route table about the pair (an hour old at most) and
 *    pick the path (src/lib/swap/path.ts).
 * 3. Price it:
 *    - `pool`, `pool-deliver`, `move-first`: the router's best order (split
 *      when that pays more), checked to add up to exactly the amount sold, and
 *      the floor `⌊out × (100 − s)%⌋` (refused when it rounds to nothing);
 *      `pool-deliver` then proves the one-hop transfer of that floor home;
 *      `move-first` is an estimate, said so.
 *    - `contract`: the verified contract's live `get_route` for the pair, the
 *      router's price for exactly that route, and the one-hop proofs for the
 *      funds going in and the output going out.
 *
 * A pair that cannot be swapped for a known reason answers `blocked` with the
 * sentence to show, plus the price when one was read. Only an unreachable
 * router is an error (`QuoteUnavailable`, a 503 for the route).
 */

import "server-only";

import { applySlippage } from "@zunialab/interchain";

import { QUOTE_TTL_MS, SWAP_VENUE_CHAIN_ID, TWAP_WINDOW_SECONDS } from "@/config/interchain";
import { findServerChain } from "@/lib/server/chains";
import { pairRemoteSide, type Pairing, type PairingResult } from "@/lib/server/swap/names";
import { sqsDirectQuote, SqsError, sqsListings, sqsQuote, type PricedQuote } from "@/lib/server/swap/sqs";
import { swapVenue } from "@/lib/server/swap/venue";
import { loadXcsTable, xcsRouteGate } from "@/lib/server/swap/xcs-table";
import { sameDenom } from "@/lib/swap/denoms";
import { rateOf } from "@/lib/swap/format";
import { swapPathFor, signingChainFor, type SwapPath } from "@/lib/swap/path";
import { poolMinOut, poolRoutesOf } from "@/lib/swap/pool";
import {
  fractionToPercent,
  largestSplit,
  priceImpactPercent,
  spotPriceInDisplayUnits,
  type SqsQuote,
  type SqsSplit,
} from "@/lib/swap/sqs";
import type {
  SwapBlockedCode,
  SwapQuotePrice,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRoutePool,
  SwapRouteSplit,
} from "@/lib/swap/wire";
import { executableBetween, noRouteReason, notTradedReason, TESTNET_REASON, type GateSide } from "@/lib/swap/xcs";
import { identifyDenom, identifyDenoms } from "@/lib/token/identity";
import type { TokenIdentity } from "@/lib/token/types";

const VENUE = SWAP_VENUE_CHAIN_ID;

/** The router could not be reached: nothing can be priced. The route answers 503. */
export class QuoteUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteUnavailable";
  }
}

/**
 * How long one quote may take before the route gives up on it. A price lives
 * `QUOTE_TTL_MS`; an answer later than that would arrive expired, and a cold
 * quote that walks every check (venue, route table, traces, both channel ends
 * and their light clients, each with its own timeout and retry) could
 * otherwise outlast the proxy in front of the server, whose own timeout turns
 * into an error page with no body. The work is not cancelled: what it proves
 * lands in the caches, so the next attempt is quick.
 */
export const QUOTE_DEADLINE_MS = QUOTE_TTL_MS;

interface Side {
  readonly chainId: string;
  readonly denom: string;
  readonly identity: TokenIdentity;
  readonly ticker: string;
  readonly testnet: boolean;
  /** A browser hint for the Osmosis name, unproved. */
  readonly hint: string | null;
}

/**
 * A side and its identity. The table-only identity first; a voucher it does
 * not know is then traced on its chain (hash-verified, cached process-wide,
 * never rejecting: what cannot be traced stays unknown), so OSMO held on the
 * Hub reads as OSMO with its decimals rather than `IBC·14F9`.
 */
async function sideOf(chainId: string, denom: string, hint: string | undefined): Promise<Side> {
  let identity = identifyDenom(chainId, denom);
  if (identity.provenance === "unknown" && denom.startsWith("ibc/")) {
    identity = (await identifyDenoms(chainId, [denom])).get(denom) ?? identity;
  }
  return {
    chainId,
    denom,
    identity,
    ticker: identity.ticker,
    testnet: findServerChain(chainId)?.network === "testnet",
    hint: hint ?? null,
  };
}

/**
 * Why a side has no Osmosis name. A token identity proves (a chain's own coin,
 * a table row) that has none is one Osmosis does not trade: the extension's
 * `notTradedReason`. A token nothing proves cannot be named at all.
 */
function unnamedBlock(side: Side): { code: SwapBlockedCode; message: string } {
  return side.identity.provenance === "unknown"
    ? { code: "venue-denom-unknown", message: `Zunia cannot tell what ${side.ticker} is on Osmosis, so it will not swap it.` }
    : { code: "not-traded", message: notTradedReason(side.ticker) };
}

/** The extension's sentence for a pair that is one token on Osmosis (SwapScreen `quoteBlockText`). */
function sameTokenText(ticker: string): string {
  return `Both sides are ${ticker} on Osmosis, so there is nothing to swap. Use Send to move it.`;
}

/** The Osmosis name a side can be gated with before any proof: its own denom on Osmosis, else hint or identity. */
function candidateOf(side: Side): string | null {
  if (side.chainId === VENUE) return side.denom;
  return side.hint ?? side.identity.osmosisDenom ?? null;
}

function gateSide(side: Side, venueDenom: string | null): GateSide {
  return {
    key: `${side.chainId}:${side.denom}`,
    chainId: side.chainId,
    denom: side.denom,
    identity: { ...side.identity, ...(venueDenom ? { osmosisDenom: venueDenom } : {}) },
    testnet: side.testnet,
  };
}

function blocked(
  code: SwapBlockedCode,
  message: string,
  extra: { path?: SwapPath; preview?: SwapQuotePrice } = {},
): SwapQuoteResponse {
  return { updatedAt: Date.now(), blocked: { code, message }, ...extra };
}

/** A failed pairing as the quote's refusal, in the direction it was needed. */
function pairingBlock(result: Extract<PairingResult, { ok: false }>, direction: "inbound" | "delivery"): { code: SwapBlockedCode; message: string } {
  switch (result.code) {
    case "venue-denom-unknown":
      return { code: "venue-denom-unknown", message: result.message };
    case "not-traded":
      return { code: "not-traded", message: result.message };
    case "variant-mismatch":
      return { code: "variant-mismatch", message: result.message };
    default:
      return { code: direction === "inbound" ? "inbound-unavailable" : "delivery-unavailable", message: result.message };
  }
}

/** The identity's exponent, unless SQS lists the Osmosis denom with another: then unknown (amounts by Max only). */
async function decimalsFor(side: Side, venueDenom: string | null): Promise<number | null> {
  const own = side.identity.decimals;
  if (own === null || !venueDenom) return own;
  try {
    const listed = (await sqsListings()).find((listing) => listing.denom === venueDenom);
    return listed === undefined || listed.decimals === own ? own : null;
  } catch {
    return own;
  }
}

function percentOrUndefined(fraction: string | null): number | undefined {
  const value = fractionToPercent(fraction);
  return value === null ? undefined : value;
}

function poolsOf(split: SqsSplit): SwapRoutePool[] {
  return split.pools.map((pool) => {
    const spread = percentOrUndefined(pool.spreadFactor);
    const takerFee = percentOrUndefined(pool.takerFee);
    return {
      id: pool.poolId,
      tokenOutDenom: pool.tokenOutDenom,
      ...(spread !== undefined ? { spread } : {}),
      ...(takerFee !== undefined ? { takerFee } : {}),
    };
  });
}

function splitsOf(quote: SqsQuote): SwapRouteSplit[] {
  return quote.splits.map((split) => ({ inAmount: split.inAmount, outAmount: split.outAmount, pools: poolsOf(split) }));
}


/** Router failures that are about the pair become refusals; an unreachable router is a 503. */
async function priced(read: () => Promise<PricedQuote>): Promise<PricedQuote | "no-route"> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof SqsError && error.code === "no-route") return "no-route";
    if (error instanceof SqsError && error.code === "malformed") return "no-route";
    throw new QuoteUnavailable("The Osmosis router could not be reached, so nothing can be priced right now.");
  }
}

/** Quote one swap. Throws only {@link QuoteUnavailable}. */
export async function quoteSwap(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
  const [from, to] = await Promise.all([
    sideOf(request.fromChainId, request.fromDenom, request.fromVenueDenom),
    sideOf(request.toChainId, request.toDenom, request.toVenueDenom),
  ]);
  const slippage = request.slippagePercent;

  if (from.testnet || to.testnet) return blocked("testnet", TESTNET_REASON);
  if (from.chainId === to.chainId && from.denom === to.denom) {
    return blocked("same-token", "This is the token you are selling.");
  }

  // Names on Osmosis, before proofs: enough to gate and to pick the path.
  const vinCandidate = candidateOf(from);
  const voutCandidate = candidateOf(to);
  if (vinCandidate && voutCandidate && sameDenom(vinCandidate, voutCandidate)) {
    return blocked("same-token", sameTokenText(to.ticker));
  }

  const venue = await swapVenue();
  const table = venue.address ? await loadXcsTable(venue.address) : null;

  // A voucher of an Osmosis token held elsewhere names itself through its
  // trace (case two in names.ts), so it is proved first when nothing else
  // names it: the path depends on the name.
  let fromPairing: Pairing | null = null;
  let toPairing: Pairing | null = null;
  let vin = vinCandidate;
  let vout = voutCandidate;
  if (!vin && from.chainId !== VENUE && from.denom.startsWith("ibc/")) {
    const result = await pairRemoteSide({ chainId: from.chainId, denom: from.denom, ticker: from.ticker });
    if (!result.ok) {
      const block = pairingBlock(result, "inbound");
      return blocked(block.code, block.message);
    }
    fromPairing = result.pairing;
    vin = fromPairing.venueDenom;
  }
  if (!vout && to.chainId !== VENUE && to.denom.startsWith("ibc/")) {
    const result = await pairRemoteSide({ chainId: to.chainId, denom: to.denom, ticker: to.ticker });
    if (!result.ok) {
      const block = pairingBlock(result, "delivery");
      return blocked(block.code, block.message);
    }
    toPairing = result.pairing;
    vout = toPairing.venueDenom;
  }

  const answer = executableBetween(table, gateSide(from, vin), gateSide(to, vout));
  const path = swapPathFor(from, to, answer);
  const signingChainId = signingChainFor(path, from.chainId);

  if (!vin) {
    const block = unnamedBlock(from);
    return blocked(block.code, block.message, { path });
  }
  if (!vout) {
    const block = unnamedBlock(to);
    return blocked(block.code, block.message, { path });
  }
  if (sameDenom(vin, vout)) {
    return blocked("same-token", sameTokenText(to.ticker), { path });
  }

  const [fromDecimals, toDecimals] = await Promise.all([decimalsFor(from, vin), decimalsFor(to, vout)]);
  const base = {
    signingChainId,
    amountIn: request.amount,
    decimals: { from: fromDecimals, to: toDecimals },
    venueInputDenom: vin,
    venueOutputDenom: vout,
    slippagePercent: slippage,
  };
  // The price's life runs from the router's answer (which a burst of
  // identical requests shares for up to 5 s), not from this response.
  const life = (readAt: number) => ({ quotedAt: readAt, expiresAt: readAt + QUOTE_TTL_MS });
  const spot = (quote: SqsQuote) => spotPriceInDisplayUnits(quote.spotPrice, fromDecimals, toDecimals);

  /* ---------------------------------------------------------------- pools */
  if (path !== "contract") {
    const read = await priced(() => sqsQuote({ tokenInDenom: vin, amount: request.amount, tokenOutDenom: vout }));
    if (read === "no-route") {
      return blocked("no-pool-route", `Osmosis has no pool route from ${from.ticker} to ${to.ticker} at this amount, so there is nothing to sign.`, { path });
    }
    const { quote } = read;
    const splits = splitsOf(quote);
    const largest = largestSplit(quote.splits);
    const minOut = poolMinOut({ outputAmount: quote.outAmount }, slippage);
    const warnings: string[] = [];
    if (quote.splits.length > 1) {
      warnings.push(`The router splits this order across ${quote.splits.length} routes for a better price.`);
    }
    const preview: SwapQuotePrice = {
      ...base,
      ...life(read.readAt),
      path,
      estimate: path === "move-first",
      ...(path === "move-first"
        ? {
            method:
              "Priced as if the tokens were already on Osmosis: they move there first with Send, then swap in its pools at the price of that moment.",
          }
        : {}),
      amountOut: quote.outAmount,
      minOut,
      minOutKind: "exact",
      priceImpact: priceImpactPercent(quote),
      effectiveFee: fractionToPercent(quote.effectiveFee),
      spotPrice: spot(quote),
      rate: rateOf(request.amount, fromDecimals, quote.outAmount, toDecimals),
      route: { pools: largest ? poolsOf(largest) : [], splits },
      warnings,
    };
    if (!poolRoutesOf({ splits: quote.splits, outputDenom: vout }, request.amount)) {
      return blocked(
        "routes-invalid",
        "The Osmosis router's routes for this swap do not add up to the amount you sell, so Zunia will not sign them.",
        { path, preview },
      );
    }
    if (!minOut) {
      return blocked(
        "no-floor",
        "At this amount the swap would pay out so little that its minimum rounds to nothing, so Zunia will not sign it.",
        { path, preview },
      );
    }
    if (path === "pool-deliver") {
      const result = toPairing
        ? ({ ok: true, pairing: toPairing } as const)
        : await pairRemoteSide({ chainId: to.chainId, denom: to.denom, ticker: to.ticker, candidate: vout });
      if (!result.ok) {
        const block = pairingBlock(result, "delivery");
        return blocked(block.code, block.message, { path, preview });
      }
      const { hop, relation } = result.pairing;
      if (hop.clientStatus === "unconfirmed") {
        warnings.push(`Zunia could not confirm the light clients of ${hop.venueChannelId}; the channel itself is open.`);
      }
      return {
        ...preview,
        updatedAt: Date.now(),
        delivery: {
          destChainId: to.chainId,
          channelId: hop.venueChannelId,
          port: hop.port,
          arrivalDenom: to.denom,
          kind: relation === "remote-native" ? "unwind" : "wrap",
          clientStatus: hop.clientStatus,
        },
      };
    }
    return { ...preview, updatedAt: Date.now() };
  }

  /* ------------------------------------------------------------- contract */
  if (!venue.address || !venue.contract) {
    return blocked("venue-unavailable", venue.reason ?? "Zunia's Osmosis swap contract is not available right now.", { path });
  }
  const gate = await xcsRouteGate(venue.address, vin, vout);
  if (gate.status === "missing") {
    return blocked("no-contract-route", `${noRouteReason(from.ticker, to.ticker)} The swap stays unsigned.`, { path });
  }
  if (gate.status !== "ready") {
    return blocked(
      "route-unreadable",
      `Zunia could not confirm that the Osmosis swap contract takes ${from.ticker} to ${to.ticker}, so the swap stays unsigned.`,
      { path },
    );
  }
  const read = await priced(() => sqsDirectQuote({ tokenInDenom: vin, amount: request.amount, route: gate.route }));
  if (read === "no-route") {
    return blocked(
      "route-unpriced",
      `The pools on the Osmosis swap contract's route from ${from.ticker} to ${to.ticker} could not be priced, so the swap stays unsigned.`,
      { path },
    );
  }
  const { quote } = read;
  let floor: string | null = null;
  try {
    floor = applySlippage(quote.outAmount, slippage);
  } catch {
    floor = null;
  }
  const routePools: SwapRoutePool[] = quote.splits.length === 1 && quote.splits[0] ? poolsOf(quote.splits[0]) : gate.route.map((hop) => ({ id: hop.poolId, tokenOutDenom: hop.tokenOutDenom }));
  const warnings: string[] = [];
  const preview: SwapQuotePrice = {
    ...base,
    ...life(read.readAt),
    path,
    estimate: false,
    amountOut: quote.outAmount,
    minOut: floor && floor !== "0" ? floor : null,
    minOutKind: "twap-estimate",
    priceImpact: priceImpactPercent(quote),
    effectiveFee: fractionToPercent(quote.effectiveFee),
    spotPrice: spot(quote),
    rate: rateOf(request.amount, fromDecimals, quote.outAmount, toDecimals),
    route: { pools: routePools },
    contract: venue.contract,
    twapWindowSeconds: TWAP_WINDOW_SECONDS,
    warnings,
  };

  let inbound: SwapQuotePrice["inbound"];
  if (from.chainId !== VENUE) {
    const result = fromPairing
      ? ({ ok: true, pairing: fromPairing } as const)
      : await pairRemoteSide({ chainId: from.chainId, denom: from.denom, ticker: from.ticker, candidate: vin });
    if (!result.ok) {
      const block = pairingBlock(result, "inbound");
      return blocked(block.code, block.message, { path, preview });
    }
    const { hop, relation } = result.pairing;
    inbound = {
      sourceChainId: from.chainId,
      channelId: hop.remoteChannelId,
      port: hop.port,
      venueChannelId: hop.venueChannelId,
      kind: relation === "remote-native" ? "wrap" : "unwind",
      clientStatus: hop.clientStatus,
    };
    if (hop.clientStatus === "unconfirmed") {
      warnings.push(`Zunia could not confirm the light clients of ${hop.remoteChannelId}; the channel itself is open.`);
    }
  }
  let delivery: SwapQuotePrice["delivery"];
  if (to.chainId !== VENUE) {
    const result = toPairing
      ? ({ ok: true, pairing: toPairing } as const)
      : await pairRemoteSide({ chainId: to.chainId, denom: to.denom, ticker: to.ticker, candidate: vout });
    if (!result.ok) {
      const block = pairingBlock(result, "delivery");
      return blocked(block.code, block.message, { path, preview });
    }
    const { hop, relation } = result.pairing;
    delivery = {
      destChainId: to.chainId,
      channelId: hop.venueChannelId,
      port: hop.port,
      arrivalDenom: to.denom,
      kind: relation === "remote-native" ? "unwind" : "wrap",
      clientStatus: hop.clientStatus,
    };
  }
  return {
    ...preview,
    updatedAt: Date.now(),
    ...(inbound ? { inbound } : {}),
    ...(delivery ? { delivery } : {}),
  };
}

/**
 * {@link quoteSwap}, or {@link QuoteUnavailable} once `deadlineMs` has passed
 * (the route's 503). The work goes on after the deadline and fills the
 * caches; its own failure then is caught here, never left unhandled.
 */
export function quoteSwapWithin(request: SwapQuoteRequest, deadlineMs: number = QUOTE_DEADLINE_MS): Promise<SwapQuoteResponse> {
  const work = quoteSwap(request);
  work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new QuoteUnavailable("Pricing this swap took too long. Try again: the checks it ran are kept for a few minutes.")),
      deadlineMs,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
