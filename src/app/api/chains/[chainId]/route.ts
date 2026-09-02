import { NextRequest } from "next/server";
import { proxyIndexer, stubJson } from "@/lib/api-proxy";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ chainId: string }> },
) {
  const { chainId } = await ctx.params;
  const address = req.nextUrl.searchParams.get("address");

  if (address) {
    const upstream = await proxyIndexer("/v1/wallets/history", {
      method: "POST",
      body: JSON.stringify({ chainId, address }),
    });
    if (upstream.ok) {
      const body = (await upstream.json()) as {
        items?: unknown[];
        txs?: unknown[];
      };
      const txs = body.items ?? body.txs ?? [];
      return Response.json({
        chainId,
        address,
        balance: "—",
        txCount: Array.isArray(txs) ? txs.length : 0,
        history: body,
      });
    }
  }

  return stubJson({
    chainId,
    address,
    balance: "—",
    txCount: 0,
  });
}
