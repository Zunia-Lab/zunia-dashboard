import { NextRequest } from "next/server";
import { proxyBackend, stubJson } from "@/lib/api-proxy";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const upstream = await proxyBackend("/v1/push/subscribe", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (upstream.ok) return upstream;

  return stubJson({ ok: true, stored: false, reason: "backend_unreachable" });
}
