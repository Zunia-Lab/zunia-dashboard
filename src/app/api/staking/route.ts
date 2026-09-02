import { NextRequest } from "next/server";
import { proxyBackend, stubJson } from "@/lib/api-proxy";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const chainId = req.nextUrl.searchParams.get("chainId") ?? "cosmoshub-4";
  if (!address) return stubJson({ staked: "0", apr: "—", claimable: "0" });

  const upstream = await proxyBackend(
    `/v1/staking?chainId=${encodeURIComponent(chainId)}&address=${encodeURIComponent(address)}`,
  );
  if (upstream.ok) return upstream;

  return stubJson({
    staked: "—",
    apr: "—",
    claimable: "—",
    address,
    chainId,
  });
}
