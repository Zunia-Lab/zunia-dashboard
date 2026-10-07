/**
 * Osmosis poolmanager swaps, in both encodings a wallet may sign them in.
 *
 * `MsgSwapExactAmountIn` (one route) and `MsgSplitRouteSwapExactAmountIn` (an
 * order the router split) are not in cosmjs-types, and the shared amino
 * encoder (`./amino-tx.ts`) does not know them, so their protobuf bytes and
 * their amino documents are written here, field for field:
 *
 * ```proto
 * message SwapAmountInRoute      { uint64 pool_id = 1; string token_out_denom = 2; }
 * message MsgSwapExactAmountIn   { string sender = 1; repeated SwapAmountInRoute routes = 2;
 *                                  cosmos.base.v1beta1.Coin token_in = 3 [(nullable) = false];
 *                                  string token_out_min_amount = 4; }
 * message SwapAmountInSplitRoute { repeated SwapAmountInRoute pools = 1; string token_in_amount = 2; }
 * message MsgSplitRouteSwapExactAmountIn { string sender = 1; repeated SwapAmountInSplitRoute routes = 2;
 *                                  string token_in_denom = 3; string token_out_min_amount = 4; }
 * ```
 *
 * The bytes are pinned to the osmojs-generated vectors zunia-core signs with
 * (`zunia-core/tests/vectors/cosmos-signing.json`, cases
 * `msg_swap_exact_amount_in`, `…_multi_hop`, `msg_split_route_swap_exact_amount_in`;
 * copied into src/lib/swap/__tests__/fixtures/poolmanager-vectors.json): a
 * one-byte difference is a signature that verifies against nothing, which the
 * chain reports as an opaque "unauthorized".
 *
 * The amino names are Osmosis's own registered ones, the names osmojs's amino
 * converter emits and the Osmosis app reconstructs: `osmosis/poolmanager/
 * swap-exact-amount-in` and `osmosis/poolmanager/split-amount-in`. Signing
 * mode is the signer's choice (`TxMessage` carries both); note the Zunia
 * extension refuses poolmanager over amino and signs it in direct mode.
 *
 * Every input is checked as it is written (`OsmosisEncodeError`): the encoder
 * is also how the swap read-back proves a message's bytes say exactly what its
 * amino document says (src/lib/swap/messages.ts), so it must refuse anything
 * it would otherwise coerce.
 */

import type { AminoMsg } from "@/lib/tx/amino-tx";
import { ProtoWriter } from "@/lib/tx/proto";
import type { TxMessage } from "@/lib/tx/types";

export const POOL_SWAP_TYPE_URL = "/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn";
export const POOL_SPLIT_SWAP_TYPE_URL = "/osmosis.poolmanager.v1beta1.MsgSplitRouteSwapExactAmountIn";
export const POOL_SWAP_AMINO_TYPE = "osmosis/poolmanager/swap-exact-amount-in";
export const POOL_SPLIT_SWAP_AMINO_TYPE = "osmosis/poolmanager/split-amount-in";

/** Amino type for each poolmanager type URL this module encodes. */
export const POOLMANAGER_AMINO_TYPES: Readonly<Record<string, string>> = {
  [POOL_SWAP_TYPE_URL]: POOL_SWAP_AMINO_TYPE,
  [POOL_SPLIT_SWAP_TYPE_URL]: POOL_SPLIT_SWAP_AMINO_TYPE,
};

/** Thrown for a value the encoder will not write. Never shown verbatim to a user. */
export class OsmosisEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OsmosisEncodeError";
  }
}

const UINT64_MAX = BigInt("18446744073709551615");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new OsmosisEncodeError(`${what} must have exactly ${keys.join(", ")}`);
  }
}

function str(value: unknown, what: string, pattern?: RegExp): string {
  if (typeof value !== "string" || value === "" || (pattern && !pattern.test(value))) {
    throw new OsmosisEncodeError(`${what} is not a valid string`);
  }
  return value;
}

const UINT_STRING = /^(0|[1-9]\d*)$/;

function poolId(value: unknown, what: string): bigint {
  const text = str(value, what, /^[1-9]\d*$/);
  const id = BigInt(text);
  if (id > UINT64_MAX) throw new OsmosisEncodeError(`${what} does not fit in a uint64`);
  return id;
}

function encodeCoin(denom: string, amount: string): Uint8Array {
  return new ProtoWriter().string(1, denom).string(2, amount).intoBytes();
}

/** `SwapAmountInRoute` from its proto-JSON (`{pool_id, token_out_denom}`). */
function encodeRoute(raw: unknown, what: string): Uint8Array {
  if (!isRecord(raw)) throw new OsmosisEncodeError(`${what} is not an object`);
  exactKeys(raw, ["pool_id", "token_out_denom"], what);
  return new ProtoWriter()
    .uint64(1, poolId(raw.pool_id, `${what}.pool_id`))
    .string(2, str(raw.token_out_denom, `${what}.token_out_denom`))
    .intoBytes();
}

