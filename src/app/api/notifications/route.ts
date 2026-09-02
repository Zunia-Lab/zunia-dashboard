import { proxyBackend, stubJson } from "@/lib/api-proxy";

export async function GET() {
  const upstream = await proxyBackend("/v1/notifications");
  if (upstream.ok) return upstream;
  return stubJson({
    items: [
      {
        title: "Welcome to Zunia",
        meta: "Enable Web Push in Settings · just now",
        unread: true,
      },
    ],
  });
}
