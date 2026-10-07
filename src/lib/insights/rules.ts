/**
 * Insights: deterministic rules over what the dashboard already reads.
 *
 * Every insight is a fact with its numbers and one action, computed from the
 * portfolio, staking, chain economics, governance and security reads of the
 * current scope. No model, no scoring service, no advice: a rule fires when a
 * measurable condition holds ("2,005 TIA of rewards is claimable", "this
 * validator can raise its commission to 60 % within 30 days") and says how it
 * was measured in `why`. The same inputs always give the same list, in the
 * same order, which is what lets the Overview row and the Insights page show
 * the same thing and lets these rules be tested.
 *
 * Honesty rules the texts follow (house rules, design spec §0):
 * - unknown is never zero: a rule that needs a figure nobody could read
 *   (a price, a gas price, decimals) does not fire rather than guess;
 * - estimates say so ("est.", "about") and `why` names the method;
 * - amounts respect privacy mode: with `hideAmounts` every amount the user
 *   holds reads "••••" (prices, rates and shares stay, as everywhere else).
 *
 * Pure module (no React, no I/O), so `node --test` covers it; the hook that
 * feeds it lives in `./index.ts`.
 */

import type {
  AuthzGrantRow,
  ChainStats,
  ChainStatsResponse,
  FeeGrantRow,
  InheritedVote,
  ProposalRow,
  ProposalsResponse,
  SecurityReviewResponse,
  StakingChain,
  StakingDelegation,
  StakingResponse,
  VoteChoice,
} from "@/lib/chain/types";
// The proposal page's one URL (chain in the path): the old `?chain=` form
// costs a redirect. A pure module, so the rules stay testable with node --test.
import { proposalHref } from "@/components/governance/model";
import {
  MASK,
  formatDate,
  formatDuration,
  formatFiat,
  formatPercent,
  formatRelativeTime,
  formatTokenAmount,
  shortenAddress,
} from "@/lib/format";
import { groupAssets } from "@/lib/token/holdings";
import type { PortfolioAsset, PortfolioResponse, UnpricedReason } from "@/lib/token/wire";
import { computeFee, fallbackGasLimit, type FeeChain } from "@/lib/tx/fees";

/* -------------------------------------------------------------------------- */
/* Contract                                                                    */
/* -------------------------------------------------------------------------- */

export const INSIGHT_KINDS = [
  "claim",
  "idle-stake",
  "vote",
  "unbonding",
  "validator-risk",
  "concentration",
  "unpriced",
  "security",
  "chain-risk",
  "compounding",
] as const;

export type InsightKind = (typeof INSIGHT_KINDS)[number];

/**
 * - `critical`: funds or earnings are at stake now (a jailed validator, a
 *   grant that can move funds).
 * - `warning`: worth checking soon (a vote closing within 48 h, a commission
 *   at 20 % or more, a chain that stopped producing blocks).
 * - `opportunity`: a measured gain is available (rewards past the restake
 *   point, an idle balance that would earn the chain's APR).
 * - `info`: context (an unbonding finishing this week, unpriced holdings).
 */
export type InsightSeverity = "info" | "opportunity" | "warning" | "critical";

export interface Insight {
  /** Stable across renders and reads: `${kind}:${chainId}:…`. */
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** One line, a fact: "2,005.13 TIA of rewards on Celestia". */
  title: string;
  /** One or two sentences with the numbers behind it. */
  body: string;
  /** The headline figure: {label: "Claimable", value: "$974.67"}. */
  metric?: { label: string; value: string };
  chainId?: string;
  /** The one thing to do about it, as an app path. */
  action?: { label: string; href: string };
  /** How it was measured (the "why" disclosure). */
  why?: string;
}

/** Most severe first. */
export const SEVERITY_RANK: Readonly<Record<InsightSeverity, number>> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  info: 3,
};

export const SEVERITY_LABEL: Readonly<Record<InsightSeverity, string>> = {
  critical: "Critical",
  warning: "Warning",
  opportunity: "Opportunity",
  info: "Info",
};

/**
 * Order inside one severity: what can cost money first, then what can earn
 * it, then context. Kept explicit so the list never reorders between reads.
 */
const KIND_RANK: Readonly<Record<InsightKind, number>> = {
  security: 0,
  "chain-risk": 1,
  "validator-risk": 2,
  vote: 3,
  unbonding: 4,
  compounding: 5,
  claim: 6,
  "idle-stake": 7,
  concentration: 8,
  unpriced: 9,
};

export const INSIGHT_KIND_LABEL: Readonly<Record<InsightKind, string>> = {
  claim: "Rewards",
  compounding: "Compounding",
  "idle-stake": "Idle balance",
  vote: "Governance",
  unbonding: "Unbonding",
  "validator-risk": "Validator",
  concentration: "Concentration",
  unpriced: "Pricing",
  security: "Security",
  "chain-risk": "Chain status",
};

/** The Insights page sections (design spec §6). */
export type InsightGroup = "do-now" | "opportunities" | "risks";

