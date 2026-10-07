"use client";

/**
 * Compare's side-by-side figures: one column per entity, one row per figure,
 * grouped (market, performance over the chart's range, staking, security,
 * you). The best value of a row gets a soft amber fill and says why
 * ("Highest real yield"); a row with a single known value or a tie of
 * everyone crowns nobody (`bestIndexes`). A figure that does not apply (an
 * asset that is not a staking token) reads "—" with that reason.
 *
 * A table from tablets up; on phones each figure is a line with the
 * entities' values in equal columns under a pinned header (`StackedFigures`).
 * Market figures (price, cap, volume) are public and never masked; only
 * "You hold" follows the privacy setting.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { AssetLogo, ChainLogo, DataTable, Delta, InfoTip, Money, TokenAmount, type Column } from "@/components/ui";
import type { ChainStats } from "@/lib/chain/types";
import { formatNumber, formatPercent } from "@/lib/format";
import type { PriceRange } from "@/lib/token/types";
import { cn } from "@/lib/cn";
import { CellSkeleton, Dash, RealYieldText, reasonOf } from "@/components/chains/cells";
import { formatDays, toPct } from "@/components/chains/model";
import type { Entity } from "./entities";
import { bestIndexes, type BestRule, type Performance } from "./model";

/** Everything the table needs about one entity. */
export interface Facts {
  entity: Entity;
  /** Stats of `entity.stakingChain`; null when not applicable or not loaded. */
  stats: ChainStats | null;
  statsState: "loading" | "ready" | "error" | "none";
  statsReason?: string;
  price: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCap: number | null;
  volume24h: number | null;
  /** Currency of price, market cap and volume. */
  currency: string | null;
  /** The markets feed (or the stats' own price) has not answered yet. */
  marketLoading: boolean;
  perf: Performance;
  perfLoading: boolean;
  /** The wallet's holdings of this token; undefined without a wallet. */
  holdings?: { value: number | null; amount: number | null; loading: boolean };
  holdingsCurrency?: string | null;
}

interface Metric {
  id: string;
  label: string;
  info?: string;
  value: (f: Facts) => number | null;
  render: (value: number, f: Facts) => ReactNode;
  /** Why a value is missing. */
  reason?: (f: Facts) => string | undefined;
  /** Loading state for this figure. */
  loading?: (f: Facts) => boolean;
  best?: BestRule;
  bestLabel?: string;
}

const NOT_STAKING = "Not a staking token: no chain economics to compare";

function stakingReason(f: Facts, field: Parameters<typeof reasonOf>[1]): string | undefined {
  if (f.statsState === "none") return NOT_STAKING;
  if (f.statsState === "error") return f.statsReason ?? "This chain could not be read right now";
  return reasonOf(f.stats, field);
}

const stakingLoading = (f: Facts) => f.statsState === "loading";

function pctOf(fraction: number | null | undefined): number | null {
  return toPct(fraction ?? null);
}

