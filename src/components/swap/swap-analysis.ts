/**
 * The figures the swap page's analysis computes: what a swap costs against
 * market prices and line by line, what the wallet can swap, the rate past
 * swaps gave, and the pair's implied rate history for the chart.
 *
 * Everything here is an estimate read from real figures (router percentages,
 * market prices, on-chain movements), labelled as such where it is drawn.
 *
 * Pure: no React, no network, no storage, no clock.
 */

import type { TimePoint } from "@/components/charts/series";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import type { ActivityItem } from "@/lib/activity/types";
import { formatNumber } from "@/lib/format";
import type { AssetOption } from "@/lib/swap/assets";
import { displayValue, sellStanding } from "./swap-view";

const VENUE = SWAP_VENUE_CHAIN_ID;
const ZERO = BigInt(0);

/* -------------------------------------------------------------------------- *
 * The whole swap against market prices
 * -------------------------------------------------------------------------- */

export interface AllInCost {
  /** What is spent (the Zunia fee included), at the From's market price. */
  readonly payValue: number;
  /** What the swap pays, at the To's market price. */
  readonly receiveValue: number;
  /** `receiveValue - payValue`: negative is what the swap costs. */
  readonly difference: number;
  /** The same in percent of `payValue`. */
  readonly percent: number;
}

/**
 * The whole swap against market prices: what is received, valued at the
 * To's price, against everything spent, valued at the From's. It bundles the
 * Zunia fee, the pools' spread, Osmosis's taker fee, price impact and any gap
 * between the pools and the price source, so it is an estimate and is shown
 * as one. `null` without both prices and exponents.
 */
export function allInCost(args: {
  readonly spentUnits: bigint | string;
  readonly fromDecimals: number | null;
  readonly fromPrice: number | null | undefined;
  readonly receivedUnits: bigint | string;
  readonly toDecimals: number | null;
  readonly toPrice: number | null | undefined;
}): AllInCost | null {
  const spent = displayValue(args.spentUnits, args.fromDecimals);
  const received = displayValue(args.receivedUnits, args.toDecimals);
  if (spent === null || received === null || !(spent > 0)) return null;
  if (args.fromPrice === null || args.fromPrice === undefined || !(args.fromPrice > 0)) return null;
  if (args.toPrice === null || args.toPrice === undefined || !(args.toPrice > 0)) return null;
  const payValue = spent * args.fromPrice;
  const receiveValue = received * args.toPrice;
  return { payValue, receiveValue, difference: receiveValue - payValue, percent: (receiveValue / payValue - 1) * 100 };
}

/* -------------------------------------------------------------------------- *
 * What the swap costs, line by line
 * -------------------------------------------------------------------------- */

export type CostId = "zunia" | "taker" | "spread" | "impact" | "network";

/** The order the lines are listed in (and the colour slots they hold). */
export const COST_IDS: readonly CostId[] = ["zunia", "taker", "spread", "impact", "network"];

export interface CostLine {
  readonly id: CostId;
  /** Percent of what is paid in all (the Zunia fee included); `null` when not known. Negative: in your favour. */
  readonly percent: number | null;
  /** The same in the prices' currency; `null` without a price. */
  readonly value: number | null;
}

export interface CostBreakdown {
  readonly lines: readonly CostLine[];
  /** Sum of the known lines, percent of what is paid. */
  readonly totalPercent: number;
  /** Sum of the known lines in currency; `null` when the token sold has no price. */
  readonly totalValue: number | null;
  /** Lines with no figure (not reported by the router, or the network fee not measured yet). */
  readonly missing: readonly CostId[];
  /**
   * What the all-in figure holds beyond these costs: where the pools' own
   * price sits against the market price source, percent of what is paid
   * (positive: the pools pay more than the market price). `null` without an
   * all-in figure, or while one of the swap's own costs is unknown (the gap
   * would silently absorb it).
   */
  readonly marketGap: number | null;
}

function ratio(part: bigint, whole: bigint): number | null {
  if (whole <= ZERO) return null;
  // Six decimals of a percent, from integers: exact for any token size.
  return Number((part * BigInt(100_000_000)) / whole) / 1_000_000;
}

function units(value: bigint | string): bigint | null {
  if (typeof value === "bigint") return value;
  return /^\d+$/.test(value) ? BigInt(value) : null;
}

/**
 * Every cost of a quote as a share of what is paid in all, and its value at
 * the token sold's market price:
 * - the Zunia fee: exact, taken from the amount entered;
 * - Osmosis's taker fee, the pools' spread and the price impact: the
 *   router's percentages of the amount swapped (after the Zunia fee),
 *   rescaled to the amount paid;
 * - the network fee: its measured value against the amount paid.
 *
 * The router's three figures are estimates and are valued at the market
 * price, so the lines are labelled as such where they are drawn. Against the
 * all-in figure (what is received at market prices against what is paid), the
 * difference left over is the pools' price against the market source:
 * `marketGap`. The network fee is not part of the all-in figure, so it is
 * left out of that difference.
 */
