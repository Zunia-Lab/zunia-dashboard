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
      },
    ],
    chains,
  });
}
