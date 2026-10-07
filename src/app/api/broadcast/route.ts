/**
 * Broadcast a signed `TxRaw`.
 *
 * POST /api/broadcast  {chainId, txBytes, address?}   (`tx_bytes` accepted too)
 * → 200 {chainId, txHash, txhash, code, codespace, rawLog, success, updatedAt}
 *   for any answer the chain gave about the transaction — including a CheckTx
 *   rejection (`code ≠ 0`): the hash is deterministic over the signed bytes, so
 *   it exists even for a rejected transaction, and it is the one identifier a
 *   user and a support engineer can both look up.
 * → 422 {error:"tx_rejected", message}  the node refused the bytes outright.
 * → 400 / 403 / 413 / 415 / 429  input, origin, size, type, rate.
 * → 503 {error:"upstream_failed", message}  the node could not be reached —
 *   the transaction may or may not have reached a mempool, and the copy says so.
 *
 * Sync mode only: the node runs CheckTx and answers; inclusion is followed by
 * `/api/tx/[hash]`. `BROADCAST_MODE_BLOCK` was removed in SDK 0.47 and held a
 * connection open for a whole block where it existed.
 *
 * `address` (optional, the signer; must be an address of `chainId`) makes an
 * accepted transaction drop this server's cached reads of that account —
 * balances, staking, activity — so the refresh the page runs once the
 * transaction lands is not served the pre-transaction answer for 30 s.
 *
 * The browser never talks to a chain node; it posts here. The old indexer leg
 * (`/v1/tx/broadcast`, a route the indexer never had) is gone: it cost a failed
 * round trip and a log line on every send.
 */

import { isInterchainError, parseBroadcastResponse } from "@zunialab/interchain";
import { describeUpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";
import { badRequest, ParamError, parseAddress, parseChainId } from "@/lib/server/validate";
import { chainMessage, postLcd } from "@/lib/tx/server/lcd";
import { forgetAccountReads } from "@/lib/tx/server/invalidate";
import { MAX_TX_BASE64, parseTxBytes, readJsonBody, sameOriginProblem } from "@/lib/tx/server/request";

export const runtime = "nodejs";

const BROADCAST_TIMEOUT_MS = 15_000;

function noStore(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const forbidden = sameOriginProblem(req);
  if (forbidden) return forbidden;
  const limited = rateLimit(req, { scope: "broadcast", capacity: 12, refillPerSecond: 0.2 });
  if (limited) return limited;

  let chain;
  let txBytes: string;
  let signer: string | null = null;
  try {
    const body = await readJsonBody(req, MAX_TX_BASE64 + 4_096);
    if (body instanceof Response) return body;
    chain = parseChainId(typeof body.chainId === "string" ? body.chainId : null);
    txBytes = parseTxBytes(body.txBytes ?? body.tx_bytes);
    if (body.address !== undefined && body.address !== null) {
      signer = parseAddress(typeof body.address === "string" ? body.address : "", chain);
    }
    if (body.mode !== undefined && body.mode !== "BROADCAST_MODE_SYNC" && body.mode !== "sync") {
      throw new ParamError("mode_invalid", "Only sync broadcast is supported");
    }
  } catch (error) {
    return badRequest(error);
  }

  const rest = restOf(chain.chainId);
  if (!rest) {
    return noStore(
      { error: "no_endpoint", message: `${chain.chainName} has no public REST endpoint in this build's catalog.` },
      503,
    );
  }

  let answer;
  try {
    answer = await postLcd(`${rest}/cosmos/tx/v1beta1/txs`, { tx_bytes: txBytes, mode: "BROADCAST_MODE_SYNC" }, BROADCAST_TIMEOUT_MS);
  } catch (error) {
    return noStore(
      {
        error: "upstream_failed",
        message: `${chain.chainName} did not answer (${describeUpstreamError(error)}). The transaction may still have been sent: check Activity before sending it again.`,
      },
      503,
    );
  }

  if (answer.status >= 200 && answer.status < 300) {
    try {
      const parsed = parseBroadcastResponse(answer.body, chain.chainId);
      // Accepted (or already held: the same bytes twice): its effects are
      // coming, so cached reads of the signer stop being the truth now.
      if (signer && (parsed.code === 0 || parsed.code === 19)) forgetAccountReads(chain.chainId, signer);
      return privateJson({
        chainId: chain.chainId,
        txHash: parsed.txHash,
        // Legacy field name, still read by pages that have not moved to the
        // sign hook yet.
        txhash: parsed.txHash,
        code: parsed.code,
        codespace: parsed.codespace,
        rawLog: chainMessage({ message: parsed.rawLog }, 1_000),
        success: parsed.code === 0,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.warn("[broadcast] unreadable answer", chain.chainId, isInterchainError(error) ? error.code : "");
      return noStore(
        {
          error: "upstream_unreadable",
          message: `${chain.chainName} answered in a shape Zunia cannot read. Check Activity before sending again.`,
        },
        503,
      );
    }
  }

  if (answer.status >= 400 && answer.status < 500) {
    const reason = chainMessage(answer.body);
    return noStore(
      {
        error: "tx_rejected",
        message: reason || `${chain.chainName} refused the transaction (HTTP ${answer.status}).`,
      },
      422,
    );
  }

  return noStore(
    {
      error: "upstream_failed",
      message: `${chain.chainName} answered HTTP ${answer.status}. The transaction may still have been sent: check Activity before sending it again.`,
    },
    503,
  );
}
