import { NextRequest } from "next/server";
import { findIbcChannels } from "@/lib/server/ibc-channels";

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source") ?? "";
  const dest = req.nextUrl.searchParams.get("dest") ?? "";
  if (!source || !dest) {
    return Response.json({ error: "source_and_dest_required" }, { status: 400 });
  }
  try {
    const channels = await findIbcChannels(source, dest);
    return Response.json({ channels });
  } catch (err) {
    return Response.json(
      {
        channels: [],
        error: err instanceof Error ? err.message : "lookup_failed",
      },
      { status: 200 },
    );
  }
}
