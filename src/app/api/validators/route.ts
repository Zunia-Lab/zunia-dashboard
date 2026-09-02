import { NextRequest } from "next/server";
import { stubJson } from "@/lib/api-proxy";
import { readValidators } from "@/lib/server/chain-reads";

export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get("chainId");
  if (!chainId) return stubJson({ error: "chainId_required" }, 400);

  try {
    const validators = await readValidators(chainId);
    return Response.json({ validators, source: "public-lcd" });
  } catch (err) {
    return stubJson({
      error: "read_failed",
      message: err instanceof Error ? err.message : "unknown",
      validators: [],
    });
  }
}
