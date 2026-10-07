/**
 * Whether one transaction is in a block yet, and whether it succeeded.
 *
 * GET /api/tx/<64-hex hash>?chainId=<catalog id>[&address=<signer>]
 * → 200 TxOutcome + {chainId, txHash, updatedAt}
 *   - `pending`: the node has not indexed the hash (404) or knows it without a
 *     height. The normal answer for the first seconds after a broadcast, and
 *     for a while on a load-balanced gateway; never folded into failure,
 *     because telling someone their money vanished when it did not is worse
 *     than "still waiting".
 *   - `success` / `failed` with height, gas, code, codespace and the chain's
 *     raw log (bounded) for `explainTxError`.
 * → 400 bad hash / chain, 429, 503 when the node could not be read (pollers
 *   keep polling).
 *
 * Polled every 2 s by the sign flow; a 1.5 s single-flight cache folds
 * concurrent polls of the same hash into one upstream read. With `address`
 * (the signer, an address of `chainId`), a final answer also drops this
 * server's cached reads of that account, so the balances the page refreshes
 * right after are the post-transaction ones.
 */

import type { NextRequest } from "next/server";
import { parseTxStatus } from "@zunialab/interchain";
import { cached } from "@/lib/server/cache";
import { describeUpstreamError, fetchJson, UpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";
import { badRequest, parseAddress, parseChainId, parseTxHash } from "@/lib/server/validate";
import { forgetAccountReads } from "@/lib/tx/server/invalidate";
import { chainMessage } from "@/lib/tx/server/lcd";
import type { TxOutcome } from "@/lib/tx/types";

export const runtime = "nodejs";

function num(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function readOutcome(rest: string, chainId: string, hash: string): Promise<TxOutcome> {
  let body: unknown;
  try {
    body = await fetchJson(`${rest}/cosmos/tx/v1beta1/txs/${hash}`, { timeoutMs: 6_000 });
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "http" && error.status === 404) {
      return { status: "pending", txHash: hash };
    }
    throw error;
  }
  const status = parseTxStatus(body, chainId, hash);
  const response = (body as { tx_response?: { codespace?: unknown } } | null)?.tx_response;
  const codespace = typeof response?.codespace === "string" && response.codespace ? response.codespace : undefined;
  if (status.state === "pending" || status.state === "not-found") return { status: "pending", txHash: status.txHash };
  return {
    status: status.state,
    txHash: status.txHash,
    height: num(status.height),
    gasUsed: num(status.gasUsed),
    gasWanted: num(status.gasWanted),
    code: status.code ?? undefined,
    ...(codespace ? { codespace } : {}),
    ...(status.state === "failed" && status.rawLog ? { rawLog: chainMessage({ message: status.rawLog }, 1_000) } : {}),
    ...(status.timestamp ? { timestamp: status.timestamp } : {}),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const limited = rateLimit(req, { scope: "tx-status", capacity: 90, refillPerSecond: 2 });
  if (limited) return limited;

  let chain;
  let hash: string;
  let signer: string | null = null;
  try {
    hash = parseTxHash((await params).hash);
    chain = parseChainId(req.nextUrl.searchParams.get("chainId"));
    const rawSigner = req.nextUrl.searchParams.get("address");
    if (rawSigner) signer = parseAddress(rawSigner, chain);
  } catch (error) {
    return badRequest(error);
  }
  const rest = restOf(chain.chainId);
  if (!rest) {
    return Response.json(
      { error: "no_endpoint", message: `${chain.chainName} has no public REST endpoint in this build's catalog.` },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const outcome = await cached(
      `wallet:tx:${chain.chainId}:${hash}`,
      { ttlMs: 1_500, staleMs: 0, errorTtlMs: 1_000 },
      () => readOutcome(rest, chain.chainId, hash),
    );
    if (signer && (outcome.status === "success" || outcome.status === "failed")) {
      forgetAccountReads(chain.chainId, signer);
    }
    return privateJson({ chainId: chain.chainId, ...outcome, txHash: outcome.txHash ?? hash, updatedAt: Date.now() });
  } catch (error) {
    return Response.json(
      {
        error: "upstream_failed",
        message: `Could not read the transaction on ${chain.chainName}: ${describeUpstreamError(error)}.`,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