export function insightGroup(insight: Pick<Insight, "kind" | "severity">): InsightGroup {
  if (insight.severity === "critical") return "do-now";
  switch (insight.kind) {
    case "claim":
    case "compounding":
    case "vote":
    case "unbonding":
      return "do-now";
    case "idle-stake":
      return "opportunities";
    default:
      return "risks";
  }
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export interface InsightInputs {
  /** Epoch ms the time rules measure from (votes closing, unbondings finishing). */
  now: number;
  /** Currency of every money figure: the portfolio answer's (`data.currency`). */
  currency: string;
  /** Privacy mode: amounts the user holds read "••••". */
  hideAmounts: boolean;
  portfolio: PortfolioResponse | null;
  staking: StakingResponse | null;
  chainStats: ChainStatsResponse | null;
  /** Voting-period proposals read with the wallet as voter. */
  proposals: ProposalsResponse | null;
  security: SecurityReviewResponse | null;
  /** Catalog fee data per chain (gas prices, fee denom): the claim and reserve estimates. */
  feeChains: Readonly<Record<string, FeeChain>>;
  /** Display names from the catalog, for chains the reads do not name. */
  chainNames?: Readonly<Record<string, string>>;
}

/* -------------------------------------------------------------------------- */
/* Thresholds                                                                  */
/* -------------------------------------------------------------------------- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Rewards must be worth this many claim fees before they are worth a card. */
export const CLAIM_FEE_MULTIPLE = 3;
/**
 * Below one unit of the display currency a card about money is noise (SAF
 * rewards worth $0.0006 pass the fee test, since SAF fees are tinier still).
 */
export const MIN_CARD_VALUE = 1;
/** An idle balance worth less than this is left alone. */
export const MIN_IDLE_VALUE = 10;
/** Delegate fees an idle-balance figure leaves liquid, for future transactions. */
export const FEE_RESERVE_TXS = 10;
/** Votes closing sooner than this are a warning, later ones context. */
export const VOTE_WARNING_MS = 48 * HOUR;
/** Unbondings finishing within this window are listed. */
export const UNBONDING_WINDOW_MS = 7 * DAY;
/** Signed share of the uptime window under which a validator is flagged. */
export const UPTIME_WARNING = 0.95;
/**
 * Commission from which a validator is flagged: now (when also above the
 * chain's median and minimum), or reachable within 30 days.
 */
export const HIGH_COMMISSION = 0.2;
/** Share of priced value in one asset or one chain from which it is reported. */
export const CONCENTRATION_SHARE = 0.6;
/** Share from which concentration becomes a warning. */
export const CONCENTRATION_WARNING = 0.9;

const MSG_WITHDRAW = { typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward" };
const MSG_DELEGATE = { typeUrl: "/cosmos.staking.v1beta1.MsgDelegate" };

/**
 * Chains whose status changes what their assets are worth holding, from the
 * ecosystem facts the product works from (design spec §0, October 2026).
 * Assets whose origin or holding chain is listed here get a chain-risk card.
 */
export const CHAIN_NOTICES: Readonly<Record<string, { name: string; fact: string }>> = {
  "stride-1": { name: "Stride", fact: "a wind-down of Stride was proposed in 2026" },
  "neutron-1": { name: "Neutron", fact: "Neutron wound down in 2026" },
  "noble-1": { name: "Noble", fact: "Noble left Cosmos in 2026" },
};

/* -------------------------------------------------------------------------- */
/* Pure helpers (exported for tests and for the pages)                         */
/* -------------------------------------------------------------------------- */

function toBig(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

function wholeOf(base: bigint, decimals: number): number {
  return Number(base) / 10 ** decimals;
}

/**
 * Fee, in base units of the chain's fee denom, of one transaction holding
 * `messages`, at the catalog's average gas price and the signer's fallback gas
 * limits (the figure the signing flow uses when the chain cannot simulate).
 * Null when the catalog publishes no gas price: no fee is guessed.
 */
export function estimateFee(chain: FeeChain | undefined, messages: readonly { typeUrl: string }[]): bigint | null {
  if (!chain || messages.length === 0) return null;
  try {
    const quote = computeFee(chain, fallbackGasLimit(messages), "average");
    return BigInt(quote.amount[0]?.amount ?? "0");
  } catch {
    return null;
  }
}

/** One claim message per validator that holds rewards. */
export function claimMessages(validators: number): { typeUrl: string }[] {
  return Array.from({ length: Math.max(1, validators) }, () => MSG_WITHDRAW);
}

/**
 * The rewards level at which restaking pays best: √(2·F·P), for a stake P and
 * a fee F per claim-and-restake (both in the same unit).
 *
 * Compounding every T years grows the stake by P·r·T − F per period; the
 * yearly rate (r − F/(P·T) − r²·T/2 to second order) peaks at
 * T* = √(2F/P)/r, when the rewards accrued, P·r·T*, equal √(2·F·P). The APR
 * cancels out: a faster-earning stake reaches the level sooner, not at a
 * different level.
 */
export function restakeThreshold(fee: number, stake: number): number | null {
  if (!(fee >= 0) || !(stake > 0) || !Number.isFinite(fee) || !Number.isFinite(stake)) return null;
  return Math.sqrt(2 * fee * stake);
}

/** Herfindahl–Hirschman index of shares that sum to 1 (0 < HHI ≤ 1). */
export function herfindahl(shares: readonly number[]): number | null {
  const positive = shares.filter((s) => Number.isFinite(s) && s > 0);
  if (positive.length === 0) return null;
  return positive.reduce((sum, s) => sum + s * s, 0);
}

/** Text for an amount in base units: "2,005.13 TIA", "49.09k TIA", "12,340 base units". */
export function tokenText(base: bigint | string, decimals: number | null, symbol: string, hide: boolean): string {
  if (hide) return `${MASK} ${symbol}`;
  if (decimals === null) return formatTokenAmount(base, null);
  const units = typeof base === "bigint" ? base : (toBig(base) ?? BigInt(0));
  const whole = wholeOf(units, decimals);
  const options = whole >= 10_000 ? { compact: true } : whole >= 1 ? { maxFraction: 2 } : { maxFraction: 6 };
  return `${formatTokenAmount(units, decimals, options)} ${symbol}`;
}

/**
 * "$974.67", "$23.9k", "<$0.01"; "••••" in privacy mode. Every figure here is
 * an amount held (a stake, rewards, an exposure), so cents at most: the
 * eight decimals a sub-cent price needs ("$0.00000185") are noise on a
 * holding, where "<$0.01" says what matters.
 */
export function moneyText(value: number, currency: string, hide: boolean): string {
  if (hide) return MASK;
  return formatFiat(value, currency, Math.abs(value) >= 10_000 ? { compact: true } : { precision: 2 });
}

/** A fraction as a percentage: 0.1851 → "18.5%"; never "100.0%" for 99.97 %. */
function pct(fraction: number, digits = 1): string {
  if (fraction < 1 && fraction * 100 >= 100 - 0.5 * 10 ** -digits) return `>${formatPercent(100 - 10 ** -digits, { digits })}`;
  return formatPercent(fraction * 100, { digits });
}

/**
 * A commission rate as the chain sets it: "5%", "7.5%", never a 7.5 % rate
 * rounded to "8%" (the Staking page prints the same validator's 7.5%).
 */
function ratePct(fraction: number): string {
  const percent = Math.round(fraction * 1000) / 10;
  return formatPercent(percent, { digits: Number.isInteger(percent) ? 0 : 1 });
}

/**
 * "in 45 min", "in 30 h", "in 5 d": hours up to two days, because a vote
 * closing in 30 hours is not "in 1 d". Rounded down, so a deadline never
 * reads further away than it is.
 */
export function untilText(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.floor(hours / 24)} d`;
}

const VOTE_LABEL: Readonly<Record<string, string>> = {
  yes: "Yes",
  no: "No",
  abstain: "Abstain",
  veto: "No with veto",
  weighted: "a split vote",
};

export function voteLabel(choice: VoteChoice | InheritedVote["option"] | null | undefined): string | null {
  if (!choice) return null;
  const option = typeof choice === "string" ? choice : choice.option;
  return VOTE_LABEL[option] ?? option;
}

/** "A", "A and B", "A, B and 3 more". */
function listText(names: readonly string[], max = 2): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* -------------------------------------------------------------------------- */
/* Shared context                                                              */
/* -------------------------------------------------------------------------- */

interface Ranked extends Insight {
  /** Order inside one severity and kind: bigger first (usually a value). */
  weight: number;
}

interface Ctx {
  inputs: InsightInputs;
  hide: boolean;
  currency: string;
  name: (chainId: string) => string;
  stats: (chainId: string) => ChainStats | null;
  /** The chain's staking-token row of the portfolio (liquid balance, price). */
  nativeAsset: (chainId: string, denom: string) => PortfolioAsset | null;
  /** Price of the staking token, in `currency`; null when unpriced. */
  nativePrice: (chainId: string, denom: string) => number | null;
  money: (value: number) => string;
  tokens: (base: bigint | string, decimals: number | null, symbol: string) => string;
}

function context(inputs: InsightInputs): Ctx {
  const names = new Map<string, string>();
  for (const [id, name] of Object.entries(inputs.chainNames ?? {})) names.set(id, name);
  for (const chain of inputs.chainStats?.chains ?? []) names.set(chain.chainId, chain.chainName);
  for (const chain of inputs.portfolio?.chains ?? []) names.set(chain.chainId, chain.chainName);
  const statsById = new Map((inputs.chainStats?.chains ?? []).map((chain) => [chain.chainId, chain]));
  const assets = inputs.portfolio?.assets ?? [];
  // Chain stats are priced in the preference currency; the portfolio in its
  // own answer's. They only agree when the currencies do.
  const statsInCurrency = (inputs.chainStats?.currency ?? "").toLowerCase() === inputs.currency.toLowerCase();

  const nativeAsset = (chainId: string, denom: string) =>
    assets.find((asset) => asset.chainId === chainId && asset.identity.denom === denom) ?? null;

  return {
    inputs,
    hide: inputs.hideAmounts,
    currency: inputs.currency,
    name: (chainId) => names.get(chainId) ?? CHAIN_NOTICES[chainId]?.name ?? chainId,
    stats: (chainId) => statsById.get(chainId) ?? null,
    nativeAsset,
    nativePrice: (chainId, denom) => {
      const row = nativeAsset(chainId, denom);
      if (row?.price) return row.price.price;
      const stats = statsById.get(chainId);
      return statsInCurrency && stats?.price && stats.nativeDenom === denom ? stats.price.price : null;
    },
    money: (value) => moneyText(value, inputs.currency, inputs.hideAmounts),
    tokens: (base, decimals, symbol) => tokenText(base, decimals, symbol, inputs.hideAmounts),
  };
}

function readableChains(staking: StakingResponse | null): StakingChain[] {
  return (staking?.chains ?? []).filter((chain) => chain.status !== "error");
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Rewards (`claim`) and compounding (`compounding`), one card per chain.
 *
 * A chain qualifies when its staking-denom rewards are worth at least
 * {@link CLAIM_FEE_MULTIPLE} claim fees (and one currency unit when priced).
 * It is a compounding card instead when the rewards also passed the restake
 * point √(2·F·P) for its stake, a claim card otherwise. A chain whose fee
 * cannot be estimated, or is paid in another denom, is left out: comparing
 * against a guessed fee would be a guess.
 */
export function rewardInsights(ctx: Ctx): Ranked[] {
  const out: Ranked[] = [];
  for (const chain of readableChains(ctx.inputs.staking)) {
    const rewards = toBig(chain.totals.rewards);
    if (rewards === null || rewards <= BigInt(0)) continue;
    const feeChain = ctx.inputs.feeChains[chain.chainId];
    if (!feeChain || feeChain.feeMinimalDenom !== chain.denom) continue;
    const withRewards = chain.delegations.filter((d) =>
      d.rewards.some((coin) => coin.denom === chain.denom && (toBig(coin.amount) ?? BigInt(0)) > BigInt(0)),
    ).length;
    const validators = Math.max(1, withRewards);
    const claimFee = estimateFee(feeChain, claimMessages(validators));
    if (claimFee === null) continue;
    if (Number(rewards) < CLAIM_FEE_MULTIPLE * Number(claimFee)) continue;

    const price = ctx.nativePrice(chain.chainId, chain.denom);
    const value = price !== null && chain.decimals !== null ? wholeOf(rewards, chain.decimals) * price : null;
    if (value !== null && value < MIN_CARD_VALUE) continue;

    const name = ctx.name(chain.chainId);
    const amount = ctx.tokens(rewards, chain.decimals, chain.symbol);
    const feeText = tokenText(claimFee, chain.decimals, chain.symbol, false);
    const staked = toBig(chain.totals.staked);
    const restakeFee = estimateFee(feeChain, [...claimMessages(validators), MSG_DELEGATE]);
    const threshold =
      staked !== null && restakeFee !== null ? restakeThreshold(Number(restakeFee), Number(staked)) : null;
    const apr = chain.apr.weighted ?? chain.apr.chain;
    const compounding = threshold !== null && apr !== null && apr > 0 && Number(rewards) >= threshold;
    const metric = { label: "Claimable", value: value !== null ? ctx.money(value) : amount };
    const action = { label: "Claim rewards", href: `/staking?action=claim&chain=${encodeURIComponent(chain.chainId)}` };
    const from = `from ${plural(validators, "validator")}`;

    if (compounding && staked !== null && restakeFee !== null && threshold !== null) {
      const point = tokenText(BigInt(Math.ceil(threshold)), chain.decimals, chain.symbol, false);
      out.push({
        id: `compounding:${chain.chainId}`,
        kind: "compounding",
        severity: "opportunity",
        title: `Rewards on ${name} passed the restake point`,
        body:
          `${amount}${value !== null ? ` (${ctx.money(value)})` : ""} is claimable ${from}. ` +
          `For your ${ctx.tokens(staked, chain.decimals, chain.symbol)} stake, restaking pays best from about ${ctx.hide ? MASK : point} of rewards.`,
        metric,
        chainId: chain.chainId,
        action,
        why:
          `With a stake P and a fee F per claim-and-restake, the yearly return peaks when you restake each time rewards reach √(2·F·P). ` +
          `F here is about ${tokenText(restakeFee, chain.decimals, chain.symbol, false)} (est.: the catalog's average gas price × Zunia's fallback gas limits; real fees are usually lower). ` +
          `Your stake earns ${pct(apr ?? 0)} APR after commission.`,
        weight: value ?? 0,
      });
    } else {
      out.push({
        id: `claim:${chain.chainId}`,
        kind: "claim",
        severity: "opportunity",
        title: `${amount} of rewards on ${name}`,
        body:
          `Claimable now ${from}${value !== null ? `, worth ${ctx.money(value)}` : ""}. ` +
          `The claim fee is about ${feeText} (est.).`,
        metric,
        chainId: chain.chainId,
        action,
        why:
          `Shown when rewards are worth at least ${CLAIM_FEE_MULTIPLE}× the estimated claim fee` +
          `${value !== null ? ` and ${formatFiat(MIN_CARD_VALUE, ctx.currency)}` : ""}. ` +
          `The fee is the catalog's average gas price × Zunia's fallback gas limit for ${plural(validators, "claim message")}.`,
        weight: value ?? 0,
      });
    }
  }
  return out;
}

/**
 * Idle native balances on chains whose actual APR is above zero: what the
 * balance would earn staked, after leaving {@link FEE_RESERVE_TXS} delegate
 * fees liquid, and the dilution it takes unstaked (actual inflation).
 */
export function idleStakeInsights(ctx: Ctx): Ranked[] {
  const out: Ranked[] = [];
  for (const chain of readableChains(ctx.inputs.staking)) {
    const stats = ctx.stats(chain.chainId);
    const chainApr = stats?.apr.actual ?? null;
    if (chainApr === null || !(chainApr > 0)) continue;
    const asset = ctx.nativeAsset(chain.chainId, chain.denom);
    const liquid = toBig(asset?.amounts.liquid);
    const decimals = chain.decimals ?? asset?.identity.decimals ?? null;
    if (liquid === null || liquid <= BigInt(0) || decimals === null) continue;
    const feeChain = ctx.inputs.feeChains[chain.chainId];
    const delegateFee = estimateFee(feeChain, [MSG_DELEGATE]);
    if (delegateFee === null) continue;
    // Fees paid in another denom come out of another balance.
    const reserve = feeChain?.feeMinimalDenom === chain.denom ? delegateFee * BigInt(FEE_RESERVE_TXS) : BigInt(0);
    const idle = liquid - reserve;
    if (idle <= BigInt(0)) continue;

    const price = ctx.nativePrice(chain.chainId, chain.denom);
    const idleWhole = wholeOf(idle, decimals);
    const idleValue = price !== null ? idleWhole * price : null;
    if (idleValue !== null ? idleValue < MIN_IDLE_VALUE : idleWhole < 1) continue;

    // Your own validators' rate when you already stake here; else the chain's
    // rate after the median commission.
    const own = chain.apr.weighted;
    const median = stats?.medianCommission ?? null;
    const apr = own !== null && own > 0 ? own : chainApr * (1 - (median ?? 0));
    if (!(apr > 0)) continue;
    const yearly = idleWhole * apr;
    const yearlyValue = price !== null ? yearly * price : null;
    const yearlyTokens = BigInt(Math.floor(yearly * 10 ** decimals));
    const name = ctx.name(chain.chainId);
    const inflation = stats?.inflation.actual ?? null;

    out.push({
      id: `idle-stake:${chain.chainId}`,
      kind: "idle-stake",
      severity: "opportunity",
      title: `${ctx.tokens(idle, decimals, chain.symbol)} idle on ${name}`,
      body:
        `Staked at ${pct(apr)} APR it would earn about ${ctx.tokens(yearlyTokens, decimals, chain.symbol)}` +
        `${yearlyValue !== null ? ` (${ctx.money(yearlyValue)})` : ""} a year` +
        (inflation !== null && inflation > 0 ? `; unstaked, its share of supply shrinks ${pct(inflation)} a year.` : "."),
      metric: { label: "Est. yearly yield", value: yearlyValue !== null ? ctx.money(yearlyValue) : ctx.tokens(yearlyTokens, decimals, chain.symbol) },
      chainId: chain.chainId,
      action: { label: "Stake", href: `/staking?action=delegate&chain=${encodeURIComponent(chain.chainId)}` },
      why:
        `Estimate at today's ${price !== null ? "price and " : ""}rate: ${name}'s actual APR (block-time corrected, mint rewards only) ` +
        (own !== null && own > 0
          ? "after your validators' commission"
          : `after the ${median !== null ? `median ${ratePct(median)}` : "validators'"} commission`) +
        `. ${tokenText(reserve, decimals, chain.symbol, ctx.hide)} stays liquid for about ${FEE_RESERVE_TXS} transaction fees.`,
      weight: yearlyValue ?? 0,
    });
  }
  return out;
}

function inheritedText(proposal: ProposalRow): string {
  const inherited = proposal.inheritedVote ?? [];
  if (inherited.length === 0) return "Without your vote, your stake does not count.";
  const voted = inherited.filter((v) => v.option !== null);
  const silent = inherited.filter((v) => v.option === null);
  const name = (v: InheritedVote) => v.moniker ?? shortenAddress(v.validator, 12, 4);
  if (voted.length === 0) {
    return `${listText(silent.map(name))} ${silent.length === 1 ? "hasn't" : "haven't"} voted either.`;
  }
  const share = voted.reduce((sum, v) => sum + v.weight, 0);
  const options = [...new Set(voted.map((v) => voteLabel(v.option) ?? "a vote"))];
  return (
    `${listText(voted.map(name))} voted ${listText(options)} for ${pct(share, 0)} of your stake` +
    (silent.length > 0 ? `; ${listText(silent.map(name))} ${silent.length === 1 ? "hasn't" : "haven't"} voted.` : ".")
  );
}

function tallyText(proposal: ProposalRow): string {
  const parts: string[] = [];
  if (proposal.turnout !== null) {
    parts.push(
      `Turnout ${proposal.turnoutEstimate ? "≈" : ""}${pct(proposal.turnout)}` +
        (proposal.quorum !== null ? ` of a ${pct(proposal.quorum)} quorum` : ""),
    );
  }
  if (proposal.passingIfEndedNow !== null) parts.push(proposal.passingIfEndedNow ? "passing as of now" : "failing as of now");
  return parts.length > 0 ? `${parts.join(", ")}.` : "";
}

/** Voting proposals where the wallet has voting power and has not voted. */
export function voteInsights(ctx: Ctx): Ranked[] {
  const out: Ranked[] = [];
  for (const proposal of ctx.inputs.proposals?.proposals ?? []) {
    if (proposal.status !== "voting" || proposal.myVoteStatus !== "not-voted") continue;
    const power = toBig(proposal.myVotingPower);
    if (power === null || power <= BigInt(0)) continue;
    const end = proposal.votingEndTime ? Date.parse(proposal.votingEndTime) : NaN;
    if (!Number.isFinite(end)) continue;
    const left = end - ctx.inputs.now;
    // Past its end the proposal is being tallied: nothing to vote on.
    if (left <= 0) continue;
    const name = ctx.name(proposal.chainId);
    const soon = left < VOTE_WARNING_MS;
    out.push({
      id: `vote:${proposal.chainId}:${proposal.id}`,
      kind: "vote",
      severity: soon ? "warning" : "info",
      title: `${name} #${proposal.id} closes ${untilText(left)}`,
      body: `“${proposal.title}”. You haven't voted. ${inheritedText(proposal)} ${tallyText(proposal)}`.trim(),
      metric: { label: "Time left", value: formatDuration(left / 1000) },
      chainId: proposal.chainId,
      action: { label: "Vote", href: proposalHref(proposal.chainId, proposal.id) },
      why:
        `Listed while voting is open and your stake gives you voting power on ${name}. ` +
        `Until you vote, each validator you delegate to votes for the stake you gave it; your own vote replaces theirs.`,
      weight: 1e15 - left,
    });
  }
  return out;
}

