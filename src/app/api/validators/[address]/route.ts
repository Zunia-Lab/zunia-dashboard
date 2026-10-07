/**
 * GET /api/validators/[address]?chainId=<id>
 *
 * One validator's profile: its full `ValidatorRow` (rank, voting power,
 * commission headroom, uptime, jail / tombstone state, delegator APR), the
 * operator's self-delegation, and the slash events x/distribution recorded.
 *
 * `chainId` may be omitted when the operator prefix names exactly one
 * mainnet (`cosmosvaloper1…` → cosmoshub-4); chains that share a prefix
 * (mainnet and testnet) need it. Operator prefixes that are not
 * `<prefix>valoper` (Crypto.org's `crocncl1…`) are accepted.
 *
 * → 200 `ValidatorDetailResponse` · 400 · 404 unknown validator · 429 ·
 *   503 (unreadable; or Retry-After + `error: "upstream_timeout"` while a
 *   cold read runs).
 */

import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { publicJson } from "@/lib/server/respond";
import type { ServerChainEntry } from "@/lib/server/chains";
import { badRequest, parseChainId } from "@/lib/server/validate";
import { attachValidatorLogos } from "@/lib/server/validator-logos";
import { validatorApr } from "@/lib/chain/apr";
import { arr, intString, parseDec, pick, ratio, rec, str } from "@/lib/chain/parse";
import type { PartError, ValidatorDetailResponse, ValidatorRow, ValidatorSlash } from "@/lib/chain/types";
import { readEconomics } from "@/lib/server/chain/economics";
import { describeLcdError, describeMiss, lcd, within } from "@/lib/server/chain/lcd";
import {
  allFailed,
  inferOperatorChain,
  oldest,
  parseOperatorAddress,
  SINGLE_CHAIN_BUDGET_MS,
  stillLoading,
} from "@/lib/server/chain/request";
import { readSingleValidator, readValidatorSet, type ValidatorSet } from "@/lib/server/chain/validator-set";

export const runtime = "nodejs";

function parseSlashes(body: unknown): ValidatorSlash[] {
  const out: ValidatorSlash[] = [];
  for (const item of arr(pick(body, ["slashes"]))) {
    const slash = rec(item);
    const period = str(slash?.validator_period);
    const fraction = parseDec(slash?.fraction);
    if (period && fraction !== null) out.push({ period, fraction });
  }
  return out;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  let chain: ServerChainEntry;
  let operator: string;
  try {
    const { address } = await ctx.params;
    const raw = decodeURIComponent(address).trim();
    const chainParam = req.nextUrl.searchParams.get("chainId");
    chain = chainParam ? parseChainId(chainParam) : inferOperatorChain(raw);
    operator = parseOperatorAddress(raw, chain);
  } catch (error) {
    return badRequest(error);
  }
  const limited = rateLimit(req, { scope: "validator", capacity: 30, refillPerSecond: 1 });
  if (limited) return limited;

  const read = readValidator(chain, operator).catch((error: unknown) =>
    allFailed(`Validator ${operator} could not be read: ${describeLcdError(error)}`),
  );
  const response = await within<Response | null>(read, SINGLE_CHAIN_BUDGET_MS, () => null);
  return response ?? stillLoading(`Validator ${operator} is still loading; try again in a few seconds`);
}

async function readValidator(chain: ServerChainEntry, operator: string): Promise<Response> {
  const errors: PartError[] = [];
  const path = encodeURIComponent(operator);
  const [economics, setResult, slashes] = await Promise.all([
    readEconomics(chain),
    readValidatorSet(chain, { status: "bonded", chainApr: null }).then(
      (set): { set: ValidatorSet | null; error: string | null } => ({ set, error: null }),
      (error: unknown) => ({ set: null, error: describeLcdError(error) }),
    ),
    lcd(chain, `cosmos/distribution/v1beta1/validators/${path}/slashes?pagination.limit=100`, {
      ttlMs: 10 * 60_000,
      name: "slashes",
      map: parseSlashes,
    }).catch((error: unknown) => {
      errors.push({ chainId: chain.chainId, scope: "slashes", message: describeLcdError(error) });
      return null;
    }),
  ]);
  const chainApr = economics.result.apr.actual;
  const { set } = setResult;
  if (setResult.error) errors.push({ chainId: chain.chainId, scope: "validators", message: setResult.error });
  if (slashes && !slashes.ok) errors.push({ chainId: chain.chainId, scope: "slashes", message: describeMiss(slashes.miss) });

  let row: ValidatorRow | null = set?.rows.find((r) => r.operatorAddress === operator) ?? null;
  if (!row) {
    const single = await readSingleValidator(chain, operator, {
      window: set?.summary.signedBlocksWindow ?? economics.slashing?.signedBlocksWindow ?? null,
      chainApr,
      bondedTokens: economics.bonded,
    });
    row = single.row;
    errors.push(...single.errors.filter((error) => error.scope !== "validator"));
    if (!row) {
      if (!single.missing) return allFailed(`Validator ${operator} could not be read right now`);
      return Response.json(
        { error: "validator_not_found", message: `No validator ${operator} on ${chain.chainName}` },
        { status: 404, headers: { "cache-control": "public, max-age=60" } },
      );
    }
  } else {
    row = {
      ...row,
      apr: chainApr === null ? null : row.status === "bonded" && !row.jailed ? validatorApr(chainApr, row.commission.rate) : 0,
    };
  }
  const [withLogo] = await attachValidatorLogos(chain, [row], { waitMs: 1_000 });

  let selfDelegation: ValidatorDetailResponse["selfDelegation"] = null;
  if (row.accountAddress) {
    try {
      const self = await lcd(
        chain,
        `cosmos/staking/v1beta1/validators/${path}/delegations/${encodeURIComponent(row.accountAddress)}`,
        {
          ttlMs: 10 * 60_000,
          name: "self-delegation",
          map: (body) => intString(pick(body, ["delegation_response", "balance", "amount"])),
        },
      );
      if (self.ok && self.data !== null) {
        selfDelegation = { amount: self.data, ratio: ratio(self.data, row.tokens) };
      } else if (!self.ok && self.miss === "not-found") {
        // The operator holds no delegation to its own validator.
        selfDelegation = { amount: "0", ratio: 0 };
      } else if (!self.ok) {
        errors.push({ chainId: chain.chainId, scope: "self-delegation", message: describeMiss(self.miss) });
      }
    } catch (error) {
      errors.push({ chainId: chain.chainId, scope: "self-delegation", message: describeLcdError(error) });
    }
  }

  const summary = set
    ? { ...set.summary, aprActual: chainApr }
    : {
        active: 0,
        maxValidators: economics.staking?.maxValidators ?? null,
        activeSetFull: null,
        cutoffTokens: null,
        nakamoto: null,
        top10Share: null,
        medianCommission: null,
        bondedTokens: economics.bonded,
        aprActual: chainApr,
        signedBlocksWindow: economics.slashing?.signedBlocksWindow ?? null,
      };
  const body: ValidatorDetailResponse = {
    updatedAt: oldest([set?.asOf, economics.asOf]),
    chainId: chain.chainId,
    chainName: chain.chainName,
    symbol: economics.symbol,
    decimals: economics.decimals,
    validator: withLogo ?? row,
    selfDelegation,
    slashes: slashes?.ok ? slashes.data : null,
    summary: chainApr === null ? { ...summary, aprNote: economics.result.apr.note ?? "APR unavailable" } : summary,
    ...(errors.length ? { errors } : {}),
  };
  return publicJson(body, { maxAge: 60, sMaxAge: 300, swr: 600 });
}
