"use client";

/**
 * The analysis row of the Activity page: activity over time (stacked by
 * type, with the type mix as its legend), fees (by network or by type),
 * most-used networks or counterparties, and what was sent vs received per
 * token. Every card reads the same rows as the strip and the list.
 */

import { Fragment, useMemo, useState } from "react";
import { BarChart, BarList, Sparkline, StackedBar, useChartSize, type BarListItem } from "@/components/charts";
import {
  AssetLogo,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  Money,
  Segmented,
  Skeleton,
  TokenAmount,
  chainById,
} from "@/components/ui";
import type { TickFormatter } from "@/components/charts";
import {
  ACTIVITY_GROUPS,
  GROUP_LABELS,
  KIND_LABELS,
  chainUsage,
  feeSummary,
  flowSummary,
  topCounterparties,
  type ActivityGroup,
  type PeriodRow,
  type PriceMap,
} from "@/lib/activity/analytics";
import type { ActivityItem, ActivityKind } from "@/lib/activity/types";
import { findChainsByPrefix } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { MASK, MINUS, formatDate, formatFiat, formatNumber, formatRelativeTime, shortenAddress } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { GROUP_COLORS, GROUP_COLOR_MAP } from "./KindIcon";
import { EstTag } from "./ActivitySummary";
import { bech32Prefix, feesByGroup, hourMatrix, isOwnTransfer, ownRole, type ChartWindow } from "./view";

/* -------------------------------------------------------------------------- */
/* Formatters (module-level: the chart kit recomputes on a new function)       */
/* -------------------------------------------------------------------------- */

const countFormatter = (value: number) => formatNumber(value, { maxFraction: 0 });

/** Counts are whole: a 0.5 tick on a "transactions" axis would be a lie. */
const countTicks: TickFormatter = (value) => (Number.isInteger(value) ? formatNumber(value, { maxFraction: 0 }) : "");

/* -------------------------------------------------------------------------- */
/* Activity over time                                                          */
/* -------------------------------------------------------------------------- */

export interface ActivityOverTimeProps {
  periods: readonly PeriodRow[];
  window: ChartWindow | null;
  /** Rows on screen, for the type mix. */
  rows: readonly ActivityItem[];
  /** A node's retention edge inside the window: before it the counts are partial. */
  partialBefore: { at: number; chainNames: string[] } | null;
  loading: boolean;
  pending: boolean;
  className?: string;
}

/** The chart's own height when nothing beside it is taller. */
const OVER_TIME_HEIGHT = 236;

