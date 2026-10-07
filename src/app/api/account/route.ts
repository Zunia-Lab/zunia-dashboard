/**
 * The signer's account number, sequence and on-chain key, for one chain.
 *
 * GET /api/account?chainId=<catalog id>&address=<bech32 of that chain>
 * → 200 AccountResponse (see `@/lib/tx/client`), never cached: a stale
 *   `sequence` produces a signature the chain rejects the moment someone sends
 *   two transactions in a row.
 *
 * Unwrapping is `@zunialab/interchain`'s pure `parseAccount`: `BaseAccount`
 * arrives wrapped in `EthAccount` (Ethermint and Injective, under different
 * type URLs), `ModuleAccount`, `BaseVestingAccount` and the
 * Continuous/Delayed/Periodic/PermanentLocked vesting family, which nests
 * twice. Reading `account_number` off the outer object yields undefined, which
 * becomes 0, which is a signature over the wrong document.
 *
 * A never-used address is not an error: the node answers 404 (or 200 with a
 * gRPC NotFound), and the right answer is account 0 / sequence 0 with
 * `exists: false` — what the chain will assign.
 */

import type { NextRequest } from "next/server";
import { isInterchainError, parseAccount } from "@zunialab/interchain";
import { describeUpstreamError, fetchJson, UpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";
import { badRequest, parseAddress, parseChainId } from "@/lib/server/validate";

export const runtime = "nodejs";

function outerAccount(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const account = root.account ?? root.info;
  return account && typeof account === "object" ? (account as Record<string, unknown>) : null;
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { scope: "account", capacity: 40, refillPerSecond: 1 });
  if (limited) return limited;

  let chain;
  let address: string;
  try {
    chain = parseChainId(req.nextUrl.searchParams.get("chainId"));
    address = parseAddress(req.nextUrl.searchParams.get("address"), chain);
  } catch (error) {
    return badRequest(error);
  }

  const rest = restOf(chain.chainId);
  if (!rest) {
    return Response.json(
      { error: "no_endpoint", message: `${chain.chainName} has no public REST endpoint in this build's catalog.` },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown = null;
  let missing = false;
  try {
    body = await fetchJson(`${rest}/cosmos/auth/v1beta1/accounts/${address}`, { timeoutMs: 6_000, retries: 1 });
  } catch (error) {
    if (error instanceof UpstreamError && error.kind === "http" && error.status === 404) {
      missing = true;
    } else {
      return Response.json(
        {
          error: "upstream_failed",
          message: `Could not read your account on ${chain.chainName}: ${describeUpstreamError(error)}.`,
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  }

  try {
    const parsed = missing
      ? { accountNumber: "0", sequence: "0", pubKey: null }
      : parseAccount(body, chain.chainId, address);
    const outer = missing ? null : outerAccount(body);
    const accountType = typeof outer?.["@type"] === "string" ? (outer["@type"] as string) : null;
    return privateJson({
      chainId: chain.chainId,
      address,
      accountNumber: parsed.accountNumber,
      sequence: parsed.sequence,
      exists: !missing && outer !== null,
      pubKey: parsed.pubKey ? { typeUrl: parsed.pubKey.typeUrl, key: parsed.pubKey.key } : null,
      accountType,
      updatedAt: Date.now(),
    });
  } catch (error) {
    // Logged without the address: which chain answers in a shape we do not
    // read is the useful part, whose account it was is not ours to keep.
    console.warn("[account] unreadable account record", chain.chainId, isInterchainError(error) ? error.code : "");
    return Response.json(
      {
        error: "upstream_unreadable",
        message: `${chain.chainName} answered with an account record Zunia cannot read.`,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
