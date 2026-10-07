/**
 * Ask the chain what a transaction would cost, before anyone signs it.
 *
 * POST /api/tx/simulate  {chainId, txBytes}  (a TxRaw with an empty
 * signature, built by `encodeSimulationTx`)
 * → 200 {chainId, gasUsed, gasWanted: null, updatedAt}  (`gasWanted` is always
 *   null: the simulated transaction carries no gas limit, so the node's
 *   `gas_wanted` is its own ceiling — 75,000,000 on the Hub, 2^64−1 on
 *   Safrochain — not a figure about this transaction)
 * → 422 {error:"simulation_failed", message, reason, rawLog}  the chain ran the
 *   transaction and it would fail (insufficient funds, sequence mismatch, an
 *   inactive proposal, a contract error). Answered before signing so nobody
 *   approves a transaction that cannot succeed; `reason` is an
 *   `explainTxError` kind, `message` plain words (the chain's own, cleaned of
 *   source paths, when the kind is "unknown").
 * → 400 / 403 / 413 / 415 / 429 / 503 as for `/api/broadcast`.
 *
 * The SDK skips signature verification in simulation but decodes the whole
 * transaction, so the signer's key and sequence must be real; the gas answer
 * is a measurement, and the caller adds its margin (×1.4).
 */

import { describeUpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";
import { badRequest, parseChainId } from "@/lib/server/validate";
import { explainTxError, isSimulationRefusal } from "@/lib/tx/errors";
import { chainMessage, postLcd } from "@/lib/tx/server/lcd";
import { MAX_TX_BASE64, parseTxBytes, readJsonBody, sameOriginProblem } from "@/lib/tx/server/request";

export const runtime = "nodejs";

const SIMULATE_TIMEOUT_MS = 10_000;

function noStore(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function uint(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  return null;
}

export async function POST(req: Request) {
  const forbidden = sameOriginProblem(req);
  if (forbidden) return forbidden;
  const limited = rateLimit(req, { scope: "simulate", capacity: 30, refillPerSecond: 0.5 });
  if (limited) return limited;

  let chain;
  let txBytes: string;
  try {
    const body = await readJsonBody(req, MAX_TX_BASE64 + 4_096);
    if (body instanceof Response) return body;
    chain = parseChainId(typeof body.chainId === "string" ? body.chainId : null);
    txBytes = parseTxBytes(body.txBytes ?? body.tx_bytes);
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
    answer = await postLcd(`${rest}/cosmos/tx/v1beta1/simulate`, { tx_bytes: txBytes }, SIMULATE_TIMEOUT_MS);
  } catch (error) {
    return noStore(
      { error: "upstream_failed", message: `${chain.chainName} did not answer the simulation (${describeUpstreamError(error)}).` },
      503,
    );
  }

  if (answer.status >= 200 && answer.status < 300) {
    const gasInfo = (answer.body as { gas_info?: { gas_used?: unknown } } | null)?.gas_info;
    const gasUsed = uint(gasInfo?.gas_used);
    if (!gasUsed || gasUsed === "0") {
      return noStore(
        { error: "upstream_unreadable", message: `${chain.chainName} answered the simulation without a gas figure.` },
        503,
      );
    }
    return privateJson({
      chainId: chain.chainId,
      gasUsed,
      gasWanted: null,
      updatedAt: Date.now(),
    });
  }

  // The chain refusing the transaction or the node failing: told apart by
  // the SDK's own wording, not the status (a failed simulation is HTTP 500 on
  // SDK 0.46+, like a crashed node; see `isSimulationRefusal`).
  const rawLog = chainMessage(answer.body);
  const grpcCode = (answer.body as { code?: unknown } | null)?.code;
  if (isSimulationRefusal(answer.status, rawLog, typeof grpcCode === "number" ? grpcCode : null)) {
    const explained = explainTxError(rawLog);
    return noStore(
      {
        error: "simulation_failed",
        message: explained.message,
        reason: explained.kind,
        rawLog: rawLog || null,
      },
      422,
    );
  }
  return noStore(
    { error: "upstream_failed", message: `${chain.chainName} could not run the simulation (HTTP ${answer.status}).` },
    503,
  );
}
