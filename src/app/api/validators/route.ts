/**
 * GET /api/validators?chainId=<id>[&status=bonded|all]
 *
 * The full validator set of one chain — every bonded validator, not a top
 * slice — ranked by voting power, with cumulative share and the Nakamoto set,
 * commission now and the highest it can reach in 30 / 90 days, uptime over
 * the slashing window, jail and tombstone state, and the APR a delegator
 * earns there (chain actual APR × (1 − commission)).
 *
 * `status=all` appends inactive validators (largest first), capped at 300
 * rows in total; `truncated` says when the cap cut the list.
 *
 * → 200 `ValidatorsResponse` · 400 · 429 · 503 when the set is unreadable,
 *   or (Retry-After, `error: "upstream_timeout"`) while a cold read runs.
 *
 * One chain per request: `chainId` is required. The legacy multi-chain form
 * (`?chains=<csv>`) is gone; every caller reads one set through
 * `useValidators` in `@/lib/data/validators`.
 */

import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson } from "@/lib/server/respond";
import { badRequest, parseChainId, parseEnum } from "@/lib/server/validate";
import type { ServerChainEntry } from "@/lib/server/chains";
import { attachValidatorLogos } from "@/lib/server/validator-logos";
import { validatorApr } from "@/lib/chain/apr";
import type { PartError, ValidatorsResponse } from "@/lib/chain/types";
import { readEconomics } from "@/lib/server/chain/economics";
import { describeLcdError, within } from "@/lib/server/chain/lcd";
import {
  allFailed,
  oldest,
  SINGLE_CHAIN_BUDGET_MS,
  stillLoading,
} from "@/lib/server/chain/request";
import { readValidatorSet } from "@/lib/server/chain/validator-set";

export const runtime = "nodejs";

const STATUSES = ["bonded", "all"] as const;

/** Outcome of one chain's read within the request budget. */
type Outcome = { ok: true; body: ValidatorsResponse } | { ok: false; timedOut: boolean; message: string };

function readWithin(chain: ServerChainEntry, status: (typeof STATUSES)[number], ms: number): Promise<Outcome> {
  return within<Outcome>(
    readOne(chain, status).then(
      (body): Outcome => ({ ok: true, body }),
      (error: unknown): Outcome => ({ ok: false, timedOut: false, message: describeLcdError(error) }),
    ),
    ms,
    () => ({ ok: false, timedOut: true, message: "Timed out; try again shortly" }),
  );
}

async function readOne(
  chain: ServerChainEntry,
  status: (typeof STATUSES)[number],
): Promise<ValidatorsResponse> {
  // Economics first would serialise two cold reads; the set does not need
  // the APR to load, so both start together and APR is applied after.
  const [economics, set] = await Promise.all([
    readEconomics(chain),
    readValidatorSet(chain, { status, chainApr: null }),
  ]);
  const chainApr = economics.result.apr.actual;
  const withApr = set.rows.map((row) => ({
    ...row,
    // Inactive or jailed validators pay nothing while out of the set.
    apr: chainApr === null ? null : row.status === "bonded" && !row.jailed ? validatorApr(chainApr, row.commission.rate) : 0,
  }));
  // Waits for the cosmos.directory list, never for Keybase (see attachValidatorLogos).
  const rows = await attachValidatorLogos(chain, withApr, { waitMs: 1_500, keybaseWaitMs: 0 });
  const errors: PartError[] = [...set.errors];
  return {
    updatedAt: oldest([set.asOf]),
    chainId: chain.chainId,
    chainName: chain.chainName,
    symbol: economics.symbol,
    decimals: economics.decimals,
    status,
    summary: {
      ...set.summary,
      aprActual: chainApr,
      ...(chainApr === null ? { aprNote: economics.result.apr.note ?? "APR unavailable" } : {}),
    },
    validators: rows,
    ...(set.truncated ? { truncated: true } : {}),
    ...(errors.length ? { errors } : {}),
  };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  let chain: ServerChainEntry;
  let status: (typeof STATUSES)[number];
  try {
    chain = parseChainId(params.get("chainId"));
    status = parseEnum(params.get("status"), STATUSES, "bonded", "status");
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, { scope: "validators", capacity: 30, refillPerSecond: 1 });
  if (limited) return limited;

  const outcome = await readWithin(chain, status, SINGLE_CHAIN_BUDGET_MS);
  if (outcome.ok) return publicJson(outcome.body, { maxAge: 60, sMaxAge: 300, swr: 600 });
  if (outcome.timedOut) return stillLoading(`Validators of ${chain.chainName} are still loading; try again in a few seconds`);
  return allFailed(`Validators of ${chain.chainName} could not be read: ${outcome.message}`);
}
