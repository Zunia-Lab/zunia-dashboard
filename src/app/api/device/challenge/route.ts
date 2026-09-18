/**
 * ADR-36 binding challenge. Stores nonce in-memory (single-instance / dev).
 * Production should persist in zunia-backend Redis/Postgres.
 */

const challenges = new Map<
  string,
  { nonce: string; address: string; expiresAt: number }
>();

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    address?: string;
    chainId?: string;
  };
  if (!body.address) {
    return Response.json({ error: "address_required" }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const nonce = `Sign in to Zunia Dashboard at ${new Date().toISOString()} (${id})`;
  const expiresAt = Date.now() + 5 * 60_000;
  challenges.set(id, { nonce, address: body.address, expiresAt });
  return Response.json({
    challengeId: id,
    nonce,
    expiresAt,
    chainId: body.chainId ?? "cosmoshub-4",
  });
}

/** Test / verify route helper */
export function consumeChallenge(id: string, address: string) {
  const c = challenges.get(id);
  if (!c) return null;
  if (c.expiresAt <= Date.now()) {
    challenges.delete(id);
    return null;
  }
  if (c.address !== address) return null;
  challenges.delete(id);
  return c;
}
