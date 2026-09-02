import { NextRequest } from "next/server";
import { proxyIndexer, stubJson } from "@/lib/api-proxy";

type HistoryRow = {
  txHash?: string;
  hash?: string;
  summary?: string;
  timestamp?: string;
  success?: boolean;
  kind?: string;
};

function normalize(raw: HistoryRow[]) {
  return raw.map((t) => ({
    hash: t.txHash ?? t.hash ?? "unknown",
    summary: t.summary ?? "Transaction",
    time: t.timestamp ?? "",
    success: t.success !== false,
    kind: t.kind,
  }));
}

async function historyForChain(chainId: string, address: string) {
  const upstream = await proxyIndexer("/v1/wallets/history", {
    method: "POST",
    body: JSON.stringify({ chainId, address }),
  });
  if (!upstream.ok) return [];
  const body = (await upstream.json()) as {
    items?: HistoryRow[];
    txs?: HistoryRow[];
  };
  return normalize(body.items ?? body.txs ?? []);
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const chainId = req.nextUrl.searchParams.get("chainId") ?? "cosmoshub-4";
  const chains = (req.nextUrl.searchParams.get("chains") ?? chainId)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!address) return stubJson({ items: [] });

  const batches = await Promise.all(
    chains.slice(0, 12).map((id) => historyForChain(id, address)),
  );
  const seen = new Set<string>();
  const items = batches.flat().filter((tx) => {
    if (seen.has(tx.hash)) return false;
    seen.add(tx.hash);
    return true;
  });

  if (items.length > 0) {
    return Response.json({ items, chainId, chains, address });
  }

  return stubJson({
    items: [],
    address,
    chainId,
    chains,
  });
}
