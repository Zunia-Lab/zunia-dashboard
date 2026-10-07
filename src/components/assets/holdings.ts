/**
 * The Assets page's arithmetic: filters, groupings, the summary strip, the
 * concentration and "what moved" analyses, and the holdings CSV.
 *
 * Pure (types, BigInt and arithmetic only) so `node --test` covers it. The
 * page's rules, all honest-number rules of the house:
 *
 * - **Unknown is not small.** "Hide < $1" hides priced positions worth less
 *   than the viewer's floor (one unit of the currency unless they chose
 *   another); an unpriced position has no value to compare and always stays
 *   (it may be worth a lot).
 * - **Unlisted is counted, not dropped.** Tokens nothing names (an unknown
 *   voucher, a local token no registry lists: the usual airdropped spam) are
 *   folded away by default, with their count on screen and one click to show
 *   them (competitive research A2).
 * - **Amounts add up in base units.** A position's total is the BigInt sum of
 *   its four buckets; floats only appear once a price multiplies them.
 * - **Shares are of the priced value**, the only total that exists.
 * - **Idle is the Staking page's idle**: the liquid balance above the fee
 *   reserve, at the chain's actual APR after the median commission, so the
 *   two pages never print two figures for one wallet.
 */

import { stakeable } from "@/components/staking/model";
import { toCsv, type CsvColumn } from "@/components/ui/csv";
import { exactUnits } from "@/lib/activity/analytics";
import { formatFiat } from "@/lib/format";
import { groupAssets, type AssetGroup } from "@/lib/token/holdings";
import { tokenKeywords } from "@/lib/token/text";
import type { TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset, PortfolioChain, PortfolioResponse, UnpricedReason } from "@/lib/token/wire";

export type { AssetGroup };

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

/** The type chips above the table. */
export type AssetTypeFilter = "all" | "native" | "ibc" | "factory" | "staked";

export const ASSET_TYPE_LABELS: Readonly<Record<AssetTypeFilter, string>> = {
  all: "All",
  native: "Native",
  ibc: "IBC",
  factory: "Factory",
  staked: "Staked",
};

/** "Hide < $1": the default floor, in units of the response currency. */
export const SMALL_VALUE = 1;

/**
 * Where a viewer's own floor is kept (a number of currency units; Settings
 * may offer $1 / $10 / $100). Absent or unreadable, the floor is
 * {@link SMALL_VALUE}.
 */
export const SMALL_FLOOR_KEY = "zunia.dashboard.smallFloor";

/** A stored floor as a usable one: a finite positive number, else the default. */
export function smallFloorOf(stored: unknown): number {
  return typeof stored === "number" && Number.isFinite(stored) && stored > 0 ? stored : SMALL_VALUE;
}

/** The floor as the switch and the footer say it: "$1", "$10", "€0.50". */
export function floorText(floor: number, currency: string): string {
  return formatFiat(floor, currency, { precision: Number.isInteger(floor) ? 0 : 2 });
}

/** Most fraction digits an amount ever shows in the holdings views. */
const MAX_AMOUNT_DIGITS = 8;

/**
 * Fraction digits that keep an amount readable at its size and true to its
 * value: two from a thousand up, four from one, and below one enough for
 * three significant figures (at least `minBelowOne`, at most eight). Six
 * fixed digits cut 0.00000364 allBTC to "0.000003", 18% short, so the
 * amount times the price no longer matched the value beside it.
 */
export function amountDigits(whole: number | null, minBelowOne = 6): number {
  if (whole === null || !Number.isFinite(whole)) return minBelowOne;
  const abs = Math.abs(whole);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  if (abs === 0) return minBelowOne;
  return Math.min(MAX_AMOUNT_DIGITS, Math.max(minBelowOne, 2 - Math.floor(Math.log10(abs))));
}

/** {@link amountDigits} for a base-unit amount: its size in whole tokens picks the digits. */
export function baseAmountDigits(base: string | bigint, decimals: number | null, minBelowOne = 6): number {
  const text = typeof base === "bigint" ? base.toString() : base;
  if (decimals === null || !/^\d+$/.test(text)) return minBelowOne;
  return amountDigits(Number(exactUnits(text, decimals)), minBelowOne);
}

