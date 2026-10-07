/**
 * Swaps in Osmosis's own pools, with no contract in between: the order the
 * router's quote makes, the poolmanager message built from it, and the strict
 * readers the review checks run before anything is signed.
 *
 * Ported from zunia-extension lib/pool-swap.ts @ 1453e7a (the pure half; the
 * pricing and delivery planning that needed the extension's LCD wiring live in
 * src/lib/server/swap/ here).
 *
 * The crosschain-swaps contract (./xcs.ts) executes only the pairs in its
 * swaprouter's table: 39 directional routes on 2026-10-05, none of them OSMO to
 * USDC.inj. Osmosis's poolmanager module swaps any pair its pools connect,
 * along any route, and the Osmosis router (SQS) finds the best one, split
 * across several routes when that pays more. So when the funds are already on
 * Osmosis, Zunia signs poolmanager's own message for the router's route:
 *
 * - `MsgSwapExactAmountIn` for one route;
 * - `MsgSplitRouteSwapExactAmountIn` when the router splits the order.
 *
 * Both carry `token_out_min_amount`. The chain refuses the whole transaction
 * when the swap would pay less, so the floor is a number in the signed message
 * (the quote's output less the slippage tolerance), not a rule like the
 * contract's TWAP tolerance. A new price is therefore a new message.
 *
 * poolmanager pays the output to the signer. A token wanted on another chain
 * is sent on in the same transaction: an ICS20 transfer of exactly the floor,
 * over the channel the server proved. The swap pays at least the floor, so the
 * transfer always has it to send; whatever the swap pays above it stays in the
 * signer's Osmosis account. If the swap pays less, the chain refuses
 * everything, the fee and the transfer included.
 *
 * Pure: no network, no storage, no clock.
 */

import { applySlippage } from "@zunialab/interchain";

import { DENOM, POSITIVE_INT } from "@/lib/swap/denoms";
import { hasExactly, hasOnly, isRecord, type MsgJson } from "@/lib/swap/types";
import { POOL_SPLIT_SWAP_TYPE_URL, POOL_SWAP_TYPE_URL } from "@/lib/tx/osmosis";

/** The poolmanager type URLs, defined once where they are encoded (src/lib/tx/osmosis.ts). */
export { POOL_SPLIT_SWAP_TYPE_URL, POOL_SWAP_TYPE_URL };
export const TRANSFER_TYPE_URL = "/ibc.applications.transfer.v1.MsgTransfer";

/**
 * Pools one route may pass through. The router's longest routes are three or
 * four pools; a route this long is not one it returns.
 */
export const MAX_POOL_HOPS = 8;
/** Routes one order may be split across. The router splits into two to four. */
export const MAX_POOL_SPLITS = 16;

const ZERO = BigInt(0);

/* -------------------------------------------------------------------------- *
 * Routes
 * -------------------------------------------------------------------------- */

/** One pool on a route, and the denom it pays out. */
export interface PoolHop {
  /** Pool id, decimal digits. */
  readonly poolId: string;
  readonly tokenOutDenom: string;
}

/** One route of an order: its pools in order, and the input it takes. */
export interface PoolRoute {
  readonly hops: readonly PoolHop[];
  /** Base units of the input this route swaps. All routes add up to the whole input. */
  readonly inAmount: string;
}

/** The minimum a quote's split must carry for {@link poolRoutesOf}. */
export interface QuoteSplitLike {
  readonly pools: readonly { readonly poolId: string; readonly tokenOutDenom: string }[];
  readonly inAmount: string;
}

/**
 * The problems with a set of routes for selling `amountIn` into `outputDenom`,
 * in the chain's own terms: at least one route, none longer than
 * {@link MAX_POOL_HOPS}, no more than {@link MAX_POOL_SPLITS}, every pool id a
 * positive integer, every denom a denom, every route ending in `outputDenom`,
 * every route taking a positive amount, the amounts adding up to `amountIn`,
 * and no two routes through the same pools (the chain refuses duplicates).
 */
