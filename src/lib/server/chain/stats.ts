/**
 * `ChainStats` for one chain: the economics (`./economics`) plus the bonded
 * set's concentration figures (`./validator-set`), with a reason for every
 * figure that is missing. Shared by `/api/chains/stats` (many chains, the
 * compare table) and `/api/chains/[chainId]` (one chain, its detail page).
 */

import "server-only";
import type { ServerChainEntry } from "@/lib/server/chains";
import { getSpotPrices } from "@/lib/server/prices/spot";
import { attachValidatorLogos } from "@/lib/server/validator-logos";
import { identifyDenom } from "@/lib/token/identity";
import type { FiatCurrency } from "@/lib/token/types";
import { UNPRICED_TEXT } from "@/lib/token/wire";
import type { ChainDetailResponse, ChainStats, ChainStatsField, PartError } from "@/lib/chain/types";
import { readEconomics, type ChainEconomics } from "./economics";
import { countOpenProposals } from "./governance";
import { describeLcdError, within } from "./lcd";
import { oldest } from "./request";
import { readValidatorSet, type ValidatorSet } from "./validator-set";

const DAY = 86_400;

function assemble(
  chain: ServerChainEntry,
  economics: ChainEconomics,
  set: ValidatorSet | null,
  setError: string | null,
): ChainStats {
  const reasons: Partial<Record<ChainStatsField, string>> = { ...economics.result.reasons };
  const errors: PartError[] = [...economics.errors, ...(set?.errors ?? [])];
  const scoped = (scope: string) => errors.find((error) => error.scope === scope)?.message;
  const summary = set?.summary ?? null;

  if (economics.bonded === null) reasons.bondedTokens = scoped("pool") ?? "Staking pool unreadable";
  if (economics.totalSupply === null) reasons.totalSupply = scoped("supply") ?? "Supply unreadable";
  if (economics.communityTax === null) {
    reasons.communityTax = scoped("distribution-params") ?? "Distribution parameters unreadable";
  }
  if (!economics.staking) {
    const why = scoped("staking-params") ?? "Staking parameters unreadable";
    reasons.unbondingDays = why;
    reasons.maxValidators = why;
    reasons.minCommission = why;
  }
  if (!economics.slashing) reasons.slashing = scoped("slashing-params") ?? "Slashing parameters unreadable";
  if (!economics.gov) reasons.gov = scoped("gov-params") ?? "Governance parameters unreadable";
  if (!summary) {
    const why = setError ?? "Validator set unreadable";
    reasons.activeValidators = why;
    reasons.nakamoto = why;
    reasons.top10Share = why;
    reasons.medianCommission = why;
  }
  if (setError) errors.push({ chainId: chain.chainId, scope: "validators", message: setError });

  const unbonding = economics.staking?.unbondingSeconds ?? null;
  const result = economics.result;
  return {
    chainId: chain.chainId,
    chainName: chain.chainName,
    network: chain.network,
    iconUrl: chain.iconUrl ?? null,
    nativeSymbol: economics.symbol,
    nativeDenom: economics.bondDenom,
    nativeDecimals: economics.decimals,
    price: null,
    apr: result.apr,
    inflation: result.inflation,
    realYield: result.realYield,
    bondedRatio: result.bondedRatio,
    goalBonded: economics.mintParams?.goalBonded ?? null,
    bondedTokens: economics.bonded,
    notBondedTokens: economics.notBonded,
    totalSupply: economics.totalSupply,
    communityTax: economics.communityTax,
    unbondingDays: unbonding === null ? null : unbonding / DAY,
    maxValidators: economics.staking?.maxValidators ?? null,
    minCommission: economics.staking?.minCommission ?? null,
    activeValidators: summary?.active ?? null,
    nakamoto: summary?.nakamoto ?? null,
    top10Share: summary?.top10Share ?? null,
    medianCommission: summary?.medianCommission ?? null,
    blockTimeSec: result.blockTimeSec,
    paramsBlockTimeSec: result.paramsBlockTimeSec,
    blockTimeWindow: result.blockTimeWindow,
    latestHeight: economics.latest?.height ?? null,
    latestBlockTime: economics.latest?.time ?? null,
    halted: result.halted,
    slashing: economics.slashing,
    gov: economics.gov,
    ...(Object.keys(reasons).length ? { reasons } : {}),
    ...(errors.length ? { errors } : {}),
  };
}

