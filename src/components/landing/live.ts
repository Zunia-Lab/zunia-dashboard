/**
 * What the landing page's live preview shows, worked out from the public
 * `/api/markets` and `/api/chains/stats` answers.
 *
 * Pure (types only from the wire modules), so the rules that keep the
 * preview honest are tested: assets are matched by asset key, never by
 * ticker (Osmosis lists several "USDC"); a chain whose APR cannot be computed
 * is listed with its reason instead of drawn as a zero bar; a third-party
 * APR is flagged so the card can say so.
 */

import type { AprSource, ChainStats } from "@/lib/chain/types";
import type { MarketAsset, MarketSourceStatus } from "@/lib/token/wire";

/** The five assets the hero tracks: the hub, the venue, data availability, home, a DeFi chain. */
export const LIVE_ASSETS: ReadonlyArray<{ key: string; symbol: string; chainId: string }> = [
  { key: "cosmoshub-4:uatom", symbol: "ATOM", chainId: "cosmoshub-4" },
  { key: "osmosis-1:uosmo", symbol: "OSMO", chainId: "osmosis-1" },
  { key: "celestia:utia", symbol: "TIA", chainId: "celestia" },
  { key: "safrochain-1:usaf", symbol: "SAF", chainId: "safrochain-1" },
  { key: "injective-1:inj", symbol: "INJ", chainId: "injective-1" },
];

/** The pinned chains whose actual staking APR the hero compares. */
export const APR_CHAINS: readonly string[] = ["safrochain-1", "cosmoshub-4", "osmosis-1", "celestia", "akashnet-2"];

export interface LiveAssetRow {
  key: string;
  symbol: string;
  chainId: string;
  /** Null when neither market source lists it right now. */
  asset: MarketAsset | null;
}

/** The pieces of a preview row, formatted as the row prints them. */
export interface AssetRowText {
  symbol: string;
  chainName: string;
  /** Where the price comes from when it is not the usual source ("via Coinstore"). */
  note?: string | null;
  price: string;
  /** Null when the source has no 24 h change. */
  change24h: string | null;
  /** Null when the source has no 7-day change. */
  change7d: string | null;
}

/**
 * The accessible name of a preview row (a link to the asset).
 *
 * It repeats the row's visible text in the row's source order, so it holds
 * the label a speech-input user reads off the screen (WCAG 2.5.3). What the
 * row does not print, such as the 24 h period that only the card's subtitle
 * names, goes in parentheses, which label-in-name checks set aside. The 7-day
 * figure comes last: the narrowest phones hide it, and visible text that
 * stops early still matches the start of the name.
 */
export function assetRowLabel({ symbol, chainName, note, price, change24h, change7d }: AssetRowText): string {
  const head = `${symbol} ${chainName}${note ? ` (${note})` : ""}`;
  const day = change24h === null ? "(24-hour change unknown)" : `${change24h} (24 hours)`;
  const week = change7d === null ? "7d (unknown)" : `${change7d} 7d`;
  return `${head}, ${price}, ${day}, ${week}`;
}

/**
 * Which way a change points. The row paints its 7-day line from the 7-day
 * figure printed under it, not from the line's own first and last points:
 * the colour has to agree with the number that explains it, and the two
 * come from different reads (Numia's 7-day change, hourly closes).
 */
export function changeDirection(change: number | null): "up" | "down" | "flat" {
  if (change === null || !Number.isFinite(change) || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

/** The wanted assets in the wanted order, each matched on its asset key. */
export function pickLiveAssets(
  assets: readonly MarketAsset[],
  wanted: ReadonlyArray<{ key: string; symbol: string; chainId: string }> = LIVE_ASSETS,
): LiveAssetRow[] {
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  return wanted.map((row) => ({ ...row, asset: byKey.get(row.key) ?? null }));
}

/**
 * The market sources as one provenance line, e.g. "Numia · Osmosis +
 * Coinstore SAF/USDT", with the oldest read time among the sources that
 * answered (the age of the stalest number on the card).
 */
export function marketProvenance(sources: readonly MarketSourceStatus[]): { label: string; at: number | null } {
  const live = sources.filter((source) => source.ok);
  const label = live.length > 0 ? live.map((source) => source.label).join(" + ") : "No market source answered";
  const times = live.map((source) => source.at).filter((at): at is number => typeof at === "number" && Number.isFinite(at));
  return { label, at: times.length > 0 ? Math.min(...times) : null };
}

export interface AprBar {
  chainId: string;
  chainName: string;
  /** Actual APR before commission, percent units (18.5 means 18.5%). */
  actual: number;
  /** The figure the mint parameters publish, percent units; null when unknown. */
  naive: number | null;
  /** Observed ÷ assumed blocks per year, when the block-time correction applied. */
  factor: number | null;
  source: AprSource | null;
}

export interface AprSummary {
  bars: AprBar[];
  /** Chains without a computable APR, with the server's reason. */
  missing: Array<{ chainId: string; chainName: string; reason: string }>;
  /** Some figure comes from cosmos.directory and must be labelled third-party. */
  thirdParty: boolean;
  /**
   * The chain whose parameters understate its APR the most (faster blocks
   * than the mint assumes), when the gap is worth a sentence (≥ 15%).
   */
  highlight: AprBar | null;
}

/** A gap below this factor is noise on a landing page, not an insight. */
const HIGHLIGHT_FACTOR = 1.15;

const NO_APR = "Not computable from this chain's public data right now";

function percent(fraction: number | null | undefined): number | null {
  return typeof fraction === "number" && Number.isFinite(fraction) ? fraction * 100 : null;
}

/**
 * The tooltip line under a bar: where the figure comes from and how it
 * relates to the published rate. Compared at the precision the card prints
 * (`format`), so it never says "parameters say 4.0%" beside a 4.0% bar.
 */
export function aprDetail(bar: Pick<AprBar, "actual" | "naive" | "source">, format: (percent: number) => string): string {
  if (bar.source === "cosmos.directory") return "Third-party figure (cosmos.directory)";
  if (bar.naive === null) return "No published rate to compare with";
  const published = format(bar.naive);
  return published === format(bar.actual) ? "Same as the published rate" : `Mint parameters say ${published}`;
}

/** Bars for the chains that have an actual APR, in the order asked; the rest with their reason. */
export function aprSummary(chains: readonly ChainStats[]): AprSummary {
  const bars: AprBar[] = [];
  const missing: AprSummary["missing"] = [];
  for (const chain of chains) {
    const actual = percent(chain.apr?.actual);
    if (actual === null || actual < 0) {
      missing.push({
        chainId: chain.chainId,
        chainName: chain.chainName,
        reason: chain.reasons?.apr ?? chain.apr?.note ?? NO_APR,
      });
      continue;
    }
    const factor = chain.apr.blockTimeFactor;
    bars.push({
      chainId: chain.chainId,
      chainName: chain.chainName,
      actual,
      naive: percent(chain.apr.naive),
      factor: typeof factor === "number" && Number.isFinite(factor) ? factor : null,
      source: chain.apr.source,
    });
  }
  const candidates = bars.filter((bar) => bar.naive !== null && bar.factor !== null && bar.factor >= HIGHLIGHT_FACTOR);
  const highlight = candidates.reduce<AprBar | null>((best, bar) => (best === null || (bar.factor ?? 0) > (best.factor ?? 0) ? bar : best), null);
  return { bars, missing, thirdParty: bars.some((bar) => bar.source === "cosmos.directory"), highlight };
}
