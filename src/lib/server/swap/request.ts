/**
 * Reading and checking a swap quote request.
 *
 * Every value that reaches an upstream URL or a cache key passes through
 * here: the body must be bounded JSON, chain ids must be in the shipped
 * catalog, denoms must be bank denoms by the SDK's own rule (and not `cw20:`
 * pseudo-denoms, which no transfer or pool can move), amounts positive
 * integers of bounded length, slippage in the policy's range. A failure is a
 * `ParamError`, which the route turns into the dashboard's one 400 shape.
 */

import "server-only";

import { MAX_SLIPPAGE_PERCENT } from "@/config/interchain";
import { ParamError, parseChainId } from "@/lib/server/validate";
import { DENOM } from "@/lib/swap/denoms";
import type { SwapQuoteRequest } from "@/lib/swap/wire";
import { isRecord } from "@/lib/swap/types";

/** A quote body is a handful of short fields; anything larger is not one. */
const MAX_BODY_BYTES = 4_096;
/** Base units fit in a uint256 (78 digits); nothing sane is longer. */
const AMOUNT = /^[1-9]\d{0,77}$/;

/**
 * The JSON body of `req`, bounded; a `ParamError` (the route's 400) when it
 * is not `application/json`, too large, or not a JSON object.
 *
 * - The content type is required because `text/plain` is what a page on
 *   another site can POST without a CORS preflight; a JSON-only route is out
 *   of reach of such a form.
 * - The size is enforced while reading, not after: `Content-Length` can be
 *   absent (chunked) or wrong, and buffering an unbounded body to measure it
 *   is the cost the limit exists to avoid.
 */
export async function readBoundedJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new ParamError("content_type_invalid", "Send the body as application/json");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ParamError("body_too_large", "The request body is too large");
  }
  const bytes = await readCapped(req, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ParamError("body_invalid", "The request body is not JSON");
  }
  if (!isRecord(body)) throw new ParamError("body_invalid", "The request body must be a JSON object");
  return body;
}

/** The body's bytes, refusing (and cancelling the stream) past `maxBytes`. */
async function readCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ParamError("body_too_large", "The request body is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function parseDenom(raw: unknown, name: string): string {
  if (typeof raw !== "string" || raw.trim() === "") throw new ParamError(`${name}_required`, `${name} is required`);
  const value = raw.trim();
  if (!DENOM.test(value)) throw new ParamError(`${name}_invalid`, `${name} is not a denom`);
  if (/^cw20:/i.test(value)) throw new ParamError(`${name}_invalid`, `${name} is a CW20 token, which a swap cannot move`);
  return value;
}

function parseOptionalDenom(raw: unknown, name: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return parseDenom(raw, name);
}

/** A checked quote request, or a `ParamError`. */
export function parseQuoteRequest(body: Record<string, unknown>): SwapQuoteRequest {
  const from = parseChainId(typeof body.fromChainId === "string" ? body.fromChainId : null, "fromChainId");
  const to = parseChainId(typeof body.toChainId === "string" ? body.toChainId : null, "toChainId");
  const fromDenom = parseDenom(body.fromDenom, "fromDenom");
  const toDenom = parseDenom(body.toDenom, "toDenom");
  const amount = typeof body.amount === "string" ? body.amount.trim() : "";
  if (!AMOUNT.test(amount)) {
    throw new ParamError("amount_invalid", "amount must be a positive whole number of base units");
  }
  const slippage = body.slippagePercent;
  if (typeof slippage !== "number" || !Number.isFinite(slippage) || slippage <= 0 || slippage > MAX_SLIPPAGE_PERCENT) {
    throw new ParamError("slippage_invalid", `slippagePercent must be above 0 and at most ${MAX_SLIPPAGE_PERCENT}`);
  }
  // Six decimals is the engine's precision; finer is not a tolerance anyone chose.
  if (Math.round(slippage * 1e6) / 1e6 !== slippage) {
    throw new ParamError("slippage_invalid", "slippagePercent has more than six decimals");
  }
  const fromVenueDenom = parseOptionalDenom(body.fromVenueDenom, "fromVenueDenom");
  const toVenueDenom = parseOptionalDenom(body.toVenueDenom, "toVenueDenom");
  return {
    fromChainId: from.chainId,
    fromDenom,
    toChainId: to.chainId,
    toDenom,
    amount,
    slippagePercent: slippage,
    ...(fromVenueDenom ? { fromVenueDenom } : {}),
    ...(toVenueDenom ? { toVenueDenom } : {}),
  };
}