/**
 * Nothing names this token: an unknown voucher (`IBC·27BC`) or a local
 * token no registry lists ("Unlisted Neutron token"). Never true for the
 * chain's own coin.
 */
export function isUnlisted(identity: Pick<TokenIdentity, "listed" | "provenance">): boolean {
  return identity.listed === false || identity.provenance === "unknown";
}

/**
 * Listed, but the route it came over is not the asset's canonical one (or
 * not proven to be): priced as nothing, flagged in the table.
 */
export function isUnverifiedRoute(identity: Pick<TokenIdentity, "proven" | "provenance" | "listed">): boolean {
  return !identity.proven && !isUnlisted(identity);
}

function units(text: string): bigint {
  return /^\d+$/.test(text) ? BigInt(text) : BigInt(0);
}

/** Base units across the four buckets (liquid + staked + rewards + unbonding). */
export function rowBaseTotal(row: Pick<PortfolioAsset, "amounts">): bigint {
  const { liquid, staked, rewards, unbonding } = row.amounts;
  return units(liquid) + units(staked) + units(rewards) + units(unbonding);
}

/** Base units that are bonded or on their way out (staked + unbonding). */
export function rowBonded(row: Pick<PortfolioAsset, "amounts">): bigint {
  return units(row.amounts.staked) + units(row.amounts.unbonding);
}

/** How many of the four buckets hold something (a row worth expanding has two or more). */
export function nonZeroBuckets(row: Pick<PortfolioAsset, "amounts">): number {
  const { liquid, staked, rewards, unbonding } = row.amounts;
  return [liquid, staked, rewards, unbonding].filter((amount) => units(amount) > BigInt(0)).length;
}

export function matchesType(row: PortfolioAsset, type: AssetTypeFilter): boolean {
  switch (type) {
    case "all":
      return true;
    case "native":
      return row.identity.kind === "native";
    case "ibc":
      return row.identity.kind === "ibc";
    case "factory":
      return row.identity.kind === "factory";
    case "staked":
      return rowBonded(row) > BigInt(0);
  }
}

/** Ticker, family, aliases, names, chains and denoms, case-insensitive. */
export function matchesQuery(row: PortfolioAsset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return tokenKeywords(row.identity).some((word) => word.toLowerCase().includes(q));
}

export interface RowFilter {
  type: AssetTypeFilter;
  query: string;
  showUnlisted: boolean;
}

export interface FilteredRows {
  rows: PortfolioAsset[];
  /** Unlisted rows left out (only while `showUnlisted` is off and they match the other filters). */
  hiddenUnlisted: number;
  /** The same, counted as assets (one per asset key, however many chains hold it). */
  hiddenUnlistedAssets: number;
}

/** Type, search and the unlisted fold, applied per chain row (before grouping). */
export function filterRows(rows: readonly PortfolioAsset[], filter: RowFilter): FilteredRows {
  const out: PortfolioAsset[] = [];
  const hiddenKeys = new Set<string>();
  let hiddenUnlisted = 0;
  for (const row of rows) {
    if (!matchesType(row, filter.type) || !matchesQuery(row, filter.query)) continue;
    if (!filter.showUnlisted && isUnlisted(row.identity)) {
      hiddenUnlisted += 1;
      hiddenKeys.add(row.identity.key);
      continue;
    }
    out.push(row);
  }
  return { rows: out, hiddenUnlisted, hiddenUnlistedAssets: hiddenKeys.size };
}

/** What the holdings views count: assets (By asset) or per-chain holdings (By chain). */
export type CountUnit = "asset" | "holding";

/**
 * Chip counts per type over the unfiltered rows, unlisted fold applied, in
 * the unit the table shows: assets in "By asset", holdings in "By chain", so
 * a chip and the rows under it never count two different things.
 */
export function typeCounts(rows: readonly PortfolioAsset[], showUnlisted: boolean, unit: CountUnit = "asset"): Record<AssetTypeFilter, number> {
  const types: AssetTypeFilter[] = ["all", "native", "ibc", "factory", "staked"];
  const counts = {} as Record<AssetTypeFilter, number>;
  for (const type of types) {
    const kept = filterRows(rows, { type, query: "", showUnlisted }).rows;
    counts[type] = unit === "asset" ? groupAssets(kept).length : kept.length;
  }
  return counts;
}

