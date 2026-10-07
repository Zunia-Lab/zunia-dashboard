/**
 * The Insights page's arithmetic and wording, kept out of the components so
 * it is tested: severity counts and the headline over them, the per-network
 * tally, the concentration figures behind the "Risks" card, and the security
 * review's grouping of grants, expiries and coverage.
 *
 * The insights themselves come from `@/lib/insights/rules` (the same list the
 * Overview row shows); nothing here decides what is an insight. What it adds
 * is the reading aids around the list: how many of each kind, where they are,
 * and, for the security review, the facts per grant a user needs to judge one
 * ("can move funds", "never expires").
 *
 * Unknown stays unknown: a figure that needs a priced value or a known
 * expiry is `null` when that is missing, never a zero.
 *
 * Pure (no React, no I/O), so `node --test` covers it.
 */

import type { AuthzGrantRow, Coin, FeeGrantRow, SecurityReviewResponse } from "@/lib/chain/types";
import { formatTokenAmount, shortenAddress } from "@/lib/format";
import { herfindahl, insightGroup, type Insight, type InsightGroup, type InsightKind, type InsightSeverity } from "@/lib/insights/rules";
import { groupAssets } from "@/lib/token/holdings";
import type { PortfolioResponse } from "@/lib/token/wire";

/* -------------------------------------------------------------------------- */
/* Severity and groups                                                         */
/* -------------------------------------------------------------------------- */

/** Most severe first: the order the summary, the bar and the lists use. */
export const SEVERITIES: readonly InsightSeverity[] = ["critical", "warning", "opportunity", "info"];

export const GROUP_LABEL: Readonly<Record<InsightGroup, string>> = {
  "do-now": "Do now",
  opportunities: "Opportunities",
  risks: "Risks",
};

/** Section anchors: the summary's jump links and `/insights#…` links land on these. */
export const GROUP_ANCHOR: Readonly<Record<InsightGroup, string>> = {
  "do-now": "do-now",
  opportunities: "opportunities",
  risks: "risks",
};