export function routeProblem(routes: readonly PoolRoute[], amountIn: string, outputDenom: string): string | null {
  if (!POSITIVE_INT.test(amountIn)) return "the amount is not a positive integer";
  if (routes.length === 0) return "there is no route";
  if (routes.length > MAX_POOL_SPLITS) return `the order is split ${routes.length} ways`;
  let total = ZERO;
  const seen = new Set<string>();
  for (const route of routes) {
    if (route.hops.length === 0) return "a route has no pool";
    if (route.hops.length > MAX_POOL_HOPS) return `a route passes ${route.hops.length} pools`;
    for (const hop of route.hops) {
      if (!POSITIVE_INT.test(hop.poolId)) return `pool id ${hop.poolId} is not a pool id`;
      if (!DENOM.test(hop.tokenOutDenom)) return `${hop.tokenOutDenom} is not a denom`;
    }
    if (route.hops[route.hops.length - 1]?.tokenOutDenom !== outputDenom) {
      return `a route ends in another token than ${outputDenom}`;
    }
    if (!POSITIVE_INT.test(route.inAmount)) return "a route takes no input";
    total += BigInt(route.inAmount);
    const key = route.hops.map((hop) => hop.poolId).join(">");
    if (seen.has(key)) return "two routes pass the same pools";
    seen.add(key);
  }
  if (total !== BigInt(amountIn)) return "the routes do not add up to the amount";
  return null;
}

/**
 * The router's routes for a quote, as poolmanager takes them. `null` when they
 * are not a valid order for exactly `amountIn` of the quote's input: a split
 * that does not add up would sell another amount than the one reviewed.
 */
export function poolRoutesOf(
  quote: { readonly splits: readonly QuoteSplitLike[]; readonly outputDenom: string },
  amountIn: string,
): PoolRoute[] | null {
  const routes = quote.splits.map((split) => ({
    hops: split.pools.map((pool) => ({ poolId: pool.poolId, tokenOutDenom: pool.tokenOutDenom })),
    inAmount: split.inAmount,
  }));
  return routeProblem(routes, amountIn, quote.outputDenom) === null ? routes : null;
}

/**
 * The least the swap may pay out: the quote's output less `slippagePercent`,
 * rounded down (`⌊out × (100e6 − round(s·1e6)) / 100e6⌋`, the engine's
 * `applySlippage`, so the floor is the extension's to the base unit). `null`
 * when that is nothing, because a floor of 0 is no floor: the chain would
 * accept any price at all.
 */
export function poolMinOut(quote: { readonly outputAmount: string }, slippagePercent: number): string | null {
  try {
    const floor = applySlippage(quote.outputAmount, slippagePercent);
    return POSITIVE_INT.test(floor) ? floor : null;
  } catch {
    return null;
  }
}

