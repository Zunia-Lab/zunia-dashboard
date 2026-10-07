"use client";

/**
 * The Overview hero: net worth for the scope, its 24 h and 7 d moves, and
 * the value of today's holdings over a chosen range.
 *
 * The curve is an estimate and is drawn as one (dashed, captioned "Today's
 * holdings at past prices"): public nodes keep current balances, not past
 * ones, so the server prices today's amounts at each past date. Moving the
 * cursor over it puts that date's value in the hero figure, the way a price
 * chart does; the caption gives the range's change, high and low, and says
 * how much of today's value the curve covers when some assets have no price
 * history.
 *
 * A curve that stands for too little of today's value is not drawn at all
 * (`historyReadiness`): on a cold server cache the main assets' series can
 * miss the route's time budget, and a curve of the dust that answered first
 * would put "$0.0006, −17% over 30D" next to a $46.80 net worth. The card
 * shows a loading chart instead and asks again a few seconds later, when the
 * server has those series cached.
 */

import { useEffect, useState } from "react";
import { AreaChart, StackedBar, Swatch, type TimePoint } from "@/components/charts";
import {
  Badge,
  BigNumber,
  Card,
  ChainLogo,
  Delta,
  IconButton,
  InfoTip,
  InlineError,
  LogoStack,
  Money,
  PartialDataBadge,
  RelativeTime,
  Segmented,
  Skeleton,
  Spinner,
  useIsPhone,
  useNow,
} from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";
import {
  usePortfolioHistory,
  type PortfolioHistoryRange,
  type PortfolioHistoryResponse,
  type PortfolioState,
} from "@/lib/data/portfolio";
import { formatDate, formatPercent } from "@/lib/format";
import type { ApiState } from "@/lib/useApi";
import { useStoredValue } from "@/lib/useStoredValue";
import {
  TYPE_COLORS,
  allocationByType,
  bucketsBySize,
  coverageShareText,
  coverageText,
  historyReadiness,
  seriesChange,
  seriesExtent,
  unpricedByType,
  unreadByType,
  type TypeBucket,
} from "./model";
import { useMoneyFormatters } from "./useFormatters";

type HeroRange = "24H" | "7D" | "30D" | "90D" | "1Y";

const RANGES: { value: HeroRange; label: string; api: PortfolioHistoryRange; ariaLabel: string }[] = [
  { value: "24H", label: "24H", api: "1D", ariaLabel: "Last 24 hours" },
  { value: "7D", label: "7D", api: "7D", ariaLabel: "Last 7 days" },
  { value: "30D", label: "30D", api: "30D", ariaLabel: "Last 30 days" },
  { value: "90D", label: "90D", api: "90D", ariaLabel: "Last 90 days" },
  { value: "1Y", label: "1Y", api: "1Y", ariaLabel: "Last year" },
];

const RANGE_KEY = "zunia.dashboard.overview.range";

/** How soon to ask again while some price series are still loading on the server. */
const REASK_MS = 5_000;
/** Early asks per range and scope before the card leaves it to the regular 5-minute poll. */
const REASK_LIMIT = 6;

export interface ScopeInfo {
  /** The rail's chain, or null for every followed chain of the slice. */
  selected: ChainEntry | null;
  /** Chains the scope reads. */
  chains: readonly ChainEntry[];
  /** Back to "All chains". */
  clear: () => void;
}

/**
 * Asks for the history again a few seconds after an answer that left series
 * out because they were still loading: the server keeps reading them past
 * its budget and caches them, so the next answer is usually whole, while the
 * hook's own poll would wait five minutes (and its five-minute dedupe would
 * paint the same answer again from localStorage after a reload).
 *
 * One ask per settled request, never while one is in flight, so a slow
 * request is not counted twice; at most {@link REASK_LIMIT} per range and
 * scope, so an upstream that stays slow is not asked every few seconds for
 * as long as the tab is open. Returns whether it is still trying: the card
 * shows a loading chart meanwhile, and says so plainly once it stops.
 */
function useHistoryReask(history: ApiState<PortfolioHistoryResponse>, seriesLoading: boolean, key: string): boolean {
  const [asked, setAsked] = useState<{ key: string; count: number }>({ key, count: 0 });
  // A whole answer ends the episode: a later partial one starts afresh.
  // (React's "adjust state while rendering" pattern, guarded so it settles.)
  if (!seriesLoading && asked.count !== 0) setAsked({ key, count: 0 });
  const count = asked.key === key ? asked.count : 0;
  const canAsk = seriesLoading && count < REASK_LIMIT;
  const { refetch, refreshing } = history;
  useEffect(() => {
    if (!canAsk || refreshing) return;
    const id = window.setTimeout(() => {
      setAsked({ key, count: count + 1 });
      refetch();
    }, REASK_MS);
    return () => window.clearTimeout(id);
  }, [canAsk, refreshing, key, count, refetch]);
  return seriesLoading && (canAsk || refreshing);
}

