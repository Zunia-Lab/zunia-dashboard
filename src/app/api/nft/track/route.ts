/**
 * Where an ICS721 packet got to.
 *
 * A cross-chain NFT transfer that ends at "broadcast" tells the user nothing
 * about the thing they actually care about: their token is now locked in a
 * bridge contract and a voucher may or may not have been minted on the other
 * side. So the packet is followed, with the same engine primitives the ICS20
 * tracker uses.
 *
 * It is not `trackRoute`. That takes a `RoutePlan`, whose hops are ICS20
 * transfer hops, and an ICS721 packet does not travel on the `transfer` port —
 * cw-ics721 binds `wasm.<bridge-address>`. What is reused instead is the layer
 * below it: `extractPacketsFromTx` reads the `send_packet` event out of the
 * source transaction, port and all, and `getPacketStatus` resolves that packet
 * by sequence and channel, which is port-agnostic.
 *
 * Two statuses are returned and they mean different things. The transaction
 * status says whether the chain accepted the execute; the packet status says
 * whether the destination received it. A transaction can succeed and its packet
 * can still time out — at which point the bridge returns the token, which is
 * the case the copy has to name.
 */

import { NextRequest } from "next/server";
import {
  extractPacketsFromTx,
  getPacketStatus,
  getTxStatus,
  isInterchainError,
  type ExtractedPacket,
} from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { lcdFor } from "@/lib/server/interchain";
import { describeNftError } from "@/lib/server/nft";

export const runtime = "nodejs";

const TX_HASH = /^[0-9A-Fa-f]{64}$/;

/**
 * The ICS721 packet in a transaction, if there is one.
 *
 * cw-ics721 binds a port named `wasm.<contract>`, so when the bridge address is
 * known the match is exact. Without it, any `wasm.` port is taken — a CW721
 * execute that emits a `send_packet` at all is doing exactly one thing.
 * `transfer` packets are never matched here: those belong to the ICS20 tracker
 * and picking one up would report a token transfer as an NFT transfer.
 */
function findIcs721Packet(
  packets: readonly ExtractedPacket[],
  bridgeContract: string | null,
): ExtractedPacket | null {
  const exact = bridgeContract ? `wasm.${bridgeContract}` : null;
  if (exact) {
    const hit = packets.find((packet) => packet.sourcePort === exact);
    if (hit) return hit;
  }
  return packets.find((packet) => packet.sourcePort.startsWith("wasm.")) ?? null;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const chainId = params.get("chainId")?.trim() ?? "";
  const hash = params.get("hash")?.trim() ?? "";
  const destChainId = params.get("destChainId")?.trim() || null;
  const bridgeContract = params.get("bridge")?.trim() || null;

  if (!chainId || !TX_HASH.test(hash)) {
    return Response.json(
      {
        ok: false,
        code: "bad-request",
        message: "A chain id and a 64-character transaction hash are required.",
      },
      { status: 400 },
    );
  }

  const chain = findChain(chainId);
  const lcd = lcdFor(chain);
  if (!chain || !lcd) {
    return Response.json({
      ok: false,
      code: "unsupported-chain",
      message: chain
        ? `${chain.chainName} has no REST endpoint in this build's catalog, so the transaction cannot be read.`
        : `${chainId} is not in this build's chain catalog.`,
    });
  }

  const notes: string[] = [];

  let tx;
  try {
    tx = await getTxStatus(lcd, chainId, hash, {
      signal: req.signal,
      timeoutMs: 8_000,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message: describeNftError(
        error,
        `Could not read transaction ${hash} on ${chain.chainName}.`,
      ),
    });
  }

  // Nothing to follow until the transaction is in a block, and a failed execute
  // never emitted a packet. Both are reported as themselves, not as a missing
  // packet.
  if (tx.state !== "success") {
    return Response.json({
      ok: true,
      chainId,
      chainName: chain.chainName,
      tx,
      packet: null,
      destinationQueried: false,
      notes:
        tx.state === "failed"
          ? ["The chain rejected this transaction, so no packet was ever sent and the token did not move."]
          : ["The transaction is not in a block yet, so there is no packet to follow."],
    });
  }

  let packets: readonly ExtractedPacket[] = [];
  try {
    const body = await lcd.getJson(`/cosmos/tx/v1beta1/txs/${hash}`, {
      signal: req.signal,
      cacheTtlMs: 10_000,
    });
    packets = extractPacketsFromTx(body);
  } catch (error) {
    notes.push(
      describeNftError(
        error,
        `The transaction succeeded, but its events could not be read from ${chain.chainName}.`,
      ),
    );
  }

  const packet = findIcs721Packet(packets, bridgeContract);
  if (!packet) {
    return Response.json({
      ok: true,
      chainId,
      chainName: chain.chainName,
      tx,
      packet: null,
      destinationQueried: false,
      notes: [
        ...notes,
        packets.length === 0
          ? "This transaction emitted no IBC packet. For a same-chain transfer that is correct — the token changed owner in the collection contract and nothing crossed a chain."
          : "This transaction sent IBC packets, but none of them on a cw-ics721 port. Zunia is not claiming to follow a packet it cannot identify.",
      ],
    });
  }

  const destChain = destChainId ? findChain(destChainId) : undefined;
  const destLcd = destChain ? lcdFor(destChain) : null;
  if (destChainId && !destLcd) {
    notes.push(
      `${destChain?.chainName ?? destChainId} has no REST endpoint in this build's catalog, so the receiving transaction cannot be found. The source chain still reports whether the packet was acknowledged or timed out.`,
    );
  }

  let report;
  try {
    report = await getPacketStatus(
      packet,
      { source: lcd, destination: destLcd },
      { signal: req.signal, request: { cacheTtlMs: 3_000 } },
    );
  } catch (error) {
    return Response.json({
      ok: true,
      chainId,
      chainName: chain.chainName,
      tx,
      packet: null,
      destinationQueried: destLcd !== null,
      notes: [
        ...notes,
        describeNftError(
          error,
          "The packet was found in the transaction, but its status could not be read.",
        ),
      ],
    });
  }

  return Response.json({
    ok: true,
    chainId,
    chainName: chain.chainName,
    tx,
    packet: {
      sequence: packet.sequence,
      sourcePort: packet.sourcePort,
      sourceChannelId: packet.sourceChannelId,
      destChannelId: packet.destChannelId,
      status: report.status,
      failure: report.failure,
      receiveTxHash: report.receiveTxHash,
      ackTxHash: report.ackTxHash,
      timeoutTxHash: report.timeoutTxHash,
      error: report.error,
      // The source chain has already returned the escrowed token. The one thing
      // a user in this state needs told, and the reason it is passed through
      // rather than inferred from `status`.
      fundsRefunded: report.fundsRefunded,
    },
    destinationQueried: destLcd !== null,
    notes: [...notes, ...report.notes],
  });
}