/** Unbondings finishing within {@link UNBONDING_WINDOW_MS}, one card per chain. */
export function unbondingInsights(ctx: Ctx): Ranked[] {
  const out: Ranked[] = [];
  const { now } = ctx.inputs;
  for (const chain of readableChains(ctx.inputs.staking)) {
    const due: { at: number; balance: bigint; validator: string }[] = [];
    for (const position of chain.unbonding) {
      for (const entry of position.entries) {
        const at = Date.parse(entry.completionTime);
        const balance = toBig(entry.balance);
        if (!Number.isFinite(at) || balance === null || balance <= BigInt(0)) continue;
        if (at > now && at - now <= UNBONDING_WINDOW_MS) due.push({ at, balance, validator: position.validator.moniker });
      }
    }
    if (due.length === 0) continue;
    due.sort((a, b) => a.at - b.at);
    const total = due.reduce((sum, entry) => sum + entry.balance, BigInt(0));
    const first = due[0] as (typeof due)[number];
    const price = ctx.nativePrice(chain.chainId, chain.denom);
    const value = price !== null && chain.decimals !== null ? wholeOf(total, chain.decimals) * price : null;
    const name = ctx.name(chain.chainId);
    out.push({
      id: `unbonding:${chain.chainId}`,
      kind: "unbonding",
      severity: "info",
      title:
        due.length === 1
          ? `${ctx.tokens(total, chain.decimals, chain.symbol)} unlocks on ${name} ${untilText(first.at - now)}`
          : `${ctx.tokens(total, chain.decimals, chain.symbol)} unlocks on ${name} this week`,
      body:
        (due.length === 1
          ? `Unbonding from ${first.validator} completes on ${formatDate(first.at, "datetime")}.`
          : `${due.length} unbondings complete within 7 days; the first, from ${first.validator}, on ${formatDate(first.at, "datetime")}.`) +
        " The tokens return to your liquid balance on their own.",
      metric: { label: "Unlocking", value: value !== null ? ctx.money(value) : ctx.tokens(total, chain.decimals, chain.symbol) },
      chainId: chain.chainId,
      action: { label: "View staking", href: `/staking?chain=${encodeURIComponent(chain.chainId)}` },
      why: `Unbonding entries on ${name} with a completion time in the next 7 days, read from the chain.`,
      weight: 1e15 - (first.at - now),
    });
  }
  return out;
}

