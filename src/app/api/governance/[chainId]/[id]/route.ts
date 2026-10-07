/**
 * GET /api/governance/[chainId]/[id][?voter=<address>]
 *
 * One proposal in full: everything a list row has, plus the raw description
 * (markdown — the UI renders it through its sanitiser), metadata, proposer,
 * the messages as JSON (huge strings such as wasm byte code elided), deposit
 * progress, and while voting is open how the 30 largest validators voted.
 *
 * The chain is part of the path because proposal ids are per chain: `#1058`
 * on the Hub and `#1058` on Osmosis are different proposals.
 *
 * → 200 `ProposalDetailResponse` · 400 · 404 unknown proposal · 429 · 503
 *   (unreadable; or Retry-After + `error: "upstream_timeout"` while a cold
 *   read runs). Public without `voter`; private with it.
 */

import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson, publicJson } from "@/lib/server/respond";
import type { ServerChainEntry } from "@/lib/server/chains";
import { badRequest, ParamError, parseAddress, parseChainId } from "@/lib/server/validate";
import type { ProposalDetailResponse } from "@/lib/chain/types";
import { readProposalDetail } from "@/lib/server/chain/governance";
import { describeLcdError, within } from "@/lib/server/chain/lcd";
import { allFailed, SINGLE_CHAIN_BUDGET_MS, stillLoading } from "@/lib/server/chain/request";

type Detail = Awaited<ReturnType<typeof readProposalDetail>>;
type Outcome = { kind: "ok"; detail: Detail } | { kind: "failed"; message: string } | { kind: "timeout" };

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ chainId: string; id: string }> }) {
  let chain: ServerChainEntry;
  let id: string;
  let voter: string | null = null;
  try {
    const params = await ctx.params;
    chain = parseChainId(decodeURIComponent(params.chainId));
    id = params.id.trim();
    if (!/^\d{1,20}$/.test(id)) throw new ParamError("id_invalid", "id must be a proposal number");
    const rawVoter = req.nextUrl.searchParams.get("voter");
    if (rawVoter) voter = parseAddress(rawVoter, chain, "voter");
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, { scope: "proposal", capacity: 30, refillPerSecond: 1 });
  if (limited) return limited;

  const outcome = await within<Outcome>(
    readProposalDetail(chain, id, voter).then(
      (detail): Outcome => ({ kind: "ok", detail }),
      (error: unknown): Outcome => ({ kind: "failed", message: describeLcdError(error) }),
    ),
    SINGLE_CHAIN_BUDGET_MS,
    () => ({ kind: "timeout" }),
  );
  if (outcome.kind === "timeout") {
    return stillLoading(`Proposal ${id} on ${chain.chainName} is still loading; try again in a few seconds`);
  }
  if (outcome.kind === "failed") {
    return allFailed(`Proposal ${id} on ${chain.chainName} could not be read: ${outcome.message}`);
  }
  const { detail } = outcome;
  if (!detail) {
    return Response.json(
      { error: "proposal_not_found", message: `No proposal ${id} on ${chain.chainName}` },
      { status: 404, headers: { "cache-control": "public, max-age=60" } },
    );
  }
  const body: ProposalDetailResponse = {
    updatedAt: detail.at,
    proposal: detail.proposal,
    ...(detail.errors.length ? { errors: detail.errors } : {}),
  };
  return voter ? privateJson(body) : publicJson(body, { maxAge: 60, sMaxAge: 120, swr: 300 });
}
