import { proxyBackend, stubJson } from "@/lib/api-proxy";

export async function GET() {
  const upstream = await proxyBackend("/v1/dapps");
  if (upstream.ok) return upstream;
  return stubJson({
    items: [
      { name: "Osmosis", meta: "DEX · osmosis-1", connected: false },
      { name: "Astroport", meta: "DEX · neutron-1", connected: false },
    ],
  });
}
