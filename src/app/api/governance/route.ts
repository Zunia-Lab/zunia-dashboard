/**
 * GET /api/governance?chains=<csv, ≤ 40>&status=voting|deposit|passed|rejected|all
 *                    [&voter=<chainId>:<address>,…]
 *
 * Proposals across chains (gov v1, v1beta1 fallback): status, decoded message
 * types, deadlines, deposit vs minimum, the live tally while voting, turnout
 * against quorum, and whether the proposal would pass if voting ended now.
 * `status=all` returns the 20 most recent per chain plus everything in voting;
 * `rejected` includes failed proposals.
 *
 * With `voter`, each voting proposal on that chain also carries the voter's
 * own vote, their voting power, and — when they have not voted — how their
 * validators' votes count for their stake (`inheritedVote`).
 *
 * → 200 `ProposalsResponse` · 400 · 429 · 503 when no chain could be read.
 *
 * Public without `voter` (cached 60 s / 2 min at the edge); private with it.
 */

import type { NextRequest } from "next/server";
import { mapLimit } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson, publicJson } from "@/lib/server/respond";
import { badRequest, ParamError, parseChainList, parseEnum } from "@/lib/server/validate";
import type { PartError, ProposalRow, ProposalStatusFilter, ProposalsResponse } from "@/lib/chain/types";
import {
  INHERITED_BUDGET,
  readChainProposals,
  sortProposals,
  type ChainProposals,
  type LookupBudget,
} from "@/lib/server/chain/governance";
import { remaining, within } from "@/lib/server/chain/lcd";
import { allFailed, oldest, parseAccountsParam, unknownChainErrors } from "@/lib/server/chain/request";

export const runtime = "nodejs";

const FILTERS: readonly ProposalStatusFilter[] = ["voting", "deposit", "passed", "rejected", "all"];
/** Request-wide budget; chains still loading are reported as timed out. */
const BUDGET_MS = 12_000;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  let parsed: ReturnType<typeof parseChainList>;
  let status: ProposalStatusFilter;
  let voters: Map<string, string>;
  try {
    parsed = parseChainList(params.get("chains"), 40);
    if (parsed.chains.length === 0 && parsed.unknown.length === 0) {
      throw new ParamError("chains_required", "chains is required (comma-separated chain ids)");
    }
    status = parseEnum(params.get("status"), FILTERS, "all", "status");
    const voter = parseAccountsParam(params.get("voter"), { max: 40, name: "voter", required: false });
    voters = new Map(voter.accounts.map(({ chain, address }) => [chain.chainId, address]));
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, {
    scope: "governance",
    capacity: 40,
    refillPerSecond: 0.5,
    cost: Math.max(1, Math.ceil(parsed.chains.length / 4) + Math.ceil(voters.size / 4)),
  });
  if (limited) return limited;

  const budget: LookupBudget = { remaining: INHERITED_BUDGET };
  const startedAt = Date.now();
  const results = await mapLimit(parsed.chains, 12, (chain) =>
    within<ChainProposals>(
      readChainProposals(chain, status, voters.get(chain.chainId) ?? null, budget),
      remaining(startedAt, BUDGET_MS),
      () => ({
        chainId: chain.chainId,
        api: null,
        rows: [],
        errors: [{ chainId: chain.chainId, scope: "proposals", message: "Timed out; try again shortly" }],
        ok: false,
        at: null,
      }),
    ),
  );

  if (parsed.chains.length > 0 && results.every((result) => !result.ok)) {
    return allFailed("Governance could not be read on any requested chain");
  }
  const proposals: ProposalRow[] = sortProposals(results.flatMap((result) => result.rows));
  const errors: PartError[] = [...unknownChainErrors(parsed.unknown), ...results.flatMap((result) => result.errors)];
  const body: ProposalsResponse = {
    updatedAt: oldest(results.map((result) => result.at)),
    proposals,
    chains: results.map((result) => ({
      chainId: result.chainId,
      status: result.ok ? "ok" : "error",
      api: result.api,
    })),
    ...(parsed.unknown.length ? { unknown: parsed.unknown } : {}),
    ...(errors.length ? { errors } : {}),
  };
  return voters.size ? privateJson(body) : publicJson(body, { maxAge: 60, sMaxAge: 120, swr: 300 });
}