interface Reason {
  severity: InsightSeverity;
  title: string;
  clause: string;
}

/**
 * Risks of the validators the wallet delegates to: jailed or tombstoned,
 * outside the active set, missing blocks, high commission (now or reachable
 * within 30 days under its on-chain change limits), part of the Nakamoto set.
 * One card per validator, at its most severe reason, listing all of them.
 */
export function validatorRiskInsights(ctx: Ctx): Ranked[] {
  const out: Ranked[] = [];
  for (const chain of readableChains(ctx.inputs.staking)) {
    const stats = ctx.stats(chain.chainId);
    const price = ctx.nativePrice(chain.chainId, chain.denom);
    for (const delegation of chain.delegations) {
      const amount = toBig(delegation.amount);
      if (amount === null || amount <= BigInt(0)) continue;
      const reasons = validatorReasons(delegation, stats);
      if (reasons.length === 0) continue;
      reasons.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
      const top = reasons[0] as Reason;
      const v = delegation.validator;
      const value = price !== null && chain.decimals !== null ? wholeOf(amount, chain.decimals) * price : null;
      const name = ctx.name(chain.chainId);
      const stake = ctx.tokens(amount, chain.decimals, chain.symbol);
      out.push({
        id: `validator-risk:${chain.chainId}:${v.operatorAddress}`,
        kind: "validator-risk",
        severity: top.severity,
        title: `${v.moniker} ${top.title}`,
        body:
          `You stake ${stake}${value !== null ? ` (${ctx.money(value)})` : ""} with ${v.moniker} on ${name}. ` +
          `It ${listText(reasons.map((r) => r.clause), 3)}.`,
        metric: { label: "Your stake", value: value !== null ? ctx.money(value) : stake },
        chainId: chain.chainId,
        action: {
          label: "Review validator",
          href: `/validators/${encodeURIComponent(v.operatorAddress)}?chain=${encodeURIComponent(chain.chainId)}`,
        },
        why:
          "Read from the chain: validator status and jailing, the uptime window of x/slashing, and the commission's " +
          "max rate and max daily change (the highest rate it can legally set within 30 days). " +
          "The Nakamoto set is the smallest group of validators holding over a third of the voting power, enough to halt the chain.",
        weight: value ?? 0,
      });
    }
  }
  return out;
}