function metricsFor(range: PriceRange, connected: boolean): Array<{ section: string; note?: string; metrics: Metric[] }> {
  const groups: Array<{ section: string; note?: string; metrics: Metric[] }> = [
    {
      section: "Market",
      metrics: [
        {
          id: "price",
          loading: (f) => f.marketLoading,
          label: "Price",
          value: (f) => f.price,
          render: (v, f) => <Money value={v} currency={f.currency ?? undefined} masked={false} />,
          reason: () => "No market quotes this token",
        },
        {
          id: "change24h",
          loading: (f) => f.marketLoading,
          label: "24h",
          value: (f) => f.change24h,
          render: (v) => <Delta value={v} size="md" />,
          best: "max",
          bestLabel: "Best 24h",
        },
        {
          id: "change7d",
          loading: (f) => f.marketLoading,
          label: "7 days",
          value: (f) => f.change7d,
          render: (v) => <Delta value={v} size="md" />,
          best: "max",
          bestLabel: "Best week",
        },
        {
          id: "marketCap",
          loading: (f) => f.marketLoading,
          label: "Market cap",
          info: "CoinGecko's figure via Numia, for Cosmos-native tokens only (bridged assets would show the outside asset's).",
          value: (f) => f.marketCap,
          render: (v, f) => <Money value={v} currency={f.currency ?? undefined} compact masked={false} />,
          reason: () => "No Cosmos-native market cap for this token",
          best: "max",
          bestLabel: "Largest",
        },
        {
          id: "volume",
          loading: (f) => f.marketLoading,
          label: "Volume 24h",
          value: (f) => f.volume24h,
          render: (v, f) => <Money value={v} currency={f.currency ?? undefined} compact masked={false} />,
          reason: () => "No volume reported",
          best: "max",
          bestLabel: "Most traded",
        },
      ],
    },
    {
      section: `Performance · ${range}`,
      note: "Computed from the chart's price series, from the common start date.",
      metrics: [
        {
          id: "return",
          label: "Return",
          value: (f) => (f.perf.change === null ? null : f.perf.change * 100),
          render: (v) => <Delta value={v} size="md" />,
          reason: () => "No price history in this range",
          loading: (f) => f.perfLoading,
          best: "max",
          bestLabel: "Best performer",
        },
        {
          id: "drawdown",
          label: "Max drawdown",
          info: "The deepest fall from a running high within the range.",
          value: (f) => (f.perf.maxDrawdown === null ? null : f.perf.maxDrawdown * 100),
          // A fall too small to print reads "under 0.1%", not "−<0.1%".
          render: (v) => (v > -0.05 ? <span className="text-fg-muted">&lt;0.1%</span> : <span className="text-[var(--d-neg)]">{formatPercent(v, { digits: 1 })}</span>),
          reason: () => "No price history in this range",
          loading: (f) => f.perfLoading,
          best: "max",
          bestLabel: "Smallest drop",
        },
        {
          id: "volatility",
          label: "Volatility",
          info: "Annualised standard deviation of returns between price samples (hourly on 7D, daily beyond).",
          value: (f) => (f.perf.volatility === null ? null : f.perf.volatility * 100),
          render: (v) => <span className="text-fg-muted">{formatPercent(v, { digits: 0 })}</span>,
          reason: () => "Too few price samples",
          loading: (f) => f.perfLoading,
          best: "min",
          bestLabel: "Steadiest",
        },
      ],
    },
    {
      section: "Staking",
      note: "Chain-level figures, before validator commission.",
      metrics: [
        {
          id: "apr",
          label: "APR",
          info: "Actual staking APR at the observed block time, before validator commission. Fees and MEV not included.",
          value: (f) => pctOf(f.stats?.apr.actual),
          render: (v, f) => (
            <span title={f.stats?.apr.naive !== null && f.stats?.apr.naive !== undefined ? `Published ${formatPercent(toPct(f.stats.apr.naive))}` : undefined}>
              {formatPercent(v)}
              {f.stats?.apr.source === "cosmos.directory" ? <span className="ml-1 font-mono text-[10px] text-fg-dim">3P</span> : null}
            </span>
          ),
          reason: (f) => (f.statsState === "ready" ? (f.stats?.apr.note ?? stakingReason(f, "apr")) : stakingReason(f, "apr")),
          loading: stakingLoading,
          best: "max",
          bestLabel: "Highest APR",
        },
        {
          id: "realYield",
          label: "Real yield",
          info: "APR minus actual inflation: how much a staker's share of supply grows in a year.",
          value: (f) => pctOf(f.stats?.realYield),
          render: (v) => <RealYieldText value={v / 100} />,
          reason: (f) => stakingReason(f, "realYield"),
          loading: stakingLoading,
          best: "max",
          bestLabel: "Highest real yield",
        },
        {
          id: "inflation",
          label: "Inflation",
          value: (f) => pctOf(f.stats?.inflation.actual),
          render: (v) => <span className="text-fg-muted">{formatPercent(v)}</span>,
          reason: (f) => stakingReason(f, "inflation"),
          loading: stakingLoading,
          best: "min",
          bestLabel: "Lowest inflation",
        },
        {
          id: "bonded",
          label: "Bonded",
          info: "Share of supply staked: more stake bonded makes an attack costlier.",
          value: (f) => pctOf(f.stats?.bondedRatio),
          render: (v) => <span className="text-fg-muted">{formatPercent(v, { digits: 1 })}</span>,
          reason: (f) => stakingReason(f, "bondedRatio"),
          loading: stakingLoading,
          best: "max",
          bestLabel: "Most stake bonded",
        },
        {
          id: "unbonding",
          label: "Unbonding",
          value: (f) => f.stats?.unbondingDays ?? null,
          render: (v) => <span className="text-fg-muted">{formatDays(v)}</span>,
          reason: (f) => stakingReason(f, "unbondingDays"),
          loading: stakingLoading,
          best: "min",
          bestLabel: "Shortest unbonding",
        },
      ],
    },
    {
      section: "Security",
      metrics: [
        {
          id: "validators",
          label: "Active validators",
          value: (f) => f.stats?.activeValidators ?? null,
          render: (v, f) => (
            <span>
              {formatNumber(v)}
              {f.stats?.maxValidators ? <span className="text-fg-dim"> / {formatNumber(f.stats.maxValidators)}</span> : null}
            </span>
          ),
          reason: (f) => stakingReason(f, "activeValidators"),
          loading: stakingLoading,
          best: "max",
          bestLabel: "Largest set",
        },
        {
          id: "nakamoto",
          label: "Nakamoto",
          info: "The fewest validators holding more than a third of the stake: enough to halt the chain.",
          value: (f) => f.stats?.nakamoto ?? null,
          render: (v) => <span className="font-medium">{formatNumber(v)}</span>,
          reason: (f) => stakingReason(f, "nakamoto"),
          loading: stakingLoading,
          best: "max",
          bestLabel: "Hardest to halt",
        },
      ],
    },
  ];
  if (connected) {
    groups.push({
      section: "You",
      metrics: [
        {
          id: "holdings",
          label: "You hold",
          info: "This token across your followed chains (vouchers proven to be it included), priced now.",
          value: (f) => f.holdings?.value ?? (f.holdings?.amount === 0 ? 0 : null),
          render: (v, f) => (
            <span className="flex flex-col items-end leading-tight">
              <Money value={v} currency={f.holdingsCurrency ?? undefined} compact className={v === 0 ? "text-fg-dim" : "font-medium"} />
              {f.holdings?.amount ? <TokenAmount amount={f.holdings.amount} symbol={f.entity.ticker} compact className="mt-0.5 text-[11.5px] text-fg-dim" /> : null}
            </span>
          ),
          reason: (f) => (f.holdings?.amount ? "No price for it" : "Not held on your followed chains"),
          loading: (f) => Boolean(f.holdings?.loading),
        },
      ],
    });
  }
  return groups;
}