/** True when a priced position is under the floor ("Hide < $1"); unpriced never is. */
export function isSmall(value: number | null, floor = SMALL_VALUE): boolean {
  return value !== null && value < floor;
}

/* -------------------------------------------------------------------------- */
/* Groups                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A group's total as exact base units, when every row shares one exponent
 * (the same asset normally does); null otherwise, and the caller falls back
 * to the group's float total.
 */
export function groupBaseTotal(group: Pick<AssetGroup, "rows">): { amount: bigint; decimals: number | null } | null {
  const first = group.rows[0];
  if (!first) return null;
  const decimals = first.identity.decimals;
  if (group.rows.some((row) => row.identity.decimals !== decimals)) return null;
  let amount = BigInt(0);
  for (const row of group.rows) amount += rowBaseTotal(row);
  return { amount, decimals };
}

/** Share of a group (or row) that is staked or unbonding, in percent; null when nothing is held. */
export function bondedShare(rows: readonly Pick<PortfolioAsset, "amounts">[]): number | null {
  let total = BigInt(0);
  let bonded = BigInt(0);
  for (const row of rows) {
    total += rowBaseTotal(row);
    bonded += rowBonded(row);
  }
  if (total === BigInt(0)) return null;
  // Four decimals of a percent, done in integers: base units exceed 2^53.
  return Number((bonded * BigInt(1_000_000)) / total) / 10_000;
}

/** The 24 h price change every row of a group shares (one asset, one price). */
export function groupChange24h(group: Pick<AssetGroup, "price">): number | null {
  return group.price?.change24h ?? null;
}

export function groupChange7d(group: Pick<AssetGroup, "price">): number | null {
  return group.price?.change7d ?? null;
}

/** Groups under "Hide < $1" when it is on; returns how many it hid. */
export function hideSmallGroups(groups: readonly AssetGroup[], hide: boolean, floor = SMALL_VALUE): { groups: AssetGroup[]; hidden: number } {
  if (!hide) return { groups: [...groups], hidden: 0 };
  const kept = groups.filter((group) => !isSmall(group.value, floor));
  return { groups: kept, hidden: groups.length - kept.length };
}

/* -------------------------------------------------------------------------- */
/* Chains                                                                      */
/* -------------------------------------------------------------------------- */

export interface ChainSection {
  chainId: string;
  chainName: string;
  iconUrl: string | null;
  /** Priced value of the rows shown; null when none of them is priced. */
  value: number | null;
  rows: PortfolioAsset[];
}

/**
 * Rows by the chain they sit on, most valuable chain first (unpriced-only
 * chains after, by name), rows inside in the API's order (value, then
 * ticker). Names and icons come from the response's chain list.
 */
export function chainSections(rows: readonly PortfolioAsset[], chains: readonly PortfolioChain[]): ChainSection[] {
  const byId = new Map<string, PortfolioAsset[]>();
  for (const row of rows) {
    const list = byId.get(row.chainId);
    if (list) list.push(row);
    else byId.set(row.chainId, [row]);
  }
  const meta = new Map(chains.map((chain) => [chain.chainId, chain]));
  const sections: ChainSection[] = [];
  for (const [chainId, list] of byId) {
    const chain = meta.get(chainId);
    const priced = list.filter((row) => row.value !== null);
    sections.push({
      chainId,
      chainName: chain?.chainName ?? list[0]?.identity.chainName ?? chainId,
      iconUrl: chain?.iconUrl ?? null,
      value: priced.length > 0 ? priced.reduce((sum, row) => sum + (row.value ?? 0), 0) : null,
      rows: list,
    });
  }
  return sections.sort((a, b) => {
    if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
    if (a.value !== null && b.value === null) return -1;
    if (a.value === null && b.value !== null) return 1;
    return a.chainName.localeCompare(b.chainName);
  });
}

/* -------------------------------------------------------------------------- */
/* Summary strip                                                               */
/* -------------------------------------------------------------------------- */

export interface Mover {
  key: string;
  identity: TokenIdentity;
  /** Percent. */
  change: number;
  value: number;
}

