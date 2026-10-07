/**
 * `GET /api/activity/{hash}?chainId=&address=` — one transaction, decoded
 * (lib/activity/types `TxDetail`): status, fee, gas, memo, every message in
 * words with its bounded JSON, event counts, coin movements, IBC packets and
 * an explorer link where the chain registry names one.
 *
 * Public and cacheable for a minute once found (an included transaction never
 * changes). With `address` the answer also carries that account's activity
 * row, which ties the hash to the address, so it is private.
 *
 * 404 `{error: "not_found"}` when the node does not have the hash: not indexed
 * yet (poll again), pruned from the node, or never existed.
 */

import type { NextRequest } from "next/server";
import { readTxDetail } from "@/lib/server/activity";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson, publicJson, upstreamFailure } from "@/lib/server/respond";
import { badRequest, parseAddress, parseChainId, parseTxHash } from "@/lib/server/validate";

export async function GET(req: NextRequest, context: { params: Promise<{ hash: string }> }) {
  const { hash: rawHash } = await context.params;
  const search = req.nextUrl.searchParams;
  let chainId: string;
  let hash: string;
  let address: string | undefined;
  try {
    const chain = parseChainId(search.get("chainId"));
    chainId = chain.chainId;
    hash = parseTxHash(rawHash.replace(/^0x/i, ""));
    const rawAddress = search.get("address");
    address = rawAddress ? parseAddress(rawAddress, chain) : undefined;
  } catch (error) {
    return badRequest(error);
  }

  const limited = rateLimit(req, { scope: "activity-tx", capacity: 60, refillPerSecond: 1 });
  if (limited) return limited;

  try {
    const detail = await readTxDetail(chainId, hash, address);
    if (!detail) {
      return Response.json(
        {
          error: "not_found",
          message: "This chain's node does not have that transaction: not indexed yet, pruned, or never sent.",
        },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    return address ? privateJson(detail) : publicJson(detail, { maxAge: 60, sMaxAge: 60, swr: 300 });
  } catch (error) {
    console.error("[api/activity/hash] read failed", error instanceof Error ? error.name : "unknown");
    return upstreamFailure("The chain's node could not be read", 503);
  }
}