export function countBySeverity(items: readonly Pick<Insight, "severity">[]): Record<InsightSeverity, number> {
  const counts: Record<InsightSeverity, number> = { critical: 0, warning: 0, opportunity: 0, info: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

/** The page's three sections, each in the list's own order (most severe first). */
export function splitByGroup<T extends Pick<Insight, "kind" | "severity">>(items: readonly T[]): Record<InsightGroup, T[]> {
  const groups: Record<InsightGroup, T[]> = { "do-now": [], opportunities: [], risks: [] };
  for (const item of items) groups[insightGroup(item)].push(item);
  return groups;
}

/** Nouns for "2 validators · 1 vote": what a count of each kind is a count of. */
const KIND_NOUN: Readonly<Record<InsightKind, readonly [string, string]>> = {
  claim: ["reward claim", "reward claims"],
  compounding: ["restake", "restakes"],
  "idle-stake": ["idle balance", "idle balances"],
  vote: ["vote", "votes"],
  unbonding: ["unlock", "unlocks"],
  "validator-risk": ["validator", "validators"],
  concentration: ["concentration", "concentration"],
  unpriced: ["pricing gap", "pricing gaps"],
  security: ["security finding", "security findings"],
  "chain-risk": ["chain status", "chain statuses"],
};

/**
 * "2 validators · 1 vote · 1 chain status": what a set of insights is made
 * of, largest count first (ties in the list's own order), at most `max` parts.
 * The tail is counted in insights ("· 3 more"), so the parts always add up to
 * the count they explain.
 */
export function kindBreakdown(items: readonly Pick<Insight, "kind">[], max = 3): string {
  const counts = new Map<InsightKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const entries = [...counts.entries()]
    // Map iteration keeps first-seen order, so a stable sort keeps the list's order on ties.
    .sort((a, b) => b[1] - a[1]);
  const parts = entries.slice(0, max).map(([kind, n]) => `${n} ${KIND_NOUN[kind][n === 1 ? 0 : 1]}`);
  const rest = entries.slice(max).reduce((sum, [, n]) => sum + n, 0);
  return rest > 0 ? `${parts.join(" · ")} · ${rest} more` : parts.join(" · ");
}

/**
 * "in 12 days", "in 11 months", "in 2 years": how far off an expiry is, in
 * the unit a person would use. Rounded down, so it never reads later than it
 * is; "today" under a day, "expired" once past.
 */
export function untilText(at: number, now: number): string {
  const ms = at - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 60) return `in ${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `in ${months} months`;
  return `in ${Math.floor(days / 365.25)} years`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
function listText(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface SummaryText {
  title: string;
  sub: string;
}

/**
 * The summary card's sentence. Leads with what to do now, then what can be
 * gained, then what to review, so the first words are always the most urgent
 * thing on the page. `where` is "on 5 networks" or "on Osmosis". `failed`:
 * neither balances nor staking positions could be read, so nothing was
 * measured at all, which is not the same as nothing found.
 */
export function summaryText(
  groups: Readonly<Record<InsightGroup, readonly unknown[]>>,
  where: string,
  partial = false,
  failed = false,
): SummaryText {
  const doNow = groups["do-now"].length;
  const opportunities = groups.opportunities.length;
  const risks = groups.risks.length;
  const total = doNow + opportunities + risks;
  if (total === 0 && failed) {
    return {
      title: "Nothing could be measured",
      sub: `Your balances and staking positions didn't load ${where}, and every insight is measured from them.`,
    };
  }
  if (total === 0) {
    return {
      title: partial ? "Nothing found in what loaded" : "Nothing needs you right now",
      sub: partial
        ? `Some reads failed ${where}, so this may be incomplete. The badge says which.`
        : `No rewards worth claiming, votes waiting on you, unlocks this week or risks found ${where}.`,
    };
  }
  const rest: string[] = [];
  let title: string;
  if (doNow > 0) {
    title = `${plural(doNow, "thing")} to do now`;
    if (opportunities > 0) rest.push(plural(opportunities, "opportunity", "opportunities"));
    if (risks > 0) rest.push(`${plural(risks, "risk")} to review`);
  } else if (opportunities > 0) {
    title = `${plural(opportunities, "opportunity", "opportunities")} to consider`;
    if (risks > 0) rest.push(`${plural(risks, "risk")} to review`);
  } else {
    title = `${plural(risks, "risk")} to review`;
  }
  return {
    title,
    sub: rest.length > 0 ? `Plus ${listText(rest)}, ${where}.` : `${total === 1 ? "The only insight" : `All ${total} insights`} ${where}.`,
  };
}

/**
 * The summary's shortcuts: the actions of what to do now (most severe first),
 * or, with nothing to do now, of the opportunities. At most `max`.
 */
export function nextSteps<T extends Pick<Insight, "action" | "kind" | "severity">>(groups: Readonly<Record<InsightGroup, readonly T[]>>, max = 3): T[] {
  const source = groups["do-now"].length > 0 ? groups["do-now"] : groups.opportunities;
  return source.filter((item) => item.action).slice(0, max);
}

/**
 * A shortcut's label: the action and where ("Claim rewards · Celestia"). Two
 * votes on one chain differ by their proposal number, read from the insight
 * id (`vote:<chainId>:<id>`). Every validator card has the same action
 * ("Review validator"), so its title says which validator and why
 * ("strangelove is jailed · Cosmos Hub"): two on one chain would otherwise
 * read the same and lead to different validators. Only critical ones get here
 * (jailed, tombstoned), and their title carries no amount.
 */
export function stepLabel(insight: Pick<Insight, "id" | "kind" | "title" | "action">, chainName: string | null): string {
  if (insight.kind === "validator-risk") return chainName ? `${insight.title} · ${chainName}` : insight.title;
  const action = insight.action?.label ?? "";
  if (!chainName) return action;
  if (insight.kind === "vote") {
    const id = insight.id.split(":").pop();
    return id ? `${action} · ${chainName} #${id}` : `${action} · ${chainName}`;
  }
  return `${action} · ${chainName}`;
}

