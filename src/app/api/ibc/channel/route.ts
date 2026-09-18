/**
 * Validate one channel id the user typed.
 *
 * `checkCounterparty` is on when a destination is given, unlike the engine's
 * default, because this route is debounced by the caller rather than fired per
 * keystroke and the far-side check is what catches the dangerous case: a
 * channel that is open on the source chain and connects somewhere other than
 * where the user believes. An unreachable counterparty does not fail the check
 * — the engine treats `unreachable` and `skipped` as "nothing was learned", and
 * blocking a send because the *destination's* public endpoint is down is its
 * own failure mode.
 *
 * The envelope's `ok` is about the request; the check's own verdict is
 * `check.ok`. Two different questions, so two different fields.
 */

import { NextRequest } from "next/server";
import { isInterchainError } from "@zunialab/interchain";
import { channelService } from "@/lib/server/interchain";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source")?.trim() ?? "";
  const channel = req.nextUrl.searchParams.get("channel")?.trim() ?? "";
  const dest = req.nextUrl.searchParams.get("dest")?.trim() || undefined;
  if (!source || !channel) {
    return Response.json(
      {
        ok: false,
        code: "bad-request",
        message: "A source chain and a channel id are required.",
      },
      { status: 400 },
    );
  }

  try {
    const check = await channelService.validateIbcChannel(source, channel, dest, {
      checkCounterparty: dest !== undefined,
    });
    return Response.json({ ok: true, check });
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message:
        error instanceof Error
          ? `Could not reach the chain to verify this channel. ${error.message}`
          : "Could not reach the chain to verify this channel.",
    });
  }
}
