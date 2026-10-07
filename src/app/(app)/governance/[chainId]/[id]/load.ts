/**
 * The server read of one proposal for the page, its metadata and its share
 * image: the same `readProposalDetail` the API route uses (and the same LCD
 * cache), bounded so a cold read never holds a render hostage.
 *
 * - `not-found`: unknown chain, malformed id, or the chain has no such
 *   proposal (a real 404).
 * - `unavailable`: the node did not answer in time or failed; the page still
 *   renders and the browser finishes the read. Never a 404.
 */

import "server-only";
import { cache } from "react";
import type { ProposalDetailResponse } from "@/lib/chain/types";
import { readProposalDetail } from "@/lib/server/chain/governance";
import { within } from "@/lib/server/chain/lcd";
import { findServerChain } from "@/lib/server/chains";

export type LoadedProposal =
  | { kind: "ok"; body: ProposalDetailResponse }
  | { kind: "not-found" }
  | { kind: "unavailable" };

/**
 * How long a render waits for a cold proposal read. Proposal pages do not
 * stream (they sit outside the wallet pages' loading boundary, so that a
 * proposal the chain does not have answers a real 404), which means this
 * wait is time to first byte: nothing paints until it ends. A warm read
 * answers from the cache at once; a voting proposal's cold read (tally,
 * validator set, the 30 largest validators' votes) can take a few seconds,
 * and past this budget the page renders without it while the read carries
 * on, warming the cache the browser's own request then hits.
 */
export const RENDER_BUDGET_MS = 3_000;

export const loadProposal = cache(async (chainId: string, id: string, budgetMs: number = RENDER_BUDGET_MS): Promise<LoadedProposal> => {
  const chain = findServerChain(chainId);
  if (!chain || !/^\d{1,20}$/.test(id)) return { kind: "not-found" };
  try {
    const detail = await within<Awaited<ReturnType<typeof readProposalDetail>> | "timeout">(
      readProposalDetail(chain, id, null),
      budgetMs,
      () => "timeout",
    );
    if (detail === "timeout") return { kind: "unavailable" };
    if (!detail) return { kind: "not-found" };
    return {
      kind: "ok",
      body: {
        updatedAt: detail.at,
        proposal: detail.proposal,
        ...(detail.errors.length ? { errors: detail.errors } : {}),
      },
    };
  } catch {
    return { kind: "unavailable" };
  }
});