export interface HoldingsSummary {
  /** Priced value of the scope (the response's totals). */
  value: number | null;
  change24hAbs: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  /** Distinct assets (groups) and per-chain rows. */
  assetCount: number;
  holdingCount: number;
  chainCount: number;
  /** Groups without a value, and why (most common reason first). */
  unpricedCount: number;
  /** Of those, tokens nothing lists (folded away in the table by default). */
  unlistedCount: number;
  unpricedReasons: { reason: UnpricedReason; count: number }[];
  /** Largest priced group and its share of the priced total (percent). */
  largest: { group: AssetGroup; share: number } | null;
  /** Best and worst 24 h price change among positions worth at least the floor. */
  best: Mover | null;
  worst: Mover | null;
}

/**
 * The strip above the table. Best and worst only consider positions worth
 * at least `floor` (default one unit of the currency): a dust balance of a
 * token that tripled is noise, not news.
 */
export function summarize(data: Pick<PortfolioResponse, "totals" | "assets">, floor = SMALL_VALUE): HoldingsSummary {
  const groups = groupAssets(data.assets);
  const pricedTotal = groups.reduce((sum, group) => sum + (group.value ?? 0), 0);
  let largest: HoldingsSummary["largest"] = null;
  let best: Mover | null = null;
  let worst: Mover | null = null;
  const reasons = new Map<UnpricedReason, number>();
  let unpricedCount = 0;
  let unlistedCount = 0;
  for (const group of groups) {
    if (group.value === null) {
      unpricedCount += 1;
      if (isUnlisted(group.identity)) unlistedCount += 1;
      const reason = group.unpriced ?? "no-market";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      continue;
    }
    if (pricedTotal > 0 && (!largest || group.value > (largest.group.value ?? 0))) {
      largest = { group, share: (group.value / pricedTotal) * 100 };
    }
    const change = groupChange24h(group);
    if (change === null || group.value < floor) continue;
    const mover = { key: group.key, identity: group.identity, change, value: group.value };
    if (!best || change > best.change) best = mover;
    if (!worst || change < worst.change) worst = mover;
  }
  // One mover is both best and worst: say it once, as whichever it is.
  if (best && worst && best.key === worst.key) {
    if (best.change >= 0) worst = null;
    else best = null;
  }
  return {
    value: data.totals.value,
    change24hAbs: data.totals.change24hAbs,
    change24hPct: data.totals.change24hPct,
    change7dPct: data.totals.change7dPct,
    assetCount: groups.length,
    holdingCount: data.assets.length,
    chainCount: new Set(data.assets.map((row) => row.chainId)).size,
    unpricedCount,
    unlistedCount,
    unpricedReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    largest,
    best,
    worst,
  };
}

/* -------------------------------------------------------------------------- */
/* Analyses                                                                    */
/* -------------------------------------------------------------------------- */

export type ConcentrationLevel = "diversified" | "moderate" | "concentrated";

export interface Concentration {
  /** Herfindahl–Hirschman index over shares as fractions: 1 = one position. */
  hhi: number;
  /** Shares in percent. */
  top1: number;
  top3: number;
  level: ConcentrationLevel;
  /** Positions counted (positive values only). */
  count: number;
}

/**
 * HHI = Σ share². Levels follow the usual antitrust cut-offs (0.15 and 0.25
 * on a 0–1 scale), read here as a description of a portfolio, not advice.
 */
export function concentration(values: readonly number[]): Concentration | null {
  const positive = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => b - a);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const shares = positive.map((value) => value / total);
  const hhi = shares.reduce((sum, share) => sum + share * share, 0);
  const top = (n: number) => shares.slice(0, n).reduce((sum, share) => sum + share, 0) * 100;
  return {
    hhi,
    top1: top(1),
    top3: top(3),
    level: hhi > 0.25 ? "concentrated" : hhi >= 0.15 ? "moderate" : "diversified",
    count: positive.length,
  };
}

export interface Contribution {
  key: string;
  identity: TokenIdentity;
  /** Value change over 24 h at today's amounts, in the response currency. */
  abs: number;
  /** The asset's 24 h price change, percent. */
  pct: number | null;
  value: number | null;
}

/**
 * What moved the scope's value over 24 h: each asset's value change at
 * today's amounts, the largest moves (either way) first. Assets with no
 * 24 h change, or none at all (a stablecoin at par), are left out.
 */
