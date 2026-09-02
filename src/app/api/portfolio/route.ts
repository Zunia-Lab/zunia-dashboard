import { NextRequest } from "next/server";
import { proxyBackend, stubJson } from "@/lib/api-proxy";
import { readPortfolio } from "@/lib/server/chain-reads";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const chainId = req.nextUrl.searchParams.get("chainId") ?? "cosmoshub-4";
  const currency = (
    req.nextUrl.searchParams.get("currency") ?? "usd"
  ).toLowerCase();
  const followed = (req.nextUrl.searchParams.get("chains") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!address) {
    return stubJson({ error: "address_required" }, 400);
  }

  // Prefer the first-party backend when this deployment has one: it can index
  // more than the public LCDs expose and it is not rate limited.
  const upstream = await proxyBackend(
    `/v1/portfolio?chainId=${encodeURIComponent(chainId)}&address=${encodeURIComponent(address)}`,
  );
  if (upstream.ok) return upstream;

  // Otherwise read the public endpoints directly from the server.
  try {
    const snapshot = await readPortfolio(address, chainId, followed, currency);
    return Response.json({ ...snapshot, currency, source: "public-lcd" });
  } catch (err) {
    return stubJson({
      error: "read_failed",
      message: err instanceof Error ? err.message : "unknown",
    });
  }
}
