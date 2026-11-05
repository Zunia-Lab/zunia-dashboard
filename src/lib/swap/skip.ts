/**
 * The packet memo that swaps tokens from another chain in one signature:
 * an ICS20 transfer to Skip Go's entry point on Osmosis whose memo calls
 * `swap_and_action` through ibc-hooks. On arrival the entry point swaps the
 * tokens the packet carried along the pools Zunia quoted, refuses to pay out
 * less than the reviewed minimum, then sends the output to the user on
 * Osmosis or one IBC hop on.
 *
 * Failure: when the call fails on Osmosis (the price moved past the minimum,
 * the swap's deadline passed), ibc-hooks acknowledges the packet with an
 * error and the tokens go back to the sender on their own chain. When the
 * last hop fails, the IBC adapter pays the output to `recover_address`, the
 * user's Osmosis address.
 *
 * The entry point reads `timeout_timestamp` as a u64, so the memo carries it
 * as a bare JSON number (nanoseconds, nineteen digits, past what a JS number
 * holds). It is written from a decimal string, never through `Number`, and
 * read back the same way.
 *
 * Pure: no network, no storage, no clock.
 */

import { SKIP_SWAP_VENUE_NAME } from "@/config/interchain";
import { isRecord } from "@/lib/swap/types";

/** One pool hop, as the entry point takes it. */
export interface SkipOperation {
  readonly pool: string;
  readonly denomIn: string;
  readonly denomOut: string;
}

/** What the entry point does with the output once it holds it. */
export type SkipPostSwap =
  /** Pay it on Osmosis. */
  | { readonly kind: "transfer"; readonly toAddress: string }
  /** Send it one IBC hop on; a failed delivery pays `recoverAddress` on Osmosis. */
  | {
      readonly kind: "ibc-transfer";
      readonly channelId: string;
      readonly receiver: string;
      readonly recoverAddress: string;
    };

/** Everything a one-signature swap memo says. */
export interface SkipSwapParams {
  /** The entry point the memo calls. */
  readonly entryPoint: string;
  /** The pools, in order; the first takes the denom the packet lands as. */
  readonly operations: readonly SkipOperation[];
  /** The least the swap may pay out, on Osmosis. */
  readonly minOut: { readonly denom: string; readonly amount: string };
  /** When the entry point stops swapping: nanoseconds since the epoch, decimal. */
  readonly timeoutNs: string;
  readonly postSwap: SkipPostSwap;
}

/** More hops than any route Zunia quotes; past it a memo is not read. */
export const MAX_SKIP_OPERATIONS = 8;

const U64_MAX = BigInt("18446744073709551615");
const DIGITS = /^\d{1,20}$/;
const TIMEOUT_TOKEN = "__zunia_skip_timeout__";
const TIMEOUT_FIELD = /"timeout_timestamp":(\d{1,20})(?=[,}])/g;

function u64(text: string): boolean {
  return DIGITS.test(text) && BigInt(text) <= U64_MAX;
}

/** The hops the entry point takes for a quoted route: pool ids and the denom each pays out, in order. */
export function skipOperationsOf(
  inputDenom: string,
  pools: readonly { readonly id: string; readonly tokenOutDenom: string }[],
): SkipOperation[] {
  const operations: SkipOperation[] = [];
  let denomIn = inputDenom;
  for (const pool of pools) {
    operations.push({ pool: pool.id, denomIn, denomOut: pool.tokenOutDenom });
    denomIn = pool.tokenOutDenom;
  }
  return operations;
}

/** Why `params` cannot make a memo, or `null` when they can. */
export function skipParamsProblem(params: SkipSwapParams): string | null {
  const { operations, minOut } = params;
  if (!params.entryPoint) return "The swap has no contract to call.";
  if (operations.length === 0 || operations.length > MAX_SKIP_OPERATIONS) return "The swap has no route Zunia can sign.";
  for (const [index, operation] of operations.entries()) {
    if (!DIGITS.test(operation.pool) || !operation.denomIn || !operation.denomOut) return "The swap route names a pool Zunia cannot read.";
    const previous = operations[index - 1];
    if (previous && previous.denomOut !== operation.denomIn) return "The swap route does not chain from one pool to the next.";
  }
  if (operations[operations.length - 1]?.denomOut !== minOut.denom) return "The swap route does not end in the token bought.";
  if (!/^\d+$/.test(minOut.amount) || BigInt(minOut.amount) <= BigInt(0)) return "The swap has no minimum to sign.";
  if (!u64(params.timeoutNs)) return "The swap's deadline cannot be written.";
  const post = params.postSwap;
  if (post.kind === "transfer" ? !post.toAddress : !post.channelId || !post.receiver || !post.recoverAddress) {
    return "The swap does not say where its output goes.";
  }
  return null;
}

/** The `swap_and_action` call, with the deadline as a placeholder string (see {@link buildSkipSwapMemo}). */
function callOf(params: SkipSwapParams): Record<string, unknown> {
  const post = params.postSwap;
  return {
    swap_and_action: {
      user_swap: {
        swap_exact_asset_in: {
          swap_venue_name: SKIP_SWAP_VENUE_NAME,
          operations: params.operations.map((operation) => ({
            pool: operation.pool,
            denom_in: operation.denomIn,
            denom_out: operation.denomOut,
          })),
        },
      },
      min_asset: { native: { denom: params.minOut.denom, amount: params.minOut.amount } },
      timeout_timestamp: TIMEOUT_TOKEN,
      post_swap_action:
        post.kind === "transfer"
          ? { transfer: { to_address: post.toAddress } }
          : {
              ibc_transfer: {
                ibc_info: {
                  source_channel: post.channelId,
                  receiver: post.receiver,
                  memo: "",
                  recover_address: post.recoverAddress,
                },
              },
            },
      affiliates: [],
    },
  };
}