/* -------------------------------------------------------------------------- */
/* Per network                                                                 */
/* -------------------------------------------------------------------------- */

export interface ChainInsightRow {
  chainId: string;
  total: number;
  bySeverity: Record<InsightSeverity, number>;
  /** The most severe insight's severity; null when the chain has none. */
  worst: InsightSeverity | null;
}

export interface ChainInsightTally {
  rows: ChainInsightRow[];
  /** Insights about the whole portfolio rather than one chain (concentration by asset, pricing). */
  acrossChains: number;
}

/**
 * One row per chain in scope, most severe first, then busiest; chains with
 * nothing found stay listed (in scope order) so "nothing on Akash" is said,
 * not implied by absence. Insights on a chain outside the list are added at
 * the end rather than dropped.
 */
export function insightsByChain(items: readonly Pick<Insight, "chainId" | "severity">[], chainIds: readonly string[]): ChainInsightTally {
  const rows = new Map<string, ChainInsightRow>();
  const row = (chainId: string) => {
    let entry = rows.get(chainId);
    if (!entry) {
      entry = { chainId, total: 0, bySeverity: { critical: 0, warning: 0, opportunity: 0, info: 0 }, worst: null };
      rows.set(chainId, entry);
    }
    return entry;
  };
  for (const chainId of chainIds) row(chainId);
  let acrossChains = 0;
  for (const item of items) {
    if (!item.chainId) {
      acrossChains += 1;
      continue;
    }
    const entry = row(item.chainId);
    entry.total += 1;
    entry.bySeverity[item.severity] += 1;
  }
  const order = [...rows.keys()];
  const rank = (severity: InsightSeverity | null) => (severity === null ? SEVERITIES.length : SEVERITIES.indexOf(severity));
  const list = [...rows.values()].map((entry) => ({
    ...entry,
    worst: SEVERITIES.find((severity) => entry.bySeverity[severity] > 0) ?? null,
  }));
  list.sort((a, b) => rank(a.worst) - rank(b.worst) || b.total - a.total || order.indexOf(a.chainId) - order.indexOf(b.chainId));
  return { rows: list, acrossChains };
}

/** "1 warning", "2 opportunities", "3 info": a severity count in words. */
export function severityCountText(severity: InsightSeverity, count: number): string {
  switch (severity) {
    case "critical":
      return `${count} critical`;
    case "warning":
      return `${count} ${count === 1 ? "warning" : "warnings"}`;
    case "opportunity":
      return `${count} ${count === 1 ? "opportunity" : "opportunities"}`;
    case "info":
      return `${count} info`;
  }
}

export interface ChainValue {
  /** Priced value held there; null when the read failed or nothing there has a price. */
  value: number | null;
  /** That value's share of the priced total (0..1); null without one. */
  share: number | null;
  /** Assets held there (0 is a real answer: nothing held). */
  assets: number;
  /** The chain's balances could not be read. */
  failed: boolean;
}

/**
 * What each chain in the portfolio answer is worth, and its share of the
 * priced total: the money beside each network's insights, so a warning on a
 * chain holding 85% of the value reads differently from one on dust.
 */
