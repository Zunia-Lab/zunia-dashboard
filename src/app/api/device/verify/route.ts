import { consumeChallenge } from "../challenge/route";

/**
 * ADR-36 device verification.
 * Accepts a real extension signature and issues a short-lived session token.
 * Full secp256k1 verify against pubkey should move to zunia-backend; here we
 * gate on challenge consumption + non-empty signature shape for dashboard BFF.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    challengeId?: string;
    address?: string;
    signature?: { signature?: string; pub_key?: { value?: string } } | string;
    pubKey?: string;
  };

  if (!body.challengeId || !body.address || !body.signature) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const challenge = consumeChallenge(body.challengeId, body.address);
  if (!challenge) {
    return Response.json(
      { error: "challenge_invalid", message: "Challenge expired or unknown" },
      { status: 400 },
    );
  }

  const sig =
    typeof body.signature === "string"
      ? body.signature
      : body.signature.signature;
  if (!sig || sig.length < 64) {
    return Response.json(
      { error: "signature_invalid", message: "Signature missing or too short" },
      { status: 400 },
    );
  }

  const sessionToken = `zunia-session-${crypto.randomUUID()}`;
  return Response.json({
    ok: true,
    sessionToken,
    address: body.address,
    expiresAt: Date.now() + 24 * 60 * 60_000,
  });
}
