/**
 * One account's staking positions on one chain (B3 in the research report):
 * delegations with per-validator rewards, unbonding and redelegation entries,
 * the rewards withdraw address, and the stake-weighted APR.
 *
 * Positions are joined with the validator set so every row carries the
 * validator's status, commission, uptime and rank — the inputs of the
 * risk badges and of "your APR" — without the browser making a second call.
 * Validators outside the bonded set (jailed, unbonding) are read one by one,
 * capped, and anything unreadable stays an honest "unknown" row.
 *
 * Cache: per-address reads 30 s (identical answers for everyone asking about
 * that address, so sharing them leaks nothing the chain does not publish),
 * withdraw address 2 min.
 */

import "server-only";
import { findServerChain, type ServerChainEntry } from "@/lib/server/chains";
import { mapLimit } from "@/lib/server/http";
import { attachValidatorLogos } from "@/lib/server/validator-logos";
import {
  nextRelease,
  otherDenoms,
  parseDelegations,
  parseRedelegations,
  parseRewards,
  parseUnbonding,
  parseWithdrawAddress,
  sumDenom,
  weightedApr,
  type RawDelegation,
} from "@/lib/chain/staking";
import { sumAmounts } from "@/lib/chain/parse";
import type { Coin, PartError, StakingChain, ValidatorLite, ValidatorRow } from "@/lib/chain/types";
import { denomFacts, readEconomics } from "./economics";
import { ACCOUNT_READS } from "./account-paths";
import { describeLcdError, describeMiss, forgetLcd, forgetLcdNamed, lcd, type LcdResult } from "./lcd";
import { liteOf, readSingleValidator, readValidatorSet, unknownLite } from "./validator-set";

const USER_TTL = 30_000;
/**
 * How long past `USER_TTL` a per-account read may be served while it
 * refreshes: 90 s in all, so the shell's 60-second poll is answered from the
 * cache instead of waiting 1–1.5 s on the chain every minute. Freshness after
 * a transaction does not depend on this window: `forgetAccountReads` drops
 * these entries on broadcast and again on confirmation (/api/broadcast,
 * /api/tx/[hash]), and positions only change through the user's own
 * transactions. Rewards a minute old do not matter.
 */
const USER_STALE = 60_000;
const WITHDRAW_TTL = 2 * 60_000;
/** Validators outside the bonded set read individually per account. */
const MAX_SINGLE_READS = 12;

/** Delegations of `address` (one page of 200: more is not a wallet). */
export function readDelegations(chain: ServerChainEntry, address: string): Promise<LcdResult<RawDelegation[]>> {
  const { path, name } = ACCOUNT_READS.delegations(address);
  return lcd(chain, path, { ttlMs: USER_TTL, staleMs: USER_STALE, name, map: parseDelegations });
}

export function readWithdrawAddress(chain: ServerChainEntry, address: string): Promise<LcdResult<string | null>> {
  const { path, name } = ACCOUNT_READS.withdrawAddress(address);
  return lcd(chain, path, { ttlMs: WITHDRAW_TTL, staleMs: USER_STALE, name, map: parseWithdrawAddress });
}

/**
 * Forgets every cached per-account read of the chain analytics layer for
 * `address` on `chainId` (staking positions, rewards, withdraw address,
 * authz and fee grants, votes), so the next request after a broadcast —
 * delegate, claim, vote, revoke — reads fresh state. Meant for
 * `forgetAccountReads` in `@/lib/tx/server/invalidate`, next to the
 * portfolio and activity invalidators. Unknown chain ids are ignored.
 */
export function invalidateChainAccountReads(chainId: string, address: string): void {
  const chain = findServerChain(chainId);
  if (!chain) return;
  for (const read of Object.values(ACCOUNT_READS)) {
    const { path, name } = read(address);
    forgetLcd(chain, path, name);
  }
  // Votes are keyed by proposal; dropping the chain's vote reads is cheap.
  forgetLcdNamed(chain, "vote");
}

async function settle<T>(read: Promise<LcdResult<T>>): Promise<{ data: T | null; error: string | null; at: number | null }> {
  try {
    const result = await read;
    if (result.ok) return { data: result.data, error: null, at: result.at };
    return { data: null, error: describeMiss(result.miss), at: result.at };
  } catch (error) {
    return { data: null, error: describeLcdError(error), at: null };
  }
}

/**
 * Validator rows for the operators an account touches: from the bonded set
 * when there, else read individually (capped). Logos attached.
 */