async function readSet(
  chain: ServerChainEntry,
  withSigning: boolean,
): Promise<{ set: ValidatorSet | null; error: string | null }> {
  try {
    // chainApr is patched in afterwards: the summary does not depend on it,
    // and reading both in parallel halves a cold request.
    return { set: await readValidatorSet(chain, { status: "bonded", chainApr: null, withSigning }), error: null };
  } catch (error) {
    return { set: null, error: describeLcdError(error) };
  }
}

/** Stats for one chain plus the read time of its oldest live figure. Never rejects. */
export async function readChainStats(chain: ServerChainEntry): Promise<{ stats: ChainStats; asOf: number }> {
  const [economics, { set, error }] = await Promise.all([readEconomics(chain), readSet(chain, false)]);
  if (set) set.summary.aprActual = economics.result.apr.actual;
  return {
    stats: assemble(chain, economics, set, error),
    asOf: oldest([economics.asOf, set?.asOf]),
  };
}

/** Prices are a bonus on chain stats: they never hold the response longer than this. */
const PRICE_BUDGET_MS = 4_000;

/**
 * Fills `price` (in `currency`) on each chain's stats from the shared prices
 * module, in one batch. Never rejects: an unpriced token or an unreachable
 * source leaves `price: null` with `reasons.price` saying which.
 */
export async function attachNativePrices(stats: ChainStats[], currency: FiatCurrency = "usd"): Promise<ChainStats[]> {
  if (stats.length === 0) return stats;
  const identities = stats.map((chain) => identifyDenom(chain.chainId, chain.nativeDenom));
  const result = await within(
    getSpotPrices(identities, currency).catch(() => null),
    PRICE_BUDGET_MS,
    () => null,
  );
  return stats.map((chain, index) => {
    const key = identities[index]?.key ?? "";
    const price = result?.prices.get(key) ?? null;
    if (price) return { ...chain, price };
    const unpriced = result?.unpriced.get(key);
    const why = result === null ? UNPRICED_TEXT["source-unavailable"] : unpriced ? UNPRICED_TEXT[unpriced] : "No price";
    return { ...chain, price: null, reasons: { ...chain.reasons, price: why } };
  });
}

/** True when nothing at all could be read for the chain (for a 503). */
export function statsUnavailable(stats: ChainStats): boolean {
  return (
    stats.bondedTokens === null &&
    stats.latestHeight === null &&
    stats.activeValidators === null &&
    stats.apr.naive === null
  );
}

/** Everything the chain detail page needs in one response. */
export async function readChainDetail(
  chain: ServerChainEntry,
  currency: FiatCurrency = "usd",
): Promise<ChainDetailResponse> {
  const [economics, { set, error }, proposals] = await Promise.all([
    readEconomics(chain),
    readSet(chain, false),
    countOpenProposals(chain),
  ]);
  if (set) set.summary.aprActual = economics.result.apr.actual;
  const [stats] = await attachNativePrices([assemble(chain, economics, set, error)], currency);

  let validatorSet: ChainDetailResponse["validatorSet"] = null;
  if (set) {
    const top = await attachValidatorLogos(chain, set.rows.filter((row) => row.status === "bonded").slice(0, 10), {
      waitMs: 800,
    });
    const topShare = top.reduce((sum, row) => sum + row.votingPower, 0);
    validatorSet = {
      ...set.summary,
      top: top.map((row) => ({
        operatorAddress: row.operatorAddress,
        moniker: row.moniker,
        ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
        rank: row.rank ?? 0,
        votingPower: row.votingPower,
      })),
      othersShare: Math.max(0, 1 - topShare),
    };
  }
  const errors: PartError[] = [];
  if (proposals === null) {
    errors.push({ chainId: chain.chainId, scope: "proposals", message: "Governance unreadable" });
  }
  return {
    updatedAt: oldest([economics.asOf, set?.asOf]),
    currency,
    chain: stats ?? assemble(chain, economics, set, error),
    validatorSet,
    proposals,
    ...(errors.length ? { errors } : {}),
  };
}
