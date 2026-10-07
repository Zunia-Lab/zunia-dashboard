/**
 * Staking economics: APR (naive and actual), issuance, real yield.
 *
 * Why "actual" exists: standard x/mint pays `annual_provisions ÷
 * params.blocks_per_year` per block. The parameter is a guess made at genesis;
 * when blocks come faster than assumed, a year holds more blocks and stakers
 * earn more than the published inflation says. Safrochain's mint assumes 5 s
 * blocks (6,311,520 a year) while blocks average 2.8 s, so the real APR is
 * about 18.3 %, not the 10.3 % a naive dashboard shows (cosmos.directory
 * independently reports 18.5 % vs 10.3 %). The same correction moves the
 * Hub from 15.4 % to 19.6 %.
 *
 * Mints whose issuance follows the clock rather than block count (Osmosis
 * epochs, Celestia's time-based mint) need no correction: there `actual`
 * equals `naive` and the note says why.
 *
 * Every figure here is mint rewards only. Fees, MEV and Osmosis' taker-fee
 * share also reach stakers on some chains; they are not included, which the
 * `excludesFees` flag on every APR states.
 *
 * Pure: no I/O, no clock reads (callers pass `now`).
 */

import type { BlockRef, DirectoryEconomics } from "./params";
import type { AprSource, ChainApr, ChainInflation, ChainStatsField } from "./types";
import { ratio } from "./parse";

/**
 * Seconds in a Julian year (365.25 days) — the year the Cosmos SDK's own
 * default `blocks_per_year` is derived from (8,766 hours ÷ 5 s = 6,311,520).
 */
export const SECONDS_PER_YEAR = 31_557_600;

/** Latest block older than this means the chain (or its public node) has stalled. */
export const HALT_AFTER_MS = 5 * 60_000;

/** Blocks between the two samples used for the observed block time. */
export const BLOCK_TIME_WINDOW = 10_000;

/**
 * Above this (1,000 %) an APR says more about how little is staked than about
 * what a delegator would earn: on a chain with 0.01 % of supply bonded the
 * formula yields millions of percent. Such figures are withheld with a note.
 */
export const MAX_MEANINGFUL_APR = 10;

export interface BlockTimeSample {
  latest: BlockRef;
  earlier: BlockRef;
}

/** Average seconds per block between two blocks; null when unusable. */
export function observedBlockTime(sample: BlockTimeSample | null): number | null {
  if (!sample) return null;
  const blocks = sample.latest.height - sample.earlier.height;
  const seconds = (Date.parse(sample.latest.time) - Date.parse(sample.earlier.time)) / 1000;
  if (!(blocks > 0) || !(seconds > 0) || !Number.isFinite(seconds)) return null;
  return seconds / blocks;
}

/** Blocks per year at a given block time. */
export function blocksPerYear(blockTimeSec: number): number {
  return SECONDS_PER_YEAR / blockTimeSec;
}

/** The latest block is older than `HALT_AFTER_MS` (null when unknown). */
export function isHalted(latestBlockTime: string | null, now: number): boolean | null {
  if (!latestBlockTime) return null;
  const at = Date.parse(latestBlockTime);
  if (!Number.isFinite(at)) return null;
  return now - at > HALT_AFTER_MS;
}

/** APR a delegator earns at a validator: chain APR × (1 − commission). */
export function validatorApr(chainApr: number | null, commission: number | null): number | null {
  if (chainApr === null || commission === null) return null;
  const clamped = Math.min(1, Math.max(0, commission));
  return chainApr * (1 - clamped);
}

/** Growth of a staker's share of supply, approximated as APR − inflation. */
export function realYield(apr: number | null, inflation: number | null): number | null {
  if (apr === null || inflation === null) return null;
  return apr - inflation;
}

/** Inputs for one chain, as read from its LCD (all optional). */
export interface EconomicsInputs {
  now: number;
  /** Bonded tokens, base units. */
  bonded: string | null;
  /** Total supply of the staking denom, base units. */
  totalSupply: string | null;
  communityTax: number | null;
  mint: MintInputs;
  latest: BlockRef | null;
  /**
   * When `latest` was read. The halt check compares the block time with the
   * read time, not with `now`, so a cached reading served a few minutes later
   * cannot make a live chain look halted.
   */
  latestReadAt?: number | null;
  /** Observed block time sample; null when it could not be read. */
  sample: BlockTimeSample | null;
}

