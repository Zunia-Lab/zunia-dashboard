/**
 * The decentralisation-friendly score that orders the validator picker
 * (spec §6 Staking: "sorted by a transparent decentralisation-friendly
 * score"). Four checks, one point each, all shown next to every validator so
 * nobody has to trust a black box:
 *
 * 1. outside the Nakamoto set: not one of the few validators that together
 *    hold over a third of voting power (enough to halt the chain);
 * 2. commission at most 10 %;
 * 3. uptime at least 99 % over the current signing window;
 * 4. not jailed (and not tombstoned).
 *
 * Ties go to the smaller validator, so stake spreads out. Unknown data never
 * scores: a validator whose uptime could not be read does not get the
 * uptime point.
 *
 * Pure.
 */

import type { ValidatorLite } from "@/lib/chain/types";

export const SCORE_COMMISSION_MAX = 0.1;
export const SCORE_UPTIME_MIN = 0.99;

export interface ScoreCheck {
  id: "nakamoto" | "commission" | "uptime" | "jailed";
  label: string;
  /** Null when the data to check is missing (counts as not passed). */
  pass: boolean | null;
}

export interface ValidatorScore {
  score: number;
  checks: ScoreCheck[];
}

type Scored = Pick<ValidatorLite, "inNakamotoSet" | "commissionRate" | "uptime" | "jailed" | "tombstoned">;

export function decentralisationScore(v: Scored): ValidatorScore {
  const checks: ScoreCheck[] = [
    {
      id: "nakamoto",
      label: "Outside the Nakamoto set",
      pass: v.inNakamotoSet === null ? null : !v.inNakamotoSet,
    },
    {
      id: "commission",
      label: "Commission ≤ 10%",
      pass: v.commissionRate === null ? null : v.commissionRate <= SCORE_COMMISSION_MAX + 1e-9,
    },
    {
      id: "uptime",
      label: "Uptime ≥ 99%",
      pass: v.uptime === null ? null : v.uptime >= SCORE_UPTIME_MIN - 1e-9,
    },
    {
      id: "jailed",
      label: "Not jailed",
      pass: v.jailed === null ? null : !v.jailed && v.tombstoned !== true,
    },
  ];
  return { score: checks.filter((check) => check.pass === true).length, checks };
}

/**
 * In a full active set, the bottom tenth can be pushed out by a newcomer
 * outbidding it, and stake there would then earn nothing. Those come last
 * within their score (still listed, never hidden).
 */
export function cutoffRisk(
  v: Pick<ValidatorLite, "rank">,
  set: { activeSetFull: boolean | null; active: number } | null | undefined,
): boolean {
  if (!set || set.activeSetFull !== true || v.rank === null) return false;
  return v.rank > Math.floor(set.active * 0.9);
}

/**
 * Highest score first; within a score, validators at risk of leaving a full
 * active set after the rest, then by voting power, smallest first (unknown
 * power last), then by name, so the order is stable between renders.
 */
export function rankByScore<T>(
  items: readonly T[],
  lite: (item: T) => ValidatorLite,
  options: { atRisk?: (item: T) => boolean } = {},
): T[] {
  const keyed = items.map((item) => {
    const v = lite(item);
    return { item, score: decentralisationScore(v).score, risk: options.atRisk?.(item) ?? false, power: v.votingPower, name: v.moniker };
  });
  keyed.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.risk !== b.risk) return a.risk ? 1 : -1;
    const ap = a.power ?? Infinity;
    const bp = b.power ?? Infinity;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
  return keyed.map((entry) => entry.item);
}

/** One sentence for the picker's "how is this ordered" note. */
export const SCORE_EXPLANATION =
  "Validators are ordered by four checks, one point each: outside the Nakamoto set (the few validators that together hold over a third of voting power), commission at most 10%, uptime at least 99% over the current window, and not jailed. Ties go to the smaller validator so stake spreads out, except that in a full active set the bottom tenth comes last: a newcomer can push it out, and stake there would then earn nothing. A check with no data scores nothing.";
