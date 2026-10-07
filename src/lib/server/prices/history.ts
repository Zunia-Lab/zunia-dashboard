/**
 * Price history by token identity, in USD.
 *
 * The source follows the spot rule (`rules.ts`): an exchange market named for
 * the asset (SAF: Coinstore candles), else Numia's chart for the asset's
 * Osmosis denom, else CoinGecko's `market_chart`. A source that fails or has
 * nothing for the range hands over to the next; the answer names the one
 * used and says how far back it reaches (`coverage`), because a young asset
 * (allUSDC: daily history from 2026-08-18) must not be drawn as if it had a
 * year of prices.
 *
 * Hourly up to 7 days (Numia `tf=60`, Coinstore 60-minute candles, CoinGecko
 * ≤ 7 days), daily beyond. Candle closes are stamped at the end of their bar
 * (`parse.ts` `candleClose`), so a grid point never shows a price from after
 * it. The series ends with the newest real price ("now") after the last grid
 * boundary. Caching lives with each source: 30 minutes for hourly series, 6
 * hours for daily ones.
 */

import "server-only";

import { describeUpstreamError } from "@/lib/server/http";
import type { PricePoint, PriceRange, PriceSource, TokenIdentity } from "@/lib/token/types";
import type { PriceHistoryCoverage, UpstreamIssue } from "@/lib/token/wire";
import { coinstoreBars } from "./coinstore";
import { geckoChart, type GeckoDays } from "./coingecko";
import { numiaChart, numiaTokens } from "./numia";
import { barCloses } from "./parse";
import { isSubject, numiaRowFor, SOURCE_LABEL, venueSubjectOf, type PriceSubject } from "./rules";
import {
  DAY_MS,
  HOUR_MS,
  gridFor,
  rangeSpec,
  resampleOnGrid,
  roundSignificant,
  withLatest,
  type Resolution,
} from "./series";
import { subjectOf } from "./spot";

export interface AssetHistory {
  /** USD, on the range grid (starting where the data does), then the newest price. */
  points: PricePoint[];
  source: PriceSource | null;
  label: string | null;
  resolution: Resolution;
  coverage: PriceHistoryCoverage;
}

/**
 * One day more than the range where the API allows it: CoinGecko's window
 * starts at "now − N days" to the minute, so an exact N leaves the first grid
 * point without a price and the asset would read as partial history.
 */
const GECKO_DAYS: Readonly<Record<PriceRange, GeckoDays>> = {
  "1D": 2,
  "7D": 8,
  "30D": 31,
  "90D": 91,
  "1Y": 365,
};

interface Attempt {
  source: PriceSource;
  label: string;
  load: () => Promise<PricePoint[]>;
}

function attemptsFor(subject: PriceSubject, range: PriceRange, hourly: boolean, usdtUsd: number | null): Attempt[] {
  const attempts: Attempt[] = [];
  const exchange = subject.exchange;
  if (exchange) {
    attempts.push({
      source: "coinstore",
      label: `${exchange.name} ${exchange.pair}`,
      load: async () => {
        const candles = await coinstoreBars(exchange.market, hourly ? "60min" : "1day");
        // Clamped to the read time: the bar still forming closed "then", not now.
        return barCloses(candles.bars, hourly ? HOUR_MS : DAY_MS, candles.at, usdtUsd ?? 1);
      },
    });
  }
  attempts.push({
    source: "numia",
    label: SOURCE_LABEL.numia,
    load: async () => {
      // By denom: unambiguous. The deepest of the asset's Osmosis markets (the
      // one its spot price comes from), or for a symbol-matched asset the one
      // row its unique symbol matched. A market the spot rule refuses (a pool
      // too thin to quote anything) is not charted either: the next source
      // is. Only when the list itself cannot be read, the first denom.
      let denom: string | null;
      try {
        denom = numiaRowFor(subject, (await numiaTokens()).index)?.denom ?? null;
      } catch {
        denom = subject.osmosisDenoms[0] ?? null;
      }
      return denom ? numiaChart(denom, hourly ? 60 : 1440) : [];
    },
  });
  if (subject.coinGeckoId) {
    const id = subject.coinGeckoId;
    attempts.push({ source: "coingecko", label: SOURCE_LABEL.coingecko, load: () => geckoChart(id, GECKO_DAYS[range]) });
  }
  return attempts;
}

export interface HistoryOptions {
  now?: number;
  usdtUsd?: number | null;
  /**
   * For a market view (asset page, price chart): when the pricing rule
   * refuses the identity, chart the exact Osmosis denom's own market instead
   * (`venueSubjectOf`). Never set when valuing holdings.
   */
  market?: boolean;
}

/**
 * The subject a history is read for: the pricing rule's, or with `market`
 * the identity's own Osmosis market. Null when neither applies.
 */
function historySubjectOf(identity: TokenIdentity, market = false): PriceSubject | null {
  const subject = subjectOf(identity);
  if (isSubject(subject)) return subject;
  return market ? venueSubjectOf(identity) : null;
}

/** USD history of what `identity` may be priced as; empty (source null) when it may not be priced. */
export async function getPriceHistory(
  identity: TokenIdentity,
  range: PriceRange,
  options: HistoryOptions = {},
): Promise<{ history: AssetHistory; errors: UpstreamIssue[] }> {
  const now = options.now ?? Date.now();
  const spec = rangeSpec(range);
  const grid = gridFor(spec, now);
  const empty: AssetHistory = {
    points: [],
    source: null,
    label: null,
    resolution: spec.resolution,
    coverage: { from: null, to: null, points: 0, complete: false },
  };
  const subject = historySubjectOf(identity, options.market === true);
  if (!subject) return { history: empty, errors: [] };
  const errors: UpstreamIssue[] = [];
  for (const attempt of attemptsFor(subject, range, spec.resolution === "hour", options.usdtUsd ?? null)) {
    let raw: PricePoint[];
    try {
      raw = await attempt.load();
    } catch (error) {
      errors.push({ scope: `history:${attempt.source}`, message: describeUpstreamError(error) });
      continue;
    }
    const points = withLatest(resampleOnGrid(raw, grid), raw, grid, now).map((point) => ({
      t: point.t,
      v: roundSignificant(point.v),
    }));
    if (points.length === 0) continue;
    const first = points[0] as PricePoint;
    // The newest real price, not the grid end it was carried forward to: a
    // market that stopped trading days ago must not read as current.
    const lastRaw = raw.filter((point) => point.t <= now).at(-1)?.t ?? first.t;
    return {
      history: {
        points,
        source: attempt.source,
        label: attempt.label,
        resolution: spec.resolution,
        coverage: {
          from: first.t,
          to: lastRaw,
          points: points.length,
          complete: first.t <= (grid[0] ?? 0),
        },
      },
      errors,
    };
  }
  return { history: empty, errors };
}
