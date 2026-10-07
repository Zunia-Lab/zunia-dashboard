"use client";

import { useTheme } from "@zunialab/ui";
import { useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  affixUnit,
  AreaChart,
  BarChart,
  BarList,
  Donut,
  formatCompact,
  formatSignedPercent,
  formatValue,
  LineChart,
  Meter,
  relativeChange,
  Sparkline,
  StackedBar,
  stableColorMap,
  VIZ_ACCENT,
  type TickFormatter,
  type TimePoint,
} from "@/components/charts";
import {
  ACTIVITY_BY_DAY,
  ACTIVITY_TYPES,
  ALLOCATION_BY_CHAIN,
  APR_BY_CHAIN,
  APR_SERIES,
  ATOM_BY_CHAIN,
  CHAINS,
  EDGE_ALL_ZERO,
  EDGE_FLAT,
  EDGE_GAPPY,
  EDGE_HUGE,
  EDGE_ONE_POINT,
  EDGE_PNL,
  EDGE_TINY,
  FEES_BY_CHAIN,
  FLOWS_BY_CHAIN,
  MARKETS,
  NET_WORTH_SERIES,
  PRICE_SERIES,
  RANGES,
  REWARDS_SERIES,
  YIELD_SERIES,
  type RangeKey,
} from "./demo-data";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v: number) => `${v < 0 ? "−" : ""}$${money.format(Math.abs(v))}`;
const usdCompact = (v: number) => affixUnit(formatCompact(v), "$");
const usdTick: TickFormatter = (v, { affix }) => affix(v, "$");
const pct = (v: number) => `${v.toFixed(1)}%`;
const pctTick: TickFormatter = (v, { affix }) => affix(v, "", "%");
const count = (v: number) => String(Math.round(v));
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Desktop or not, without a hydration mismatch (the server says "not"). */
function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

/**
 * One colour per chain for the whole page, from the full followed list,
 * largest holding first: the chains a reader meets most hold the six hues,
 * and the long tail shares the "Other" grey.
 */
const CHAIN_COLORS = stableColorMap([...ALLOCATION_BY_CHAIN.map((d) => d.id), ...CHAINS.map((c) => c.id)]);
const usdPrice = (v: number) => affixUnit(formatValue(v), "$");

const cardStyle: CSSProperties = {
  background: "var(--z-surface)",
  borderColor: "var(--d-hairline, var(--viz-grid))",
};

