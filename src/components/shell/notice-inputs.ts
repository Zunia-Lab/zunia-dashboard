/**
 * The shell's reads, mapped onto the notification feed's inputs.
 *
 * The feed (`useNoticeFeed`, `@/lib/notifications/derive`) remembers what it
 * has seen per account and decides what is new, so what goes in must be
 * exactly what the reads say, for every followed chain, and only for the
 * connected account. Two rules shape this module:
 *
 * - A read that has not answered (or still shows the previous wallet's or
 *   the previous chain set's answer) is passed as `undefined`, never as an
 *   empty list: the derivation treats an empty unbonding list as "every
 *   remembered unbonding was cancelled" and an empty activity list as
 *   history, and would act on a wrong picture.
 * - Unknown is not zero. A chain whose rewards read failed is `failed: true`
 *   (it teaches the rewards cycle nothing); a chain whose staking read failed
 *   is named in `failedChains` (the feed keeps its unbondings and validators
 *   as remembered); a validator whose jailed state or commission could not be
 *   read is left out rather than reported clean.
 *
 * Pure, so the mapping is covered by `node --test`.
 */

import type { ActivityItem } from "@/lib/activity/types";
import type { ProposalRow, StakingChain } from "@/lib/chain/types";
import { formatTokenAmount } from "@/lib/format";
import type {
  ActivityDirection,
  ActivityInput,
  ProposalInput,
  RewardsChainInput,
  UnbondingInput,
  ValidatorInput,
} from "@/lib/notifications/types";
import type { NoticeFeedInputs } from "@/lib/useNotifications";

/** "12.5 ATOM"; unknown decimals read "1,250 base units of ATOM" (never a guessed exponent). */
export function amountText(amount: string, decimals: number | null | undefined, symbol: string): string {
  if (decimals === null || decimals === undefined) return `${formatTokenAmount(amount, null)} of ${symbol}`;
  return `${formatTokenAmount(amount, decimals)} ${symbol}`;
}

/** Claimable rewards per chain, in whole staking tokens. */
export function rewardsInputs(chains: readonly StakingChain[]): RewardsChainInput[] {
  return chains.map((chain) => {
    const raw = chain.totals.rewards;
    const failed = chain.status === "error" || raw === null || chain.decimals === null || !/^\d+$/.test(raw);
    const rewardsWhole = failed ? 0 : Number(raw) / 10 ** (chain.decimals as number);
    return {
      chainId: chain.chainId,
      rewardsWhole: Number.isFinite(rewardsWhole) ? rewardsWhole : 0,
      nativeSymbol: chain.symbol,
      ...(failed ? { failed: true } : {}),
    };
  });
}

/**
 * Unbonding entries and the validators the account delegates to, and the
 * chains whose staking read failed this time.
 *
 * A failed chain's rows are left out (its lists are unknown), and leaving
 * them out is not enough on its own: to the feed a remembered unbonding that
 * is missing from the read was cancelled, and a remembered validator that is
 * missing is one the account no longer delegates to. So the chain is also
 * named in `failedChains`, and the feed keeps what it remembers for it until
 * a read answers again. A chain counts as failed when the whole read errored
 * or when either list is unknown (`totals.unbonding` or `totals.staked` is
 * null): the feed keeps one memory per chain for both, so half a chain is
 * not taken as the whole picture.
 */
