/**
 * The Overview's arithmetic: everything the page shows that is computed
 * rather than read, kept out of the components so it is tested.
 *
 * - asset counts by asset, not by per-chain row (as the Assets page counts);
 * - allocation by chain, asset (grouped across chains by identity) and type,
 *   with colours assigned from the full unfiltered list so an entity keeps
 *   its hue whichever view is open (chart kit rule), and which buckets hold
 *   only unpriced assets (unknown, not $0);
 * - the chains breakdown rows (share, 24 h move, staked share, APR) and why a
 *   figure of a row is missing;
 * - the KPI figures: estimated yearly yield, claimable rewards, staked ratio
 *   of stakeable tokens, validators used, open votes; the wallet's share of a
 *   chain's bonded stake;
 * - the next unbonding releases;
 * - the history curve: whether it covers enough of today's value to be
 *   drawn, its change, high and low, and what it covers;
 * - which insights the Overview row shows.
 *
 * Every figure is `null` when an input it needs is unknown: the page shows
 * "—" with the reason, never a zero.
 */

import { stableColorMap } from "@/components/charts/palette";
import type { PartDatum } from "@/components/charts/series";
import type { ChainStats, ProposalRow, StakingChain, StakingDelegation, StakingResponse } from "@/lib/chain/types";
import { SEVERITY_RANK, type Insight } from "@/lib/insights/rules";
import { groupAssets, type AssetGroup } from "@/lib/token/holdings";
import type {
  PortfolioAsset,
  PortfolioChain,
  PortfolioHistoryResponse,
  PortfolioResponse,
  PortfolioTotals,
  UnpricedReason,
  UpstreamIssue,
} from "@/lib/token/wire";

/** A base-unit amount above zero ("12", not "0", "", or a malformed string). */
function positiveUnits(amount: string | null | undefined): boolean {
  return typeof amount === "string" && /^\d+$/.test(amount) && BigInt(amount) > BigInt(0);
}

/* -------------------------------------------------------------------------- */
/* Counting assets                                                             */
/* -------------------------------------------------------------------------- */

export interface AssetCounts {
  /** Distinct assets: the same asset on several chains counts once (the Assets page's count). */
  assets: number;
  /** Per-chain balances (what `totals.assetCount` counts). */
  holdings: number;
  /** Distinct assets with no value. */
  unpriced: number;
  /** Why, most common first. */
  unpricedReasons: { reason: UnpricedReason; count: number }[];
}

/**
 * The counts every Overview figure uses, by asset rather than by per-chain
 * row, so the Assets tile, the allocation footer and the Assets page agree
 * ("38 assets, 18 without a price", not 41 and 18 of a different 41).
 */
