/**
 * GET /api/security?accounts=<chainId>:<address>,…  (≤ 40, one per chain)
 *
 * The Cosmos equivalent of a token-approvals review: authz grants each
 * account gave (who can sign which messages for it, until when), fee
 * allowances it issued, and chains where its staking rewards are paid to a
 * different address. `checked` lists every account with its read status, so
 * "no grants found" is never confused with "could not check".
 *
 * → 200 `SecurityReviewResponse` · 400 · 429 · 503 when nothing was readable.
 * Private: keyed by addresses.
 */

import type { NextRequest } from "next/server";
import { mapLimit } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";
import { badRequest } from "@/lib/server/validate";
import type { SecurityReviewResponse } from "@/lib/chain/types";
import { remaining, within } from "@/lib/server/chain/lcd";
import { allFailed, parseAccountsParam, unknownChainErrors, type ResolvedAccount } from "@/lib/server/chain/request";
import { readAccountSecurity, type AccountSecurity } from "@/lib/server/chain/security";

export const runtime = "nodejs";

/** Request-wide budget; accounts still loading are reported as timed out. */
const BUDGET_MS = 10_000;

export async function GET(req: NextRequest) {
  let parsed: { accounts: ResolvedAccount[]; unknown: string[] };
  try {
    parsed = parseAccountsParam(req.nextUrl.searchParams.get("accounts"), { max: 40 });
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, {
    scope: "security",
    capacity: 30,
    refillPerSecond: 0.5,
    cost: Math.max(1, Math.ceil(parsed.accounts.length / 2)),
  });
  if (limited) return limited;

  const startedAt = Date.now();
  const reviews = await mapLimit(parsed.accounts, 12, ({ chain, address }) =>
    within<AccountSecurity>(readAccountSecurity(chain, address), remaining(startedAt, BUDGET_MS), () => ({
      chainId: chain.chainId,
      address,
      authzGrants: [],
      feeGrants: [],
      withdrawAddress: null,
      status: "error",
      errors: [{ chainId: chain.chainId, scope: "security", message: "Timed out; try again shortly" }],
    })),
  );

  if (reviews.length > 0 && reviews.every((review) => review.status === "error")) {
    return allFailed("The security review could not read any account right now");
  }
  const body: SecurityReviewResponse = {
    updatedAt: Date.now(),
    authzGrants: reviews.flatMap((review) => review.authzGrants),
    feeGrants: reviews.flatMap((review) => review.feeGrants),
    withdrawAddressDiffers: reviews
      .filter((review) => review.withdrawAddress !== null && review.withdrawAddress !== review.address)
      .map((review) => ({
        chainId: review.chainId,
        address: review.address,
        withdrawAddress: review.withdrawAddress ?? "",
      })),
    checked: reviews.map((review) => ({ chainId: review.chainId, address: review.address, status: review.status })),
  };
  const errors = [...unknownChainErrors(parsed.unknown), ...reviews.flatMap((review) => review.errors)];
  if (errors.length) body.errors = errors;
  return privateJson(body);
}
