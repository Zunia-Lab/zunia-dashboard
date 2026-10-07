/**
 * Synthetic, deterministic data for the chart kit page. Nothing here is a
 * market reading and nothing here may leave /dev: the shapes and magnitudes
 * only resemble Cosmos portfolios (prices of a few cents to a few dollars,
 * a five-figure net worth) so the kit is exercised at realistic scales.
 *
 * Seeded and anchored to a fixed instant so the server render and the
 * browser hydrate the same numbers.
 */

import type { BarDatum, BarListItem, LineSeries, PartDatum, TimePoint } from "@/components/charts";

export const NOW = Date.UTC(2026, 9, 7, 12, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** mulberry32: small, fast, good enough for fake charts. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** A geometric random walk that ends exactly on `end`. */
function walk(end: number, n: number, stepMs: number, vol: number, seed: number, drift = 0): TimePoint[] {
  const r = rng(seed);
  const log = [0];
  for (let i = 1; i < n; i++) log.push(log[i - 1] + drift + vol * gauss(r));
  const shift = Math.log(end) - log[n - 1];
  return log.map((l, i) => ({ t: NOW - (n - 1 - i) * stepMs, v: Math.exp(l + shift) }));
}

export const NET_WORTH = 14_231.58;

export type RangeKey = "24H" | "7D" | "30D" | "90D" | "1Y";
export const RANGES: RangeKey[] = ["24H", "7D", "30D", "90D", "1Y"];

export const NET_WORTH_SERIES: Record<RangeKey, TimePoint[]> = {
  "24H": walk(NET_WORTH, 97, 15 * MINUTE, 0.0042, 11),
  "7D": walk(NET_WORTH, 169, HOUR, 0.0065, 12, 0.0004),
  "30D": walk(NET_WORTH, 181, 4 * HOUR, 0.012, 13, 0.0008),
  "90D": walk(NET_WORTH, 91, DAY, 0.026, 14, 0.002),
  "1Y": walk(NET_WORTH, 366, DAY, 0.031, 15, 0.0012),
};

export interface DemoChain {
  id: string;
  name: string;
  symbol: string;
  /** Icon tint for the fake logo; real pages use chain logos. */
  tint: string;
}

/** The "followed chains" order. The stable colour map is built from this full list. */
export const CHAINS: DemoChain[] = [
  { id: "cosmoshub-4", name: "Cosmos Hub", symbol: "ATOM", tint: "#2e3148" },
  { id: "osmosis-1", name: "Osmosis", symbol: "OSMO", tint: "#5e12a0" },
  { id: "celestia", name: "Celestia", symbol: "TIA", tint: "#7b2bf9" },
  { id: "safrochain-1", name: "Safrochain", symbol: "SAF", tint: "#e2380c" },
  { id: "injective-1", name: "Injective", symbol: "INJ", tint: "#0082fa" },
  { id: "akashnet-2", name: "Akash", symbol: "AKT", tint: "#d3332e" },
  { id: "stargaze-1", name: "Stargaze", symbol: "STARS", tint: "#db2777" },
  { id: "juno-1", name: "Juno", symbol: "JUNO", tint: "#f0827d" },
  { id: "axelar-dojo-1", name: "Axelar", symbol: "AXL", tint: "#1a1a1a" },
  { id: "agoric-3", name: "Agoric", symbol: "BLD", tint: "#bb2b4a" },
];

export const chainName = (id: string) => CHAINS.find((c) => c.id === id)?.name ?? id;

/** Indexed comparison: four assets, prices four orders of magnitude apart. */
export const PRICE_SERIES: LineSeries[] = [
  { id: "cosmoshub-4", label: "ATOM", points: walk(1.79, 31, DAY, 0.034, 21, -0.002) },
  { id: "osmosis-1", label: "OSMO", points: walk(0.0287, 31, DAY, 0.045, 22, -0.004) },
  { id: "celestia", label: "TIA", points: walk(2.41, 31, DAY, 0.04, 23, 0.003) },
  { id: "safrochain-1", label: "SAF", points: walk(0.0123, 31, DAY, 0.055, 24, 0.009) },
];

function additiveWalk(end: number, n: number, stepMs: number, vol: number, seed: number): TimePoint[] {
  const r = rng(seed);
  const v = [0];
  for (let i = 1; i < n; i++) v.push(v[i - 1] + vol * gauss(r));
  const shift = end - v[n - 1];
  return v.map((x, i) => ({ t: NOW - (n - 1 - i) * stepMs, v: x + shift }));
}

/** Staking APR by chain, percent, 90 daily samples. */
export const APR_SERIES: LineSeries[] = [
  { id: "cosmoshub-4", label: "Cosmos Hub", points: additiveWalk(18.6, 91, DAY, 0.09, 31) },
  { id: "osmosis-1", label: "Osmosis", points: additiveWalk(9.7, 91, DAY, 0.07, 32) },
  { id: "celestia", label: "Celestia", points: additiveWalk(10.4, 91, DAY, 0.08, 33) },
];

export const ACTIVITY_TYPES = [
  { id: "transfer", label: "Transfers" },
  { id: "ibc", label: "IBC" },
  { id: "swap", label: "Swaps" },
  { id: "staking", label: "Staking" },
  { id: "gov", label: "Governance" },
];

/** Transactions per day by type, 30 days. Some days are quiet. */
export const ACTIVITY_BY_DAY: BarDatum[] = (() => {
  const r = rng(41);
  const startOfToday = Date.UTC(2026, 9, 7);
  return Array.from({ length: 30 }, (_, i) => {
    const t = startOfToday - (29 - i) * DAY;
    const busy = r() < 0.18 ? 0 : 0.6 + r() * 1.4;
    const n = (k: number) => Math.round(r() * k * busy);
    return {
      x: t,
      values: { transfer: n(5), ibc: n(3), swap: n(4), staking: n(2), gov: r() < 0.12 ? 1 : 0 },
    };
  });
})();

/** Value moved per chain, USD, last 30 days. */
export const FLOWS_BY_CHAIN: BarDatum[] = [
  { x: "cosmoshub-4", label: "Cosmos Hub", values: { sent: 1840, received: 2310 } },
  { x: "osmosis-1", label: "Osmosis", values: { sent: 3120, received: 2650 } },
  { x: "celestia", label: "Celestia", values: { sent: 420, received: 980 } },
  { x: "safrochain-1", label: "Safrochain", values: { sent: 160, received: 610 } },
  { x: "injective-1", label: "Injective", values: { sent: 740, received: 120 } },
  { x: "akashnet-2", label: "Akash", values: { sent: 90, received: 230 } },
];

export const FEES_BY_CHAIN: BarListItem[] = [
  { id: "osmosis-1", label: "Osmosis", value: 4.12, detail: "61 transactions" },
  { id: "cosmoshub-4", label: "Cosmos Hub", value: 2.87, detail: "34 transactions" },
  { id: "celestia", label: "Celestia", value: 1.12, detail: "12 transactions" },
  { id: "injective-1", label: "Injective", value: 0.62, detail: "9 transactions" },
  { id: "akashnet-2", label: "Akash", value: 0.31, detail: "5 transactions" },
  { id: "safrochain-1", label: "Safrochain", value: 0.04, detail: "18 transactions" },
];

export const APR_BY_CHAIN: Array<BarListItem & { symbol: string; tint: string }> = [
  { id: "cosmoshub-4", label: "Cosmos Hub", value: 18.6 },
  { id: "akashnet-2", label: "Akash", value: 14.2 },
  { id: "stargaze-1", label: "Stargaze", value: 12.9 },
  { id: "celestia", label: "Celestia", value: 10.4 },
  { id: "osmosis-1", label: "Osmosis", value: 9.7 },
  { id: "injective-1", label: "Injective", value: 7.3 },
  { id: "juno-1", label: "Juno", value: 5.1 },
].map((item) => {
  const chain = CHAINS.find((c) => c.id === item.id);
  return { ...item, symbol: chain?.symbol ?? "", tint: chain?.tint ?? "#666" };
});

export const ALLOCATION_BY_CHAIN: PartDatum[] = [
  { id: "cosmoshub-4", label: "Cosmos Hub", value: 6120.4 },
  { id: "osmosis-1", label: "Osmosis", value: 3410.12 },
  { id: "celestia", label: "Celestia", value: 1890.33 },
  { id: "safrochain-1", label: "Safrochain", value: 1240.0 },
  { id: "injective-1", label: "Injective", value: 780.25 },
  { id: "akashnet-2", label: "Akash", value: 410.9 },
  { id: "stargaze-1", label: "Stargaze", value: 190.18 },
  { id: "juno-1", label: "Juno", value: 120.4 },
  { id: "axelar-dojo-1", label: "Axelar", value: 69.0 },
];

/** ATOM held per chain, in ATOM: one large share and a few slivers. */
export const ATOM_BY_CHAIN: PartDatum[] = [
  { id: "cosmoshub-4", label: "Cosmos Hub", value: 412.5 },
  { id: "osmosis-1", label: "Osmosis", value: 96.2 },
  { id: "injective-1", label: "Injective", value: 12.4 },
  { id: "akashnet-2", label: "Akash", value: 0.8 },
  { id: "stargaze-1", label: "Stargaze", value: 0.21 },
];

export interface MarketRow {
  symbol: string;
  name: string;
  price: number;
  points: TimePoint[];
}

export const MARKETS: MarketRow[] = [
  { symbol: "ATOM", name: "Cosmos Hub", price: 1.79, points: walk(1.79, 169, HOUR, 0.008, 51, -0.0002) },
  { symbol: "OSMO", name: "Osmosis", price: 0.0287, points: walk(0.0287, 169, HOUR, 0.011, 52, -0.0006) },
  { symbol: "TIA", name: "Celestia", price: 2.41, points: walk(2.41, 169, HOUR, 0.01, 53, 0.0005) },
  { symbol: "INJ", name: "Injective", price: 7.82, points: walk(7.82, 169, HOUR, 0.009, 54, 0.0003) },
  { symbol: "AKT", name: "Akash", price: 0.94, points: walk(0.94, 169, HOUR, 0.012, 55, -0.0008) },
  { symbol: "SAF", name: "Safrochain", price: 0.0123, points: walk(0.0123, 169, HOUR, 0.014, 56, 0.0011) },
  { symbol: "STARS", name: "Stargaze", price: 0.00412, points: walk(0.00412, 169, HOUR, 0.013, 57, -0.0003) },
];

/** Claimable rewards accruing over a week, reset by a claim on day 4. */
export const REWARDS_SERIES: TimePoint[] = Array.from({ length: 169 }, (_, i) => {
  const t = NOW - (168 - i) * HOUR;
  const sinceClaim = i < 80 ? i + 40 : i - 80;
  return { t, v: 0.31 * sinceClaim + 0.4 * Math.sin(i / 9) + 2 };
});

export const YIELD_SERIES: TimePoint[] = walk(1612.4, 91, DAY, 0.012, 61, 0.0009);

/*
 * Edge cases the kit must survive. Daily series here sit on UTC midnights,
 * like price candles, so they also exercise the UTC labelling.
 */

const TODAY_UTC = Date.UTC(2026, 9, 7);

/** A wallet with one snapshot of history. */
export const EDGE_ONE_POINT: TimePoint[] = [{ t: TODAY_UTC, v: 1.79 }];

/** A profit-and-loss line that starts in profit and ends in a loss. */
export const EDGE_PNL: TimePoint[] = (() => {
  const r = rng(71);
  return Array.from({ length: 61 }, (_, i) => ({
    t: TODAY_UTC - (60 - i) * DAY,
    v: 80 - (122.5 * i) / 60 + 14 * gauss(r),
  }));
})();

/** A token priced at a hundred-thousandth of a dollar. */
export const EDGE_TINY: TimePoint[] = walk(0.0000123, 91, DAY, 0.05, 72).map((p, i) => ({
  t: TODAY_UTC - (90 - i) * DAY,
  v: p.v,
}));

/** Market cap by month, in dollars: billions. */
export const EDGE_HUGE: BarDatum[] = Array.from({ length: 12 }, (_, i) => ({
  x: Date.UTC(2025, 10 + i, 1),
  values: { cap: 9.8e9 + i * 0.22e9 + (i % 3) * 0.15e9 },
}));

/** Broken samples (NaN, Infinity) and a series with a single sample. */
export const EDGE_GAPPY: LineSeries[] = [
  {
    id: "cosmoshub-4",
    label: "ATOM",
    points: walk(1.79, 31, DAY, 0.03, 73).map((p, i) => ({
      t: TODAY_UTC - (30 - i) * DAY,
      v: i % 7 === 3 ? Number.NaN : i === 12 ? Number.POSITIVE_INFINITY : p.v,
    })),
  },
  { id: "osmosis-1", label: "OSMO", points: [{ t: TODAY_UTC - 4 * DAY, v: 1.6 }] },
];

/** Thirty quiet days. */
export const EDGE_ALL_ZERO: BarDatum[] = Array.from({ length: 30 }, (_, i) => ({
  x: TODAY_UTC - (29 - i) * DAY,
  values: { transfer: 0 },
}));

/** A stablecoin's week: flat. */
export const EDGE_FLAT: number[] = Array.from({ length: 24 }, () => 1);