export function assetCounts(groups: readonly AssetGroup[], holdings: number): AssetCounts {
  const reasons = new Map<UnpricedReason, number>();
  let unpriced = 0;
  for (const group of groups) {
    if (group.value !== null) continue;
    unpriced += 1;
    const reason = group.unpriced ?? "no-market";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    assets: groups.length,
    holdings,
    unpriced,
    unpricedReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

/* -------------------------------------------------------------------------- */
/* Allocation                                                                  */
/* -------------------------------------------------------------------------- */

export type AllocationView = "chain" | "asset" | "type";

export type TypeBucket = "liquid" | "staked" | "rewards" | "unbonding";

export const TYPE_BUCKETS: ReadonlyArray<{ id: TypeBucket; label: string }> = [
  { id: "liquid", label: "Liquid" },
  { id: "staked", label: "Staked" },
  { id: "rewards", label: "Rewards" },
  { id: "unbonding", label: "Unbonding" },
];

/** The four buckets always wear the same four hues, whichever are empty. */
export const TYPE_COLORS: ReadonlyMap<string, string> = stableColorMap(TYPE_BUCKETS.map((bucket) => bucket.id));

export interface Allocation {
  /** Positive values only, largest first. */
  parts: PartDatum[];
  /** Slot per entity, from the full list (largest holding first). */
  colors: ReadonlyMap<string, string>;
  /** Σ of `parts`. */
  total: number;
}

function finish(parts: PartDatum[], colors: ReadonlyMap<string, string>): Allocation {
  const positive = parts.filter((part) => Number.isFinite(part.value) && part.value > 0).sort((a, b) => b.value - a.value);
  return { parts: positive, colors, total: positive.reduce((sum, part) => sum + part.value, 0) };
}

/** Priced value per chain. */
export function allocationByChain(portfolio: PortfolioResponse): Allocation {
  const chains = portfolio.chains
    .filter((chain) => chain.value !== null && chain.value > 0)
    .sort((a, b) => (b.value as number) - (a.value as number));
  return finish(
    chains.map((chain) => ({ id: chain.chainId, label: chain.chainName, value: chain.value as number })),
    stableColorMap(chains.map((chain) => chain.chainId)),
  );
}

/**
 * Priced value per asset, the same asset on several chains counted once
 * (proven vouchers share their origin's key; unproven look-alikes never
 * merge). Two different assets sharing a ticker are told apart by chain.
 */
export function allocationByAsset(portfolio: PortfolioResponse, groups: readonly AssetGroup[] = groupAssets(portfolio.assets)): Allocation {
  const priced = groups.filter((group) => group.value !== null && group.value > 0);
  const tickers = new Map<string, number>();
  for (const group of priced) tickers.set(group.identity.ticker, (tickers.get(group.identity.ticker) ?? 0) + 1);
  return finish(
    priced.map((group) => ({
      id: group.key,
      label:
        (tickers.get(group.identity.ticker) ?? 0) > 1
          ? `${group.identity.ticker} · ${group.identity.chainName ?? group.identity.chainId}`
          : group.identity.ticker,
      value: group.value as number,
    })),
    stableColorMap(priced.map((group) => group.key)),
  );
}

/** Priced value per bucket: liquid, staked, pending rewards, unbonding. */
export function allocationByType(totals: Pick<PortfolioTotals, TypeBucket>): Allocation {
  return finish(
    TYPE_BUCKETS.map((bucket) => ({ id: bucket.id, label: bucket.label, value: totals[bucket.id] })),
    TYPE_COLORS,
  );
}

/**
 * The four buckets in the order the allocation bar draws them: largest
 * priced value first, so the legend under the bar reads in the same order.
 * Empty buckets keep their fixed order at the end (the sort is stable).
 */
export function bucketsBySize(totals: Pick<PortfolioTotals, TypeBucket> | null | undefined): ReadonlyArray<{ id: TypeBucket; label: string }> {
  if (!totals) return TYPE_BUCKETS;
  const size = (id: TypeBucket) => (Number.isFinite(totals[id]) ? totals[id] : 0);
  return [...TYPE_BUCKETS].sort((a, b) => size(b.id) - size(a.id));
}

/**
 * Per bucket, how many assets are held there without a price (counted by
 * asset, as the Assets page counts them). The bucket totals the server sends
 * add up priced value only, so a bucket holding nothing but unpriced tokens
 * (any testnet; SAF while its only price source is down) totals 0: with this
 * count the page says "—, 4 unpriced" instead of a false $0.00.
 */
export function unpricedByType(assets: readonly PortfolioAsset[]): Record<TypeBucket, number> {
  const keys: Record<TypeBucket, Set<string>> = { liquid: new Set(), staked: new Set(), rewards: new Set(), unbonding: new Set() };
  for (const asset of assets) {
    if (asset.value !== null) continue;
    for (const { id } of TYPE_BUCKETS) if (positiveUnits(asset.amounts[id])) keys[id].add(asset.identity.key);
  }
  return { liquid: keys.liquid.size, staked: keys.staked.size, rewards: keys.rewards.size, unbonding: keys.unbonding.size };
}

/** The portfolio read each bucket comes from (`server/portfolio/read.ts` issue scopes). */
const BUCKET_READ: Readonly<Record<TypeBucket, string>> = {
  liquid: "bank",
  staked: "delegations",
  rewards: "rewards",
  unbonding: "unbonding",
};

/**
 * Per bucket, the networks whose read of it failed: the server still counts
 * the rest of such a chain, so a bucket can total 0 only because its one
 * read failed (a node answering HTTP 500 on delegations). Such a 0 is
 * unknown, not $0.00. A chain that did not answer at all fails every bucket.
 */
export function unreadByType(errors: readonly UpstreamIssue[] | null | undefined): Record<TypeBucket, number> {
  const chains: Record<TypeBucket, Set<string>> = { liquid: new Set(), staked: new Set(), rewards: new Set(), unbonding: new Set() };
  for (const issue of errors ?? []) {
    if (!issue.chainId) continue;
    for (const { id } of TYPE_BUCKETS) if (issue.scope === "chain" || issue.scope === BUCKET_READ[id]) chains[id].add(issue.chainId);
  }
  return { liquid: chains.liquid.size, staked: chains.staked.size, rewards: chains.rewards.size, unbonding: chains.unbonding.size };
}

/* -------------------------------------------------------------------------- */
/* Chains breakdown                                                            */
/* -------------------------------------------------------------------------- */

export interface ChainRow {
  chainId: string;
  chainName: string;
  iconUrl: string | null;
  nativeSymbol: string;
  status: "ok" | "error";
  error?: string;
  value: number | null;
  /** Share of priced net worth, percent units. */
  share: number | null;
  change24hAbs: number | null;
  /** 24 h value change of today's holdings, percent units. */
  change24hPct: number | null;
  /** Staked value ÷ the chain's value, percent units. */
  stakedShare: number | null;
  /** Actual staking APR before commission, percent units. */
  apr: number | null;
  /** Why `apr` is unknown. */
  aprReason?: string;
  rewards: number | null;
  unbonding: number | null;
  assetCount: number;
}

/** 24 h percent change from an absolute change and today's value. */
export function changePct(value: number | null, changeAbs: number | null): number | null {
  if (value === null || changeAbs === null) return null;
  const before = value - changeAbs;
  return before > 0 ? (changeAbs / before) * 100 : null;
}

export function chainRows(portfolio: PortfolioResponse, stats: readonly ChainStats[] | null | undefined): ChainRow[] {
  const total = portfolio.totals.pricedValue;
  const statsById = new Map((stats ?? []).map((chain) => [chain.chainId, chain]));
  const rows = portfolio.chains.map((chain: PortfolioChain): ChainRow => {
    const s = statsById.get(chain.chainId);
    const apr = s?.apr.actual ?? null;
    return {
      chainId: chain.chainId,
      chainName: chain.chainName,
      iconUrl: chain.iconUrl,
      nativeSymbol: chain.nativeSymbol,
      status: chain.status,
      ...(chain.error ? { error: chain.error } : {}),
      value: chain.value,
      share: chain.value !== null && total > 0 ? (chain.value / total) * 100 : null,
      change24hAbs: chain.change24hAbs,
      change24hPct: changePct(chain.value, chain.change24hAbs),
      stakedShare: chain.value !== null && chain.staked !== null && chain.value > 0 ? (chain.staked / chain.value) * 100 : null,
      apr: apr !== null ? apr * 100 : null,
      ...(apr === null ? { aprReason: s?.reasons?.apr ?? s?.apr.note ?? (s ? "Not computable from this chain's mint data" : "Chain economics not loaded") } : {}),
      rewards: chain.rewards,
      unbonding: chain.unbonding,
      assetCount: chain.assetCount,
    };
  });
  // Most valuable first; unpriced chains next; unreadable ones last.
  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "ok" ? -1 : 1;
    if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
    if (a.value !== null && b.value === null) return -1;
    if (a.value === null && b.value !== null) return 1;
    return b.assetCount - a.assetCount || a.chainName.localeCompare(b.chainName);
  });
}

