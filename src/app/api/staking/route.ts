/**
 * GET /api/staking?accounts=<chainId>:<address>,…  (≤ 40, one per chain)
 *
 * Staking positions per account: delegations with validator status,
 * commission, uptime and pending rewards; unbonding and redelegation entries
 * with completion times; the rewards withdraw address; totals; the chain APR
 * and the stake-weighted APR after commission (inactive validators at 0 %).
 *
 * → 200 `StakingResponse` (`@/lib/chain/types`), chains in request order;
 *   each chain has `status` ok / partial / error so "nothing staked" and
 *   "could not read" are different answers.
 * → 400 bad input · 429 · 503 when no account could be read at all.
 *
 * Private: keyed by addresses, never stored by a shared cache.
 */

import type { NextRequest } from "next/server";
import { mapLimit } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { privateJson } from "@/lib/server/respond";
import { badRequest } from "@/lib/server/validate";
import type { StakingChain, StakingResponse } from "@/lib/chain/types";
import { remaining, within } from "@/lib/server/chain/lcd";
import { allFailed, parseAccountsParam, unknownChainErrors, type ResolvedAccount } from "@/lib/server/chain/request";
import { readStakingChain } from "@/lib/server/chain/staking";

export const runtime = "nodejs";

/** Request-wide budget; accounts still loading are reported as timed out. */
const BUDGET_MS = 12_000;

export async function GET(req: NextRequest) {
  let parsed: { accounts: ResolvedAccount[]; unknown: string[] };
  try {
    parsed = parseAccountsParam(req.nextUrl.searchParams.get("accounts"), { max: 40 });
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, {
    scope: "staking",
    capacity: 60,
    refillPerSecond: 1,
    cost: Math.max(1, Math.ceil(parsed.accounts.length / 2)),
  });
  if (limited) return limited;

  const startedAt = Date.now();
  const chains = await mapLimit(parsed.accounts, 12, ({ chain, address }) =>
    within<StakingChain>(readStakingChain(chain, address), remaining(startedAt, BUDGET_MS), () => ({
      chainId: chain.chainId,
      address,
      denom: chain.coinMinimalDenom,
      symbol: chain.coinDenom,
      decimals: chain.coinDecimals,
      delegations: [],
      unbonding: [],
      redelegations: [],
      withdrawAddress: null,
      totals: { staked: null, rewards: null, unbonding: null },
      rewardsOther: [],
      nextUnbonding: null,
      apr: { chain: null, weighted: null },
      status: "error",
      error: "Timed out; try again shortly",
    })),
  );

  if (chains.length > 0 && chains.every((chain) => chain.status === "error")) {
    return allFailed("Staking positions could not be read right now");
  }
  const errors = unknownChainErrors(parsed.unknown);
  const body: StakingResponse = {
    updatedAt: Date.now(),
    chains,
    ...(errors.length ? { errors } : {}),
  };
  return privateJson(body);
}