function validatorReasons(delegation: StakingDelegation, stats: ChainStats | null): Reason[] {
  const v = delegation.validator;
  // Tombstoned is final: x/slashing jails the validator for good and refuses
  // its unjail, so "until it is unjailed" would be false and invite waiting,
  // and its uptime and commission no longer matter. Moving the stake (which
  // takes effect at once) is the only remedy.
  if (v.tombstoned) {
    return [
      {
        severity: "critical",
        title: "is tombstoned",
        clause:
          "is tombstoned: it was removed for double-signing and can never sign again, so your stake there earns nothing until you move it to another validator",
      },
    ];
  }
  const reasons: Reason[] = [];
  if (v.jailed) {
    reasons.push({ severity: "critical", title: "is jailed", clause: "is jailed, so your stake there earns nothing until it is unjailed" });
  } else if (v.status !== null && v.status !== "bonded") {
    reasons.push({ severity: "warning", title: "is outside the active set", clause: "is outside the active set, so your stake there earns 0%" });
  }
  if (v.uptime !== null && v.uptime < UPTIME_WARNING) {
    const window = stats?.slashing?.signedBlocksWindow ?? null;
    reasons.push({
      severity: "warning",
      title: `signed ${pct(v.uptime)} of recent blocks`,
      clause: `signed ${pct(v.uptime)} of the last ${window !== null ? `${window.toLocaleString("en-US")} ` : ""}blocks`,
    });
  }
  const rate = v.commissionRate;
  const reach = v.commissionReachable30d;
  const median = stats?.medianCommission ?? null;
  const floor = stats?.minCommission ?? null;
  const medianText = median !== null ? ` (median on this chain ${ratePct(median)})` : "";
  const canRise = reach !== null && rate !== null && reach > rate + 1e-9;
  // High only against its own chain: Celestia's minimum commission is 20 %,
  // so 20 % there is the floor every validator charges, not an outlier.
  const aboveChain = rate !== null && (median === null || rate > median + 1e-9) && (floor === null || rate > floor + 1e-9);
  if (rate !== null && rate >= HIGH_COMMISSION && aboveChain) {
    reasons.push({
      severity: "warning",
      title: `charges ${ratePct(rate)} commission`,
      clause: `charges ${ratePct(rate)} commission${medianText}${canRise ? ` and can raise it to ${ratePct(reach as number)} within 30 days` : ""}`,
    });
  } else if (canRise && (reach as number) >= HIGH_COMMISSION) {
    reasons.push({
      severity: "info",
      title: `can raise its commission to ${ratePct(reach as number)}`,
      clause: `can raise its commission from ${ratePct(rate as number)} to ${ratePct(reach as number)} within 30 days${medianText}`,
    });
  }
  if (v.inNakamotoSet) {
    const n = stats?.nakamoto ?? null;
    reasons.push({
      severity: "info",
      title: "is in the Nakamoto set",
      clause: `is one of the ${n !== null ? `${n} ` : ""}validators that together hold over a third of the voting power`,
    });
  }
  return reasons;
}

