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
 *
 * Each check reads two chains from this server's IP, so it is rate limited
 * (the field debounces at 500 ms; 30 checks then one every two seconds is far
 * above what typing needs) and only catalog chains and `channel-N` ids are
 * looked up.
 */

import { NextRequest } from "next/server";
import { isInterchainError } from "@zunialab/interchain";
import { findServerChain } from "@/lib/server/chains";
import { channelService, describeError } from "@/lib/server/interchain";
import { overLimit } from "@/lib/server/interchain-request";

export const runtime = "nodejs";

/** What the field accepts: `channel-141`, or just `141`. */
const CHANNEL = /^(channel-)?\d{1,10}$/i;

export async function GET(req: NextRequest) {
  const limited = overLimit(req, { scope: "ibc-channel", capacity: 30, refillPerSecond: 0.5 });
  if (limited) return limited;
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

  if (!findServerChain(source) || (dest !== undefined && !findServerChain(dest))) {
    return Response.json(
      { ok: false, code: "unsupported-chain", message: "That chain is not in this build's catalog." },
      { status: 400 },
    );
  }
  if (!CHANNEL.test(channel)) {
    // Answered as a check, not a request error: the field shows it inline.
    return Response.json({
      ok: true,
      check: {
        ok: false,
        state: "unknown",
        channelId: channel.slice(0, 40),
        portId: "transfer",
        message: "A channel id looks like channel-141.",
      },
    });
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
      message: describeError(error, "Could not reach the chain to verify this channel."),
    });
  }
}
