/**
 * "Value of today's holdings over time": today's amounts × each asset's price
 * history, summed on a common grid. An estimate by construction — no chain
 * keeps balance history the dashboard could read — and labelled as one
 * (`estimate: true`, `method`), drawn dashed by the UI.
 *
 * - Assets are grouped by asset key (ATOM on the Hub and on Osmosis is one
 *   series) and charted most valuable first, at most {@link MAX_CHARTED}; the
 *   rest are named in `coverage.missing`, with the share of today's value the
 *   curve does cover (`pricedValueShare`).
 * - An asset without history is left out and named, never counted at zero;
 *   one whose history starts inside the range is held flat at its first price
 *   before that and named in `coverage.partial` (see `series.ts`).
 * - The last point is "now" at spot prices, so the curve ends on the figure
 *   the hero shows for the same assets.
 * - Prices are USD history converted at today's FX rate for EUR/GBP (`note`).
 *
 * Caching: the price series are cached where they are read (30 minutes for
 * hourly series, 6 hours for daily ones, shared by every visitor) and the
 * holdings for 30 s per account, so the curve itself is recomputed per
 * request in milliseconds. It is not cached as a whole on purpose: a curve
 * cached for minutes would keep yesterday's amounts after a transfer while the
 * hero shows today's. Each asset's series may hold the answer for at most
 * {@link SERIES_BUDGET_MS}; a slower one keeps loading into the cache for the
 * next request.
 *
 * Completeness: a charted series that missed the budget, or that every price
 * source failed to serve, is value we know is there but cannot draw — unlike
 * an asset that simply has no history anywhere, which is named in `missing`
 * and left out. When such unknown value is more than
 * {@link MAX_UNAVAILABLE_SHARE} of today's priced value, no curve is returned
 * at all (`HistoryIncomplete`; the route answers 503, "still loading" when a
 * series is only late). The alternative was a curve of the remainder under
 * the hero's full figure: a $10–$14 "net worth" line under $47.20, with highs,
 * lows and a range change computed from it, cached by the browser for minutes.
 */

import "server-only";

import { mapLimit } from "@/lib/server/http";
import { within } from "@/lib/server/prices/deadline";
import { getPriceHistory, type AssetHistory } from "@/lib/server/prices/history";
import { combineHoldings, gridFor, rangeSpec, roundSignificant, type HoldingSeries } from "@/lib/server/prices/series";
import { currencyContext } from "@/lib/server/prices/spot";
import type { FiatCurrency } from "@/lib/token/types";
import {
  PORTFOLIO_HISTORY_METHOD,
  type PortfolioHistoryRange,
  type PortfolioHistoryResponse,
  type UpstreamIssue,
} from "@/lib/token/wire";
import type { PortfolioAccount } from "./accounts";
import { groupHoldings } from "./aggregate";
import { loadPortfolio } from "./load";

/** Series fetched per curve; beyond this the long tail is named, not charted. */
export const MAX_CHARTED = 24;
/** Series read at once. */
const SERIES_CONCURRENCY = 6;
/** How long one asset's price series may hold the answer on a cold cache. */
const SERIES_BUDGET_MS = 12_000;
/**
 * The most of today's priced value a curve may silently lack because its
 * series is late or failed. Above it the curve would misstate the portfolio,
 * so none is drawn.
 */
const MAX_UNAVAILABLE_SHARE = 0.05;

/**
 * Too much of today's value has no readable history right now. `loading` is
 * true when at least one series is merely late (it keeps loading into the
 * cache, so a retry in a few seconds usually succeeds) rather than failed.
 */
export class HistoryIncomplete extends Error {
  constructor(readonly loading: boolean) {
    super(loading ? "Price history is still loading" : "Price history is unavailable right now");
    this.name = "HistoryIncomplete";
  }
}

export async function portfolioHistory(
  accounts: readonly PortfolioAccount[],
  requested: FiatCurrency,
  range: PortfolioHistoryRange,
): Promise<PortfolioHistoryResponse> {
  const [loaded, context] = await Promise.all([loadPortfolio(accounts, "usd"), currencyContext(requested)]);
  const errors: UpstreamIssue[] = [...(loaded.response.errors ?? []), ...context.errors];

  const ranked = groupHoldings(loaded.response.assets);
  const charted = ranked.slice(0, MAX_CHARTED);

  const now = Date.now();
  const spec = rangeSpec(range);
  const grid = gridFor(spec, now);
  // Value whose history exists but could not be read for this answer, and
  // whether any of it is only late.
  let unavailableValue = 0;
  let loading = false;
  const histories = await mapLimit(charted, SERIES_CONCURRENCY, async (group): Promise<AssetHistory | null> => {
    const key = group.identity.key;
    try {
      const read = await within(getPriceHistory(group.identity, range, { now, usdtUsd: loaded.spot.usdtUsd }), SERIES_BUDGET_MS);
      if (!read.done) {
        unavailableValue += group.value;
        loading = true;
        errors.push({ scope: `history:${key}`, message: "Price history is still loading; try again shortly" });
        return null;
      }
      for (const issue of read.value.errors) errors.push({ ...issue, scope: `${issue.scope}:${key}` });
      // Every source failed: the value is unknown, not "no history". A late
      // read that settles as a 429 a few seconds later lands here too, which
      // is why timeouts alone are not the gate.
      if (read.value.history.source === null && read.value.errors.length > 0) unavailableValue += group.value;
      return read.value.history;
    } catch {
      unavailableValue += group.value;
      errors.push({ scope: `history:${key}`, message: "Price history could not be read" });
      return null;
    }
  });

  const pricedValue = loaded.response.totals.pricedValue;
  if (pricedValue > 0 && unavailableValue / pricedValue > MAX_UNAVAILABLE_SHARE) {
    throw new HistoryIncomplete(loading);
  }

  const series: HoldingSeries[] = charted.map((group, index) => ({
    key: group.identity.key,
    units: group.units,
    points: histories[index]?.points ?? [],
  }));
  const combined = combineHoldings(series, grid);
  const skipped = new Set(combined.skipped);
  const inCurve = charted.filter((group) => !skipped.has(group.identity.key));

  const points = combined.points.map((point) => ({ t: point.t, v: roundSignificant(point.v * context.rate, 8) }));
  if (points.length > 0) {
    const nowValue = inCurve.reduce((sum, group) => sum + group.units * group.spot, 0);
    const last = points[points.length - 1];
    if (last && now > last.t) points.push({ t: now, v: roundSignificant(nowValue * context.rate, 8) });
  }

  const coveredValue = inCurve.reduce((sum, group) => sum + group.value, 0);
  const symbolOf = new Map(charted.map((group) => [group.identity.key, group.identity.ticker]));
  const response: PortfolioHistoryResponse = {
    currency: context.currency,
    range,
    resolution: spec.resolution,
    points,
    estimate: true,
    method: PORTFOLIO_HISTORY_METHOD,
    coverage: {
      pricedValueShare: pricedValue > 0 ? Math.min(1, coveredValue / pricedValue) : 0,
      missing: ranked.filter((group) => !inCurve.includes(group)).map((group) => group.identity.key),
      partial: combined.partial.map((entry) => ({
        key: entry.key,
        symbol: symbolOf.get(entry.key) ?? entry.key,
        from: entry.from,
      })),
    },
    updatedAt: now,
  };
  if (context.currencyFallback) response.currencyFallback = context.currencyFallback;
  if (context.currency !== "usd") {
    response.note = `USD price history converted at today's ${context.currency.toUpperCase()} rate`;
  }
  if (errors.length > 0) response.errors = errors;
  return response;
}
