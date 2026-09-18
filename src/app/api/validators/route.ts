import { NextRequest } from "next/server";
import { stubJson } from "@/lib/api-proxy";
import { readValidators } from "@/lib/server/chain-reads";

export async function GET(req: NextRequest) {
  const single = req.nextUrl.searchParams.get("chainId");
  const many = (req.nextUrl.searchParams.get("chains") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const chainIds = single ? [single] : many;
  if (chainIds.length === 0) {
    return stubJson({ error: "chainId_required" }, 400);
  }

  try {
    const batches = await Promise.all(
      chainIds.map(async (chainId) => {
        try {
          return await readValidators(chainId);
        } catch {
          return [];
        }
      }),
    );
    return Response.json({
      validators: batches.flat(),
      source: "public-lcd",
    });
  } catch (err) {
    return stubJson({
      error: "read_failed",
      message: err instanceof Error ? err.message : "unknown",
      validators: [],
    });
  }
}
