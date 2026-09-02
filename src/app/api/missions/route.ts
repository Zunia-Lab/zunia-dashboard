import { proxyBackend, stubJson } from "@/lib/api-proxy";

export async function GET() {
  const upstream = await proxyBackend("/v1/missions");
  if (upstream.ok) return upstream;
  return stubJson({
    items: [
      { title: "Connect a wallet", xp: "+50 XP", done: false },
      { title: "Stake ATOM", xp: "+100 XP", done: false },
    ],
  });
}