interface MetricsTableProps {
  facts: readonly Facts[];
  colors: ReadonlyMap<string, string>;
  range: PriceRange;
  connected: boolean;
}

export function MetricsTable({ facts, colors, range, connected }: MetricsTableProps) {
  const groups = metricsFor(range, connected).map((group) => ({
    ...group,
    rows: group.metrics.map((metric) => ({
      metric,
      best: metric.best ? bestIndexes(facts.map((f) => metric.value(f)), metric.best) : new Set<number>(),
    })),
  }));
  return (
    <>
      <div className="max-md:hidden">
        <WideTable groups={groups} facts={facts} colors={colors} />
      </div>
      <StackedFigures groups={groups} facts={facts} colors={colors} className="md:hidden" />
    </>
  );
}

interface MetricRow {
  metric: Metric;
  /** Indexes (into `facts`) holding the row's best value. */
  best: Set<number>;
}

interface MetricGroup {
  section: string;
  note?: string;
  rows: MetricRow[];
}

interface LayoutProps {
  groups: MetricGroup[];
  facts: readonly Facts[];
  colors: ReadonlyMap<string, string>;
  className?: string;
}

/** One cell's content: skeleton, reasoned dash, the figure, or the figure marked best. */
function Figure({ row, fact, index, compact }: { row: MetricRow; fact: Facts; index: number; compact?: boolean }) {
  const { metric } = row;
  if (metric.loading?.(fact)) return <CellSkeleton width={44} align={compact ? "left" : "right"} />;
  const value = metric.value(fact);
  if (value === null) return <Dash reason={metric.reason?.(fact)} />;
  const body = metric.render(value, fact);
  if (!row.best.has(index)) return <>{body}</>;
  return (
    // Amber, the kit's "info" tone: it reads as "winner" in both themes,
    // where the crimson accent can read as a loss in light. A soft fill, no
    // frame: a dozen framed boxes made the table look busy. Phones keep the
    // fill and say the label to screen readers only (no room to print it).
    // The fill is 8% amber in both themes, not the token's 14% dark one: on
    // that, a loss in red (4.2:1) and dim text like " / 180" (4.3:1) fell
    // under AA; here they hold 4.7:1, and dim text inside steps up to muted.
    <span
      className={cn(
        "inline-flex flex-col gap-0.5 rounded-[7px] bg-[color-mix(in_srgb,var(--z-info)_8%,transparent)] px-1.5 py-1 text-fg [&_.text-fg-dim]:text-fg-muted",
        compact ? "-mx-1.5 items-start" : "-mr-1.5 items-end",
      )}
    >
      {body}
      {compact ? (
        <span className="sr-only">{metric.bestLabel}</span>
      ) : (
        <span className="whitespace-nowrap text-[10.5px] font-medium leading-none text-[var(--z-info)]">{metric.bestLabel}</span>
      )}
    </span>
  );
}

