import { proxyBackend, stubJson } from "@/lib/api-proxy";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chains = (url.searchParams.get("chains") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const query = chains.length
    ? `?chains=${encodeURIComponent(chains.join(","))}`
    : "";
  const upstream = await proxyBackend(`/v1/governance/proposals${query}`);
  if (upstream.ok) return upstream;
  return stubJson({
    items: [
      {
        id: "stub-1",
        status: "voting",
        title: "Example proposal (stub)",
        yesPct: 42,
        summary:
          "Placeholder proposal text while the governance indexer is offline.",
        description:
          "This is sample proposal body. When /v1/governance/proposals is live, the full on-chain description renders here.",
      },
    ],
    chains,
  });
}