export function chainValues(portfolio: Pick<PortfolioResponse, "chains" | "totals"> | null): Map<string, ChainValue> {
  const out = new Map<string, ChainValue>();
  if (!portfolio) return out;
  const total = portfolio.totals.pricedValue;
  for (const chain of portfolio.chains) {
    const value = chain.status === "ok" ? chain.value : null;
    out.set(chain.chainId, {
      value,
      share: value !== null && total > 0 ? value / total : null,
      assets: chain.assetCount,
      failed: chain.status === "error",
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Concentration                                                               */
/* -------------------------------------------------------------------------- */

export interface ShareSlice {
  id: string;
  label: string;
  value: number;
}

export type ConcentrationLevel = "diversified" | "moderate" | "concentrated";

/**
 * HHI bands, on the 0–1 scale (×10,000 for the antitrust convention they come
 * from: under 1,500 unconcentrated, 1,500–2,500 moderately, above 2,500
 * highly concentrated). A portfolio is not a market, so they are a yardstick
 * for the reader, not a verdict, and the page says so.
 */
export const HHI_MODERATE = 0.15;
export const HHI_CONCENTRATED = 0.25;

export function hhiLevel(hhi: number | null): ConcentrationLevel | null {
  if (hhi === null || !Number.isFinite(hhi)) return null;
  if (hhi > HHI_CONCENTRATED) return "concentrated";
  if (hhi >= HHI_MODERATE) return "moderate";
  return "diversified";
}

export const LEVEL_LABEL: Readonly<Record<ConcentrationLevel, string>> = {
  diversified: "Spread out",
  moderate: "Moderately concentrated",
  concentrated: "Highly concentrated",
};

export interface Concentration {
  /** Positive slices, largest first. */
  slices: ShareSlice[];
  /** Σ of the slices. */
  total: number;
  top: ShareSlice | null;
  /** The largest slice's share of the total (0..1); null without a total. */
  topShare: number | null;
  /** Σ share², 0 < HHI ≤ 1; null without a total. */
  hhi: number | null;
  /** 1 / HHI: how many equal holdings would be as concentrated. */
  effective: number | null;
  level: ConcentrationLevel | null;
}

export function concentrationOf(input: readonly ShareSlice[]): Concentration {
  const slices = input.filter((slice) => Number.isFinite(slice.value) && slice.value > 0).sort((a, b) => b.value - a.value);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!(total > 0)) return { slices: [], total: 0, top: null, topShare: null, hhi: null, effective: null, level: null };
  const hhi = herfindahl(slices.map((slice) => slice.value / total));
  const top = slices[0] ?? null;
  return {
    slices,
    total,
    top,
    topShare: top ? top.value / total : null,
    hhi,
    effective: hhi !== null && hhi > 0 ? 1 / hhi : null,
    level: hhiLevel(hhi),
  };
}

/**
 * Priced value per asset, the same asset on several chains counted once
 * (`groupAssets`: proven vouchers join their origin; look-alikes never do).
 * Two different assets that share a ticker are told apart by chain name.
 */
export function assetSlices(portfolio: Pick<PortfolioResponse, "assets">): ShareSlice[] {
  const groups = groupAssets(portfolio.assets).filter((group) => group.value !== null && group.value > 0);
  const tickers = new Map<string, number>();
  for (const group of groups) tickers.set(group.identity.ticker, (tickers.get(group.identity.ticker) ?? 0) + 1);
  return groups.map((group) => {
    const ticker = group.identity.ticker;
    const where = group.identity.originChainName ?? group.identity.chainName ?? group.identity.chainId;
    return { id: group.key, label: (tickers.get(ticker) ?? 0) > 1 ? `${ticker} · ${where}` : ticker, value: group.value as number };
  });
}

/** Priced value per chain that answered. */
export function chainSlices(portfolio: Pick<PortfolioResponse, "chains">): ShareSlice[] {
  return portfolio.chains
    .filter((chain) => chain.status === "ok" && chain.value !== null && chain.value > 0)
    .map((chain) => ({ id: chain.chainId, label: chain.chainName, value: chain.value as number }));
}

/* -------------------------------------------------------------------------- */
/* Security review                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Message types a grantee could use to move funds out of the account. Kept in
 * step with the rules' own list (`securityInsights`), which decides the
 * "critical" badge the insight carries.
 */
const FUND_MOVING_MSGS: ReadonlySet<string> = new Set([
  "/cosmos.bank.v1beta1.MsgSend",
  "/cosmos.bank.v1beta1.MsgMultiSend",
  "/ibc.applications.transfer.v1.MsgTransfer",
  "/cosmwasm.wasm.v1.MsgExecuteContract",
  "/cosmos.authz.v1beta1.MsgExec",
  "/cosmos.authz.v1beta1.MsgGrant",
  "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
]);

const FUND_MOVING_AUTHZ: ReadonlySet<string> = new Set(["SendAuthorization", "TransferAuthorization", "ContractExecutionAuthorization"]);

const MSG_LABEL: Readonly<Record<string, string>> = {
  "/cosmos.gov.v1.MsgVote": "Vote",
  "/cosmos.gov.v1beta1.MsgVote": "Vote",
  "/cosmos.gov.v1.MsgVoteWeighted": "Vote",
  "/cosmos.gov.v1beta1.MsgVoteWeighted": "Vote",
  "/cosmos.gov.v1.MsgSubmitProposal": "Submit proposals",
  "/cosmos.gov.v1beta1.MsgSubmitProposal": "Submit proposals",
  "/cosmos.gov.v1.MsgDeposit": "Deposit on proposals",
  "/cosmos.gov.v1beta1.MsgDeposit": "Deposit on proposals",
  "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": "Claim rewards",
  "/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission": "Claim commission",
  "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress": "Change where rewards go",
  "/cosmos.staking.v1beta1.MsgDelegate": "Delegate",
  "/cosmos.staking.v1beta1.MsgUndelegate": "Undelegate",
  "/cosmos.staking.v1beta1.MsgBeginRedelegate": "Redelegate",
  "/cosmos.bank.v1beta1.MsgSend": "Send tokens",
  "/cosmos.bank.v1beta1.MsgMultiSend": "Send tokens",
  "/ibc.applications.transfer.v1.MsgTransfer": "Send tokens over IBC",
  "/cosmwasm.wasm.v1.MsgExecuteContract": "Run contracts",
  "/cosmos.authz.v1beta1.MsgExec": "Use other grants",
  "/cosmos.authz.v1beta1.MsgGrant": "Grant permissions",
  "/cosmos.authz.v1beta1.MsgRevoke": "Revoke grants",
};

const STAKE_LABEL: Readonly<Record<string, string>> = {
  delegate: "Delegate",
  undelegate: "Undelegate",
  redelegate: "Redelegate",
};

export interface GrantPermission {
  /** "Vote", "Send tokens", "MsgSwapExactAmountIn". */
  label: string;
  /** The message type the grant covers, when the chain named one. */
  typeUrl: string | null;
  movesFunds: boolean;
}

/** What one authz grant lets its grantee do, in words. */
export function grantPermission(grant: Pick<AuthzGrantRow, "authorization" | "msgTypeUrl" | "stakeAction">): GrantPermission {
  const typeUrl = grant.msgTypeUrl ?? null;
  const movesFunds = FUND_MOVING_AUTHZ.has(grant.authorization) || (typeUrl !== null && FUND_MOVING_MSGS.has(typeUrl));
  if (typeUrl) {
    // An unknown module's message reads as its own name ("MsgSwapExactAmountIn"), not as a guess.
    return { label: MSG_LABEL[typeUrl] ?? typeUrl.split(".").pop() ?? typeUrl, typeUrl, movesFunds };
  }
  if (grant.authorization === "StakeAuthorization") {
    const action = grant.stakeAction?.toLowerCase() ?? "";
    return { label: STAKE_LABEL[action] ?? "Stake for you", typeUrl: null, movesFunds };
  }
  if (grant.authorization === "SendAuthorization") return { label: "Send tokens", typeUrl: null, movesFunds };
  if (grant.authorization === "TransferAuthorization") return { label: "Send tokens over IBC", typeUrl: null, movesFunds };
  if (grant.authorization === "ContractExecutionAuthorization") return { label: "Run contracts", typeUrl: null, movesFunds };
  return { label: grant.authorization, typeUrl: null, movesFunds };
}

/** The earliest end of a set of grants: null expirations never end on their own. */
export type Expiry =
  | { kind: "never" }
  | { kind: "unknown" }
  | {
      kind: "at";
      at: number;
      /** Already past (the chain prunes expired grants lazily, so a read can still list one). */
      past: boolean;
      /** Ends within {@link EXPIRY_SOON_MS}. */
      soon: boolean;
    };

export const EXPIRY_SOON_MS = 30 * 86_400_000;

export function expiryOf(expirations: readonly (string | null)[], now: number): Expiry {
  if (expirations.length === 0) return { kind: "unknown" };
  if (expirations.some((value) => value === null)) return { kind: "never" };
  const times = expirations.map((value) => Date.parse(value as string)).filter((at) => Number.isFinite(at));
  if (times.length === 0) return { kind: "unknown" };
  const at = Math.min(...times);
  return { kind: "at", at, past: at <= now, soon: at > now && at - now <= EXPIRY_SOON_MS };
}

export interface GrantGroup {
  /** `${chainId}|${grantee}`. */
  key: string;
  chainId: string;
  granter: string;
  grantee: string;
  grants: AuthzGrantRow[];
  /** Distinct permissions, fund-moving ones first. */
  permissions: GrantPermission[];
  movesFunds: boolean;
  expiry: Expiry;
  /** Spend caps and validator lists, in words; empty when the grants set none. */
  limits: string[];
}

/** One spend cap: "100 ATOM" for the chain's own coin, base units for anything else. */
export function coinText(coin: Coin, chain: { coinMinimalDenom: string; coinDenom: string; coinDecimals: number } | null): string {
  if (chain && coin.denom === chain.coinMinimalDenom) {
    return `${formatTokenAmount(coin.amount, chain.coinDecimals, { maxFraction: 6 })} ${chain.coinDenom}`;
  }
  const denom = coin.denom.length > 24 ? `${coin.denom.slice(0, 12)}…${coin.denom.slice(-6)}` : coin.denom;
  return `${formatTokenAmount(coin.amount, 0)} ${denom}`;
}

type ChainCoinInfo = (chainId: string) => { coinMinimalDenom: string; coinDenom: string; coinDecimals: number } | null;

function limitTexts(grants: readonly AuthzGrantRow[], chainInfo: ChainCoinInfo): string[] {
  const out = new Set<string>();
  for (const grant of grants) {
    if (grant.spendLimit && grant.spendLimit.length > 0) {
      out.add(`Up to ${grant.spendLimit.map((coin) => coinText(coin, chainInfo(grant.chainId))).join(" + ")}`);
    }
    if (grant.validators && grant.validators.length > 0) {
      out.add(
        grant.validators.length === 1
          ? `Only with ${shortenAddress(grant.validators[0] as string, 14, 4)}`
          : `Only with ${grant.validators.length} listed validators`,
      );
    }
  }
  return [...out];
}

/**
 * Authz grants by (chain, grantee): one row per party that can act for the
 * account, with everything it may do. Fund-moving rows first, then rows
 * that never expire, then by chain.
 */
export function groupAuthz(grants: readonly AuthzGrantRow[], now: number, chainInfo: ChainCoinInfo = () => null): GrantGroup[] {
  const byKey = new Map<string, AuthzGrantRow[]>();
  for (const grant of grants) {
    const key = `${grant.chainId}|${grant.grantee}`;
    const list = byKey.get(key);
    if (list) list.push(grant);
    else byKey.set(key, [grant]);
  }
  const groups: GrantGroup[] = [];
  for (const [key, list] of byKey) {
    const first = list[0] as AuthzGrantRow;
    const seen = new Set<string>();
    const permissions: GrantPermission[] = [];
    for (const grant of list) {
      const permission = grantPermission(grant);
      if (seen.has(permission.label)) continue;
      seen.add(permission.label);
      permissions.push(permission);
    }
    permissions.sort((a, b) => Number(b.movesFunds) - Number(a.movesFunds));
    groups.push({
      key,
      chainId: first.chainId,
      granter: first.granter,
      grantee: first.grantee,
      grants: list,
      permissions,
      movesFunds: permissions.some((permission) => permission.movesFunds),
      expiry: expiryOf(
        list.map((grant) => grant.expiration),
        now,
      ),
      limits: limitTexts(list, chainInfo),
    });
  }
  const neverFirst = (expiry: Expiry) => (expiry.kind === "never" ? 0 : 1);
  return groups.sort(
    (a, b) =>
      Number(b.movesFunds) - Number(a.movesFunds) ||
      neverFirst(a.expiry) - neverFirst(b.expiry) ||
      a.chainId.localeCompare(b.chainId) ||
      a.grantee.localeCompare(b.grantee),
  );
}

export interface FeeGrantGroup {
  key: string;
  chainId: string;
  grantee: string;
  grants: FeeGrantRow[];
  /** "BasicAllowance", "PeriodicAllowance"… */
  allowances: string[];
  /** True when every allowance caps what it may spend. */
  limited: boolean;
  limits: string[];
  /** Messages the allowance is restricted to, when it is (AllowedMsgAllowance). */
  allowedMessages: string[];
  expiry: Expiry;
}

/** Fee allowances by (chain, grantee). */
export function groupFeeGrants(grants: readonly FeeGrantRow[], now: number, chainInfo: ChainCoinInfo = () => null): FeeGrantGroup[] {
  const byKey = new Map<string, FeeGrantRow[]>();
  for (const grant of grants) {
    const key = `${grant.chainId}|${grant.grantee}`;
    const list = byKey.get(key);
    if (list) list.push(grant);
    else byKey.set(key, [grant]);
  }
  return [...byKey.entries()]
    .map(([key, list]) => {
      const first = list[0] as FeeGrantRow;
      const limits = new Set<string>();
      for (const grant of list) {
        if (grant.spendLimit && grant.spendLimit.length > 0) {
          limits.add(`Up to ${grant.spendLimit.map((coin) => coinText(coin, chainInfo(grant.chainId))).join(" + ")}`);
        }
      }
      return {
        key,
        chainId: first.chainId,
        grantee: first.grantee,
        grants: list,
        allowances: [...new Set(list.map((grant) => grant.allowance))],
        limited: list.every((grant) => (grant.spendLimit?.length ?? 0) > 0),
        limits: [...limits],
        allowedMessages: [...new Set(list.flatMap((grant) => grant.allowedMessages ?? []))].map(
          (typeUrl) => MSG_LABEL[typeUrl] ?? typeUrl.split(".").pop() ?? typeUrl,
        ),
        expiry: expiryOf(
          list.map((grant) => grant.expiration),
          now,
        ),
      };
    })
    .sort((a, b) => Number(a.limited) - Number(b.limited) || a.chainId.localeCompare(b.chainId) || a.grantee.localeCompare(b.grantee));
}

export interface SecurityCoverage {
  /** Read in full with nothing found. */
  clean: string[];
  /** Read in full with at least one finding. */
  flagged: string[];
  /** Read, but one of the reads failed: findings may be missing. */
  partial: string[];
  /** Not readable at all. */
  failed: string[];
  /** Chains in scope the wallet shared no address for: not asked. */
  notAsked: string[];
  findings: number;
}

/**
 * What the review covered, so "nothing found" (a clean read) and "could not
 * check" (a failed one) are never the same sentence.
 */
export function securityCoverage(
  review: Pick<SecurityReviewResponse, "authzGrants" | "feeGrants" | "withdrawAddressDiffers" | "checked">,
  skipped: readonly string[] = [],
): SecurityCoverage {
  const withFindings = new Set<string>([
    ...review.authzGrants.map((grant) => grant.chainId),
    ...review.feeGrants.map((grant) => grant.chainId),
    ...review.withdrawAddressDiffers.map((entry) => entry.chainId),
  ]);
  const coverage: SecurityCoverage = { clean: [], flagged: [], partial: [], failed: [], notAsked: [...skipped], findings: 0 };
  for (const check of review.checked) {
    if (check.status === "error") coverage.failed.push(check.chainId);
    else if (check.status === "partial") coverage.partial.push(check.chainId);
    else if (withFindings.has(check.chainId)) coverage.flagged.push(check.chainId);
    else coverage.clean.push(check.chainId);
  }
  const authzParties = new Set(review.authzGrants.map((grant) => `${grant.chainId}|${grant.grantee}`)).size;
  const feeParties = new Set(review.feeGrants.map((grant) => `${grant.chainId}|${grant.grantee}`)).size;
  coverage.findings = authzParties + feeParties + review.withdrawAddressDiffers.length;
  return coverage;
}
