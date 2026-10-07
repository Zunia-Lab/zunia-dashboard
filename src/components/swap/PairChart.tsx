"use client";

/**
 * The pair over time, to judge the moment: how much To one From has bought
 * (implied from each token's own fiat price history), with this quote's rate
 * drawn across it, or both tokens indexed to 100 at the start of the range.
 *
 * Implied, not traded: the line divides two price series sampled at the same
 * hour (or day), so it can sit a little off the pools' own rate; the caption
 * says so and the quote line shows where this swap would land. A side with
 * no history leaves the chart empty with that reason, never a flat line.
 */

import { memo, useMemo, useState } from "react";
import { AreaChart, LineChart, stableColorMap, type TickFormatter } from "@/components/charts";
import { Card, CardBody, CardHeader, IconButton, InfoTip, InlineError, Segmented, SourceTag } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { usePriceHistory } from "@/lib/data/prices";
import type { AssetOption } from "@/lib/swap/assets";
import { ratioText } from "@/lib/swap/format";
import { compactRatio, ratioSeries, sampleTolerance, seriesChange, seriesRange } from "./swap-analysis";
import { ageText, liquidityText } from "./swap-view";
import { useTicker } from "./useTicker";

type Range = "1D" | "7D" | "30D";
type View = "rate" | "indexed";