async function validatorsFor(
  chain: ServerChainEntry,
  operators: readonly string[],
  context: { chainApr: number | null; bondedTokens: string | null },
  errors: PartError[],
): Promise<Map<string, ValidatorLite>> {
  const out = new Map<string, ValidatorLite>();
  if (operators.length === 0) return out;
  const wanted = new Set(operators);
  const found = new Map<string, ValidatorRow>();
  let window: number | null = null;
  try {
    const set = await readValidatorSet(chain, { status: "bonded", chainApr: context.chainApr });
    window = set.summary.signedBlocksWindow;
    for (const row of set.rows) if (wanted.has(row.operatorAddress)) found.set(row.operatorAddress, row);
    for (const error of set.errors) if (error.scope === "signing-infos") errors.push(error);
  } catch (error) {
    errors.push({ chainId: chain.chainId, scope: "validators", message: describeLcdError(error) });
  }

  const missing = operators.filter((operator) => !found.has(operator));
  const singles = await mapLimit(missing.slice(0, MAX_SINGLE_READS), 4, (operator) =>
    readSingleValidator(chain, operator, {
      window,
      chainApr: context.chainApr,
      bondedTokens: context.bondedTokens,
    }),
  );
  singles.forEach((single, index) => {
    const operator = missing[index];
    if (operator && single.row) found.set(operator, single.row);
    errors.push(...single.errors);
  });

  const withLogos = await attachValidatorLogos(chain, [...found.values()], { waitMs: 1_000 });
  for (const row of withLogos) out.set(row.operatorAddress, liteOf(row));
  for (const operator of operators) if (!out.has(operator)) out.set(operator, unknownLite(operator));
  return out;
}

/** Reads one account's staking state on one chain. Never rejects. */
export async function readStakingChain(chain: ServerChainEntry, address: string): Promise<StakingChain> {
  const id = chain.chainId;
  const user = { ttlMs: USER_TTL, staleMs: USER_STALE };
  const rewardsRead = ACCOUNT_READS.rewards(address);
  const unbondingRead = ACCOUNT_READS.unbonding(address);
  const redelegationsRead = ACCOUNT_READS.redelegations(address);
  const [economics, delegations, rewards, unbonding, redelegations, withdraw] = await Promise.all([
    readEconomics(chain),
    settle(readDelegations(chain, address)),
    settle(lcd(chain, rewardsRead.path, { ...user, name: rewardsRead.name, map: parseRewards })),
    settle(lcd(chain, unbondingRead.path, { ...user, name: unbondingRead.name, map: parseUnbonding })),
    settle(lcd(chain, redelegationsRead.path, { ...user, name: redelegationsRead.name, map: parseRedelegations })),
    settle(readWithdrawAddress(chain, address)),
  ]);

  // The bond denom from the staking params; when they were unreadable, the
  // denom the delegations themselves report (always the bond denom) rather
  // than the catalog's guess, which would filter every delegation out of a
  // chain that stakes a different token and show "nothing staked".
  const denom = economics.staking?.bondDenom ?? delegations.data?.[0]?.denom ?? economics.bondDenom;
  const errors: PartError[] = [];
  const note = (scope: string, part: { error: string | null }) => {
    if (part.error) errors.push({ chainId: id, scope, message: part.error });
  };
  note("delegations", delegations);
  note("rewards", rewards);
  note("unbonding", unbonding);
  note("redelegations", redelegations);
  note("withdraw-address", withdraw);
  // A chain without a computable APR is not a failed read: `apr.chain` is
  // null and the chain stats say why.
  const chainApr = economics.result.apr.actual;

  const operators = new Set<string>();
  for (const d of delegations.data ?? []) operators.add(d.validator);
  for (const u of unbonding.data ?? []) operators.add(u.validator);
  for (const r of redelegations.data ?? []) {
    operators.add(r.src);
    operators.add(r.dst);
  }
  const validators = await validatorsFor(
    chain,
    [...operators],
    { chainApr, bondedTokens: economics.bonded },
    errors,
  );
  const lite = (operator: string) => validators.get(operator) ?? unknownLite(operator);

  const rewardMap = rewards.data ?? new Map<string, Coin[]>();
  const stakeRows = (delegations.data ?? [])
    .filter((d) => d.denom === denom)
    .map((d) => ({ validator: lite(d.validator), amount: d.amount, rewards: rewardMap.get(d.validator) ?? [] }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const unbondingRows = (unbonding.data ?? []).map((u) => ({ validator: lite(u.validator), entries: u.entries }));
  const redelegationRows = (redelegations.data ?? []).map((r) => ({
    src: lite(r.src),
    dst: lite(r.dst),
    entries: r.entries,
  }));
  const rewardLists = [...rewardMap.values()];

  const failed = delegations.error !== null;
  const { symbol, decimals } = denom === economics.bondDenom ? economics : denomFacts(chain, denom);
  return {
    chainId: id,
    address,
    denom,
    symbol,
    decimals,
    delegations: stakeRows,
    unbonding: unbondingRows,
    redelegations: redelegationRows,
    withdrawAddress: withdraw.data,
    totals: {
      staked: delegations.data ? sumAmounts(stakeRows.map((row) => row.amount)) : null,
      rewards: rewards.data ? sumDenom(rewardLists, denom) : null,
      unbonding: unbonding.data
        ? sumAmounts(unbondingRows.flatMap((row) => row.entries.map((entry) => entry.balance)))
        : null,
    },
    rewardsOther: otherDenoms(rewardLists, denom),
    nextUnbonding: nextRelease(unbondingRows),
    apr: {
      chain: chainApr,
      weighted: weightedApr(stakeRows.map((row) => ({ amount: row.amount, apr: row.validator.apr }))),
    },
    status: failed ? "error" : errors.length ? "partial" : "ok",
    ...(failed ? { error: delegations.error ?? "Delegations unreadable" } : {}),
    ...(errors.length ? { errors } : {}),
  };
}