export function stakingInputs(chains: readonly StakingChain[]): {
  unbonding: UnbondingInput[];
  validators: ValidatorInput[];
  failedChains: string[];
} {
  const unbonding: UnbondingInput[] = [];
  const validators: ValidatorInput[] = [];
  const failedChains: string[] = [];
  for (const chain of chains) {
    if (chain.status === "error" || chain.totals.unbonding === null || chain.totals.staked === null) {
      failedChains.push(chain.chainId);
    }
    if (chain.status === "error") continue;
    if (chain.totals.unbonding !== null) {
      for (const position of chain.unbonding) {
        for (const entry of position.entries) {
          unbonding.push({
            chainId: chain.chainId,
            validator: position.validator.operatorAddress,
            completionTime: entry.completionTime,
            amountText: amountText(entry.balance, chain.decimals, chain.symbol),
            ...(position.validator.moniker ? { validatorName: position.validator.moniker } : {}),
          });
        }
      }
    }
    if (chain.totals.staked === null) continue;
    const seen = new Set<string>();
    for (const delegation of chain.delegations) {
      const validator = delegation.validator;
      if (seen.has(validator.operatorAddress)) continue;
      seen.add(validator.operatorAddress);
      if (validator.jailed === null || validator.commissionRate === null) continue;
      validators.push({
        chainId: chain.chainId,
        operatorAddress: validator.operatorAddress,
        moniker: validator.moniker,
        jailed: validator.jailed,
        commissionRate: validator.commissionRate,
        ...(validator.status !== null ? { active: validator.status === "bonded" } : {}),
      });
    }
  }
  return { unbonding, validators, failedChains };
}

/** Voting-period proposals with the account's vote state. */
export function proposalInputs(proposals: readonly ProposalRow[]): ProposalInput[] {
  return proposals
    .filter((proposal) => proposal.status === "voting" && proposal.votingEndTime)
    .map((proposal) => ({
      chainId: proposal.chainId,
      id: proposal.id,
      title: proposal.title,
      votingEndTime: proposal.votingEndTime as string,
      ...(proposal.votingStartTime ? { votingStartTime: proposal.votingStartTime } : {}),
      myVote: proposal.myVoteStatus === "voted" ? true : proposal.myVoteStatus === "not-voted" ? false : null,
      eligible: proposal.myVotingPower !== null && proposal.myVotingPower !== "0",
    }));
}

/** Net flow of a row: only in, only out, or both / neither. */
export function directionOf(item: Pick<ActivityItem, "amounts">): ActivityDirection {
  if (item.amounts.length === 0) return "self";
  if (item.amounts.every((amount) => amount.direction === "in")) return "in";
  if (item.amounts.every((amount) => amount.direction === "out")) return "out";
  return "self";
}

export function activityInputs(items: readonly ActivityItem[]): ActivityInput[] {
  return items.map((item) => {
    const incoming = item.amounts.find((amount) => amount.direction === "in");
    return {
      chainId: item.chainId,
      hash: item.hash,
      kind: item.kind,
      time: item.time,
      summary: item.summary,
      success: item.success,
      direction: directionOf(item),
      ...(item.ibc?.sourceChainId ? { counterpartyChainId: item.ibc.sourceChainId } : {}),
      ...(incoming
        ? { amountText: amountText(incoming.amount, incoming.identity.decimals, incoming.identity.ticker) }
        : {}),
    };
  });
}

/** One read as the mapper needs it: its answer, or null while it has none for these accounts. */
export interface FreshRead<T> {
  data: T | null;
  /** The answer on screen belongs to a previous key (another wallet or chain set). */
  stale: boolean;
}

function fresh<T>(read: FreshRead<T> | null | undefined): T | null {
  return read && read.data && !read.stale ? read.data : null;
}

/**
 * The feed's inputs from the shell's reads. `account` null (disconnected)
 * yields no account data at all.
 */
export function noticeInputs(input: {
  account: string | null;
  staking?: FreshRead<{ chains: readonly StakingChain[] }> | null;
  proposals?: FreshRead<{ proposals: readonly ProposalRow[] }> | null;
  activity?: FreshRead<readonly ActivityItem[]> | null;
}): NoticeFeedInputs {
  if (!input.account) return { account: null };
  const staking = fresh(input.staking);
  const proposals = fresh(input.proposals);
  const activity = fresh(input.activity);
  return {
    account: input.account,
    ...(staking ? { portfolio: { chains: rewardsInputs(staking.chains) }, staking: stakingInputs(staking.chains) } : {}),
    ...(proposals ? { proposals: proposalInputs(proposals.proposals) } : {}),
    ...(activity ? { activity: activityInputs(activity) } : {}),
  };
}
