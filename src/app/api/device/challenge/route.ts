import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { proxyBackend, stubJson } from "@/lib/api-proxy";

/** ADR-36 challenge stub — prefers backend; local stub if unreachable. */
export async function POST(req: NextRequest) {
  let body: { address?: string; chainId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.address || !body.chainId) {
    return Response.json({ error: "address_and_chainId_required" }, { status: 400 });
  }

  const upstream = await proxyBackend("/v1/device/challenge", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (upstream.ok) return upstream;

  const challengeId = randomUUID();
  const message = `Zunia device bind\nchain: ${body.chainId}\naddress: ${body.address}\nnonce: ${challengeId}\n`;
  return stubJson({
    challengeId,
    message,
    expiresInSec: 300,
  });
}