/**
 * Why a chain row's share, 24 h move or staked share reads "—", from the
 * row's own state: a chain that did not answer, one that holds nothing (its
 * token may well be priced: "Unpriced" there would be false), one whose
 * holdings have no price, and only then the figure's own gap.
 */
export function chainRowReason(
  row: Pick<ChainRow, "status" | "value" | "assetCount">,
  figure: "share" | "change" | "staked",
): string {
  if (row.status === "error") return "Not read";
  if (row.assetCount === 0) return "Nothing held";
  if (row.value === null) return "Unpriced";
  switch (figure) {
    case "change":
      return "No 24 h price change";
    case "share":
      return "Nothing priced in scope";
    case "staked":
      return "Nothing priced here";
  }
}

/* -------------------------------------------------------------------------- */
/* KPI figures                                                                 */
/* -------------------------------------------------------------------------- */

export interface YieldEstimate {
  /** Staked value × each chain's stake-weighted APR after commission; null when nothing could be computed. */
  yearly: number | null;
  /** yearly ÷ the staked value it covers (a fraction). */
  apr: number | null;
  /** Staked value the estimate covers. */
  coveredValue: number;
  /** Chains holding staked value whose APR is unknown (left out of the figure). */
  missing: string[];
}

/**
 * The estimated yearly yield of what is staked now: per chain, the priced
 * staked value × the stake-weighted APR after each validator's commission
 * (inactive validators count 0). Assumes today's prices and rates.
 */
