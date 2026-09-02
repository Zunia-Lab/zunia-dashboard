import { NextRequest } from "next/server";
import { validateIbcChannel } from "@/lib/server/ibc-channels";

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source") ?? "";
  const channel = req.nextUrl.searchParams.get("channel") ?? "";
  const dest = req.nextUrl.searchParams.get("dest") ?? undefined;
  if (!source || !channel) {
    return Response.json({ error: "source_and_channel_required" }, { status: 400 });
  }
  try {
    const check = await validateIbcChannel(source, channel, dest);
    return Response.json(check);
  } catch (err) {
    return Response.json(
      {
        ok: false,
        state: "unknown",
        channelId: channel,
        portId: "transfer",
        message: err instanceof Error ? err.message : "lookup_failed",
      },
      { status: 200 },
    );
  }
}