export function costBreakdown(args: {
  /** Base units paid in all (the Zunia fee included). */
  readonly spentUnits: bigint | string;
  /** Base units swapped (`quote.amountIn`, the amount net of the Zunia fee). */
  readonly netUnits: bigint | string;
  /** Base units of the Zunia fee. */
  readonly feeUnits: bigint | string;
  readonly fromDecimals: number | null;
  /** Market price of one whole token sold; `null` when unpriced. */
  readonly fromPrice: number | null;
  /** Router figures, percent of the amount swapped. */
  readonly takerPercent: number | null;
  readonly spreadPercent: number | null;
  readonly impactPercent: number | null;
  /** The measured network fee in currency; `null` when not measured or unpriced. */
  readonly networkValue: number | null;
  /** `allInCost(...).percent`, when both prices are known. */
  readonly allInPercent: number | null;
}): CostBreakdown | null {
  const spent = units(args.spentUnits);
  const net = units(args.netUnits);
  const fee = units(args.feeUnits);
  if (spent === null || net === null || fee === null || spent <= ZERO) return null;
  const netShare = (ratio(net, spent) ?? 0) / 100;
  const spentDisplay = displayValue(spent, args.fromDecimals);
  const price = args.fromPrice !== null && Number.isFinite(args.fromPrice) && args.fromPrice > 0 ? args.fromPrice : null;
  const payValue = spentDisplay !== null && price !== null ? spentDisplay * price : null;
  const valueOf = (percent: number | null) => (percent === null || payValue === null ? null : (payValue * percent) / 100);
  const router = (percent: number | null) => (percent === null || !Number.isFinite(percent) ? null : percent * netShare);

  const zunia = ratio(fee, spent);
  const taker = router(args.takerPercent);
  const spread = router(args.spreadPercent);
  const impact = router(args.impactPercent);
  const network =
    args.networkValue !== null && Number.isFinite(args.networkValue) && payValue !== null && payValue > 0
      ? (args.networkValue / payValue) * 100
      : null;
  const lines: CostLine[] = [
    { id: "zunia", percent: zunia, value: valueOf(zunia) },
    { id: "taker", percent: taker, value: valueOf(taker) },
    { id: "spread", percent: spread, value: valueOf(spread) },
    { id: "impact", percent: impact, value: valueOf(impact) },
    // Measured in the fee token: its value stands even when the token sold has no price.
    { id: "network", percent: network, value: args.networkValue !== null && Number.isFinite(args.networkValue) ? args.networkValue : null },
  ];
  const known = lines.filter((line) => line.percent !== null);
  const totalPercent = known.reduce((sum, line) => sum + (line.percent ?? 0), 0);
  const totalValue = payValue === null ? null : known.reduce((sum, line) => sum + (line.value ?? 0), 0);
  const missing = lines.filter((line) => line.percent === null).map((line) => line.id);
  const swapCosts = [zunia, taker, spread, impact];
  const marketGap =
    args.allInPercent !== null && Number.isFinite(args.allInPercent) && swapCosts.every((cost) => cost !== null)
      ? args.allInPercent + swapCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
      : null;
  return { lines, totalPercent, totalValue, missing, marketGap };
}

/* -------------------------------------------------------------------------- *
 * What the wallet can swap (the page's figures strip)
 * -------------------------------------------------------------------------- */

export interface SwappableGroup {
  /** Rows in the group. */
  readonly count: number;
  /** Sum of the priced rows' value; `null` when none is priced. */
  readonly value: number | null;
  /** Rows without a value. */
  readonly unpriced: number;
}

export interface SwappableSummary {
  /** Liquid balances whose token Zunia's list of Osmosis tokens includes. */
  readonly tradable: SwappableGroup;
  /** …of which already on Osmosis (one transaction). */
  readonly onVenue: SwappableGroup;
  /** …of which on other chains (the contract, or a move first). */
  readonly elsewhere: SwappableGroup & { readonly chains: number };
  /**
   * Balances outside that list, most valuable first:
   * - `notTraded`: nothing on Osmosis is this token, so it cannot be swapped here;
   * - `unlisted`: Osmosis has it but the list leaves it out (a thin or
   *   unverified market): a quote may still come back, usually with a high
   *   price impact, so these are not called unswappable.
   */
  readonly notListed: SwappableGroup & { readonly tickers: readonly string[]; readonly notTraded: number; readonly unlisted: number };
}

function group(rows: readonly AssetOption[], valueOf: (option: AssetOption) => number | null): SwappableGroup {
  let value: number | null = null;
  let unpriced = 0;
  for (const row of rows) {
    const worth = valueOf(row);
    if (worth === null || !Number.isFinite(worth)) unpriced += 1;
    else value = (value ?? 0) + worth;
  }
  return { count: rows.length, value, unpriced };
}

/**
 * The sell list read as "what can I swap": by standing on the venue
 * (`sellStanding`) and by where the balance sits. Only meaningful once the
 * venue's listing has loaded (`listed` not `null`).
 */