export function contributions(groups: readonly AssetGroup[], limit = 6): Contribution[] {
  return groups
    .filter((group) => group.change24hAbs !== null && group.change24hAbs !== 0)
    .map((group) => ({
      key: group.key,
      identity: group.identity,
      abs: group.change24hAbs as number,
      pct: groupChange24h(group),
      value: group.value,
    }))
    .sort((a, b) => Math.abs(b.abs) - Math.abs(a.abs))
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Staking coverage                                                            */
/* -------------------------------------------------------------------------- */

export interface StakeableAsset {
  key: string;
  chainId: string;
  identity: TokenIdentity;
  row: PortfolioAsset;
  /** Percent of the position that is staked or unbonding. */
  bondedShare: number;
  /** Liquid balance, whole units (null when decimals are unknown). */
  liquid: number | null;
  /** Value of the liquid balance; null when unpriced. */
  liquidValue: number | null;
  /**
   * What is idle: the liquid balance above the fee reserve, base units (the
   * Staking page's "Idle to stake", same reserve). "0" when the reserve takes
   * it all.
   */
  idle: string;
  /** `idle` in whole units (null when decimals are unknown). */
  idleWhole: number | null;
  /** Value of `idle`; null when unpriced. */
  idleValue: number | null;
}

/** Below a cent (or a millionth of a token, unpriced), idle is dust: the fee would eat it. */
export function idleWorthStaking(entry: Pick<StakeableAsset, "idleWhole" | "idleValue">): boolean {
  return entry.idleValue !== null ? entry.idleValue >= 0.01 : (entry.idleWhole ?? 0) >= 1e-6;
}

/**
 * The chain's own staking coin held on that chain (`stakingDenom` names it):
 * the positions where staking is one click away. Most idle value first.
 *
 * Idle follows the Staking page's rule so both pages print one figure: the
 * liquid balance above `reserveOf(chainId, denom)` (base units kept back for
 * three staking transactions' fees; "0" when fees are paid in another coin).
 */
export function stakeableAssets(
  rows: readonly PortfolioAsset[],
  stakingDenom: (chainId: string) => string | undefined,
  reserveOf: (chainId: string, denom: string) => string = () => "0",
): StakeableAsset[] {
  const out: StakeableAsset[] = [];
  for (const row of rows) {
    const { identity } = row;
    if (identity.kind !== "native" || stakingDenom(row.chainId) !== identity.denom) continue;
    const share = bondedShare([row]);
    if (share === null) continue;
    const decimals = identity.decimals;
    const liquid = decimals === null ? null : Number(exactUnits(row.amounts.liquid, decimals));
    const price = row.price?.price ?? null;
    const idle = stakeable(row.amounts.liquid, reserveOf(row.chainId, identity.denom));
    const idleWhole = decimals === null ? null : Number(exactUnits(idle, decimals));
    out.push({
      key: identity.key,
      chainId: row.chainId,
      identity,
      row,
      bondedShare: share,
      liquid,
      liquidValue: liquid !== null && price !== null ? liquid * price : null,
      idle,
      idleWhole,
      idleValue: idleWhole !== null && price !== null ? idleWhole * price : null,
    });
  }
  return out.sort((a, b) => (b.idleValue ?? -1) - (a.idleValue ?? -1));
}

/**
 * What a typical validator pays on a chain, as a fraction: the chain's
 * actual APR after the median commission, the Staking page's rate. Null when
 * either is unknown (a naive APR is not used: it would not match Staking).
 */
export function typicalStakingRate(stats: { apr: { actual: number | null }; medianCommission: number | null } | null | undefined): number | null {
  const apr = stats?.apr.actual ?? null;
  const commission = stats?.medianCommission ?? null;
  if (apr === null || commission === null || !Number.isFinite(apr) || !Number.isFinite(commission)) return null;
  return apr * (1 - commission);
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

export interface HoldingsCsvRow {
  chainId: string;
  chainName: string;
  key: string;
  ticker: string;
  name: string;
  denom: string;
  kind: string;
  listed: boolean;
  proven: boolean;
  decimals: number | null;
  /** "tokens" when the amounts are whole-token decimals, "base units" when decimals are unknown. */
  unit: "tokens" | "base units";
  liquid: string;
  staked: string;
  rewards: string;
  unbonding: string;
  total: string;
  price: number | null;
  value: number | null;
  change24h: number | null;
  priceSource: string | null;
  unpriced: UnpricedReason | null;
}

function amountText(base: string, decimals: number | null): string {
  if (decimals === null || decimals === 0) return /^\d+$/.test(base) ? base : "0";
  return exactUnits(/^\d+$/.test(base) ? base : "0", decimals);
}

/** One CSV row per chain holding, exact amounts (never a float of base units). */
export function holdingsCsvRows(rows: readonly PortfolioAsset[]): HoldingsCsvRow[] {
  return rows.map((row) => {
    const { identity } = row;
    const decimals = identity.decimals;
    return {
      chainId: row.chainId,
      chainName: identity.chainName ?? row.chainId,
      key: identity.key,
      ticker: identity.ticker,
      name: identity.name,
      denom: identity.denom,
      kind: identity.kind,
      listed: !isUnlisted(identity),
      proven: identity.proven,
      decimals,
      unit: decimals === null ? "base units" : "tokens",
      liquid: amountText(row.amounts.liquid, decimals),
      staked: amountText(row.amounts.staked, decimals),
      rewards: amountText(row.amounts.rewards, decimals),
      unbonding: amountText(row.amounts.unbonding, decimals),
      total: amountText(rowBaseTotal(row).toString(), decimals),
      price: row.price?.price ?? null,
      value: row.value,
      change24h: row.price?.change24h ?? null,
      priceSource: row.price ? (row.price.label ?? row.price.source) : null,
      unpriced: row.unpriced ?? null,
    };
  });
}

/**
 * The CSV's first line: a `#` comment saying when, in which currency and for
 * which scope. Commas, quotes and line breaks are stripped so no reader
 * splits it into cells and it can never start a formula.
 */
export function csvHeaderLine(at: number, currency: string, scope: string, count: number): string {
  const when = new Date(at).toISOString().replace("T", " ").slice(0, 16);
  const text = `# Zunia holdings export · ${when} UTC · values in ${currency.toUpperCase()} · scope ${scope} · ${count} holdings · amounts are exact; prices are spot prices at export time`;
  return text.replace(/[",\r\n]+/g, " ");
}

/** The columns of the holdings CSV, prices and values in `currency`. */
function holdingsCsvColumns(currency: string): CsvColumn<HoldingsCsvRow>[] {
  const code = currency.toUpperCase();
  return [
    { header: "Chain ID", value: (row) => row.chainId },
    { header: "Chain", value: (row) => row.chainName },
    { header: "Asset key", value: (row) => row.key },
    { header: "Ticker", value: (row) => row.ticker },
    { header: "Name", value: (row) => row.name },
    { header: "Denom", value: (row) => row.denom },
    { header: "Type", value: (row) => row.kind },
    { header: "Listed", value: (row) => row.listed },
    { header: "Origin proven", value: (row) => row.proven },
    { header: "Decimals", value: (row) => row.decimals },
    { header: "Amount unit", value: (row) => row.unit },
    { header: "Liquid", value: (row) => row.liquid },
    { header: "Staked", value: (row) => row.staked },
    { header: "Rewards", value: (row) => row.rewards },
    { header: "Unbonding", value: (row) => row.unbonding },
    { header: "Total", value: (row) => row.total },
    { header: `Price (${code})`, value: (row) => row.price },
    { header: `Value (${code})`, value: (row) => row.value },
    { header: "24h change (%)", value: (row) => row.change24h },
    { header: "Price source", value: (row) => row.priceSource },
    { header: "Why unpriced", value: (row) => row.unpriced },
  ];
}

/**
 * The whole export: the `#` line saying when, in which currency and for
 * which scope, then one row per chain holding (every holding in scope,
 * whatever the table's filters show).
 */
export function holdingsCsv(rows: readonly PortfolioAsset[], options: { at: number; currency: string; scope: string }): string {
  const csvRows = holdingsCsvRows(rows);
  return `${csvHeaderLine(options.at, options.currency, options.scope, csvRows.length)}\r\n${toCsv(csvRows, holdingsCsvColumns(options.currency))}`;
}
