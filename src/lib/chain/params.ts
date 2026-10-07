/**
 * Readers for the chain-level LCD payloads that feed the economics: staking,
 * distribution, slashing, mint (standard and Osmosis), gov params, blocks.
 *
 * Each takes the raw JSON body and returns typed fields or null. They never
 * throw, so one odd module on one chain degrades one figure, not the page.
 */

import {
  arr,
  coins,
  intString,
  parseDec,
  parseDurationSeconds,
  parseIntSafe,
  parseTime,
  pick,
  rec,
  str,
} from "./parse";
import type { Coin, GovParams, SlashingParams } from "./types";

const DAY = 86_400;

export interface StakingParams {
  bondDenom: string | null;
  unbondingSeconds: number | null;
  maxValidators: number | null;
  minCommission: number | null;
}

/** `cosmos/staking/v1beta1/params` */
export function parseStakingParams(body: unknown): StakingParams | null {
  const params = rec(pick(body, ["params"]));
  if (!params) return null;
  return {
    bondDenom: str(params.bond_denom),
    unbondingSeconds: parseDurationSeconds(params.unbonding_time),
    maxValidators: parseIntSafe(params.max_validators),
    minCommission: parseDec(params.min_commission_rate),
  };
}

/** `cosmos/staking/v1beta1/pool` */
export function parsePool(body: unknown): { bonded: string; notBonded: string | null } | null {
  const pool = rec(pick(body, ["pool"]));
  const bonded = intString(pool?.bonded_tokens);
  if (!pool || bonded === null) return null;
  return { bonded, notBonded: intString(pool.not_bonded_tokens) };
}

/** `cosmos/bank/v1beta1/supply/by_denom?denom=` (and the older `/supply/{denom}`). */
export function parseSupplyAmount(body: unknown): string | null {
  return intString(pick(body, ["amount", "amount"]));
}

/** `cosmos/distribution/v1beta1/params` */
export function parseCommunityTax(body: unknown): number | null {
  return parseDec(pick(body, ["params", "community_tax"]));
}

/** `cosmos/slashing/v1beta1/params` */
export function parseSlashingParams(body: unknown): SlashingParams | null {
  const params = rec(pick(body, ["params"]));
  if (!params) return null;
  return {
    signedBlocksWindow: parseIntSafe(params.signed_blocks_window),
    minSignedPerWindow: parseDec(params.min_signed_per_window),
    downtimeJailSeconds: parseDurationSeconds(params.downtime_jail_duration),
    slashFractionDowntime: parseDec(params.slash_fraction_downtime),
    slashFractionDoubleSign: parseDec(params.slash_fraction_double_sign),
  };
}

export interface MintParams {
  mintDenom: string | null;
  /** Blocks per year the mint assumes; null on custom mints without it. */
  blocksPerYear: number | null;
  goalBonded: number | null;
}

/** `cosmos/mint/v1beta1/params` */
export function parseMintParams(body: unknown): MintParams | null {
  const params = rec(pick(body, ["params"]));
  if (!params) return null;
  const blocksPerYear = parseIntSafe(params.blocks_per_year);
  return {
    mintDenom: str(params.mint_denom),
    blocksPerYear: blocksPerYear !== null && blocksPerYear > 0 ? blocksPerYear : null,
    goalBonded: parseDec(params.goal_bonded),
  };
}

/**
 * `cosmos/mint/v1beta1/inflation`, or Celestia's `…/inflation_rate` (its
 * time-based mint answers 501 on the standard route).
 */
export function parseInflation(body: unknown): number | null {
  return parseDec(pick(body, ["inflation"])) ?? parseDec(pick(body, ["inflation_rate"]));
}

/** `cosmos/mint/v1beta1/annual_provisions` (base units per year, a Dec). */
export function parseAnnualProvisions(body: unknown): number | null {
  return parseDec(pick(body, ["annual_provisions"]));
}

export interface OsmosisMintParams {
  epochIdentifier: string | null;
  /** Share of each epoch's issuance that goes to stakers. */
  stakingProportion: number | null;
}

/** `osmosis/mint/v1beta1/params` */
export function parseOsmosisMintParams(body: unknown): OsmosisMintParams | null {
  const params = rec(pick(body, ["params"]));
  if (!params) return null;
  return {
    epochIdentifier: str(params.epoch_identifier),
    stakingProportion: parseDec(pick(params, ["distribution_proportions", "staking"])),
  };
}

/** `osmosis/mint/v1beta1/epoch_provisions` (base units per epoch, a Dec). */
export function parseEpochProvisions(body: unknown): number | null {
  return parseDec(pick(body, ["epoch_provisions"]));
}

/** Duration of epoch `identifier` from `osmosis/epochs/v1beta1/epochs`. */
export function parseEpochSeconds(body: unknown, identifier: string): number | null {
  for (const item of arr(pick(body, ["epochs"]))) {
    const epoch = rec(item);
    if (str(epoch?.identifier) === identifier) return parseDurationSeconds(epoch?.duration);
  }
  // Osmosis' mint epoch has always been "day"; trust the name only for it.
  if (identifier === "day") return DAY;
  if (identifier === "week") return 7 * DAY;
  return null;
}