export function NetWorthCard({ state, scope }: { state: PortfolioState; scope: ScopeInfo }) {
  const [storedRange, setRange] = useStoredValue<HeroRange>(RANGE_KEY, "30D");
  const range = RANGES.some((r) => r.value === storedRange) ? storedRange : "30D";
  const api = RANGES.find((r) => r.value === range)?.api ?? "30D";
  const history = usePortfolioHistory(api);
  const [active, setActive] = useState<TimePoint | null>(null);
  const [table, setTable] = useState(false);
  const phone = useIsPhone();
  const now = useNow();

  const data = state.data;
  const currency = data?.currency ?? "usd";
  // The curve is formatted in its own answer's currency: the two reads can
  // differ for a moment after a currency switch, or when only one fell back
  // to USD.
  const fmt = useMoneyFormatters(history.data?.currency ?? currency);
  const totals = data?.totals;
  const loading = state.loading;
  const failed = state.status === "error" && !data;
  const unpricedOnly = totals?.value === null;

  // Whether the curve may stand next to the hero figure at all. Withheld,
  // it is neither drawn nor summarised (start, high, low, change) nor
  // hoverable: its points are dropped here, so nothing below can read them.
  const readiness = historyReadiness(history.data);
  const seriesLoading = readiness.loading.length > 0;
  const reasking = useHistoryReask(history, seriesLoading, `${api}|${state.accounts.param ?? ""}`);
  const withheld = !readiness.usable;
  const points = withheld ? [] : (history.data?.points ?? []);
  // The hovered date, read back from the points on screen: a point from an
  // answer since replaced (or withheld) never lingers in the hero figure.
  const hovered = active ? (points.find((point) => point.t === active.t) ?? null) : null;
  const change = seriesChange(points);
  const extent = seriesExtent(points);
  const first = points[0];
  const fromStart = hovered && first && first.v > 0 ? ((hovered.v - first.v) / first.v) * 100 : null;
  const shown = hovered?.v ?? totals?.value ?? null;
  // A new scope: the previous scope's figure stays until the new one lands,
  // dimmed and with the card's refetch spinner (the kit's CardHeader cue).
  const stale = state.stale;

  const caption = withheld
    ? seriesLoading && reasking
      ? "Price history is still loading"
      : null
    : [history.data ? coverageText(history.data) : null, history.data?.note].filter(Boolean).join(" · ") || null;
  const empty = unpricedOnly
    ? "Nothing priced to chart: the assets held here have no market price."
    : withheld && seriesLoading
      ? "Price history is taking longer than usual to load. The chart refreshes every few minutes."
      : withheld && readiness.share > 0
        ? `Too little to chart: price history covers ${coverageShareText(readiness.share)} of today's value.`
        : "No price history for this range yet.";

  return (
    <Card variant="hero" as="section" pending={stale} className="h-full gap-4" aria-labelledby="overview-net-worth">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h2 id="overview-net-worth" className="shrink-0 text-[length:var(--d-type-card-title)] font-medium tracking-[-0.015em] text-fg">
            Net worth
          </h2>
          <ScopeChip scope={scope} />
          <PartialDataBadge errors={data?.errors} />
          {stale ? (
            <>
              <Spinner size={12} className="text-fg-dim" />
              <span className="sr-only">Refreshing</span>
            </>
          ) : null}
        </div>
        {/* Without balances there is no curve for these to steer. */}
        {failed ? null : (
          <div className="flex items-center gap-1.5 max-sm:w-full max-sm:justify-between">
            <Segmented<HeroRange>
              ariaLabel="History range"
              mono
              value={range}
              onChange={(next) => {
                setActive(null);
                setRange(next);
              }}
              options={RANGES.map(({ value, label, ariaLabel }) => ({ value, label, ariaLabel }))}
            />
            <IconButton
              label={table ? "Show as chart" : "Show as table"}
              icon={table ? "activity" : "list"}
              size="sm"
              variant="ghost"
              pressed={table}
              onClick={() => setTable((on) => !on)}
            />
          </div>
        )}
      </div>

      {failed ? (
        // One error for the card: the history read shares the balances
        // read's fate (the curve is today's holdings), so one Retry asks
        // for both, and no empty chart band, legend or row of dashes is
        // left under it.
        <InlineError
          title="Couldn't read your balances"
          message={state.error?.message ?? "The portfolio read failed."}
          onRetry={() => {
            state.refetch();
            history.refetch();
          }}
        />
      ) : (
        <>
          <div className={cn("flex flex-col gap-2 transition-opacity duration-[160ms]", stale && "opacity-60")}>
            <BigNumber
              loading={loading}
              value={
                <Money
                  value={shown}
                  currency={currency}
                  animate={!hovered}
                  reason={unpricedOnly ? "None of the assets held here has a price" : undefined}
                />
              }
            />
            <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5">
              {loading ? (
                <Skeleton className="h-5 w-56" />
              ) : hovered ? (
                <>
                  <span className="text-[13px] tabular-nums text-fg-muted">
                    {formatDate(hovered.t, history.data?.resolution === "hour" ? "datetime" : "long")}
                  </span>
                  <Delta value={fromStart} size="md" period={`since ${range} start`} />
                  <Badge size="sm">est.</Badge>
                </>
              ) : (
                <>
                  {/* The 24 h move in percent and in money, one unit that
                      never wraps apart, its period after both: on a phone
                      (no divider) the dollar figure cannot read as the 7 d
                      one. */}
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <Delta value={totals?.change24hPct ?? null} variant="pill" size="md" />
                    <Delta value={totals?.change24hAbs ?? null} kind="abs" currency={currency} size="md" period="24h" />
                  </span>
                  {/* On a phone the 7 d figure may wrap to its own line, where
                      a divider would dangle at the end of the first. */}
                  <span aria-hidden className="h-3.5 w-px bg-[var(--d-hairline-strong)] max-sm:hidden" />
                  <Delta value={totals?.change7dPct ?? null} size="md" period="7d" />
                  {data ? (
                    <span className="ml-auto text-[12px] text-fg-dim max-sm:hidden">
                      {/* The shared clock ticks every 30 s, so a fresh answer can be
                          "ahead" of it: never let that read as a future time. */}
                      Updated <RelativeTime at={now !== null ? Math.min(data.updatedAt, now) : data.updatedAt} />
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div>
            {history.status === "error" && !history.data ? (
              <div className="flex items-center" style={{ height: phone ? 176 : 232 }}>
                <InlineError
                  className="w-full"
                  title="History unavailable"
                  message={history.error?.message ?? "The history read failed."}
                  onRetry={history.refetch}
                />
              </div>
            ) : (
              <AreaChart
                data={points}
                height={phone ? 176 : 232}
                label="Net worth"
                gradient
                estimate
                baseline={first?.v ?? null}
                baselineLabel={first ? `Start ${fmt.compact(first.v)}` : undefined}
                valueFormatter={fmt.full}
                tickFormatter={fmt.tick}
                loading={history.loading || (withheld && reasking) || (loading && points.length === 0)}
                pending={history.stale || state.stale}
                view={table ? "table" : "chart"}
                onActiveChange={setActive}
                empty={empty}
              />
            )}
          </div>

          <div className="flex flex-col gap-1 text-[12px] leading-snug text-fg-dim">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <Swatch color="var(--viz-accent)" kind="line" dashed />
                Today&apos;s holdings at past prices
              </span>
              <Badge size="sm">est.</Badge>
              <InfoTip
                label="How this curve is made"
                content={
                  <div className="max-w-[300px] text-[12.5px] leading-snug">
                    <p className="font-medium text-fg">How this curve is made</p>
                    <p className="mt-1 text-fg-muted">
                      Public nodes keep current balances, not past ones, so each point is today&apos;s amounts × that
                      day&apos;s price. Moves in the curve are price moves; deposits, withdrawals and rewards before today
                      are not in it. The last point is now, at spot prices.
                    </p>
                  </div>
                }
              />
              {/* The range's own figures. They stay while the cursor reads a
                  point (the line above the chart says "since start" then), so
                  hovering never reflows the card. */}
              {change && !history.stale ? (
                <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1 tabular-nums">
                  {extent ? (
                    <span className="whitespace-nowrap">
                      High <span className="text-fg-muted">{fmt.compact(extent.high.v)}</span> <span aria-hidden>·</span> Low{" "}
                      <span className="text-fg-muted">{fmt.compact(extent.low.v)}</span>
                    </span>
                  ) : null}
                  {extent ? <span aria-hidden className="h-3 w-px bg-[var(--d-hairline-strong)]" /> : null}
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span>
                      {range}
                      <span className="sr-only"> change</span>
                    </span>
                    <Delta value={change.pct} />
                  </span>
                </span>
              ) : null}
            </div>
            {caption ? <p className="min-w-0">{caption}</p> : null}
          </div>

          <div className={cn("transition-opacity duration-[160ms]", stale && "opacity-60")}>
            <TypeRow
              totals={totals ?? null}
              unpriced={data ? unpricedByType(data.assets) : null}
              unread={data ? unreadByType(data.errors) : null}
              currency={currency}
              loading={loading}
            />
          </div>
        </>
      )}
    </Card>
  );
}

/** "All chains · 5 networks" with their logos, or the selected chain with a way back. */
function ScopeChip({ scope }: { scope: ScopeInfo }) {
  const chip =
    "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-[var(--d-hairline-strong)] bg-[var(--d-glass)] text-[12px] font-medium text-fg-muted";
  if (scope.selected) {
    return (
      <span className={cn(chip, "pl-1 pr-0.5")}>
        <ChainLogo chainId={scope.selected.chainId} size={16} />
        <span className="truncate">{scope.selected.chainName}</span>
        <IconButton
          label="Show all chains"
          icon="close"
          size="sm"
          variant="ghost"
          className="!size-5 rounded-full"
          onClick={scope.clear}
        />
      </span>
    );
  }
  const count = scope.chains.length;
  return (
    <span className={cn(chip, "px-2", count > 0 && "pl-1")}>
      {count > 0 ? (
        <LogoStack
          size={16}
          max={3}
          items={scope.chains.map((chain) => ({ src: chain.iconUrl, label: chain.chainName }))}
          label={`${count} networks`}
        />
      ) : null}
      <span className="truncate">
        All chains<span className="text-fg-dim"> · {count}</span>
      </span>
    </span>
  );
}

/**
 * Liquid · Staked · Rewards · Unbonding, each with its share, over a thin
 * allocation bar, in the bar's order (largest first). A bucket at 0 whose
 * holdings have no price, or whose read failed on some network, reads "—"
 * with which of the two it is, never a false $0.00; a bucket that truly
 * holds nothing keeps its $0.00.
 */
function TypeRow({
  totals,
  unpriced,
  unread,
  currency,
  loading,
}: {
  totals: { liquid: number; staked: number; rewards: number; unbonding: number; pricedValue: number } | null;
  unpriced: Record<TypeBucket, number> | null;
  unread: Record<TypeBucket, number> | null;
  currency: string;
  loading: boolean;
}) {
  const fmt = useMoneyFormatters(currency);
  const allocation = totals ? allocationByType(totals) : null;
  const total = totals?.pricedValue ?? 0;
  return (
    <div className="@container border-t border-[var(--d-hairline)] pt-3.5">
      {allocation && allocation.total > 0 ? (
        <StackedBar
          data={allocation.parts}
          colors={allocation.colors}
          legend="none"
          thickness={6}
          minSegmentWidth={4}
          title="Net worth by type"
          valueFormatter={fmt.holding}
        />
      ) : (
        <div aria-hidden className="h-1.5 rounded-full bg-[var(--d-glass-2)]" />
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 @[520px]:grid-cols-4">
        {bucketsBySize(totals).map((bucket) => {
          const value = totals ? totals[bucket.id] : null;
          const count = unpriced?.[bucket.id] ?? 0;
          const failed = unread?.[bucket.id] ?? 0;
          const unknown = value !== null && value <= 0 && (count > 0 || failed > 0);
          const share = !unknown && value !== null && total > 0 ? (value / total) * 100 : null;
          return (
            <div key={bucket.id} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-[12px] text-fg-dim">
                <Swatch color={TYPE_COLORS.get(bucket.id) ?? "var(--viz-other)"} />
                {bucket.label}
              </dt>
              <dd className="mt-1 flex items-baseline gap-1.5">
                {loading ? (
                  <Skeleton className="h-4 w-16" />
                ) : (
                  <>
                    <Money
                      value={unknown ? null : value}
                      currency={currency}
                      compact
                      precision={2}
                      reason={
                        !unknown
                          ? undefined
                          : count > 0
                            ? `${count} unpriced ${count === 1 ? "asset" : "assets"}, not valued`
                            : `Not read on ${failed} ${failed === 1 ? "network" : "networks"}`
                      }
                      className="text-[15px] font-semibold tabular-nums tracking-[-0.01em] text-fg"
                    />
                    {unknown ? (
                      <span className="text-[12px] text-fg-dim">{count > 0 ? `${count} unpriced` : "not read"}</span>
                    ) : share !== null && value !== null && value > 0 ? (
                      <span className="text-[12px] tabular-nums text-fg-dim">{formatPercent(share, { digits: share < 10 ? 1 : 0 })}</span>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