export function yieldEstimate(portfolio: PortfolioResponse, staking: StakingResponse | null | undefined): YieldEstimate {
  const byId = new Map((staking?.chains ?? []).map((chain) => [chain.chainId, chain]));
  let yearly = 0;
  let covered = 0;
  const missing: string[] = [];
  for (const chain of portfolio.chains) {
    if (chain.staked === null || !(chain.staked > 0)) continue;
    const apr = byId.get(chain.chainId)?.apr.weighted ?? null;
    if (apr === null || !Number.isFinite(apr)) {
      missing.push(chain.chainId);
      continue;
    }
    yearly += chain.staked * apr;
    covered += chain.staked;
  }
  return {
    yearly: covered > 0 ? yearly : null,
    apr: covered > 0 ? yearly / covered : null,
    coveredValue: covered,
    missing,
  };
}

export interface StakedRatio {
  /** Staked ÷ (liquid + staked + unbonding) of the staking tokens, by value; null when none is priced. */
  ratio: number | null;
  stakedValue: number;
  /** Liquid staking tokens (what could be staked). */
  liquidValue: number;
}

/**
 * How much of the tokens that can be staked is staked, by value. Only each
 * chain's staking denom counts (USDC sitting next to ATOM is not "unstaked
 * ATOM"); unbonding tokens count as not staked.
 */
export function stakedRatio(
  portfolio: PortfolioResponse,
  stakingDenoms: ReadonlyMap<string, string>,
): StakedRatio {
  let staked = 0;
  let liquid = 0;
  let unbonding = 0;
  for (const asset of portfolio.assets) {
    if (stakingDenoms.get(asset.chainId) !== asset.identity.denom) continue;
    const decimals = asset.identity.decimals;
    const price = asset.price?.price ?? null;
    if (decimals === null || price === null) continue;
    const scale = 10 ** decimals;
    staked += (Number(asset.amounts.staked) / scale) * price;
    liquid += (Number(asset.amounts.liquid) / scale) * price;
    unbonding += (Number(asset.amounts.unbonding) / scale) * price;
  }
  const whole = staked + liquid + unbonding;
  return { ratio: whole > 0 ? staked / whole : null, stakedValue: staked, liquidValue: liquid };
}

/** The staking denom of each chain, from staking positions, else chain stats. */
export function stakingDenomMap(
  staking: StakingResponse | null | undefined,
  stats: readonly ChainStats[] | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const chain of stats ?? []) map.set(chain.chainId, chain.nativeDenom);
  for (const chain of staking?.chains ?? []) map.set(chain.chainId, chain.denom);
  return map;
}

/**
 * Chains with rewards to claim, priced or not: counted from the amounts, not
 * from the priced reward totals, which are 0 on a chain whose token has no
 * price (a testnet) although the rewards are real and claimable.
 */