/**
 * Concentration of priced value: the largest asset (grouped across chains)
 * or, with two or more chains holding value, the largest chain. HHI and its
 * inverse (the "effective number" of equal holdings) say how spread it is.
 */
export function concentrationInsights(ctx: Ctx): Ranked[] {
  const portfolio = ctx.inputs.portfolio;
  const total = portfolio?.totals.pricedValue ?? 0;
  if (!portfolio || !(total > 0)) return [];
  const groups = groupAssets(portfolio.assets).filter((g) => g.value !== null && g.value > 0);
  const hhi = herfindahl(groups.map((g) => (g.value as number) / total));
  const chains = portfolio.chains.filter((c) => c.status === "ok" && c.value !== null && c.value > 0);
  const topChain = [...chains].sort((a, b) => (b.value as number) - (a.value as number))[0];
  const chainShare = topChain && chains.length >= 2 ? (topChain.value as number) / total : null;
  const topAsset = groups[0];
  const assetShare = topAsset ? (topAsset.value as number) / total : 0;
  const effective = hhi !== null ? 1 / hhi : null;
  const metric = effective !== null ? { label: "Effective assets", value: effective.toFixed(1) } : undefined;
  const why =
    `Shares of priced value only (unpriced holdings are not counted). HHI = Σ share² = ${hhi !== null ? hhi.toFixed(2) : "—"}; ` +
    `its inverse${effective !== null ? `, ${effective.toFixed(1)},` : ""} is the number of equal holdings that would be as concentrated.`;

  // One asset is 100 % of itself: a fact the holder knows, not an insight.
  if (topAsset && groups.length >= 2 && assetShare > CONCENTRATION_SHARE) {
    const ticker = topAsset.identity.ticker;
    const chainNote =
      chainShare !== null && chainShare > CONCENTRATION_SHARE && topChain
        ? ` ${ctx.name(topChain.chainId)} holds ${pct(chainShare)} of it all.`
        : "";
    return [
      {
        id: `concentration:asset:${topAsset.key}`,
        kind: "concentration",
        severity: assetShare >= CONCENTRATION_WARNING ? "warning" : "info",
        title: `${pct(assetShare)} of your value is ${ticker}`,
        body: `${ticker} is worth ${ctx.money(topAsset.value as number)} of ${ctx.money(total)}.${chainNote} A 10% move in ${ticker} moves your priced net worth ${pct(assetShare * 0.1)}.`,
        metric,
        action: { label: "View assets", href: "/assets" },
        why,
        weight: assetShare,
      },
    ];
  }
  if (topChain && chainShare !== null && chainShare > CONCENTRATION_SHARE) {
    const name = ctx.name(topChain.chainId);
    return [
      {
        id: `concentration:chain:${topChain.chainId}`,
        kind: "concentration",
        severity: chainShare >= CONCENTRATION_WARNING ? "warning" : "info",
        title: `${pct(chainShare)} of your value is on ${name}`,
        body: `${name} holds ${ctx.money(topChain.value as number)} of ${ctx.money(total)}. A halt or an endpoint outage there affects most of your holdings at once.`,
        metric,
        chainId: topChain.chainId,
        action: { label: "View assets", href: "/assets" },
        why,
        weight: chainShare,
      },
    ];
  }
  return [];
}