export type MintInputs =
  | {
      kind: "standard";
      /** `cosmos/mint/v1beta1/annual_provisions`, base units per year. */
      annualProvisions: number;
      /** `cosmos/mint/v1beta1/inflation`; null when the chain does not expose it. */
      inflation: number | null;
      /** `params.blocks_per_year`; null when the mint has no such parameter. */
      blocksPerYear: number | null;
      /** True when the mint params read failed (not merely absent). */
      paramsUnreadable: boolean;
    }
  | {
      kind: "osmosis";
      epochProvisions: number;
      epochSeconds: number | null;
      stakingProportion: number | null;
    }
  | { kind: "directory"; directory: DirectoryEconomics }
  | { kind: "none"; reason: string };

export interface EconomicsResult {
  apr: ChainApr;
  inflation: ChainInflation;
  realYield: number | null;
  bondedRatio: number | null;
  blockTimeSec: number | null;
  paramsBlockTimeSec: number | null;
  blockTimeWindow: number | null;
  halted: boolean | null;
  reasons: Partial<Record<ChainStatsField, string>>;
}

function emptyApr(source: AprSource | null, note: string): ChainApr {
  return { naive: null, actual: null, source, note, blockTimeFactor: null, excludesFees: true };
}

/** A positive finite number, else null. */
function positive(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Turns one chain's raw readings into APR, inflation and yield figures.
 *
 * Each missing input nulls only what depends on it, and `reasons` records why.
 */
export function computeEconomics(input: EconomicsInputs): EconomicsResult {
  const reasons: Partial<Record<ChainStatsField, string>> = {};
  const bonded = positive(input.bonded === null ? null : Number(input.bonded));
  const supply = positive(input.totalSupply === null ? null : Number(input.totalSupply));
  const tax = input.communityTax;
  const blockTimeSec = observedBlockTime(input.sample);
  const blockTimeWindow = input.sample ? input.sample.latest.height - input.sample.earlier.height : null;
  const bondedRatio = ratio(input.bonded, input.totalSupply);

  if (bondedRatio === null) {
    reasons.bondedRatio = input.bonded === null ? "Bonded tokens unavailable" : "Total supply unavailable";
  }
  if (blockTimeSec === null) reasons.blockTimeSec = "Could not read two blocks to time them";

  let apr: ChainApr;
  let inflation: ChainInflation = { param: null, actual: null };
  let paramsBlockTimeSec: number | null = null;
  const mint = input.mint;

  if (mint.kind === "standard") {
    const provisions = mint.annualProvisions;
    inflation.param = mint.inflation;
    if (mint.blocksPerYear !== null) paramsBlockTimeSec = SECONDS_PER_YEAR / mint.blocksPerYear;
    const naive =
      bonded !== null && tax !== null ? (provisions * (1 - tax)) / bonded : null;

    if (naive === null) {
      apr = emptyApr(
        "lcd",
        bonded === null ? "Bonded tokens unavailable" : "Community tax unavailable",
      );
    } else if (mint.blocksPerYear === null) {
      // No blocks_per_year to correct against: either the mint is time based
      // (Celestia), or its params could not be read. Only the first case makes
      // the naive figure the actual one.
      if (mint.paramsUnreadable) {
        apr = {
          naive,
          actual: null,
          source: "lcd",
          note: "Mint parameters unreadable, so the block-time correction cannot be applied",
          method: "annual_provisions × (1 − community_tax) ÷ bonded_tokens",
          blockTimeFactor: null,
          excludesFees: true,
        };
      } else {
        apr = {
          naive,
          actual: naive,
          source: "lcd",
          note: "This chain's mint has no blocks_per_year parameter (issuance is not per block), so actual equals the published rate",
          method: "annual_provisions × (1 − community_tax) ÷ bonded_tokens",
          blockTimeFactor: null,
          excludesFees: true,
        };
      }
    } else if (blockTimeSec === null) {
      apr = {
        naive,
        actual: null,
        source: "lcd",
        note: "Observed block time unavailable, so the actual APR cannot be computed",
        method: "annual_provisions × (1 − community_tax) ÷ bonded_tokens",
        blockTimeFactor: null,
        excludesFees: true,
      };
    } else {
      const factor = blocksPerYear(blockTimeSec) / mint.blocksPerYear;
      apr = {
        naive,
        actual: naive * factor,
        source: "lcd",
        method:
          "annual_provisions × (1 − community_tax) ÷ bonded_tokens × observed ÷ assumed blocks per year",
        blockTimeFactor: factor,
        excludesFees: true,
      };
    }

    if (supply === null) {
      reasons.inflation = "Total supply unavailable";
    } else if (mint.blocksPerYear === null) {
      inflation.actual = mint.paramsUnreadable ? null : provisions / supply;
    } else if (blockTimeSec !== null) {
      inflation.actual = (provisions / supply) * (blocksPerYear(blockTimeSec) / mint.blocksPerYear);
    }
    if (inflation.param === null && inflation.actual === null && !reasons.inflation) {
      reasons.inflation = "Inflation is not exposed and could not be derived";
    }
  } else if (mint.kind === "osmosis") {
    const epochsPerYear = mint.epochSeconds ? SECONDS_PER_YEAR / mint.epochSeconds : null;
    const yearly = epochsPerYear !== null ? mint.epochProvisions * epochsPerYear : null;
    if (yearly === null) {
      apr = emptyApr("osmosis-mint", "Epoch length unavailable");
    } else if (bonded === null || mint.stakingProportion === null || tax === null) {
      apr = emptyApr(
        "osmosis-mint",
        bonded === null
          ? "Bonded tokens unavailable"
          : tax === null
            ? "Community tax unavailable"
            : "Staking share of issuance unavailable",
      );
    } else {
      const naive = (yearly * mint.stakingProportion * (1 - tax)) / bonded;
      apr = {
        naive,
        actual: naive,
        source: "osmosis-mint",
        note: "Issuance is paid per epoch (wall-clock), so block time does not change it",
        method:
          "epoch_provisions × epochs per year × distribution_proportions.staking × (1 − community_tax) ÷ bonded_tokens",
        blockTimeFactor: null,
        excludesFees: true,
      };
    }
    inflation = { param: null, actual: yearly !== null && supply !== null ? yearly / supply : null };
    if (inflation.actual === null) reasons.inflation = supply === null ? "Total supply unavailable" : "Epoch length unavailable";
  } else if (mint.kind === "directory") {
    const directory = mint.directory;
    const factor =
      directory.actualBlocksPerYear !== null && directory.blocksPerYear !== null
        ? directory.actualBlocksPerYear / directory.blocksPerYear
        : null;
    if (directory.naive === null && directory.actual === null) {
      // No APR means the directory found no working mint either (Kava pays
      // stakers through its own module and reports 0); its inflation figure
      // from the same record is no more trustworthy, so neither is shown.
      apr = emptyApr(
        "cosmos.directory",
        "Rewards do not come from a standard mint on this chain; no public APR to show",
      );
      reasons.inflation = "Not published for this chain";
    } else {
      apr = {
        naive: directory.naive,
        actual: directory.actual,
        source: "cosmos.directory",
        note: "This chain's mint is not readable from its public endpoint; figures from cosmos.directory",
        method: "cosmos.directory estimated_apr (naive) and calculated_apr (block-time adjusted)",
        blockTimeFactor: factor,
        excludesFees: true,
      };
      inflation = {
        param: directory.inflation,
        actual: directory.inflation !== null && factor !== null ? directory.inflation * factor : null,
      };
      if (inflation.param === null) reasons.inflation = "Not published for this chain";
    }
  } else {
    apr = emptyApr(null, mint.reason);
    reasons.inflation = mint.reason;
  }

  if ((apr.naive ?? 0) > MAX_MEANINGFUL_APR || (apr.actual ?? 0) > MAX_MEANINGFUL_APR) {
    const share =
      bondedRatio === null
        ? ""
        : bondedRatio < 0.0001
          ? " (under 0.01 % of supply)"
          : ` (${(bondedRatio * 100).toFixed(2)} % of supply)`;
    apr = {
      ...apr,
      naive: null,
      actual: null,
      blockTimeFactor: null,
      note: `So little is staked${share} that the APR formula gives a meaningless figure`,
    };
  }
  if (apr.actual === null) reasons.apr = apr.note ?? "APR unavailable";
  const real = realYield(apr.actual, inflation.actual);
  if (real === null) reasons.realYield = apr.actual === null ? "Actual APR unavailable" : "Actual inflation unavailable";

  const halted = isHalted(input.latest?.time ?? null, input.latestReadAt ?? input.now);
  if (halted === null) reasons.halted = "Latest block unreadable";
  if (!input.latest) reasons.latestHeight = "Latest block unreadable";

  return {
    apr,
    inflation,
    realYield: real,
    bondedRatio,
    blockTimeSec,
    paramsBlockTimeSec,
    blockTimeWindow,
    halted,
    reasons,
  };
}