export interface BlockRef {
  height: number;
  /** ISO time. */
  time: string;
}

/** `cosmos/base/node/v1beta1/status` (SDK ≥ 0.50; tiny) */
export function parseNodeStatus(body: unknown): BlockRef | null {
  const height = parseIntSafe(pick(body, ["height"]));
  const time = parseTime(pick(body, ["timestamp"]));
  return height !== null && height > 0 && time ? { height, time } : null;
}

/** `cosmos/base/tendermint/v1beta1/blocks/{height|latest}` */
export function parseBlockHeader(body: unknown): BlockRef | null {
  const header =
    rec(pick(body, ["block", "header"])) ?? rec(pick(body, ["sdk_block", "header"]));
  const height = parseIntSafe(header?.height);
  const time = parseTime(header?.time);
  return height !== null && height > 0 && time ? { height, time } : null;
}

function govFromParams(params: Record<string, unknown>): Omit<GovParams, "api"> {
  const votingSeconds = parseDurationSeconds(params.voting_period);
  const expeditedSeconds = parseDurationSeconds(params.expedited_voting_period);
  const depositSeconds = parseDurationSeconds(params.max_deposit_period);
  const minDeposit = coins(params.min_deposit);
  return {
    quorum: parseDec(params.quorum),
    threshold: parseDec(params.threshold),
    vetoThreshold: parseDec(params.veto_threshold),
    expeditedThreshold: parseDec(params.expedited_threshold),
    votingPeriodDays: votingSeconds !== null && votingSeconds > 0 ? votingSeconds / DAY : null,
    expeditedVotingPeriodDays:
      expeditedSeconds !== null && expeditedSeconds > 0 ? expeditedSeconds / DAY : null,
    depositPeriodDays: depositSeconds !== null && depositSeconds > 0 ? depositSeconds / DAY : null,
    minDeposit: minDeposit.length ? minDeposit : null,
  };
}

/**
 * gov v1 params from `cosmos/gov/v1/params/tallying`.
 *
 * SDK ≥ 0.47 answers every params query with the unified `params` object, so
 * one read is enough; 0.46 fills only the section asked for and needs the
 * `voting` and `deposit` reads too (`mergeGovV1Sections`). Returns null when
 * the body has neither form.
 */
export function parseGovV1Params(body: unknown): GovParams | null {
  const params = rec(pick(body, ["params"]));
  if (params && (params.quorum !== undefined || params.voting_period !== undefined)) {
    return { ...govFromParams(params), api: "v1" };
  }
  return null;
}

/**
 * gov params assembled from the three per-section reads (gov v1 on SDK 0.46,
 * or v1beta1): `tally_params` from the tallying read, `voting_params` from the
 * voting read, `deposit_params` from the deposit read. The other sections of
 * each answer are zero-filled by the node and must be ignored.
 */
export function parseGovSections(
  tallying: unknown,
  voting: unknown,
  deposit: unknown,
  api: "v1" | "v1beta1",
): GovParams | null {
  const tally = rec(pick(tallying, ["tally_params"]));
  if (!tally) return null;
  const votingParams = rec(pick(voting, ["voting_params"])) ?? {};
  const depositParams = rec(pick(deposit, ["deposit_params"])) ?? {};
  const merged: Record<string, unknown> = {
    quorum: tally.quorum,
    threshold: tally.threshold,
    veto_threshold: tally.veto_threshold,
    voting_period: votingParams.voting_period,
    max_deposit_period: depositParams.max_deposit_period,
    min_deposit: depositParams.min_deposit,
  };
  return { ...govFromParams(merged), api };
}

export interface DirectoryEconomics {
  /** cosmos.directory `estimated_apr` (from params). */
  naive: number | null;
  /** cosmos.directory `calculated_apr` (block-time adjusted). */
  actual: number | null;
  inflation: number | null;
  blocksPerYear: number | null;
  actualBlocksPerYear: number | null;
}

/** `https://chains.cosmos.directory/{name}` → `chain.params`. */
export function parseDirectoryChain(body: unknown): DirectoryEconomics | null {
  const params = rec(pick(body, ["chain", "params"]));
  if (!params) return null;
  const positive = (value: number | null) => (value !== null && value > 0 ? value : null);
  return {
    naive: positive(parseDec(params.estimated_apr)),
    actual: positive(parseDec(params.calculated_apr)),
    inflation: parseDec(params.base_inflation),
    blocksPerYear: positive(parseDec(params.blocks_per_year)),
    actualBlocksPerYear: positive(parseDec(params.actual_blocks_per_year)),
  };
}

/** Minimum deposit of the denom present in `min`, for a deposit progress bar. */
export function depositProgress(total: Coin[], min: Coin[] | null): number | null {
  if (!min || min.length === 0) return null;
  const target = min[0];
  if (!target) return null;
  const paid = total.find((coin) => coin.denom === target.denom);
  const goal = Number(target.amount);
  if (!Number.isFinite(goal) || goal <= 0) return null;
  return Math.min(1, Number(paid?.amount ?? "0") / goal);
}
