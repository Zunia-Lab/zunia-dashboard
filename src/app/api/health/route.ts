import { proxyIndexer, stubJson } from "@/lib/api-proxy";

export async function GET() {
  const indexer = await proxyIndexer("/health");
  const indexerBody = indexer.ok
    ? await indexer.json().catch(() => ({ ok: false }))
    : { ok: false, unreachable: true };

  return stubJson({
    ok: true,
    service: "zunia-dashboard",
    indexer: indexerBody,
  });
}