export function rewardChainCount(assets: readonly PortfolioAsset[]): number {
  return new Set(assets.filter((asset) => positiveUnits(asset.amounts.rewards)).map((asset) => asset.chainId)).size;
}

/** A delegation that earns nothing: its validator is outside the active set, jailed or tombstoned. */
function idleDelegation(delegation: StakingDelegation): boolean {
  const v = delegation.validator;
  return v.jailed === true || v.tombstoned === true || (v.status !== null && v.status !== "bonded");
}

export interface ValidatorsUsed {
  /** Validators holding stake from this wallet, largest stake first. */
  validators: { operatorAddress: string; moniker: string; logoUrl: string | null }[];
  /** …of which earning nothing (outside the active set, jailed or tombstoned). */
  idle: number;
}

/**
 * The validators a chain's stake sits with (the single-chain KPI). Null when
 * the delegations could not be read: "0 validators" would be a false
 * "nothing staked".
 */
export function validatorsUsed(chain: StakingChain | null | undefined): ValidatorsUsed | null {
  if (!chain || chain.status === "error" || chain.totals.staked === null) return null;
  const held = chain.delegations
    .filter((delegation) => positiveUnits(delegation.amount))
    .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0));
  return {
    validators: held.map(({ validator }) => ({
      operatorAddress: validator.operatorAddress,
      moniker: validator.moniker,
      logoUrl: validator.logoUrl ?? null,
    })),
    idle: held.filter(idleDelegation).length,
  };
}

export interface StakeShare {
  /** Base units staked with validators of the active (bonded) set: the stake the chain's bonded tokens include. */
  bonded: bigint;
  /** Base units staked with validators outside it (inactive, jailed, tombstoned): not bonded, so not counted. */
  outside: bigint;
  /** bonded ÷ the chain's bonded tokens; null when either is unknown. */
  share: number | null;
  /** Some validator's status could not be read, so the bonded part is unknown. */
  statusUnknown: boolean;
}

/**
 * The wallet's share of a chain's bonded stake, i.e. of its voting power.
 * Only stake with validators of the active set counts: the chain's bonded
 * tokens leave out stake on inactive or jailed validators, so counting it
 * would overstate the share (and the governance voting power, which x/gov
 * also counts from bonded validators only, would disagree).
 */
export function stakeShare(chain: StakingChain | null | undefined, bondedTokens: string | null | undefined): StakeShare | null {
  if (!chain || chain.status === "error" || chain.totals.staked === null) return null;
  let bonded = BigInt(0);
  let outside = BigInt(0);
  let statusUnknown = false;
  for (const delegation of chain.delegations) {
    if (!positiveUnits(delegation.amount)) continue;
    const amount = BigInt(delegation.amount);
    if (delegation.validator.status === null) statusUnknown = true;
    else if (delegation.validator.status === "bonded" && delegation.validator.jailed !== true) bonded += amount;
    else outside += amount;
  }
  const pool = bondedTokens && /^\d+$/.test(bondedTokens) ? BigInt(bondedTokens) : null;
  const share = !statusUnknown && pool !== null && pool > BigInt(0) ? Number(bonded) / Number(pool) : null;
  return { bonded, outside, share, statusUnknown };
}

export interface VoteSummary {
  /** Proposals in their voting period on scoped chains. */
  open: number;
  /** …of which the wallet has voting power on. */
  eligible: number;
  /** …and has not voted on. */
  awaiting: number;
  /** The eligible proposal closing first (an unvoted one when there is one). */
  next: ProposalRow | null;
  /** Chains of the eligible proposals, each once, closing soonest first. */
  eligibleChains: string[];
}

function endOf(proposal: ProposalRow): number {
  const at = proposal.votingEndTime ? Date.parse(proposal.votingEndTime) : NaN;
  return Number.isFinite(at) ? at : Infinity;
}

export function hasVotingPower(proposal: ProposalRow): boolean {
  return proposal.myVotingPower !== null && /^\d+$/.test(proposal.myVotingPower) && BigInt(proposal.myVotingPower) > BigInt(0);
}

