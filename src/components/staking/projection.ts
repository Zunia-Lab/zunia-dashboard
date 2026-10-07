/**
 * Rewards forecast and the compounding simulator (research S3).
 *
 * Two strategies over the same horizon, in whatever unit the caller works in
 * (whole tokens of one chain, or fiat across chains):
 *
 * - **simple**: rewards accrue and are kept aside (never restaked):
 *   P × (1 + r·t). No fees.
 * - **compounded**: every 1/n of a year the pending rewards are claimed and
 *   delegated back, paying one claim + delegate fee each time. A restake
 *   whose rewards would not even cover the fee is skipped (nobody would pay
 *   $0.05 to restake $0.01), and keeps accruing to the next date.
 *
 * Between restakes rewards grow linearly (x/distribution pays on the staked
 * amount, not on pending rewards), so the curve is exact for a constant APR.
 * Everything else is an assumption the UI states: APR and price held
 * constant, no slashing, the fee unchanged.
 *
 * Pure.
 */

export interface ProjectionInput {
  /** Starting stake, in the caller's unit. */
  principal: number;
  /** Yearly rate after commission, as a fraction (0.18 = 18 %). */
  apr: number;
  /** Horizon in years. */
  years: number;
  /** Restakes per year; 0 = never. */
  restakesPerYear: number;
  /** Cost of one claim + delegate, in the caller's unit. */
  feePerRestake: number;
  /** Chart samples per year (default 12: monthly). */
  samplesPerYear?: number;
}

export interface ProjectionPoint {
  /** Years from the start. */
  t: number;
  simple: number;
  compound: number;
}

export interface Projection {
  points: ProjectionPoint[];
  simpleEnd: number;
  compoundEnd: number;
  /** compoundEnd − simpleEnd: what compounding adds after its fees (can be negative). */
  gain: number;
  /** Fees paid by the restakes that happened. */
  fees: number;
  restakes: number;
  /** Restake dates passed over because rewards were below the fee. */
  skipped: number;
}

const EPSILON = 1e-9;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Runs both strategies. Invalid input (negative stake, NaN) projects nothing. */
export function project(input: ProjectionInput): Projection {
  const principal = Math.max(0, finite(input.principal));
  const apr = Math.max(0, finite(input.apr));
  const years = Math.max(0, finite(input.years));
  const n = Math.max(0, Math.floor(finite(input.restakesPerYear)));
  const fee = Math.max(0, finite(input.feePerRestake));
  const samples = Math.max(1, Math.floor(finite(input.samplesPerYear ?? 12, 12)));

  // Restake dates, in years, and chart sample dates, merged in order so the
  // state machine below walks one timeline.
  const events: Array<{ t: number; kind: "restake" | "sample" }> = [];
  if (n > 0) {
    const count = Math.floor(years * n + EPSILON);
    for (let k = 1; k <= count; k += 1) events.push({ t: k / n, kind: "restake" });
  }
  const sampleCount = Math.max(1, Math.round(years * samples));
  for (let k = 0; k <= sampleCount; k += 1) events.push({ t: (years * k) / sampleCount, kind: "sample" });
  // At the same instant a restake runs before the sample, so the chart shows
  // the stake after it (the pending part moves into the base, same total).
  events.sort((a, b) => a.t - b.t || (a.kind === b.kind ? 0 : a.kind === "restake" ? -1 : 1));

  let base = principal;
  let lastRestake = 0;
  let fees = 0;
  let restakes = 0;
  let skipped = 0;
  const points: ProjectionPoint[] = [];

  const pendingAt = (t: number) => base * apr * (t - lastRestake);

  for (const event of events) {
    if (event.kind === "restake") {
      const pending = pendingAt(event.t);
      if (pending > fee + EPSILON) {
        base += pending - fee;
        fees += fee;
        restakes += 1;
        lastRestake = event.t;
      } else {
        skipped += 1;
      }
      continue;
    }
    points.push({ t: event.t, simple: principal * (1 + apr * event.t), compound: base + pendingAt(event.t) });
  }

  const simpleEnd = principal * (1 + apr * years);
  const compoundEnd = base + pendingAt(years);
  return { points, simpleEnd, compoundEnd, gain: compoundEnd - simpleEnd, fees, restakes, skipped };
}

/**
 * The pending-rewards level at which restaking pays best, for a fixed fee:
 * R* = √(2 · fee · stake), in the same unit as both.
 *
 * Why: restaking every T years with fee f grows the stake at about
 * r − f/(P·T) − r²·T/2 per year; the optimum is T* = √(2f/P)/r, at which the
 * pending rewards are P·r·T* = √(2fP). Null when the fee or stake is not
 * positive (with no fee, sooner is always better).
 */
export function restakeThreshold(stake: number, fee: number): number | null {
  if (!(stake > 0) || !(fee > 0) || !Number.isFinite(stake) || !Number.isFinite(fee)) return null;
  return Math.sqrt(2 * fee * stake);
}

/** Days between restakes at the optimal threshold; null when it cannot be computed. */
export function restakeIntervalDays(stake: number, apr: number, fee: number): number | null {
  const threshold = restakeThreshold(stake, fee);
  if (threshold === null || !(apr > 0) || !Number.isFinite(apr)) return null;
  return (threshold / (stake * apr)) * 365;
}

/** The restake frequencies the simulator offers, per year. */
export const RESTAKE_OPTIONS = [
  { value: "0", label: "Never", perYear: 0 },
  { value: "12", label: "Monthly", perYear: 12 },
  { value: "52", label: "Weekly", perYear: 52 },
  { value: "365", label: "Daily", perYear: 365 },
] as const;

export type RestakeOption = (typeof RESTAKE_OPTIONS)[number]["value"];

/**
 * The offered frequency that leaves the most after its fees over the
 * horizon, or "Never" when no restake cadence beats keeping rewards aside:
 * compounding that does not pay for itself is not worth suggesting, and a
 * default that loses half the rewards to fees would be a bad first answer.
 * Ties go to the less frequent option (fewer transactions to sign).
 */
export function bestOption(input: Omit<ProjectionInput, "restakesPerYear">): RestakeOption {
  let best: RestakeOption = "0";
  let bestGain = 0;
  for (const option of RESTAKE_OPTIONS) {
    if (option.perYear === 0) continue;
    const { gain } = project({ ...input, restakesPerYear: option.perYear });
    // Options run from least to most frequent, so `>` keeps the earlier on a tie.
    if (gain > bestGain + EPSILON) {
      best = option.value;
      bestGain = gain;
    }
  }
  return best;
}

/** The offered frequency closest to an interval in days (for "use the suggestion"). */
export function closestOption(intervalDays: number | null): RestakeOption {
  if (intervalDays === null || !Number.isFinite(intervalDays) || intervalDays <= 0) return "12";
  const perYear = 365 / intervalDays;
  let best: RestakeOption = "12";
  let bestDistance = Infinity;
  for (const option of RESTAKE_OPTIONS) {
    if (option.perYear === 0) continue;
    // Compare on a log scale: weekly vs monthly is a ×4 step, not "40 apart".
    const distance = Math.abs(Math.log(option.perYear) - Math.log(perYear));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option.value;
    }
  }
  return best;
}