const RANGES: { value: Range; label: string }[] = [
  { value: "1D", label: "24H" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
];

const RANGE_WORDS: Record<Range, string> = { "1D": "24 hours", "7D": "7 days", "30D": "30 days" };

export interface PairChartProps {
  from: AssetOption;
  to: AssetOption;
  /** This quote's own rate (To per From), drawn as a reference line. */
  quoteRate: number | null;
}

function rateText(value: number): string {
  return ratioText(value) ?? "—";
}

const rateTicks: TickFormatter = (value) => ratioText(value) ?? "";

function Figure({ label, value, tone, sub, info, about }: { label: string; value: string; tone?: "pos" | "neg" | null; sub?: string | null; info?: string; about?: string }) {
  return (
    <div className="min-w-0">
      <p className="flex min-w-0 items-center gap-1 text-[11.5px] text-fg-dim">
        <span className="truncate">{label}</span>
        {info ? <InfoTip content={info} label={about ?? `About ${label}`} size={11} /> : null}
      </p>
      <p
        className={cn(
          "truncate text-[14px] font-semibold tabular-nums tracking-[-0.01em]",
          tone === "pos" ? "text-[var(--d-pos)]" : tone === "neg" ? "text-[var(--d-neg)]" : "text-fg",
        )}
      >
        {value}
      </p>
      {sub ? <p className="truncate text-[11px] tabular-nums text-fg-dim">{sub}</p> : null}
    </div>
  );
}

/** Memoised: the page re-renders every second for the quote clock; the chart only when its pair or the quote's rate changes. */
export const PairChart = memo(function PairChart({ from, to, quoteRate }: PairChartProps) {
  const [range, setRange] = useState<Range>("7D");
  const [view, setView] = useState<View>("rate");
  const [table, setTable] = useState(false);
  const now = useTicker(15_000);
  const fromHistory = usePriceHistory(from.identity, range);
  const toHistory = usePriceHistory(to.identity, range);

  const sameAsset = from.identity.key === to.identity.key;
  const fromPoints = fromHistory.data?.points;
  const toPoints = toHistory.data?.points;
  const resolution = fromHistory.data?.resolution === "day" || toHistory.data?.resolution === "day" ? "day" : "hour";

  const ratio = useMemo(
    () => (fromPoints && toPoints ? ratioSeries(fromPoints, toPoints, sampleTolerance(resolution)) : []),
    [fromPoints, toPoints, resolution],
  );
  const series = useMemo(
    () => [
      { id: from.key, label: from.ticker, points: fromPoints ?? [] },
      { id: to.key, label: to.ticker, points: toPoints ?? [] },
    ],
    [from.key, from.ticker, to.key, to.ticker, fromPoints, toPoints],
  );
  const colors = useMemo(() => stableColorMap([from.key, to.key]), [from.key, to.key]);

  const loading = (fromHistory.loading || toHistory.loading) && ratio.length === 0;
  const pending = fromHistory.refreshing || toHistory.refreshing || fromHistory.stale || toHistory.stale;
  const failed = fromHistory.error && !fromHistory.data ? fromHistory : toHistory.error && !toHistory.data ? toHistory : null;
  const missing =
    fromHistory.data && fromHistory.data.points.length < 2
      ? from.ticker
      : toHistory.data && toHistory.data.points.length < 2
        ? to.ticker
        : null;

  const change = seriesChange(ratio);
  const span = seriesRange(ratio);
  const average = ratio.length > 0 ? ratio.reduce((sum, point) => sum + point.v, 0) / ratio.length : null;
  const latestRate = ratio.length > 0 ? (ratio[ratio.length - 1]?.v ?? null) : null;
  const vsAverage = latestRate !== null && average !== null && average > 0 ? (latestRate / average - 1) * 100 : null;
  const fromChange = fromPoints ? seriesChange(fromPoints) : null;
  const toChange = toPoints ? seriesChange(toPoints) : null;
  const sources = [...new Set([fromHistory.data?.label, toHistory.data?.label].filter((label): label is string => Boolean(label)))];
  const incomplete = [fromHistory.data, toHistory.data].some((data) => data && !data.coverage.complete);
  const updatedAt = Math.max(fromHistory.data?.updatedAt ?? 0, toHistory.data?.updatedAt ?? 0) || null;

  const tone = (value: number | null) => (value === null || Math.abs(value) < 0.005 ? null : value > 0 ? "pos" : "neg");

  const title = `${from.ticker} → ${to.ticker}`;
  const empty = missing ? (
    <p className="text-[13px] text-fg-dim">No price history for {missing}: the pair needs both prices.</p>
  ) : (
    <p className="text-[13px] text-fg-dim">No overlapping price history in this range.</p>
  );

  return (
    <Card as="section" aria-labelledby="swap-pair-title">
      {/* A size container, so the controls can be held to the card's width
          (`100cqw`): the kit's header keeps its actions on one unshrinkable
          row, which ran 12 px past a 320 px screen and clipped the table
          toggle. Held to the width, they wrap onto a second row instead. */}
      <div className="@container">
        <CardHeader
          id="swap-pair-title"
          refreshing={pending && ratio.length > 0}
          // The pair as the title (it fits beside the controls on a narrow
          // column); the range, already on its control, goes in the line under it.
          title={title}
          subtitle={
            view === "rate"
              ? `${to.ticker} per ${from.ticker} over ${RANGE_WORDS[range]}, implied from both prices`
              : `Both prices over ${RANGE_WORDS[range]}, indexed to 100`
          }
          actions={
            <div className="flex max-w-[100cqw] flex-wrap items-center justify-end gap-2">
              <Segmented
                ariaLabel="Chart view"
                value={view}
                onChange={setView}
                options={[
                  { value: "rate", label: "Rate" },
                  { value: "indexed", label: "Indexed" },
                ]}
              />
              <Segmented ariaLabel="Range" mono value={range} onChange={setRange} options={RANGES} />
              <IconButton
                label={table ? "Show the chart" : "Show as a table"}
                icon={table ? "trendingUp" : "list"}
                size="sm"
                pressed={table}
                onClick={() => setTable((value) => !value)}
              />
            </div>
          }
        />
      </div>
      <CardBody>
        {sameAsset ? (
          <p className="py-6 text-center text-[13px] text-fg-dim">Both sides are the same asset, so the rate is 1 by definition.</p>
        ) : failed ? (
          <InlineError title="Couldn't load the price history" message={failed.error?.message ?? "The price source did not answer."} onRetry={failed.refetch} />
        ) : view === "rate" ? (
          <AreaChart
            data={ratio}
            height={232}
            label={`${to.ticker} per ${from.ticker}`}
            ariaLabel={`${to.ticker} per ${from.ticker} over ${RANGE_WORDS[range]}, implied from each token's price${change !== null ? `, ${formatPercent(change, { signed: true })}` : ""}`}
            gradient
            baseline={quoteRate}
            baselineLabel="Your quote"
            // The number alone: the series label ("OSMO per USDC.n") names the unit
            // in the tooltip and heads the table column.
            valueFormatter={rateText}
            tickFormatter={rateTicks}
            loading={loading}
            pending={pending}
            empty={empty}
            view={table ? "table" : "chart"}
          />
        ) : (
          <LineChart
            series={series}
            colors={colors}
            indexed
            height={232}
            title={`${from.ticker} and ${to.ticker} price`}
            ariaLabel={`${from.ticker} and ${to.ticker} price over ${RANGE_WORDS[range]}, indexed to 100 at the start`}
            loading={loading}
            pending={pending}
            empty={empty}
            view={table ? "table" : "chart"}
          />
        )}
      </CardBody>
      {!sameAsset && ratio.length > 1 ? (
        // Two columns on a phone, three on a narrow card, one row when it fits.
        <div className="@container border-t border-[var(--d-hairline)] pt-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 @[440px]:grid-cols-3 @[600px]:flex @[600px]:flex-wrap">
            <Figure label={`Rate change, ${RANGES.find((r) => r.value === range)?.label}`} value={change === null ? "—" : formatPercent(change, { signed: true })} tone={tone(change)} />
            <Figure label="Low – high" value={span ? `${compactRatio(span.low) ?? "—"} – ${compactRatio(span.high) ?? "—"}` : "—"} />
            <Figure
              label={`Now vs ${RANGES.find((r) => r.value === range)?.label} average`}
              value={vsAverage === null ? "—" : formatPercent(vsAverage, { signed: true })}
              tone={tone(vsAverage)}
              info={`How much ${to.ticker} one ${from.ticker} buys now, against its average over the range. Above zero, selling ${from.ticker} now gets more than usual.`}
              about="About the rate now against its average"
            />
            <Figure
              label={`${from.ticker} price`}
              value={fromChange === null ? "—" : formatPercent(fromChange, { signed: true, digits: 1 })}
              tone={tone(fromChange)}
              sub={liquidityText(from.liquidity)}
            />
            <Figure
              label={`${to.ticker} price`}
              value={toChange === null ? "—" : formatPercent(toChange, { signed: true, digits: 1 })}
              tone={tone(toChange)}
              sub={liquidityText(to.liquidity)}
            />
          </div>
        </div>
      ) : null}
      {!sameAsset && (sources.length > 0 || incomplete) ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {sources.length > 0 ? <SourceTag source={`${sources.join(" + ")}${updatedAt ? ` · ${ageText(updatedAt, now)}` : ""}`} /> : <span />}
          {incomplete ? <span className="text-[11.5px] text-fg-dim">History is shorter than the range for one side.</span> : null}
        </div>
      ) : null}
    </Card>
  );
});