const UNPRICED_WORDS: Readonly<Record<UnpricedReason, string>> = {
  "no-market": "no market",
  unproven: "an unproven origin",
  "decimals-unknown": "unknown decimals",
  testnet: "testnet tokens",
  "source-unavailable": "a price source down",
};

/**
 * Holdings without a price: counted, listed in their own units, not valued.
 * Counted by asset, as the Assets page and the Overview count them: a token
 * held on two chains is one asset without a price, not two.
 */
export function unpricedInsights(ctx: Ctx): Ranked[] {
  const portfolio = ctx.inputs.portfolio;
  if (!portfolio) return [];
  const byReason = new Map<UnpricedReason, number>();
  let count = 0;
  for (const group of groupAssets(portfolio.assets)) {
    if (group.value !== null) continue;
    count += 1;
    const reason = group.unpriced ?? "no-market";
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  if (count <= 0) return [];
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${n} with ${UNPRICED_WORDS[reason]}`);
  return [
    {
      id: "unpriced",
      kind: "unpriced",
      severity: "info",
      title: `${plural(count, "asset")} without a price`,
      body:
        `${count === 1 ? "It is" : "They are"} shown in ${count === 1 ? "its" : "their"} own units and left out of net worth` +
        (reasons.length > 0 ? `: ${listText(reasons, 3)}.` : "."),
      metric: { label: "Unpriced", value: String(count) },
      action: { label: "View assets", href: "/assets" },
      why: "A token is valued only when its origin is proven and a market quotes it (Numia for Osmosis-traded assets, Coinstore for SAF). Nothing is valued at a guessed price or at zero.",
      weight: count,
    },
  ];
}

/** Message types a grantee could use to move funds out of the account. */
const FUND_MOVING_MSGS = new Set([
  "/cosmos.bank.v1beta1.MsgSend",
  "/cosmos.bank.v1beta1.MsgMultiSend",
  "/ibc.applications.transfer.v1.MsgTransfer",
  "/cosmwasm.wasm.v1.MsgExecuteContract",
  "/cosmos.authz.v1beta1.MsgExec",
  "/cosmos.authz.v1beta1.MsgGrant",
  "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
]);

const FUND_MOVING_AUTHZ = new Set(["SendAuthorization", "TransferAuthorization", "ContractExecutionAuthorization"]);

const GRANT_VERBS: Readonly<Record<string, string>> = {
  "/cosmos.gov.v1.MsgVote": "vote",
  "/cosmos.gov.v1beta1.MsgVote": "vote",
  "/cosmos.gov.v1.MsgVoteWeighted": "vote",
  "/cosmos.gov.v1beta1.MsgVoteWeighted": "vote",
  "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": "claim rewards",
  "/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission": "claim commission",
  "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress": "change where rewards go",
  "/cosmos.staking.v1beta1.MsgDelegate": "delegate",
  "/cosmos.staking.v1beta1.MsgUndelegate": "undelegate",
  "/cosmos.staking.v1beta1.MsgBeginRedelegate": "redelegate",
  "/cosmos.bank.v1beta1.MsgSend": "send tokens",
  "/cosmos.bank.v1beta1.MsgMultiSend": "send tokens",
  "/ibc.applications.transfer.v1.MsgTransfer": "send tokens over IBC",
  "/cosmwasm.wasm.v1.MsgExecuteContract": "run contracts",
};

function grantVerb(grant: AuthzGrantRow): string {
  if (grant.msgTypeUrl) return GRANT_VERBS[grant.msgTypeUrl] ?? grant.msgTypeUrl.split(".").pop() ?? grant.msgTypeUrl;
  if (grant.authorization === "StakeAuthorization") return grant.stakeAction ?? "stake";
  if (grant.authorization === "SendAuthorization") return "send tokens";
  if (grant.authorization === "TransferAuthorization") return "send tokens over IBC";
  return grant.authorization;
}

function fundMoving(grant: AuthzGrantRow): boolean {
  return FUND_MOVING_AUTHZ.has(grant.authorization) || (grant.msgTypeUrl !== undefined && FUND_MOVING_MSGS.has(grant.msgTypeUrl));
}

function expiryText(expirations: readonly (string | null)[], now: number): string {
  if (expirations.some((e) => e === null)) return "At least one never expires.";
  const times = expirations.map((e) => Date.parse(e as string)).filter(Number.isFinite);
  if (times.length === 0) return "";
  return `Expires ${formatDate(Math.min(...times), "short", { now })}.`;
}

/**
 * The security review (DeBank/Rabby "approvals" for Cosmos): authz grants
 * this account gave, staking rewards paid to another address, fee
 * allowances issued. A grant that can move funds is critical.
 */
export function securityInsights(ctx: Ctx): Ranked[] {
  const review = ctx.inputs.security;
  if (!review) return [];
  const out: Ranked[] = [];
  const href = "/insights#security";

  const byGrantee = new Map<string, AuthzGrantRow[]>();
  for (const grant of review.authzGrants) {
    const key = `${grant.chainId}|${grant.grantee}`;
    const list = byGrantee.get(key);
    if (list) list.push(grant);
    else byGrantee.set(key, [grant]);
  }
  for (const grants of byGrantee.values()) {
    const first = grants[0] as AuthzGrantRow;
    const name = ctx.name(first.chainId);
    const who = shortenAddress(first.grantee, 10, 4);
    const verbs = [...new Set(grants.map(grantVerb))];
    const moving = grants.some(fundMoving);
    out.push({
      id: `security:authz:${first.chainId}:${first.grantee}`,
      kind: "security",
      severity: moving ? "critical" : "info",
      title: moving ? `${who} can move funds from your ${name} account` : `${who} can act for your ${name} account`,
      body: `${plural(grants.length, "authz grant")} let it ${listText(verbs, 3)} in your name. ${expiryText(grants.map((g) => g.expiration), ctx.inputs.now)}`.trim(),
      metric: { label: "Grants", value: String(grants.length) },
      chainId: first.chainId,
      action: { label: "Review grants", href },
      why:
        "Authz grants you signed stay valid until they expire or you revoke them, and the grantee uses them without your keys. " +
        "Auto-compounding and voting bots rely on them.",
      weight: moving ? 2 : 1,
    });
  }

  for (const entry of review.withdrawAddressDiffers) {
    const name = ctx.name(entry.chainId);
    out.push({
      id: `security:withdraw:${entry.chainId}`,
      kind: "security",
      severity: "warning",
      title: `${name} rewards are paid to another address`,
      body: `Claimed staking rewards on ${name} go to ${shortenAddress(entry.withdrawAddress, 10, 4)}, not to this account.`,
      chainId: entry.chainId,
      action: { label: "Review", href },
      why: "x/distribution pays rewards to the account's withdraw address. It changes only with a transaction you sign (MsgSetWithdrawAddress), or one a grantee signs for you.",
      weight: 3,
    });
  }

  const feeByGrantee = new Map<string, FeeGrantRow[]>();
  for (const grant of review.feeGrants) {
    const key = `${grant.chainId}|${grant.grantee}`;
    const list = feeByGrantee.get(key);
    if (list) list.push(grant);
    else feeByGrantee.set(key, [grant]);
  }
  for (const grants of feeByGrantee.values()) {
    const first = grants[0] as FeeGrantRow;
    const name = ctx.name(first.chainId);
    const limited = grants.every((g) => (g.spendLimit?.length ?? 0) > 0);
    out.push({
      id: `security:feegrant:${first.chainId}:${first.grantee}`,
      kind: "security",
      severity: "info",
      title: `You pay fees for ${shortenAddress(first.grantee, 10, 4)} on ${name}`,
      body: `A fee allowance lets it spend your tokens on transaction fees${limited ? ", up to a limit" : " with no spend limit"}. ${expiryText(grants.map((g) => g.expiration), ctx.inputs.now)}`.trim(),
      chainId: first.chainId,
      action: { label: "Review", href },
      why: "x/feegrant allowances let another account pay its fees from yours until the allowance expires or is revoked.",
      weight: 0,
    });
  }
  return out;
}

/**
 * Chain status: a chain the wallet holds value on whose public node serves
 * no new block (halted, or that node stalled), and assets that come from or
 * sit on a chain in {@link CHAIN_NOTICES}.
 */
export function chainRiskInsights(ctx: Ctx): Ranked[] {
  const out: Ranked[] = [];
  const portfolio = ctx.inputs.portfolio;
  const { now } = ctx.inputs;
  for (const stats of ctx.inputs.chainStats?.chains ?? []) {
    if (stats.halted !== true) continue;
    const held = portfolio?.chains.find((c) => c.chainId === stats.chainId);
    if (!held || held.assetCount <= 0) continue;
    const at = stats.latestBlockTime ? Date.parse(stats.latestBlockTime) : NaN;
    const name = stats.chainName;
    out.push({
      id: `chain-risk:halted:${stats.chainId}`,
      kind: "chain-risk",
      severity: "warning",
      title: `${name} is not producing blocks`,
      body:
        `The latest block its public node serves is from ${Number.isFinite(at) ? formatRelativeTime(at, now) : "an unknown time"}: the chain is halted or that node is stalled. ` +
        `You hold ${held.value !== null ? ctx.money(held.value) : plural(held.assetCount, "asset")} there; transactions on it may not go through.`,
      metric: held.value !== null ? { label: "Held there", value: ctx.money(held.value) } : undefined,
      chainId: stats.chainId,
      action: { label: "Chain status", href: `/chains/${encodeURIComponent(stats.chainId)}` },
      why: "Flagged when the newest block the endpoint returns is more than 5 minutes old.",
      weight: held.value ?? 0,
    });
  }

  if (portfolio) {
    const byNotice = new Map<string, PortfolioAsset[]>();
    for (const asset of portfolio.assets) {
      const origin = asset.identity.originChainId;
      const notice = origin && CHAIN_NOTICES[origin] ? origin : CHAIN_NOTICES[asset.chainId] ? asset.chainId : null;
      if (!notice) continue;
      const list = byNotice.get(notice);
      if (list) list.push(asset);
      else byNotice.set(notice, [asset]);
    }
    for (const [chainId, assets] of byNotice) {
      const notice = CHAIN_NOTICES[chainId] as { name: string; fact: string };
      const tickers = [...new Set(assets.map((a) => a.identity.ticker))];
      const priced = assets.filter((a) => a.value !== null);
      const value = priced.length > 0 ? priced.reduce((sum, a) => sum + (a.value as number), 0) : null;
      out.push({
        id: `chain-risk:notice:${chainId}`,
        kind: "chain-risk",
        severity: "warning",
        title: `${plural(tickers.length, "asset")} you hold depend${tickers.length === 1 ? "s" : ""} on ${notice.name}`,
        body:
          `${listText(tickers, 3)} ${tickers.length === 1 ? "comes" : "come"} from or ${tickers.length === 1 ? "sits" : "sit"} on ${notice.name}, and ${notice.fact}. ` +
          `Redeeming or moving ${tickers.length === 1 ? "it" : "them"} relies on that chain.` +
          (value !== null ? ` Value: ${ctx.money(value)}.` : ""),
        metric: value !== null ? { label: "Exposed", value: ctx.money(value) } : { label: "Assets", value: String(tickers.length) },
        chainId,
        action: { label: "View assets", href: "/assets" },
        why: "Ecosystem status as of October 2026 (Zunia design notes). Liquid-staking tokens are redeemed on their issuing chain, and IBC vouchers travel back through their origin.",
        weight: value ?? 0,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

function compare(a: Ranked, b: Ranked): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    b.weight - a.weight ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Every insight for the inputs, most severe first; within a severity by kind
 * (security, chain status, validators, votes, unbonding, compounding, claims,
 * idle balances, concentration, pricing), then by value.
 */
export function deriveInsights(inputs: InsightInputs): Insight[] {
  const ctx = context(inputs);
  const ranked = [
    ...securityInsights(ctx),
    ...chainRiskInsights(ctx),
    ...validatorRiskInsights(ctx),
    ...voteInsights(ctx),
    ...unbondingInsights(ctx),
    ...rewardInsights(ctx),
    ...idleStakeInsights(ctx),
    ...concentrationInsights(ctx),
    ...unpricedInsights(ctx),
  ].sort(compare);
  // The ordering weight is an implementation detail, not part of the contract.
  return ranked.map((item) => {
    const insight: Insight & { weight?: number } = { ...item };
    delete insight.weight;
    return insight;
  });
}

/** The rules' context, for callers that run one rule on its own (tests, pages). */
export function insightContext(inputs: InsightInputs): Ctx {
  return context(inputs);
}

export type { Ctx as InsightContext };