export function voteSummary(proposals: readonly ProposalRow[], now: number): VoteSummary {
  const open = proposals.filter((p) => p.status === "voting" && endOf(p) > now).sort((a, b) => endOf(a) - endOf(b));
  const eligible = open.filter(hasVotingPower);
  const awaiting = eligible.filter((p) => p.myVoteStatus === "not-voted");
  return {
    open: open.length,
    eligible: eligible.length,
    awaiting: awaiting.length,
    next: awaiting[0] ?? eligible[0] ?? null,
    eligibleChains: [...new Set(eligible.map((p) => p.chainId))],
  };
}

/** Voting proposals closing soonest (still open), for the deadlines card. */
export function deadlines(proposals: readonly ProposalRow[], now: number, limit = 4): ProposalRow[] {
  return proposals
    .filter((p) => p.status === "voting" && endOf(p) > now)
    .sort((a, b) => endOf(a) - endOf(b) || a.chainId.localeCompare(b.chainId) || Number(a.id) - Number(b.id))
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Unbonding releases                                                          */
/* -------------------------------------------------------------------------- */

export interface Release {
  chainId: string;
  symbol: string;
  decimals: number | null;
  /** Base units. */
  amount: string;
  at: number;
  validator: string;
  /** In the portfolio currency; null when unpriced. */
  value: number | null;
}

/** The next unbonding completions across chains, soonest first. */
export function upcomingReleases(
  staking: StakingResponse | null | undefined,
  portfolio: PortfolioResponse | null | undefined,
  now: number,
  limit = 3,
): Release[] {
  const out: Release[] = [];
  for (const chain of (staking?.chains ?? []) as StakingChain[]) {
    if (chain.status === "error") continue;
    const native = portfolio?.assets.find((a) => a.chainId === chain.chainId && a.identity.denom === chain.denom);
    const price = native?.price?.price ?? null;
    for (const position of chain.unbonding) {
      for (const entry of position.entries) {
        const at = Date.parse(entry.completionTime);
        if (!Number.isFinite(at) || at <= now || !/^\d+$/.test(entry.balance) || entry.balance === "0") continue;
        out.push({
          chainId: chain.chainId,
          symbol: chain.symbol,
          decimals: chain.decimals,
          amount: entry.balance,
          at,
          validator: position.validator.moniker,
          value: price !== null && chain.decimals !== null ? (Number(entry.balance) / 10 ** chain.decimals) * price : null,
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.chainId.localeCompare(b.chainId)).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

/** Change from the first to the last point of a series. */
export function seriesChange(points: readonly { t: number; v: number }[]): { abs: number; pct: number | null } | null {
  if (points.length < 2) return null;
  const first = points[0] as { v: number };
  const last = points[points.length - 1] as { v: number };
  return { abs: last.v - first.v, pct: first.v > 0 ? ((last.v - first.v) / first.v) * 100 : null };
}

/**
 * The highest and lowest points of a series (the earliest of equal ones), so
 * the range reads as a band and not only as a start-to-end change. Null with
 * fewer than two finite points.
 */
export function seriesExtent(points: readonly { t: number; v: number }[]): { high: { t: number; v: number }; low: { t: number; v: number } } | null {
  let high: { t: number; v: number } | null = null;
  let low: { t: number; v: number } | null = null;
  let finite = 0;
  for (const point of points) {
    if (!Number.isFinite(point.v)) continue;
    finite += 1;
    if (high === null || point.v > high.v) high = point;
    if (low === null || point.v < low.v) low = point;
  }
  return finite >= 2 && high && low ? { high, low } : null;
}

type HistoryCoverage = Pick<PortfolioHistoryResponse, "coverage"> & Partial<Pick<PortfolioHistoryResponse, "errors">>;

/**
 * The phrase the history route gives an asset series that missed its time
 * budget (`server/portfolio/history.ts`): the server keeps reading it and
 * caches it, so the next answer usually has it.
 */
const SERIES_LOADING = "still loading";

/** Share of today's value the curve needs while some of its series are still loading… */
export const HISTORY_SHARE_LOADING = 0.95;
/** …and once every series has answered (a lasting gap is drawn, with its coverage note). */
export const HISTORY_SHARE_SETTLED = 0.5;

/** Asset keys whose price series the answer left out because they were still loading. */
export function seriesStillLoading(history: Partial<Pick<PortfolioHistoryResponse, "errors">>): string[] {
  const keys = new Set<string>();
  for (const issue of history.errors ?? []) {
    if (issue.scope.startsWith("history:") && issue.message.includes(SERIES_LOADING)) keys.add(issue.scope.slice("history:".length));
  }
  return [...keys];
}

export interface HistoryReadiness {
  /** Asset keys still loading on the server (left out of this answer's curve). */
  loading: string[];
  /** Share (0–1) of today's priced value the curve covers. */
  share: number;
  /**
   * The curve may be drawn, hovered and summarised next to the hero figure.
   * While series are still loading it is built from whichever answered
   * first, often dust worth a fraction of a cent, so it needs nearly all of
   * today's value ({@link HISTORY_SHARE_LOADING}). Once every series has
   * answered, a lasting gap (an asset no source keeps history for) is drawn
   * with its coverage note, down to half of the value.
   */
  usable: boolean;
}

/** Whether a history answer can stand next to the hero figure (no answer yet: nothing to withhold). */
export function historyReadiness(history: HistoryCoverage | null | undefined): HistoryReadiness {
  if (!history) return { loading: [], share: 1, usable: true };
  const loading = seriesStillLoading(history);
  const share = history.coverage.pricedValueShare;
  return {
    loading,
    share,
    usable: Number.isFinite(share) && share >= (loading.length > 0 ? HISTORY_SHARE_LOADING : HISTORY_SHARE_SETTLED),
  };
}

/** "87%", and "<1%" for a sliver that would round to a false 0%. */
export function coverageShareText(share: number): string {
  if (share > 0 && share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/**
 * What the history curve covers, in one line ("Covers 87% of today's value ·
 * 9 assets have no price history"). Series still loading are said to be
 * loading, not to have no history: the next answer usually has them.
 */
export function coverageText(history: HistoryCoverage): string | null {
  const { pricedValueShare, missing, partial } = history.coverage;
  const loading = new Set(seriesStillLoading(history));
  const absent = missing.filter((key) => !loading.has(key));
  const parts: string[] = [];
  if (pricedValueShare < 0.995) parts.push(`Covers ${coverageShareText(pricedValueShare)} of today's value`);
  if (loading.size > 0) {
    parts.push(`${parts.length === 0 ? "Price" : "price"} history still loading for ${loading.size} ${loading.size === 1 ? "asset" : "assets"}`);
  }
  if (absent.length > 0) parts.push(`${absent.length} ${absent.length === 1 ? "asset has" : "assets have"} no price history`);
  if (partial.length > 0) {
    parts.push(`${partial.length === 1 ? (partial[0] as { symbol: string }).symbol : `${partial.length} assets`} held at first known price before history starts`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/* -------------------------------------------------------------------------- */
/* Insights row                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The Overview shows at most `max` insights: in the rules' order, but no
 * more than `perKind` of one kind while others wait (five claim cards would
 * otherwise hide a jailed validator ranked just below them). Leftover room
 * is filled in order.
 */
export function pickInsights(items: readonly Insight[], max = 6, perKind = 2): Insight[] {
  const chosen: Insight[] = [];
  const skipped: Insight[] = [];
  const perKindCount = new Map<string, number>();
  for (const item of items) {
    if (chosen.length >= max) break;
    const count = perKindCount.get(item.kind) ?? 0;
    if (count >= perKind) {
      skipped.push(item);
      continue;
    }
    perKindCount.set(item.kind, count + 1);
    chosen.push(item);
  }
  for (const item of skipped) {
    if (chosen.length >= max) break;
    chosen.push(item);
  }
  return chosen.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || items.indexOf(a) - items.indexOf(b));
}