/**
 * The packet memo: `{"wasm":{"contract":…,"msg":{"swap_and_action":{…}}}}`,
 * compact, keys in a fixed order, the deadline a bare number. Throws when
 * {@link skipParamsProblem} has a reason.
 */
export function buildSkipSwapMemo(params: SkipSwapParams): string {
  const problem = skipParamsProblem(params);
  if (problem) throw new Error(problem);
  const text = JSON.stringify({ wasm: { contract: params.entryPoint, msg: callOf(params) } });
  return text.replace(`"${TIMEOUT_TOKEN}"`, params.timeoutNs);
}

/* -------------------------------------------------------------------------- *
 * Reading a memo back
 * -------------------------------------------------------------------------- */

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function readOperations(value: unknown): SkipOperation[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SKIP_OPERATIONS) return null;
  const operations: SkipOperation[] = [];
  for (const raw of value) {
    if (!exactKeys(raw, ["pool", "denom_in", "denom_out"])) return null;
    const pool = text(raw.pool);
    const denomIn = text(raw.denom_in);
    const denomOut = text(raw.denom_out);
    if (!pool || !DIGITS.test(pool) || !denomIn || !denomOut) return null;
    const previous = operations[operations.length - 1];
    if (previous && previous.denomOut !== denomIn) return null;
    operations.push({ pool, denomIn, denomOut });
  }
  return operations;
}

function readPostSwap(value: unknown): SkipPostSwap | null {
  if (exactKeys(value, ["transfer"])) {
    const transfer = value.transfer;
    if (!exactKeys(transfer, ["to_address"])) return null;
    const toAddress = text(transfer.to_address);
    return toAddress ? { kind: "transfer", toAddress } : null;
  }
  if (exactKeys(value, ["ibc_transfer"])) {
    const ibc = value.ibc_transfer;
    if (!exactKeys(ibc, ["ibc_info"])) return null;
    const info = ibc.ibc_info;
    if (!exactKeys(info, ["source_channel", "receiver", "memo", "recover_address"])) return null;
    const channelId = text(info.source_channel);
    const receiver = text(info.receiver);
    const recoverAddress = text(info.recover_address);
    // A memo on the last hop would run something nobody reviewed.
    if (!channelId || !receiver || !recoverAddress || info.memo !== "") return null;
    return { kind: "ibc-transfer", channelId, receiver, recoverAddress };
  }
  return null;
}

/**
 * Read a one-signature swap memo, or `null` for any other memo and for one
 * that is not exactly the shape {@link buildSkipSwapMemo} writes: compact,
 * no field it does not write (a `sent_asset`, an affiliate, a memo on the
 * last hop, a swap-out), the deadline a bare number that fits a u64.
 */
export function readSkipSwapMemo(memo: string): SkipSwapParams | null {
  const deadlines = [...memo.matchAll(TIMEOUT_FIELD)];
  if (deadlines.length !== 1) return null;
  const timeoutNs = deadlines[0]![1]!;
  if (!u64(timeoutNs)) return null;
  const quoted = memo.replace(TIMEOUT_FIELD, `"timeout_timestamp":"${timeoutNs}"`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(quoted);
  } catch {
    return null;
  }
  // Compact and free of duplicate keys: serializing what was read gives back the memo.
  if (JSON.stringify(parsed) !== quoted) return null;
  if (!exactKeys(parsed, ["wasm"]) || !exactKeys(parsed.wasm, ["contract", "msg"])) return null;
  const entryPoint = text(parsed.wasm.contract);
  if (!entryPoint || !exactKeys(parsed.wasm.msg, ["swap_and_action"])) return null;
  const body = parsed.wasm.msg.swap_and_action;
  if (!exactKeys(body, ["user_swap", "min_asset", "timeout_timestamp", "post_swap_action", "affiliates"])) return null;
  if (!Array.isArray(body.affiliates) || body.affiliates.length !== 0) return null;
  if (body.timeout_timestamp !== timeoutNs) return null;
  if (!exactKeys(body.user_swap, ["swap_exact_asset_in"])) return null;
  const swap = body.user_swap.swap_exact_asset_in;
  if (!exactKeys(swap, ["swap_venue_name", "operations"]) || swap.swap_venue_name !== SKIP_SWAP_VENUE_NAME) return null;
  const operations = readOperations(swap.operations);
  if (!operations) return null;
  if (!exactKeys(body.min_asset, ["native"]) || !exactKeys(body.min_asset.native, ["denom", "amount"])) return null;
  const minDenom = text(body.min_asset.native.denom);
  const minAmount = text(body.min_asset.native.amount);
  if (!minDenom || !minAmount || !/^\d+$/.test(minAmount)) return null;
  if (operations[operations.length - 1]!.denomOut !== minDenom) return null;
  const postSwap = readPostSwap(body.post_swap_action);
  if (!postSwap) return null;
  return { entryPoint, operations, minOut: { denom: minDenom, amount: minAmount }, timeoutNs, postSwap };
}

/** Whether `wasm.msg` (an ibc-hooks call, parsed loosely) is the entry point's `swap_and_action`. */
export function isSkipSwapCall(msg: unknown): msg is { swap_and_action: Record<string, unknown> } {
  return isRecord(msg) && Object.keys(msg).length === 1 && isRecord(msg.swap_and_action);
}

/** The denom a loosely parsed `swap_and_action` call buys (its minimum's), or `null`. */
export function skipBoughtDenom(msg: unknown): string | null {
  if (!isSkipSwapCall(msg)) return null;
  const min = msg.swap_and_action.min_asset;
  const native = isRecord(min) ? min.native : null;
  return isRecord(native) && typeof native.denom === "string" && native.denom ? native.denom : null;
}