export function ActivityOverTime({ periods, window, rows, partialBefore, loading, pending, className }: ActivityOverTimeProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  // Beside a taller Fees card the row is stretched: the chart takes the extra
  // height instead of leaving an empty band under its axis. Its box is laid
  // out absolutely, so the measured height never feeds back into the row's.
  const [frameRef, frame] = useChartSize<HTMLDivElement>();
  const chartHeight = Math.max(OVER_TIME_HEIGHT, Math.floor(frame.height));

  const mix = useMemo(() => {
    const counts = new Map<ActivityGroup, number>();
    for (const period of periods) {
      for (const group of ACTIVITY_GROUPS) counts.set(group, (counts.get(group) ?? 0) + period.byGroup[group]);
    }
    return ACTIVITY_GROUPS.filter((group) => (counts.get(group) ?? 0) > 0).map((group) => ({
      id: group,
      label: GROUP_LABELS[group],
      value: counts.get(group) ?? 0,
    }));
  }, [periods]);

  // Only the groups present get a column in the table twin; colours come from
  // the fixed group map, so a hidden group never shifts the others.
  const series = useMemo(() => {
    const present = new Set(mix.map((part) => part.id));
    const groups = present.size > 0 ? ACTIVITY_GROUPS.filter((group) => present.has(group)) : [...ACTIVITY_GROUPS];
    return groups.map((group) => ({ id: group, label: GROUP_LABELS[group] }));
  }, [mix]);

  const data = useMemo(
    () => periods.map((period) => ({ x: period.start, values: period.byGroup as Readonly<Record<string, number>> })),
    [periods],
  );

  const per = window?.bucket === "week" ? "week" : "day";
  const span = window ? `${formatDate(window.from, "short")} – today` : null;
  const subtitle = [`Transactions per ${per} by type`, span].filter(Boolean).join(" · ");
  const caveat = window?.clipped
    ? `Starts ${formatDate(window.from, "short")}: older transactions are not loaded yet.`
    : partialBefore
      ? `Before ${formatDate(partialBefore.at, "short")} only partly counted: ${partialBefore.chainNames.join(", ")} ${partialBefore.chainNames.length === 1 ? "keeps" : "keep"} no older history.`
      : null;
  const total = rows.length;
  const ariaLabel = window
    ? `Transactions per ${per} by type, ${formatDate(window.from, "long")} to today: ${formatNumber(total)} in total${mix.length ? `, ${mix.map((part) => `${part.label} ${part.value}`).join(", ")}` : ""}.`
    : "Transactions over time";

  return (
    <Card pending={pending} className={className}>
      <CardHeader
        title="Activity over time"
        subtitle={subtitle}
        actions={
          <Segmented<"chart" | "table">
            ariaLabel="Show as"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: "Chart", icon: "markets", ariaLabel: "Chart" },
              { value: "table", label: "Table", icon: "list", ariaLabel: "Table" },
            ]}
          />
        }
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        <StackedBar
          data={mix}
          colors={GROUP_COLOR_MAP}
          maxSegments={ACTIVITY_GROUPS.length}
          thickness={8}
          legend="inline"
          valueFormatter={countFormatter}
          title="Mix by type"
          loading={loading}
          empty={<span className="sr-only">No transactions</span>}
        />
        <div ref={frameRef} className="relative flex-1" style={{ minHeight: OVER_TIME_HEIGHT }}>
          <div className="absolute inset-0">
            <BarChart
              data={data}
              series={series}
              colors={GROUP_COLOR_MAP}
              layout="stacked"
              xType="time"
              height={chartHeight}
              legend="none"
              timeZone="local"
              valueFormatter={countFormatter}
              tickFormatter={countTicks}
              ariaLabel={ariaLabel}
              title="Activity over time"
              loading={loading}
              pending={pending}
              view={view}
              empty="No transactions in this window"
            />
          </div>
        </div>
        {caveat ? (
          <p className="flex items-start gap-1.5 text-[12px] leading-snug text-fg-dim">
            <span aria-hidden className="mt-[5px] inline-block size-1.5 shrink-0 rounded-full bg-[var(--z-warning)]" />
            {caveat}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Fees                                                                        */
/* -------------------------------------------------------------------------- */

export interface ActivityFeesProps {
  rows: readonly ActivityItem[];
  prices: PriceMap;
  currency: string;
  /** Priced fees per chart bucket (null when none is priced). */
  trend: readonly { t: number; v: number }[] | null;
  /** "day" or "week", for the trend's label. */
  per: "day" | "week";
  /** One chain in scope: fees by type only (a one-bar "by network" says nothing). */
  singleChain: boolean;
  loading: boolean;
  pending: boolean;
  className?: string;
}

/** Fee tokens listed under the ranking; the rest are counted. */
const FEE_TOKENS = 4;

export function ActivityFees({ rows, prices, currency, trend, per, singleChain, loading, pending, className }: ActivityFeesProps) {
  const { hideAmounts } = usePrefs();
  const [mode, setMode] = useState<"chain" | "type">("chain");
  const effective = singleChain ? "type" : mode;

  const summary = useMemo(() => feeSummary(rows, prices), [rows, prices]);
  const byType = useMemo(() => feesByGroup(rows, prices), [rows, prices]);

  const money = useMemo(
    () => (value: number) => (hideAmounts ? MASK : formatFiat(value, currency, { compact: value >= 10_000 })),
    [hideAmounts, currency],
  );

  const items: BarListItem[] =
    effective === "chain"
      ? summary.byChain
          .filter((chain) => chain.value !== null)
          .map((chain) => ({
            id: chain.chainId,
            label: chainById(chain.chainId)?.chainName ?? chain.chainId,
            value: chain.value ?? 0,
            icon: <ChainLogo chainId={chain.chainId} size={16} />,
            detail: `${formatNumber(chain.count)} ${chain.count === 1 ? "transaction" : "transactions"} · avg ${money((chain.value ?? 0) / Math.max(1, chain.count))}`,
          }))
      : byType
          .filter((group) => group.value !== null)
          .map((group) => ({
            id: group.group,
            label: GROUP_LABELS[group.group],
            value: group.value ?? 0,
            color: GROUP_COLORS[group.group],
            detail: `${formatNumber(group.count)} ${group.count === 1 ? "transaction" : "transactions"} · avg ${money((group.value ?? 0) / Math.max(1, group.count))}`,
          }));

  const unpricedChains = effective === "chain" ? summary.byChain.filter((chain) => chain.value === null) : [];
  const average = summary.value !== null && summary.count > 0 ? summary.value / summary.count : null;
  const peak = trend && trend.length > 1 ? trend.reduce((best, point) => (point.v > best.v ? point : best), trend[0]) : null;

  // Nothing to rank: the card keeps its own height instead of stretching to
  // its row as a tall empty box.
  const nothing = !loading && summary.count === 0;
  return (
    <Card pending={pending} className={cn(className, nothing && "self-start")}>
      <CardHeader
        title={
          <>
            Fees paid
            <EstTag />
          </>
        }
        subtitle={
          // Nothing is claimed before the rows are in ("none paid" while
          // loading would be a statement about history nobody has read), and
          // with no fee the empty list below says so.
          !loading && summary.count > 0
            ? `Paid on ${formatNumber(summary.count)} ${summary.count === 1 ? "transaction" : "transactions"}`
            : undefined
        }
        info="Network fees your accounts paid, valued at today's prices. A fee covered by a fee grant or paid by another signer is not counted."
        actions={
          singleChain ? undefined : (
            <Segmented<"chain" | "type">
              ariaLabel="Group fees by"
              value={mode}
              onChange={setMode}
              options={[
                { value: "chain", label: "Network" },
                { value: "type", label: "Type" },
              ]}
            />
          )
        }
      />
      <CardBody className="flex flex-1 flex-col gap-4">
        <BarList
          items={items}
          valueFormatter={money}
          colorBy={effective === "type" ? GROUP_COLOR_MAP : undefined}
          limit={6}
          title={effective === "chain" ? "Fees by network" : "Fees by type"}
          loading={loading}
          pending={pending}
          empty={summary.count === 0 ? "No fees paid by you in this view" : "No fee token has a price"}
        />
        {!loading && trend && peak && peak.v > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="d-label">Fees per {per}</p>
              <p className="text-[12px] text-fg-dim">
                Peak <Money value={peak.v} currency={currency} className="text-fg-muted" /> · {formatDate(peak.t, "short")}
              </p>
            </div>
            <Sparkline
              data={trend}
              height={40}
              tone="accent"
              wash
              label={`Fees paid per ${per}`}
              valueFormatter={money}
            />
          </div>
        ) : null}
        {!loading && summary.byToken.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="d-label">Paid in</p>
            <ul className="flex flex-col gap-1.5">
              {summary.byToken.slice(0, FEE_TOKENS).map((token) => (
                <li key={token.key} className="flex items-center gap-2 text-[13px]">
                  <ChainLogo chainId={token.key.split(":")[0]} size={16} />
                  <span className="min-w-0 flex-1 truncate text-fg-muted">
                    <TokenAmount amount={token.amount} decimals={token.decimals} symbol={token.symbol} maxFraction={4} className="text-fg" />
                    <span className="text-fg-dim">
                      {" "}
                      · {formatNumber(token.count)} {token.count === 1 ? "fee" : "fees"}
                    </span>
                  </span>
                  <Money value={token.value} currency={currency} className="tabular-nums text-fg-muted" reason="No price for this token" />
                </li>
              ))}
            </ul>
            {summary.byToken.length > FEE_TOKENS ? (
              <p className="text-[12px] text-fg-dim">and {summary.byToken.length - FEE_TOKENS} more fee tokens</p>
            ) : null}
          </div>
        ) : null}
        {!loading && summary.count > 0 ? (
          <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-[var(--d-hairline)] pt-3 text-[12.5px] text-fg-dim">
            <span>
              Total <Money value={summary.value} currency={currency} className="font-medium text-fg" reason="No fee token has a price" />
            </span>
            <span>
              Avg per transaction <Money value={average} currency={currency} className="text-fg-muted" reason="No fee token has a price" />
            </span>
            {unpricedChains.length > 0 ? (
              <span className="w-full">
                Not priced: {unpricedChains.map((chain) => chainById(chain.chainId)?.chainName ?? chain.chainId).join(", ")}
              </span>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Most-used networks / counterparties                                         */
/* -------------------------------------------------------------------------- */

export interface ActivityUsageProps {
  rows: readonly ActivityItem[];
  singleChain: boolean;
  /** Key parts of the wallet's own addresses (`bech32Body`), to name the viewer among counterparties. */
  ownBodies: ReadonlySet<string>;
  now: number | null;
  loading: boolean;
  pending: boolean;
  className?: string;
}

/**
 * The chain an address belongs to, from its prefix (an operator address
 * reads as its chain's). A counterparty often lives on another chain than
 * the transaction: the sender of an IBC transfer that arrived here.
 */
function chainOfAddress(address: string, hint: string): string {
  const prefix = bech32Prefix(address)?.replace(/valoper$/, "");
  return (prefix ? findChainsByPrefix(prefix, hint)[0]?.chainId : undefined) ?? hint;
}

/** "osmo1f88a…6ejt", or who it is when it is the viewer: "You · Safrochain", "Your validator · Safrochain". */
function counterpartyLabel(address: string, chainId: string, ownBodies: ReadonlySet<string>): string {
  const role = ownRole(address, ownBodies);
  const name = chainById(chainId)?.chainName ?? chainId;
  if (role === "you") return `You · ${name}`;
  if (role === "validator") return `Your validator · ${name}`;
  return shortenAddress(address, 10, 4);
}

function kindsText(kinds: Partial<Record<ActivityKind, number>>): string {
  return Object.entries(kinds)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 3)
    .map(([kind, count]) => `${count} ${KIND_LABELS[kind as ActivityKind].toLowerCase()}`)
    .join(" · ");
}

export function ActivityUsage({ rows, singleChain, ownBodies, now, loading, pending, className }: ActivityUsageProps) {
  const usage = useMemo(() => chainUsage(rows), [rows]);
  // Self-transfers name the account itself as the other side: not a counterparty.
  const counterparties = useMemo(() => topCounterparties(rows.filter((row) => row.counterparty !== row.address), 6), [rows]);
  const [picked, setPicked] = useState<"networks" | "counterparties" | null>(null);
  // A ranking of one is a stat, not a chart: with one network in use, lead
  // with counterparties. While loading the card keeps its all-chains face, so
  // its title does not flip when the rows arrive.
  const canRankNetworks = !singleChain && (loading || usage.length > 1);
  const mode = canRankNetworks ? (picked ?? "networks") : "counterparties";

  const items: BarListItem[] =
    mode === "networks"
      ? usage.map((chain) => ({
          id: chain.chainId,
          label: chainById(chain.chainId)?.chainName ?? chain.chainId,
          value: chain.count,
          icon: <ChainLogo chainId={chain.chainId} size={16} />,
          detail: [chain.failed > 0 ? `${chain.failed} failed` : null, now !== null ? `last ${formatRelativeTime(chain.lastTime, now)}` : null]
            .filter(Boolean)
            .join(" · "),
        }))
      : counterparties.map((party) => {
          const home = chainOfAddress(party.address, party.chainId);
          return {
            id: `${party.chainId}|${party.address}`,
            label: counterpartyLabel(party.address, home, ownBodies),
            value: party.count,
            icon: <ChainLogo chainId={home} size={16} />,
            detail: `${party.address} · ${kindsText(party.kinds)}`,
          };
        });

  return (
    <Card pending={pending} className={className}>
      <CardHeader
        title={canRankNetworks ? "Most used" : "Top counterparties"}
        subtitle={mode === "networks" ? "Transactions per network" : "Addresses, validators and contracts you deal with most"}
        actions={
          canRankNetworks ? (
            <Segmented<"networks" | "counterparties">
              ariaLabel="Rank"
              value={mode}
              onChange={setPicked}
              options={[
                { value: "networks", label: "Networks" },
                { value: "counterparties", label: "Addresses", ariaLabel: "Counterparty addresses" },
              ]}
            />
          ) : undefined
        }
      />
      <CardBody>
        <BarList
          items={items}
          valueFormatter={countFormatter}
          limit={6}
          title={mode === "networks" ? "Transactions per network" : "Transactions per counterparty"}
          loading={loading}
          pending={pending}
          empty={mode === "networks" ? "No transactions in this view" : "No counterparties in this view"}
        />
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* When you transact (weekday × hour)                                          */
/* -------------------------------------------------------------------------- */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAYS_PLURAL = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"] as const;

/** "2 AM", "12 PM" (en-US, as the rest of the dashboard's times). */
function hourText(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

/** Axis ticks every six hours, short: "12a", "6a", "12p", "6p". */
function hourTick(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "a" : "p"}`;
}

/**
 * One hue, light to dark (a sequential scale), on a square-root ramp so a
 * single busy hour does not wash every other cell out. Empty cells keep the
 * quiet glass, never the scale's first step: "none" must not read as "a few".
 */
function heatColor(count: number, max: number): string {
  if (count <= 0 || max <= 0) return "var(--d-glass)";
  const share = Math.round(22 + 78 * Math.sqrt(count / max));
  return `color-mix(in srgb, var(--viz-accent) ${share}%, var(--d-glass-2))`;
}

/** Below this many transactions a "busiest hour" is an anecdote, not a habit. */
const RHYTHM_MIN = 5;

export interface ActivityRhythmProps {
  rows: readonly ActivityItem[];
  loading: boolean;
  pending: boolean;
  className?: string;
}

export function ActivityRhythm({ rows, loading, pending, className }: ActivityRhythmProps) {
  const matrix = useMemo(() => hourMatrix(rows), [rows]);
  const { peak } = matrix;
  const summary = !peak
    ? "No transactions in this view"
    : matrix.total < RHYTHM_MIN
      ? `${formatNumber(matrix.total)} ${matrix.total === 1 ? "transaction" : "transactions"} so far: too few for a pattern yet`
      : `Busiest: ${WEEKDAYS_PLURAL[peak.weekday]} around ${hourText(peak.hour)} (${formatNumber(peak.count)} ${peak.count === 1 ? "transaction" : "transactions"})`;

  return (
    <Card pending={pending} className={className}>
      <CardHeader
        title="When you transact"
        subtitle="Day of the week × hour, your local time"
        info="Each square is one hour of the week; the darker it is, the more transactions started in it. Automated jobs (an auto-compounder, a daily payout) show up as a single dark column."
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        {loading ? (
          <Skeleton className="h-[136px] w-full rounded-[8px]" />
        ) : matrix.total === 0 ? (
          <p className="py-6 text-center text-[13px] text-fg-dim">No transactions in this view</p>
        ) : (
          // Square cells while the card is narrow; wider cells once it is
          // wide, so the grid keeps about the same height as its neighbours
          // instead of growing with the card's width.
          <figure role="img" aria-label={`Transactions by day of the week and hour. ${summary}.`} className="@container m-0 w-full">
            <div aria-hidden className="grid grid-cols-[2.25rem_repeat(24,minmax(0,1fr))] gap-[2px]">
              {matrix.cells.map((hours, weekday) => (
                <Fragment key={WEEKDAYS[weekday]}>
                  <span className="self-center font-mono text-[10.5px] leading-none text-fg-dim">{WEEKDAYS[weekday]}</span>
                  {hours.map((count, hour) => (
                    <span
                      key={hour}
                      title={`${WEEKDAYS[weekday]} ${hourText(hour)}: ${count} ${count === 1 ? "transaction" : "transactions"}`}
                      className="aspect-square min-h-[7px] rounded-[2px] @[26rem]:aspect-[3/2]"
                      style={{ background: heatColor(count, matrix.max) }}
                    />
                  ))}
                </Fragment>
              ))}
              <span />
              {/* fg-dim like the weekday labels: at 10px the faint grey is
                  under 4.5:1 on the card in both themes. */}
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={`tick-${hour}`} className="pt-1 text-center font-mono text-[10px] leading-none text-fg-dim">
                  {hour % 6 === 0 ? hourTick(hour) : ""}
                </span>
              ))}
            </div>
          </figure>
        )}
        {!loading && matrix.total > 0 ? <p className="mt-auto text-[12.5px] leading-snug text-fg-muted">{summary}</p> : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Sent vs received per token                                                  */
/* -------------------------------------------------------------------------- */

export interface ActivityFlowsProps {
  rows: readonly ActivityItem[];
  prices: PriceMap;
  currency: string;
  /** Key parts of the wallet's own addresses: transfers between them are left out (`isOwnTransfer`). */
  ownBodies: ReadonlySet<string>;
  loading: boolean;
  pending: boolean;
  className?: string;
}

const FLOW_ROWS = 5;

export function ActivityFlows({ rows, prices, currency, ownBodies, loading, pending, className }: ActivityFlowsProps) {
  // Tokens moved from one of the wallet's accounts to another are not
  // "sent" and "received" twice: they are left out and counted below.
  const { flows, internal } = useMemo(() => {
    const external = rows.filter((row) => !isOwnTransfer(row, ownBodies));
    return { flows: flowSummary(external, { prices }), internal: rows.length - external.length };
  }, [rows, prices, ownBodies]);
  const logos = useMemo(() => {
    const out = new Map<string, string | undefined>();
    for (const row of rows) for (const amount of row.amounts) if (!out.has(amount.identity.key)) out.set(amount.identity.key, amount.identity.logoUrl);
    return out;
  }, [rows]);
  const tokens = flows.byToken.slice(0, FLOW_ROWS);

  return (
    <Card pending={pending} className={className}>
      <CardHeader
        title={
          <>
            Sent vs received
            <EstTag />
          </>
        }
        subtitle="Transfers and IBC per token · net at today's prices"
        info={`What arrived and what left through transfers and IBC transfers, per token. Swaps, staking rewards and transfers between your own accounts are not counted here. ${flows.method}`}
      />
      <CardBody>
        {loading ? (
          <ul aria-hidden className="flex flex-col gap-4">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex items-center gap-3">
                <Skeleton circle width={28} />
                <span className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3" width="30%" />
                  <Skeleton className="h-2.5" width="55%" />
                </span>
                <Skeleton className="h-3 w-16" />
              </li>
            ))}
          </ul>
        ) : tokens.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-fg-dim">{internal > 0 ? "Only transfers between your own accounts" : "No transfers in this view"}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--d-hairline)]">
            {tokens.map((token) => {
              const net = token.inValue === null && token.outValue === null ? null : (token.inValue ?? 0) - (token.outValue ?? 0);
              const inShare =
                token.inValue !== null && token.outValue !== null && token.inValue + token.outValue > 0
                  ? token.inValue / (token.inValue + token.outValue)
                  : null;
              const hasIn = BigInt(token.in) > BigInt(0);
              const hasOut = BigInt(token.out) > BigInt(0);
              return (
                <li key={token.key} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <AssetLogo src={logos.get(token.key)} symbol={token.symbol} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-fg">{token.symbol}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] tabular-nums text-fg-dim">
                        {hasIn ? (
                          <span>
                            In{" "}
                            <span className="text-[var(--d-pos)]">
                              +<TokenAmount amount={token.in} decimals={token.decimals} maxFraction={2} />
                            </span>
                          </span>
                        ) : null}
                        {hasOut ? (
                          <span>
                            Out{" "}
                            <span className="text-fg-muted">
                              {MINUS}
                              <TokenAmount amount={token.out} decimals={token.decimals} maxFraction={2} />
                            </span>
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-[14px] font-medium tabular-nums", net !== null && net > 0 ? "text-[var(--d-pos)]" : "text-fg")}>
                        <Money value={net} currency={currency} signed compact reason="No price for this token" />
                      </p>
                      <p className="mt-0.5 text-[12px] text-fg-dim">net</p>
                    </div>
                  </div>
                  {inShare !== null ? (
                    <div aria-hidden className="flex h-1 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
                      <span className="h-full bg-[var(--d-pos)]" style={{ width: `${inShare * 100}%` }} />
                      <span className="h-full flex-1 bg-fg-dim opacity-40" />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {!loading && flows.byToken.length > FLOW_ROWS ? (
          <p className="mt-3 text-[12px] text-fg-dim">and {flows.byToken.length - FLOW_ROWS} more tokens (in the CSV export)</p>
        ) : null}
        {!loading && flows.unpriced > 0 ? (
          <p className="mt-3 text-[12px] text-fg-dim">
            {flows.unpriced} {flows.unpriced === 1 ? "amount has" : "amounts have"} no price and {flows.unpriced === 1 ? "is" : "are"} shown in tokens only.
          </p>
        ) : null}
        {!loading && internal > 0 ? (
          <p className="mt-3 text-[12px] text-fg-dim">
            {formatNumber(internal)} {internal === 1 ? "transfer" : "transfers"} between your own accounts {internal === 1 ? "is" : "are"} not counted.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
