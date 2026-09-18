/**
 * Broadcast a signed `TxRaw`.
 *
 * The browser never talks to an LCD or to the indexer; it posts here.
 *
 * Response narrowing is `@zunialab/interchain`'s `parseBroadcastResponse`. The
 * copy this replaced treated a missing `code` as 0 (correct — proto-JSON omits
 * a zero) but also treated a missing `txhash` as the empty string, which turned
 * a malformed gateway answer into a successful-looking broadcast with a blank
 * hash. The engine throws on that instead.
 */

import { NextResponse } from "next/server";
import {
  isInterchainError,
  parseBroadcastResponse,
} from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { proxyIndexer } from "@/lib/api-proxy";

export const runtime = "nodejs";

type Body = {
  chainId?: string;
  tx_bytes?: string;
  txBytes?: string;
  mode?: string;
};

function shape(body: unknown, chainId: string) {
  const parsed = parseBroadcastResponse(body, chainId);
  return {
    txhash: parsed.txHash,
    code: parsed.code,
    rawLog: parsed.rawLog,
    success: parsed.code === 0,
  };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const chainId = body.chainId?.trim();
  const txBytes = (body.tx_bytes ?? body.txBytes)?.trim();
  const mode = body.mode ?? "BROADCAST_MODE_SYNC";

  if (!chainId || !txBytes) {
    return NextResponse.json(
      { error: "chainId and tx_bytes are required" },
      { status: 400 },
    );
  }

  // Prefer the indexer when this deployment exposes a broadcast route; fall
  // through to the chain's own REST endpoint otherwise.
  const indexer = await proxyIndexer("/v1/tx/broadcast", {
    method: "POST",
    body: JSON.stringify({ chainId, tx_bytes: txBytes, mode }),
  });
  if (indexer.ok) {
    try {
      return NextResponse.json(shape(await indexer.json(), chainId));
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "The indexer's broadcast answer could not be read.",
        },
        { status: 502 },
      );
    }
  }

  const chain = findChain(chainId);
  const rest = chain?.rest?.replace(/\/$/, "");
  if (!rest) {
    return NextResponse.json(
      { error: `No REST endpoint for chain ${chainId}` },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${rest}/cosmos/tx/v1beta1/txs`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ tx_bytes: txBytes, mode }),
      cache: "no-store",
    });
    const json: unknown = await res.json();
    if (!res.ok) {
      const message =
        typeof json === "object" && json !== null && "message" in json
          ? String((json as { message?: unknown }).message)
          : `LCD HTTP ${res.status}`;
      return NextResponse.json({ error: message }, { status: 502 });
    }
    const out = shape(json, chainId);
    if (out.code !== 0) {
      return NextResponse.json(
        { error: out.rawLog || `Rejected (code ${out.code})`, ...out },
        { status: 400 },
      );
    }
    return NextResponse.json(out);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "broadcast failed";
    return NextResponse.json(
      {
        error: message,
        ...(isInterchainError(error) ? { code: error.code } : {}),
      },
      { status: 502 },
    );
  }
}
