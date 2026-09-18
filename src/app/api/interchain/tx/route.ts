/**
 * Whether one transaction is in a block yet, and whether it succeeded.
 *
 * Exists so that "Broadcast accepted" stops being the last thing a user is
 * told. The send screen used to render a fixed three-step progress with
 * "Included" already marked as the current step, with nothing behind it — a
 * claim about the chain that no read supported.
 *
 * `not-found` is a real answer, and a normal one for the first few seconds
 * after a broadcast or while a load-balanced endpoint catches up. It is
 * returned as itself, never folded into failure.
 */

import { NextRequest } from "next/server";
import { getTxStatus, isInterchainError } from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { describeError, lcdFor } from "@/lib/server/interchain";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get("chainId")?.trim() ?? "";
  const hash = req.nextUrl.searchParams.get("hash")?.trim() ?? "";
  if (!chainId || !/^(0x)?[0-9a-fA-F]{64}$/.test(hash)) {
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
      message: `${chainId} has no REST endpoint in this build's catalog, so its transactions cannot be read.`,
    });
  }

  try {
    const status = await getTxStatus(lcd, chainId, hash, { signal: req.signal });
    return Response.json({ ok: true, status });
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message: describeError(error, "The transaction status could not be read."),
    });
  }
}
