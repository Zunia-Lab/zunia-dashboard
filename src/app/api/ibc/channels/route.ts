/**
 * Open transfer channels between two chains.
 *
 * Discovery now runs through `@zunialab/interchain`; the dashboard's own copy in
 * `lib/server/ibc-channels.ts` is deleted. Two behaviour changes come with the
 * engine, both fixes:
 *
 * - a channel in `STATE_TRYOPEN` is no longer reported as open (the old test
 *   was `state.includes("OPEN")`, and `"STATE_TRYOPEN"` contains `"OPEN"`);
 * - `counterpartyPortId` is present, which the extension's copy had and this
 *   one did not.
 *
 * A failure answers 200 with `ok: false` and a reason. Discovery failing is an
 * ordinary state — a slow or incomplete public endpoint — and the caller's next
 * move is to offer manual channel entry, which needs the reason to explain
 * itself. A 5xx would render as a broken page instead.
 */

import { NextRequest } from "next/server";
import { isInterchainError } from "@zunialab/interchain";
import { channelService } from "@/lib/server/interchain";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source")?.trim() ?? "";
  const dest = req.nextUrl.searchParams.get("dest")?.trim() ?? "";
  if (!source || !dest) {
    return Response.json(
      {
        ok: false,
        code: "bad-request",
        message: "Both a source chain and a destination chain are required.",
      },
      { status: 400 },
    );
  }

  try {
    const channels = await channelService.findIbcChannels(source, dest);
    return Response.json({ ok: true, channels });
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message:
        error instanceof Error
          ? `Could not list channels from ${source}. ${error.message}`
          : `Could not list channels from ${source}.`,
    });
  }
}