function EntityTag({ fact, colors, link }: { fact: Facts; colors: ReadonlyMap<string, string>; link?: boolean }) {
  const { entity } = fact;
  const content = (
    <>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colors.get(entity.id) }} />
      {entity.ref.kind === "chain" ? <ChainLogo chainId={entity.ref.id} size={16} /> : <AssetLogo src={entity.logo} symbol={entity.ticker} size={16} />}
      <span className="truncate font-sans text-[12.5px] font-medium">{entity.ticker}</span>
    </>
  );
  if (!link) return <span className="flex min-w-0 items-center gap-1.5 text-fg">{content}</span>;
  return (
    <Link href={entity.href} className="inline-flex max-w-[180px] items-center justify-end gap-1.5 normal-case tracking-normal text-fg hover:underline" title={entity.name}>
      {content}
    </Link>
  );
}

function MetricLabel({ metric }: { metric: Metric }) {
  return (
    <span className="flex items-center gap-1 text-[13.5px] text-fg-muted">
      {metric.label}
      {metric.info ? <InfoTip content={metric.info} size={13} label={`About ${metric.label}`} /> : null}
    </span>
  );
}

type TableRow = { kind: "section"; id: string; group: MetricGroup } | { kind: "metric"; id: string; row: MetricRow };

/** Tablets and up: one column per entity, the metric pinned on the left. */
function WideTable({ groups, facts, colors }: LayoutProps) {
  const rows: TableRow[] = groups.flatMap((group) => [
    { kind: "section" as const, id: `section:${group.section}`, group },
    ...group.rows.map((row) => ({ kind: "metric" as const, id: row.metric.id, row })),
  ]);
  const columns: Column<TableRow>[] = [
    {
      key: "metric",
      header: "Metric",
      sticky: true,
      minWidth: 128,
      cell: (row) =>
        row.kind === "section" ? (
          <span className="flex items-center gap-1.5">
            <span className="d-label text-fg-muted">{row.group.section}</span>
            {row.group.note ? <InfoTip content={row.group.note} size={12} label={`About ${row.group.section}`} /> : null}
          </span>
        ) : (
          <MetricLabel metric={row.row.metric} />
        ),
    },
    ...facts.map<Column<TableRow>>((f, index) => ({
      key: f.entity.id,
      align: "right",
      minWidth: 104,
      header: <EntityTag fact={f} colors={colors} link />,
      cell: (row) => (row.kind === "section" ? null : <Figure row={row.row} fact={f} index={index} />),
    })),
  ];
  return (
    <DataTable
      ariaLabel="Side-by-side figures"
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      rowClassName={(row) => cn(row.kind === "section" && "[&>td]:!h-9 [&>td]:bg-[var(--d-card-2)]")}
    />
  );
}

/**
 * Phones: a table of four 1/4-width columns behind a pinned metric column
 * showed barely one entity at a time. Here each metric is a line with its
 * figures in a row of equal columns under a header that stays pinned under
 * the top bar, so all four are always side by side.
 */
function StackedFigures({ groups, facts, colors, className }: LayoutProps) {
  const grid = { gridTemplateColumns: `repeat(${Math.max(1, facts.length)}, minmax(0, 1fr))` };
  return (
    <div className={className}>
      <div
        aria-hidden
        className="sticky top-[var(--d-sticky-top,0px)] z-[2] grid gap-2 border-y border-[var(--d-hairline)] bg-[var(--d-card)] px-[var(--d-pad)] py-2.5"
        style={grid}
      >
        {facts.map((f) => (
          <EntityTag key={f.entity.id} fact={f} colors={colors} />
        ))}
      </div>
      {groups.map((group) => (
        <section key={group.section} aria-label={group.section}>
          <p className="flex items-center gap-1.5 bg-[var(--d-card-2)] px-[var(--d-pad)] py-2">
            <span className="d-label text-fg-muted">{group.section}</span>
            {group.note ? <InfoTip content={group.note} size={12} label={`About ${group.section}`} /> : null}
          </p>
          <dl className="divide-y divide-[var(--d-hairline)]">
            {group.rows.map((row) => (
              <div key={row.metric.id} className="px-[var(--d-pad)] py-2.5">
                <dt>
                  <MetricLabel metric={row.metric} />
                </dt>
                <dd className="mt-1.5 grid gap-2 text-[13px] tabular-nums" style={grid}>
                  {facts.map((f, index) => (
                    <span key={f.entity.id} className="flex min-w-0 items-center">
                      <span className="sr-only">{f.entity.ticker}: </span>
                      <Figure row={row} fact={f} index={index} compact />
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