function Card({
  title,
  caption,
  actions,
  className = "",
  children,
}: {
  title: string;
  caption?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border p-4 xl:p-5 ${className}`} style={cardStyle}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-medium leading-5 text-fg">{title}</h2>
          {caption ? <p className="mt-0.5 text-[12.5px] leading-[1.4] text-fg-dim">{caption}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-[10px] bg-glass p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={`h-8 min-w-10 rounded-[8px] px-2.5 font-mono text-[11.5px] tracking-[0.04em] transition-colors ${
            o === value ? "bg-surface text-fg shadow-sm" : "text-fg-dim hover:text-fg"
          }`}
          style={o === value ? { background: "var(--z-surface-raised)" } : undefined}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`h-8 rounded-[10px] border px-3 text-[12.5px] transition-colors ${
        on ? "text-fg" : "text-fg-dim hover:text-fg"
      }`}
      style={{
        borderColor: on ? "var(--z-line-strong)" : "var(--z-line)",
        background: on ? "var(--z-glass-2)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-fg-dim">{children}</div>;
}

function Delta({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-fg-dim">{"—"}</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${up ? "text-success" : "text-danger"}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d={up ? "M5 1.5 9 7.5H1Z" : "M5 8.5 1 2.5h8Z"} fill="currentColor" />
      </svg>
      {formatSignedPercent(value)}
      {suffix ? <span className="text-fg-dim">{suffix}</span> : null}
    </span>
  );
}

function Hero({ pending, table }: { pending: boolean; table: boolean }) {
  const [range, setRange] = useState<RangeKey>("30D");
  const [shown, setShown] = useState<RangeKey>("30D");
  const [loadingRange, setLoadingRange] = useState(false);
  const [hover, setHover] = useState<TimePoint | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wide = useWide();

  // A range switch simulates a refetch: the old frame stays, dimmed, until
  // the "response" lands. No skeleton, no layout jump.
  const pick = (next: RangeKey) => {
    setRange(next);
    setLoadingRange(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShown(next);
      setLoadingRange(false);
    }, 650);
  };

  const data = NET_WORTH_SERIES[shown];
  const first = data[0];
  const last = data[data.length - 1];
  const point = hover ?? last;
  const change = relativeChange(first.v, point.v);
  const fmtDate = useMemo(
    () => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    [],
  );

  return (
    <Card
      title="Net worth"
      caption="Today's holdings at past prices, an estimate · synthetic"
      className="lg:col-span-8"
      actions={<Segmented label="Range" options={RANGES} value={range} onChange={pick} />}
    >
      <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <div className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-fg sm:text-[44px]">
          {usd(point.v)}
        </div>
        <div className="pb-1 text-[13px]">
          <Delta value={change} suffix={hover ? ` since ${fmtDate.format(first.t)}` : ` · ${shown}`} />
        </div>
      </div>
      <AreaChart
        data={data}
        height={wide ? 368 : 220}
        label="Net worth"
        gradient
        estimate
        baseline={first.v}
        baselineLabel={`Start ${usdCompact(first.v)}`}
        valueFormatter={usd}
        tickFormatter={usdTick}
        pending={pending || loadingRange}
        view={table ? "table" : "chart"}
        onActiveChange={setHover}
      />
    </Card>
  );
}

function Allocation({ pending, table }: { pending: boolean; table: boolean }) {
  const total = ALLOCATION_BY_CHAIN.reduce((s, d) => s + d.value, 0);
  return (
    <Card title="Allocation" caption="By chain · 9 networks" className="lg:col-span-4">
      <Donut
        data={ALLOCATION_BY_CHAIN}
        colors={CHAIN_COLORS}
        centerValue={usdCompact(total)}
        centerCaption="Net worth"
        valueFormatter={usdCompact}
        title="Allocation by chain"
        legend="below"
        legendFooter="3 assets without a price are not counted"
        pending={pending}
        view={table ? "table" : "chart"}
      />
    </Card>
  );
}

function Kpi({
  label,
  value,
  delta,
  children,
}: {
  label: string;
  value: string;
  delta?: number | null;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border p-4" style={cardStyle}>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="text-[24px] font-semibold leading-none tracking-[-0.02em] text-fg">{value}</div>
        {delta !== undefined ? (
          <div className="text-[12.5px]">
            <Delta value={delta} />
          </div>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MarketsTable() {
  return (
    <Card title="Markets" caption="7-day sparklines, coloured by direction" className="lg:col-span-6">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-left font-mono text-[11px] uppercase tracking-[0.06em] text-fg-dim">
            <th className="pb-2 font-normal">Asset</th>
            <th className="pb-2 text-right font-normal">Price</th>
            <th className="hidden pb-2 text-right font-normal sm:table-cell">24h</th>
            <th className="pb-2 pl-4 text-right font-normal">7d</th>
          </tr>
        </thead>
        <tbody>
          {MARKETS.map((m) => {
            const day = m.points[m.points.length - 25];
            const d24 = relativeChange(day.v, m.price);
            const d7 = relativeChange(m.points[0].v, m.price);
            return (
              <tr key={m.symbol} className="border-t" style={{ borderColor: "var(--viz-grid)" }}>
                <td className="py-2.5">
                  <div className="font-medium text-fg">{m.symbol}</div>
                  <div className="text-[12px] text-fg-dim">{m.name}</div>
                </td>
                <td className="py-2.5 text-right tabular-nums text-fg">${formatValue(m.price)}</td>
                <td className="hidden py-2.5 text-right text-[12.5px] sm:table-cell">
                  <Delta value={d24} />
                </td>
                <td className="py-2.5 pl-4 text-right">
                  <div className="inline-flex flex-col items-end gap-0.5">
                    <Sparkline
                      data={m.points}
                      width={112}
                      height={28}
                      tone="trend"
                      label={`${m.symbol}, 7 days`}
                      valueFormatter={(v) => `$${formatValue(v)}`}
                    />
                    <span className="text-[11.5px]">
                      <Delta value={d7} />
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Edge({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ChainIcon({ symbol, tint }: { symbol: string; tint: string }) {
  return (
    <span
      className="inline-flex size-5 items-center justify-center rounded-full font-mono text-[9px] font-semibold text-white"
      style={{ background: tint }}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}

export function ChartsKitDemo() {
  const { resolved, toggle } = useTheme();
  const [pending, setPending] = useState(false);
  const [table, setTable] = useState(false);

  const aprMedian = median(APR_BY_CHAIN.map((a) => a.value));
  const feeMedian = median(FEES_BY_CHAIN.map((f) => f.value));
  const rewards = REWARDS_SERIES[REWARDS_SERIES.length - 1].v;
  const yieldLast = YIELD_SERIES[YIELD_SERIES.length - 1].v;
  const flowSeries = [
    { id: "sent", label: "Sent" },
    { id: "received", label: "Received" },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" style={{ background: "var(--z-bg)" }}>
      <main className="mx-auto flex max-w-[1680px] flex-col gap-4 p-4 xl:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3 pb-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-fg">Chart kit</h1>
              <span
                className="rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-warning"
                style={{ borderColor: "var(--z-warning-line)", background: "var(--z-warning-fill)" }}
              >
                Dev only · synthetic data
              </span>
            </div>
            <p className="mt-1 max-w-[70ch] text-[13px] text-fg-dim">
              Every chart in src/components/charts, in every state. Numbers are generated, not market readings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle on={pending} onChange={setPending}>
              Refetch (pending)
            </Toggle>
            <Toggle on={table} onChange={setTable}>
              Table view
            </Toggle>
            <Toggle on={resolved === "dark"} onChange={() => toggle()}>
              {resolved === "dark" ? "Dark" : "Light"} theme
            </Toggle>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Hero pending={pending} table={table} />
          <Allocation pending={pending} table={table} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Claimable rewards" value={usd(rewards)} delta={relativeChange(REWARDS_SERIES[0].v, rewards)}>
            <AreaChart
              data={REWARDS_SERIES}
              compact
              height={56}
              label="Claimable rewards"
              valueFormatter={usd}
              pending={pending}
            />
          </Kpi>
          <Kpi label="Est. yearly yield" value={usd(yieldLast)} delta={relativeChange(YIELD_SERIES[0].v, yieldLast)}>
            <AreaChart
              data={YIELD_SERIES}
              compact
              height={56}
              label="Est. yearly yield"
              valueFormatter={usd}
              pending={pending}
            />
          </Kpi>
          <Kpi label="Staked ratio" value="62.4%">
            <Meter value={0.624} label="Staked of liquid + staked" ariaLabel="Staked ratio" />
          </Kpi>
          <Kpi label="Top validator commission" value="12%">
            <Meter
              value={12}
              max={25}
              label="Commission"
              valueLabel="12%"
              thresholds={{ warning: 10, danger: 20 }}
              statusLabels={{ warning: "High", danger: "Very high" }}
              markers={[{ value: 5, label: "Chain median 5%" }]}
            />
          </Kpi>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card title="Price performance" caption="ATOM, OSMO, TIA and SAF · 30 days" className="lg:col-span-7">
            <LineChart
              series={PRICE_SERIES}
              colors={CHAIN_COLORS}
              indexed
              height={280}
              title="Price performance, indexed"
              pending={pending}
              view={table ? "table" : "chart"}
            />
          </Card>
          <Card title="Staking APR" caption="Three chains · 90 days" className="lg:col-span-5">
            <LineChart
              series={APR_SERIES}
              colors={CHAIN_COLORS}
              height={280}
              title="Staking APR by chain"
              valueFormatter={pct}
              tickFormatter={pctTick}
              pending={pending}
              view={table ? "table" : "chart"}
            />
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card title="Activity" caption="Transactions per day by type · 30 days" className="lg:col-span-7">
            <BarChart
              data={ACTIVITY_BY_DAY}
              series={ACTIVITY_TYPES}
              layout="stacked"
              timeZone="utc"
              height={240}
              title="Transactions per day"
              valueFormatter={count}
              pending={pending}
              view={table ? "table" : "chart"}
            />
          </Card>
          <Card title="Fees by chain" caption="Paid in each chain's fee token, est. USD" className="lg:col-span-5">
            <BarList
              items={FEES_BY_CHAIN}
              valueFormatter={(v) => `$${v.toFixed(2)}`}
              reference={{ value: feeMedian, label: `Median $${feeMedian.toFixed(2)}` }}
              title="Fees by chain"
              pending={pending}
            />
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card title="Value moved" caption="Sent and received per chain, USD · 30 days" className="lg:col-span-6">
            <BarChart
              data={FLOWS_BY_CHAIN}
              series={flowSeries}
              layout="grouped"
              xType="category"
              height={240}
              title="Value moved by chain"
              valueFormatter={usdCompact}
              tickFormatter={usdTick}
              pending={pending}
            />
          </Card>
          <Card title="Staking APR by chain" caption="Before commission · median across followed chains" className="lg:col-span-6">
            <BarList
              items={APR_BY_CHAIN.map((a) => ({ ...a, icon: <ChainIcon symbol={a.symbol} tint={a.tint} /> }))}
              color={VIZ_ACCENT}
              valueFormatter={pct}
              reference={{ value: aprMedian, label: `Median ${pct(aprMedian)}` }}
              showShare={false}
              title="Staking APR by chain"
              pending={pending}
            />
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-6">
            <Card title="ATOM by chain" caption="Where your ATOM sits · 521.6 ATOM">
              <StackedBar
                data={ATOM_BY_CHAIN}
                colors={CHAIN_COLORS}
                valueFormatter={(v) => `${formatValue(v)} ATOM`}
                title="ATOM by chain"
                pending={pending}
              />
            </Card>
            <Card title="Meters" caption="Accent until a threshold; status always has a glyph and a word" className="flex-1">
              <div className="flex flex-col gap-5">
                <Meter value={0.624} label="Staked ratio" />
                <Meter
                  value={0.972}
                  label="Validator uptime"
                  thresholds={{ warning: 0.99, danger: 0.95, direction: "down" }}
                  statusLabels={{ warning: "Below 99%", danger: "Below 95%" }}
                />
                <Meter
                  value={0.412}
                  label="Top-10 voting power"
                  thresholds={{ warning: 0.334, danger: 0.5 }}
                  statusLabels={{ warning: "Concentrated", danger: "Halt risk" }}
                  markers={[{ value: 0.334, label: "33.4% halts the chain" }]}
                />
                <Meter value={0.58} label="Quorum reached" size="sm" color="var(--viz-2)" />
              </div>
            </Card>
          </div>
          <MarketsTable />
        </div>

        <Card title="Edge cases" caption="One sample, a loss, tiny and huge magnitudes, broken samples, nothing at all">
          <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
            <Edge label="One sample · area">
              <AreaChart data={EDGE_ONE_POINT} height={150} label="Net worth" valueFormatter={usd} tickFormatter={usdTick} />
            </Edge>
            <Edge label="Crosses zero · P&L, UTC days">
              <AreaChart data={EDGE_PNL} height={150} label="Profit and loss" valueFormatter={usd} tickFormatter={usdTick} />
            </Edge>
            <Edge label="$0.0000123 · price">
              <AreaChart data={EDGE_TINY} height={150} label="Price" valueFormatter={usdPrice} tickFormatter={usdTick} />
            </Edge>
            <Edge label="Billions · monthly bars">
              <BarChart
                data={EDGE_HUGE}
                series={[{ id: "cap", label: "Market cap" }]}
                height={150}
                title="Market cap by month"
                valueFormatter={usdCompact}
                tickFormatter={usdTick}
              />
            </Edge>
            <Edge label="NaN dropped · one-sample series">
              <LineChart
                series={EDGE_GAPPY}
                colors={CHAIN_COLORS}
                height={150}
                title="ATOM and OSMO price"
                valueFormatter={usdPrice}
                tickFormatter={usdTick}
              />
            </Edge>
            <Edge label="Single series · accent">
              <LineChart
                series={PRICE_SERIES.slice(2, 3)}
                height={150}
                title="TIA price"
                valueFormatter={usdPrice}
                tickFormatter={usdTick}
              />
            </Edge>
            <Edge label="All zero · empty state">
              <BarChart
                data={EDGE_ALL_ZERO}
                series={[{ id: "transfer", label: "Transfers" }]}
                height={150}
                title="Transfers per day"
                empty="No transactions in this range"
              />
            </Edge>
            <Edge label="Flat · trend tone stays neutral">
              <div className="flex h-[150px] items-center">
                <Sparkline data={EDGE_FLAT} width={180} tone="trend" label="USDC, 24 hours" />
              </div>
            </Edge>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4">
          <Card title="States" caption="First load, refetch, empty">
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0">
                <SectionLabel>Loading · area</SectionLabel>
                <div className="mt-2">
                  <AreaChart data={[]} loading height={120} label="Net worth" />
                </div>
              </div>
              <div className="min-w-0">
                <SectionLabel>Pending · bars stay, dimmed</SectionLabel>
                <div className="mt-2">
                  <BarChart
                    data={ACTIVITY_BY_DAY.slice(-14)}
                    series={ACTIVITY_TYPES.slice(0, 1)}
                    timeZone="utc"
                    height={120}
                    title="Transfers per day"
                    valueFormatter={count}
                    pending
                  />
                </div>
              </div>
              <div className="min-w-0">
                <SectionLabel>Empty · area</SectionLabel>
                <div className="mt-2">
                  <AreaChart data={[]} height={120} label="Net worth" empty="No balance history for this range" />
                </div>
              </div>
              <div className="min-w-0">
                <SectionLabel>Loading · list</SectionLabel>
                <div className="mt-2">
                  <BarList items={[]} loading limit={3} />
                </div>
              </div>
              <div className="min-w-0">
                <SectionLabel>Loading · donut</SectionLabel>
                <div className="mt-2">
                  <Donut data={[]} loading size={120} thickness={14} legend="side" />
                </div>
              </div>
              <div className="min-w-0">
                <SectionLabel>Loading · allocation bar</SectionLabel>
                <div className="mt-2">
                  <StackedBar data={[]} loading />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