function encodeRoutes(raw: unknown, what: string): Uint8Array[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new OsmosisEncodeError(`${what} must be a non-empty array`);
  return raw.map((route, index) => encodeRoute(route, `${what}[${index}]`));
}

/**
 * Protobuf bytes of `MsgSwapExactAmountIn` from its proto-JSON value
 * (`{sender, routes:[{pool_id, token_out_denom}], token_in:{denom, amount}, token_out_min_amount}`).
 */
export function encodeSwapExactAmountIn(value: unknown): Uint8Array {
  if (!isRecord(value)) throw new OsmosisEncodeError("MsgSwapExactAmountIn is not an object");
  exactKeys(value, ["sender", "routes", "token_in", "token_out_min_amount"], "MsgSwapExactAmountIn");
  const tokenIn = value.token_in;
  if (!isRecord(tokenIn)) throw new OsmosisEncodeError("token_in is not an object");
  exactKeys(tokenIn, ["denom", "amount"], "token_in");
  return new ProtoWriter()
    .string(1, str(value.sender, "sender"))
    .repeatedMessage(2, encodeRoutes(value.routes, "routes"))
    // `token_in` is non-nullable: written even if it were empty.
    .messageAlways(3, encodeCoin(str(tokenIn.denom, "token_in.denom"), str(tokenIn.amount, "token_in.amount", UINT_STRING)))
    .string(4, str(value.token_out_min_amount, "token_out_min_amount", UINT_STRING))
    .intoBytes();
}

/**
 * Protobuf bytes of `MsgSplitRouteSwapExactAmountIn` from its proto-JSON value
 * (`{sender, routes:[{pools:[…], token_in_amount}], token_in_denom, token_out_min_amount}`).
 */
export function encodeSplitRouteSwapExactAmountIn(value: unknown): Uint8Array {
  if (!isRecord(value)) throw new OsmosisEncodeError("MsgSplitRouteSwapExactAmountIn is not an object");
  exactKeys(value, ["sender", "routes", "token_in_denom", "token_out_min_amount"], "MsgSplitRouteSwapExactAmountIn");
  const routes = value.routes;
  if (!Array.isArray(routes) || routes.length === 0) throw new OsmosisEncodeError("routes must be a non-empty array");
  const splits = routes.map((raw, index) => {
    const what = `routes[${index}]`;
    if (!isRecord(raw)) throw new OsmosisEncodeError(`${what} is not an object`);
    exactKeys(raw, ["pools", "token_in_amount"], what);
    return new ProtoWriter()
      .repeatedMessage(1, encodeRoutes(raw.pools, `${what}.pools`))
      .string(2, str(raw.token_in_amount, `${what}.token_in_amount`, UINT_STRING))
      .intoBytes();
  });
  return new ProtoWriter()
    .string(1, str(value.sender, "sender"))
    .repeatedMessage(2, splits)
    .string(3, str(value.token_in_denom, "token_in_denom"))
    .string(4, str(value.token_out_min_amount, "token_out_min_amount", UINT_STRING))
    .intoBytes();
}

/** Protobuf bytes of either poolmanager message from its proto-JSON value. */
export function encodePoolSwap(typeUrl: string, value: unknown): Uint8Array {
  if (typeUrl === POOL_SWAP_TYPE_URL) return encodeSwapExactAmountIn(value);
  if (typeUrl === POOL_SPLIT_SWAP_TYPE_URL) return encodeSplitRouteSwapExactAmountIn(value);
  throw new OsmosisEncodeError(`${typeUrl} is not a poolmanager swap this build encodes`);
}

/**
 * The amino document of a poolmanager swap. Osmosis's amino JSON is the
 * proto-JSON with `pool_id` as a decimal string, which is exactly the value
 * this module takes, so the document carries the value unchanged (a deep copy,
 * so a later edit of the caller's object cannot change what is signed).
 */
export function poolSwapAmino(typeUrl: string, value: Readonly<Record<string, unknown>>): AminoMsg {
  const type = Object.hasOwn(POOLMANAGER_AMINO_TYPES, typeUrl) ? POOLMANAGER_AMINO_TYPES[typeUrl] : undefined;
  if (!type) throw new OsmosisEncodeError(`${typeUrl} has no amino name in this build`);
  // Encoding first validates the whole value, so an amino document is only
  // ever produced for a message whose bytes exist too.
  encodePoolSwap(typeUrl, value);
  return { type, value: JSON.parse(JSON.stringify(value)) as Record<string, unknown> };
}

/** A poolmanager swap as a signable message: protobuf bytes plus its amino document. */
export function poolSwapTxMessage(
  typeUrl: string,
  value: Readonly<Record<string, unknown>>,
  summary?: string,
): TxMessage {
  return {
    typeUrl,
    value: encodePoolSwap(typeUrl, value),
    amino: poolSwapAmino(typeUrl, value),
    ...(summary ? { summary } : {}),
  };
}
