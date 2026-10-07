/**
 * Follow a signed transfer hop by hop.
 *
 * The plan comes back from the client because the walk needs it: each hop's
 * channel is what identifies the packet the previous hop forwarded. Nothing
 * here trusts the plan for anything but that — it is used to address LCD reads,
 * never to decide what happened. Every status comes from the chains.
 *
 * The four failures are kept distinct all the way to the wire, because the
 * user's next action differs in every one:
 *
 * - `timeout`   — the packet expired and the escrow was returned. Funds safe.
 * - `ack-error` — the destination rejected it and the escrow was returned.
 * - `stalled`   — nothing has failed; it is simply late. Funds safe, wait.
 * - `swap-delivery-failed` — the swap ran and the payout did not land. The
 *   output sits in the crosschain-swaps contract and only the recovery address
 *   can pull it out. This is the one that needs the user. The contract the
 *   recovery names is the one the swap engine's venue check verified on chain
 *   (`recoveryContractFor`), never an unchecked setting.
 *
 * Polled every 6 s per transfer in flight (the tracker page, the activity
 * packet view, the live menu's watcher), so the rate limit leaves room for
 * several at once. The body carries the plan and its memo, hence 64 KB.
 */

import { NextRequest } from "next/server";
import {
  isInterchainError,
  trackRoute,
  type RoutePlan,
} from "@zunialab/interchain";
import { describeError, lcdResolver } from "@/lib/server/interchain";
import { boundedBody, foreignOrigin, overLimit } from "@/lib/server/interchain-request";
import { recoveryContractFor } from "@/lib/server/interchain-rules";
import { swapVenue } from "@/lib/server/swap/venue";

export const runtime = "nodejs";

interface TrackBody {
  plan?: unknown;
  sourceTxHash?: unknown;
  expectedAmount?: unknown;
  sourcePacketSequence?: unknown;
  recoveryAddress?: unknown;
}

/** Longer than any plan the planner builds (`maxHops` is 3–4). */
const MAX_HOPS = 8;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bad(message: string) {
  return Response.json({ ok: false, code: "bad-request", message }, { status: 400 });
}

/**
 * Narrow the plan the client sent back.
 *
 * It went out of this server one request ago, but it came back over the
 * network, so it is checked like anything else. A malformed plan produces a
 * `bad-request`, not a half-walked trace.
 */
function readPlan(value: unknown): RoutePlan | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const sourceChainId = str(row.sourceChainId);
  const destChainId = str(row.destChainId);
  if (!sourceChainId || !destChainId) return null;
  // A route is a handful of hops; each one tracked is a chain read.
  if (!Array.isArray(row.hops) || row.hops.length === 0 || row.hops.length > MAX_HOPS) return null;

  const hops: RoutePlan["hops"][number][] = [];
  for (const entry of row.hops) {
    if (typeof entry !== "object" || entry === null) return null;
    const hop = entry as Record<string, unknown>;
    const chainId = str(hop.chainId);
    if (!chainId) return null;
    const kind = str(hop.kind);
    if (kind !== "transfer" && kind !== "forward" && kind !== "swap") return null;
    hops.push({
      chainId,
      channelId: str(hop.channelId),
      port: str(hop.port) || "transfer",
      counterpartyChainId: str(hop.counterpartyChainId) || null,
      kind,
    });
  }

  return {
    sourceChainId,
    destChainId,
    inputDenom: str(row.inputDenom),
    outputDenom: str(row.outputDenom),
    hops,
    memo: typeof row.memo === "string" ? row.memo : "",
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter((w): w is string => typeof w === "string")
      : [],
    estimatedDurationSeconds:
      typeof row.estimatedDurationSeconds === "number" &&
      Number.isFinite(row.estimatedDurationSeconds)
        ? row.estimatedDurationSeconds
        : 0,
    requiresPfm: row.requiresPfm === true,
    requiresIbcHooks: row.requiresIbcHooks === true,
  };
}

const MAX_BODY_BYTES = 65_536;

export async function POST(req: NextRequest) {
  const foreign = foreignOrigin(req);
  if (foreign) return foreign;
  const limited = overLimit(req, { scope: "interchain-track", capacity: 60, refillPerSecond: 1 });
  if (limited) return limited;
  const parsed = await boundedBody(req, MAX_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as TrackBody;

  const plan = readPlan(body.plan);
  if (!plan) return bad("The route plan was missing or unreadable.");
  const sourceTxHash = str(body.sourceTxHash);
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(sourceTxHash)) {
    return bad("A 64-character transaction hash is required.");
  }

  const expectedAmount = str(body.expectedAmount);
  const sourcePacketSequence = str(body.sourcePacketSequence);
  const recoveryAddress = str(body.recoveryAddress);

  // Only looked up when the plan actually contains a swap; the verified
  // contract address is what turns "your funds are recoverable" into a button
  // that can be built.
  const needsVenue = plan.hops.some((hop) => hop.kind === "swap");
  const swapContract = needsVenue ? recoveryContractFor(plan.hops, await swapVenue()) : null;

  try {
    const trace = await trackRoute(plan, sourceTxHash, lcdResolver, {
      signal: req.signal,
      ...(expectedAmount && /^\d+$/.test(expectedAmount)
        ? { expectedAmount }
        : {}),
      ...(sourcePacketSequence && /^\d+$/.test(sourcePacketSequence)
        ? { sourcePacketSequence }
        : {}),
      ...(swapContract ? { swapContract } : {}),
      ...(recoveryAddress ? { recoveryAddress } : {}),
      // Polling: a short cache keeps a 5-second poll from re-reading the same
      // committed transaction on every tick without pinning a stale answer.
      request: { cacheTtlMs: 3_000 },
    });

    return Response.json({
      ok: true,
      trace: {
        sourceChainId: trace.sourceChainId,
        destChainId: trace.destChainId,
        sourceTxHash: trace.sourceTxHash,
        hops: trace.hops.map((hop) => ({
          index: hop.index,
          chainId: hop.chainId,
          channelId: hop.channelId,
          port: hop.port,
          counterpartyChainId: hop.counterpartyChainId,
          kind: hop.kind,
          sequence: hop.sequence,
          sendTxHash: hop.sendTxHash,
          receiveTxHash: hop.receiveTxHash,
          status: hop.status,
          error: hop.error,
          stalled: hop.stalled,
          fundsRefunded: hop.fundsRefunded,
        })),
        status: trace.status,
        failure: trace.failure,
        stalled: trace.stalled,
        currentHopIndex: trace.currentHopIndex,
        elapsedSeconds: trace.elapsedSeconds,
        estimatedDurationSeconds: trace.estimatedDurationSeconds,
        updatedAt: trace.updatedAt,
        notes: trace.notes,
        recovery: trace.recovery
          ? {
              chainId: trace.recovery.chainId,
              contractAddress: trace.recovery.contractAddress,
              recoveryAddress: trace.recovery.recoveryAddress,
              // `msg` is non-null only when both addresses are present. False
              // means the recover control must be disabled with that reason,
              // not hidden: the funds are still recoverable, just not from
              // here until the contract address is configured.
              ready: trace.recovery.msg !== null,
              executeMsgJson: JSON.stringify(trace.recovery.executeMsg),
            }
          : null,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message: describeError(error, "The transfer could not be tracked."),
    });
  }
}
