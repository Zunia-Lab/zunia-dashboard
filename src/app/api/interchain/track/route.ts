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
 *   can pull it out. This is the one that needs the user.
 */

import { NextRequest } from "next/server";
import {
  isInterchainError,
  trackRoute,
  type RoutePlan,
} from "@zunialab/interchain";
import { describeError, lcdResolver } from "@/lib/server/interchain";
import { swapVenueConfig } from "@/lib/server/swap-venue";

export const runtime = "nodejs";

interface TrackBody {
  plan?: unknown;
  sourceTxHash?: unknown;
  expectedAmount?: unknown;
  sourcePacketSequence?: unknown;
  recoveryAddress?: unknown;
}

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
  if (!Array.isArray(row.hops) || row.hops.length === 0) return null;

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

export async function POST(req: NextRequest) {
  let body: TrackBody;
  try {
    body = (await req.json()) as TrackBody;
  } catch {
    return bad("The request body was not JSON.");
  }

  const plan = readPlan(body.plan);
  if (!plan) return bad("The route plan was missing or unreadable.");
  const sourceTxHash = str(body.sourceTxHash);
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(sourceTxHash)) {
    return bad("A 64-character transaction hash is required.");
  }

  const expectedAmount = str(body.expectedAmount);
  const sourcePacketSequence = str(body.sourcePacketSequence);
  const recoveryAddress = str(body.recoveryAddress);

  // Only supplied when the plan actually contains a swap; the contract address
  // is what turns "your funds are recoverable" into a button that can be built.
  const needsVenue = plan.hops.some((hop) => hop.kind === "swap");
  const venue = needsVenue ? await swapVenueConfig() : null;

  try {
    const trace = await trackRoute(plan, sourceTxHash, lcdResolver, {
      signal: req.signal,
      ...(expectedAmount && /^\d+$/.test(expectedAmount)
        ? { expectedAmount }
        : {}),
      ...(sourcePacketSequence && /^\d+$/.test(sourcePacketSequence)
        ? { sourcePacketSequence }
        : {}),
      ...(venue?.contractAddress ? { swapContract: venue.contractAddress } : {}),
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
