import { NextRequest } from "next/server";
import { proxyBackend, stubJson } from "@/lib/api-proxy";

/** Verifies ADR-36 signature via backend stub. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const upstream = await proxyBackend("/v1/device/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (upstream.ok) return upstream;

  const parsed = body as {
    challengeId?: string;
    address?: string;
    signature?: string;
  };
  if (!parsed.challengeId || !parsed.address || !parsed.signature) {
    return Response.json({ error: "incomplete_verify_payload" }, { status: 400 });
  }

  // Local stub accepts any non-empty signature for UI wiring.
  return stubJson({
    ok: true,
    sessionToken: `stub-session-${parsed.challengeId.slice(0, 8)}`,
    verifiedBy: "dashboard_stub",
  });
}