export function swappableSummary(
  sell: readonly AssetOption[],
  listed: ReadonlySet<string> | null,
  valueOf: (option: AssetOption) => number | null,
): SwappableSummary {
  const standing = new Map(sell.map((option) => [option.key, sellStanding(option, listed)] as const));
  const tradable = sell.filter((option) => standing.get(option.key) === "tradable");
  const notListed = sell.filter((option) => standing.get(option.key) !== "tradable");
  const onVenue = tradable.filter((option) => option.chainId === VENUE);
  const elsewhere = tradable.filter((option) => option.chainId !== VENUE);
  const byWorth = [...notListed].sort((a, b) => (valueOf(b) ?? -1) - (valueOf(a) ?? -1));
  const notTraded = notListed.filter((option) => standing.get(option.key) === "not-traded").length;
  return {
    tradable: group(tradable, valueOf),
    onVenue: group(onVenue, valueOf),
    elsewhere: { ...group(elsewhere, valueOf), chains: new Set(elsewhere.map((option) => option.chainId)).size },
    notListed: {
      ...group(notListed, valueOf),
      tickers: [...new Set(byWorth.map((option) => option.ticker))],
      notTraded,
      unlisted: notListed.length - notTraded,
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Past swaps
 * -------------------------------------------------------------------------- */

/** What a past swap paid, read from what moved on chain. */
export interface ExecutedRate {
  readonly fromTicker: string;
  readonly toTicker: string;
  /** Asset keys, for today's prices. */
  readonly fromKey: string;
  readonly toKey: string;
  /** To received per From sent, display units, every fee the account paid in the token sold included. */
  readonly rate: number;
}

/**
 * The rate a successful swap gave: what came in over what went out, when one
 * token left and one arrived with known exponents. A Zunia fee paid in the
 * token sold left in the same transaction, so it is inside the rate (what
 * the swap really cost); `null` for anything else (a failure, a multi-token
 * move, unknown decimals).
 */
export function executedRate(item: Pick<ActivityItem, "kind" | "success" | "amounts">): ExecutedRate | null {
  if (item.kind !== "swap" || !item.success) return null;
  const sent = item.amounts.filter((amount) => amount.direction === "out");
  const got = item.amounts.filter((amount) => amount.direction === "in");
  const out = sent[0];
  const back = got[0];
  if (sent.length !== 1 || got.length !== 1 || !out || !back) return null;
  const spent = displayValue(out.amount, out.identity.decimals);
  const received = displayValue(back.amount, back.identity.decimals);
  if (spent === null || received === null || !(spent > 0) || !(received > 0)) return null;
  return {
    fromTicker: out.identity.ticker,
    toTicker: back.identity.ticker,
    fromKey: out.identity.key,
    toKey: back.identity.key,
    rate: received / spent,
  };
}

/* -------------------------------------------------------------------------- *
 * The pair chart: an implied rate from two price histories
 * -------------------------------------------------------------------------- */

/** How far apart two samples may be and still count as the same moment. */
export function sampleTolerance(resolution: "hour" | "day"): number {
  return resolution === "hour" ? 45 * 60_000 : 18 * 3_600_000;
}

/**
 * How much To one From bought over time, from each token's own fiat price
 * history: for every From sample, the To sample nearest in time (within
 * `toleranceMs`), divided. Samples with no partner or a non-positive price
 * are skipped, never interpolated.
 */
export function ratioSeries(from: readonly TimePoint[], to: readonly TimePoint[], toleranceMs: number): TimePoint[] {
  const partners = [...to].filter((point) => Number.isFinite(point.v) && point.v > 0).sort((a, b) => a.t - b.t);
  if (partners.length === 0) return [];
  const out: TimePoint[] = [];
  let j = 0;
  for (const point of [...from].sort((a, b) => a.t - b.t)) {
    if (!Number.isFinite(point.v) || point.v <= 0) continue;
    while (j + 1 < partners.length && Math.abs((partners[j + 1]?.t ?? Infinity) - point.t) <= Math.abs((partners[j]?.t ?? Infinity) - point.t)) {
      j += 1;
    }
    const partner = partners[j];
    if (!partner || Math.abs(partner.t - point.t) > toleranceMs) continue;
    out.push({ t: point.t, v: point.v / partner.v });
  }
  return out;
}

/** First to last, in percent; `null` with fewer than two points or a non-positive start. */
export function seriesChange(points: readonly TimePoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0]?.v;
  const last = points[points.length - 1]?.v;
  if (first === undefined || last === undefined || !(first > 0)) return null;
  return (last / first - 1) * 100;
}

/** Lowest and highest value; `null` when empty. */
export function seriesRange(points: readonly TimePoint[]): { readonly low: number; readonly high: number } | null {
  if (points.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const point of points) {
    if (point.v < low) low = point.v;
    if (point.v > high) high = point.v;
  }
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : null;
}

/**
 * A rate with `digits` significant figures, grouped, never in exponent
 * notation: `0.01968`, `50.66`, `2,801`. For axis-like summaries (low / high);
 * the quote's own rate keeps its full precision elsewhere.
 */
export function compactRatio(value: number, digits = 4): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const magnitude = Math.floor(Math.log10(value));
  const decimals = Math.max(0, Math.min(12, digits - 1 - magnitude));
  return formatNumber(value, { maxFraction: decimals });
}