/** The routes in words: `pool 3586`, `pools 3497 → 1464`, or `2 routes: pool 3498 (60%) and pool 3586 (40%)`. */
export function poolRouteText(routes: readonly PoolRoute[]): string {
  const one = (route: PoolRoute) =>
    route.hops.length === 1
      ? `pool ${route.hops[0]?.poolId ?? ""}`
      : `pools ${route.hops.map((hop) => hop.poolId).join(" → ")}`;
  if (routes.length === 1 && routes[0]) return one(routes[0]);
  const total = routes.reduce((sum, route) => sum + BigInt(route.inAmount), ZERO);
  const share = (route: PoolRoute) => {
    if (total <= ZERO) return "";
    const percent = Number((BigInt(route.inAmount) * BigInt(1000)) / total) / 10;
    return ` (${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%)`;
  };
  const parts = routes.map((route) => `${one(route)}${share(route)}`);
  return `${routes.length} routes: ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/* -------------------------------------------------------------------------- *
 * The message
 * -------------------------------------------------------------------------- */

/**
 * The poolmanager message selling `denom` along `routes` for at least
 * `minOut`, in proto-JSON: `MsgSwapExactAmountIn` for one route, which takes
 * the whole input as `token_in`; `MsgSplitRouteSwapExactAmountIn` for several,
 * each with its share as `token_in_amount`. Throws on routes that are not a
 * valid order: nothing calls this with routes {@link poolRoutesOf} refused.
 */
export function buildPoolSwapMsg(args: {
  readonly sender: string;
  readonly denom: string;
  readonly routes: readonly PoolRoute[];
  readonly minOut: string;
}): MsgJson {
  const { sender, denom, routes, minOut } = args;
  const amount = routes.reduce((sum, route) => sum + BigInt(route.inAmount), ZERO).toString();
  const outputDenom = routes[0]?.hops[routes[0].hops.length - 1]?.tokenOutDenom ?? "";
  const problem = routeProblem(routes, amount, outputDenom);
  if (problem) throw new Error(`Zunia will not build this swap: ${problem}.`);
  if (!DENOM.test(denom)) throw new Error(`Zunia will not build this swap: ${denom} is not a denom.`);
  if (!POSITIVE_INT.test(minOut)) throw new Error("Zunia will not build a swap without a minimum output.");
  if (!sender) throw new Error("Zunia will not build a swap without a signer.");
  const pools = (route: PoolRoute) =>
    route.hops.map((hop) => ({ pool_id: hop.poolId, token_out_denom: hop.tokenOutDenom }));
  const [only] = routes;
  if (routes.length === 1 && only) {
    return {
      typeUrl: POOL_SWAP_TYPE_URL,
      value: {
        sender,
        routes: pools(only),
        token_in: { denom, amount: only.inAmount },
        token_out_min_amount: minOut,
      },
    };
  }
  return {
    typeUrl: POOL_SPLIT_SWAP_TYPE_URL,
    value: {
      sender,
      routes: routes.map((route) => ({ pools: pools(route), token_in_amount: route.inAmount })),
      token_in_denom: denom,
      token_out_min_amount: minOut,
    },
  };
}

/** A coin exactly as a message carries it. */
export interface PoolCoin {
  readonly denom: string;
  /** Base units, digits only. */
  readonly amount: string;
}

/** A poolmanager swap, read from the message that is signed. */
export interface PoolSwapFacts {
  /** `MsgSplitRouteSwapExactAmountIn` rather than `MsgSwapExactAmountIn`. */
  readonly split: boolean;
  readonly sender: string;
  /** What leaves the account: the input denom, and every route's input added up. */
  readonly sold: PoolCoin;
  /** What the last pool of every route pays out. */
  readonly outputDenom: string;
  /** `token_out_min_amount`: below it the chain refuses the transaction. */
  readonly minOut: string;
  readonly routes: readonly PoolRoute[];
}

function readHops(raw: unknown): PoolHop[] | null {
  if (!Array.isArray(raw)) return null;
  const hops: PoolHop[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !hasExactly(entry, ["pool_id", "token_out_denom"])) return null;
    const { pool_id: poolId, token_out_denom: tokenOutDenom } = entry;
    if (typeof poolId !== "string" || typeof tokenOutDenom !== "string") return null;
    hops.push({ poolId, tokenOutDenom });
  }
  return hops;
}

/**
 * Read a poolmanager swap from the message that is signed. `null` for any
 * other message, and for one with a field this reader does not know, a number
 * that is not canonical, or routes that are not a valid order (see
 * {@link routeProblem}): what cannot be read whole is never described, and
 * never signed.
 */
export function readPoolSwapMsg(msg: MsgJson | undefined): PoolSwapFacts | null {
  if (!msg || !isRecord(msg.value)) return null;
  const value = msg.value;
  const { sender, token_out_min_amount: minOut } = value;
  if (typeof sender !== "string" || sender === "") return null;
  if (typeof minOut !== "string" || !POSITIVE_INT.test(minOut)) return null;

  let routes: PoolRoute[];
  let denom: unknown;
  if (msg.typeUrl === POOL_SWAP_TYPE_URL) {
    if (!hasExactly(value, ["sender", "routes", "token_in", "token_out_min_amount"])) return null;
    const tokenIn = value.token_in;
    if (!isRecord(tokenIn) || !hasExactly(tokenIn, ["denom", "amount"])) return null;
    const hops = readHops(value.routes);
    if (!hops || typeof tokenIn.amount !== "string") return null;
    denom = tokenIn.denom;
    routes = [{ hops, inAmount: tokenIn.amount }];
  } else if (msg.typeUrl === POOL_SPLIT_SWAP_TYPE_URL) {
    if (!hasExactly(value, ["sender", "routes", "token_in_denom", "token_out_min_amount"])) return null;
    if (!Array.isArray(value.routes)) return null;
    routes = [];
    for (const entry of value.routes) {
      if (!isRecord(entry) || !hasExactly(entry, ["pools", "token_in_amount"])) return null;
      const hops = readHops(entry.pools);
      if (!hops || typeof entry.token_in_amount !== "string") return null;
      routes.push({ hops, inAmount: entry.token_in_amount });
    }
    denom = value.token_in_denom;
  } else {
    return null;
  }
  if (typeof denom !== "string" || !DENOM.test(denom)) return null;
  const outputDenom = routes[0]?.hops[routes[0].hops.length - 1]?.tokenOutDenom ?? "";
  const amount = routes.reduce(
    (sum, route) => (POSITIVE_INT.test(route.inAmount) ? sum + BigInt(route.inAmount) : sum),
    ZERO,
  );
  if (routeProblem(routes, amount.toString(), outputDenom) !== null) return null;
  return {
    split: msg.typeUrl === POOL_SPLIT_SWAP_TYPE_URL,
    sender,
    sold: { denom, amount: amount.toString() },
    outputDenom,
    minOut,
    routes,
  };
}

/** Whether two sets of routes are the same order, pool for pool and amount for amount. */
export function sameRoutes(a: readonly PoolRoute[], b: readonly PoolRoute[]): boolean {
  return (
    a.length === b.length &&
    a.every((route, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        route.inAmount === other.inAmount &&
        route.hops.length === other.hops.length &&
        route.hops.every(
          (hop, at) => hop.poolId === other.hops[at]?.poolId && hop.tokenOutDenom === other.hops[at]?.tokenOutDenom,
        )
      );
    })
  );
}

const HEIGHT_KEYS: ReadonlySet<string> = new Set(["revision_number", "revision_height"]);

/** An ICS20 transfer's block-height timeout; both `"0"` when it sets none. */
export interface TimeoutHeight {
  readonly revisionNumber: string;
  readonly revisionHeight: string;
}

/**
 * A transfer's `timeout_height` as the message carries it: absent, or the two
 * counters (amino spells an unset one `{}`, and omits a zero counter). `null`
 * for anything else: a key it does not know, a counter that is not digits.
 */
export function readTimeoutHeight(raw: unknown): TimeoutHeight | null {
  if (raw === undefined) return { revisionNumber: "0", revisionHeight: "0" };
  if (!isRecord(raw) || !hasOnly(raw, HEIGHT_KEYS)) return null;
  const counter = (value: unknown) => (value === undefined ? "0" : typeof value === "string" && /^\d+$/.test(value) ? value : null);
  const revisionNumber = counter(raw.revision_number);
  const revisionHeight = counter(raw.revision_height);
  return revisionNumber === null || revisionHeight === null ? null : { revisionNumber, revisionHeight };
}

/** Whether a height timeout is set at all. Zunia never sets one: a swap's transfers time out by the clock only. */
export function hasHeightTimeout(height: TimeoutHeight): boolean {
  return /[1-9]/.test(height.revisionNumber) || /[1-9]/.test(height.revisionHeight);
}

/** An ICS20 transfer that sends a swap's output on, read from the message that is signed. */
export interface DeliveryTransferFacts {
  readonly sourcePort: string;
  readonly sourceChannel: string;
  readonly token: PoolCoin;
  readonly sender: string;
  readonly receiver: string;
  readonly memo: string;
  /** Nanoseconds since the epoch, digits; `"0"` when the transfer sets none. */
  readonly timeoutTimestamp: string;
  /** The block-height timeout; both `"0"` when the transfer sets none. */
  readonly timeoutHeight: TimeoutHeight;
}

const TRANSFER_KEYS: ReadonlySet<string> = new Set([
  "source_port",
  "source_channel",
  "token",
  "sender",
  "receiver",
  "timeout_height",
  "timeout_timestamp",
  "memo",
]);

/** Read the transfer a `pool-deliver` swap signs after the swap; `null` for anything else. */
export function readDeliveryTransfer(msg: MsgJson | undefined): DeliveryTransferFacts | null {
  if (!msg || msg.typeUrl !== TRANSFER_TYPE_URL || !isRecord(msg.value)) return null;
  const value = msg.value;
  if (!hasOnly(value, TRANSFER_KEYS)) return null;
  const { source_port, source_channel, token, sender, receiver, timeout_timestamp } = value;
  const memo = value.memo ?? "";
  if (
    typeof source_port !== "string" ||
    typeof source_channel !== "string" ||
    typeof sender !== "string" ||
    typeof receiver !== "string" ||
    typeof memo !== "string"
  ) {
    return null;
  }
  if (!isRecord(token) || !hasExactly(token, ["denom", "amount"])) return null;
  const { denom, amount } = token;
  if (typeof denom !== "string" || typeof amount !== "string" || !POSITIVE_INT.test(amount)) return null;
  // A height timeout, when present, is the two counters and nothing else
  // (amino spells an unset one `{}`).
  const timeoutHeight = readTimeoutHeight(value.timeout_height);
  if (!timeoutHeight) return null;
  const timeout =
    timeout_timestamp === undefined ? "0" : typeof timeout_timestamp === "string" ? timeout_timestamp : null;
  if (timeout === null || !/^\d+$/.test(timeout)) return null;
  return {
    sourcePort: source_port,
    sourceChannel: source_channel,
    token: { denom, amount },
    sender,
    receiver,
    memo,
    timeoutTimestamp: timeout,
    timeoutHeight,
  };
}
