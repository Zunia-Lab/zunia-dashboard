/**
 * The "staking rewards ready" notice is a cycle, not a reading of the amount.
 *
 * Ported from zunia-extension `lib/notices.ts` (nextRewardsNotice,
 * parseRewardsNotice) @ 1453e7a, on whole-token numbers instead of base-unit
 * strings because that is what the dashboard's portfolio read exposes.
 *
 * Rewards grow every block a validator pays out — every few seconds on some
 * chains — so a notice keyed or worded on the amount is a new alert every
 * block (the dashboard's previous `claimable:<amount>` id did exactly that).
 * Instead:
 *
 * - `waiting` (a fresh account): raised as soon as anything is claimable;
 * - `raised`: one generic notice per cycle, id `rewards:<cycle>`. Reading it is
 *   final for that cycle; the id never changes, so it never re-alerts;
 * - after a claim (nothing claimable, or a drop that leaves every chain under
 *   one whole token) the cycle is `rearmed`: the next notice waits until some
 *   chain has at least one whole token again, so a claim is not followed a
 *   block later by an alert for a few micro-units.
 *
 * With a daily or weekly reminder, rewards still waiting that long after the
 * notice raise it again as a new cycle.
 */

import type { RewardsChainInput } from "@/lib/notifications/types";

export type RewardsPhase = "waiting" | "raised" | "rearmed";

export interface RewardsCycle {
  readonly phase: RewardsPhase;
  /** Raised notices so far; the notice id, so each cycle is read on its own. */
  readonly cycle: number;
  /** When the current notice was raised: its place in the feed. */
  readonly raisedAt: number;
  /** Claimable per chain at the last look, in whole tokens, to see a claim. */
  readonly last: Readonly<Record<string, number>>;
}

export const INITIAL_REWARDS_CYCLE: RewardsCycle = {
  phase: "waiting",
  cycle: 0,
  raisedAt: 0,
  last: {},
};

function amountOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The next state of the cycle from the rewards just read.
 *
 * Pure. Failed chains teach nothing, and an empty list (nothing loaded yet)
 * leaves the state as it was. `nextCycle` lets the caller keep cycle numbers
 * unique across several accounts, so `rewards:<cycle>` never collides.
 */
export function nextRewardsCycle(
  prev: RewardsCycle,
  chains: readonly RewardsChainInput[],
  now: number,
  repeatMs: number | null = null,
  nextCycle: number = prev.cycle + 1,
): RewardsCycle {
  const seen = chains.filter((row) => !row.failed && typeof row.chainId === "string" && row.chainId);
  if (seen.length === 0) return prev;

  const last: Record<string, number> = { ...prev.last };
  let anyClaimable = false;
  let anyWhole = false;
  let claimed = false;
  for (const row of seen) {
    const amount = amountOf(row.rewardsWhole);
    if (amount > 0) anyClaimable = true;
    if (amount >= 1) anyWhole = true;
    const before = prev.last[row.chainId];
    // Rewards only ever grow between withdrawals (a delegate/undelegate also
    // withdraws), so any drop is a claim. The epsilon absorbs float noise.
    if (before !== undefined && amount + Math.max(1e-12, before * 1e-9) < before) claimed = true;
    last[row.chainId] = amount;
  }

  const raise = (): RewardsCycle => ({
    phase: "raised",
    cycle: Math.max(nextCycle, prev.cycle + 1),
    raisedAt: now,
    last,
  });
  switch (prev.phase) {
    case "waiting":
      return anyClaimable ? raise() : { ...prev, last };
    case "raised":
      if (!anyClaimable || (claimed && !anyWhole)) return { ...prev, phase: "rearmed", last };
      if (repeatMs !== null && now - prev.raisedAt >= repeatMs) return raise();
      return { ...prev, last };
    case "rearmed":
      return anyWhole ? raise() : { ...prev, last };
  }
}

/** A stored cycle, validated; anything unreadable starts fresh. */
export function parseRewardsCycle(value: unknown): RewardsCycle {
  if (!value || typeof value !== "object") return INITIAL_REWARDS_CYCLE;
  const row = value as Record<string, unknown>;
  const phase =
    row.phase === "raised" || row.phase === "rearmed" || row.phase === "waiting" ? row.phase : null;
  if (!phase || typeof row.cycle !== "number" || !Number.isSafeInteger(row.cycle) || row.cycle < 0) {
    return INITIAL_REWARDS_CYCLE;
  }
  const last: Record<string, number> = {};
  if (row.last && typeof row.last === "object") {
    for (const [chainId, amount] of Object.entries(row.last as Record<string, unknown>).slice(0, 200)) {
      if (chainId.length <= 64 && typeof amount === "number" && Number.isFinite(amount) && amount >= 0) {
        last[chainId] = amount;
      }
    }
  }
  return {
    phase,
    cycle: row.cycle,
    raisedAt: typeof row.raisedAt === "number" && Number.isFinite(row.raisedAt) ? row.raisedAt : 0,
    last,
  };
}
