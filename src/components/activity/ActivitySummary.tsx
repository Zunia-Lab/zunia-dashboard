"use client";

/**
 * The analytics strip: six figures over the rows on screen (range, chips and
 * search applied), so every number agrees with the list under it.
 *
 * Money is an estimate at today's prices (the analytics module's method) and
 * says so: an "est." tag on the label and the method behind the (i). An
 * unpriced amount is left out and counted, never valued at 0.
 *
 * With a date range, the counts and the fee total also show their change
 * against the period just before (same length, same filters), but only once
 * every chain is complete for that period too: the comparison is the page's
 * (`comparisonState`), the tiles only print it. A change is neutral grey:
 * more transactions is neither good nor bad news.
 */

import { useMemo, type ReactNode } from "react";
import { Delta, Money, Percent, StatTile, TokenAmount, useIsPhone } from "@/components/ui";
import { feeSummary, flowSummary, groupCounts, successRate, type PriceMap } from "@/lib/activity/analytics";
import type { ActivityItem } from "@/lib/activity/types";
import { cn } from "@/lib/cn";
import { formatDate, formatNumber } from "@/lib/format";
import { isOwnTransfer, netFlowReading, type ChartWindow, type PeriodComparison } from "./view";

export interface ActivitySummaryProps {
  rows: readonly ActivityItem[];
  prices: PriceMap;
  currency: string;
  window: ChartWindow | null;
  /** Per-bucket transaction counts, oldest first (the Transactions tile's trend). */
  trend: number[];
  /** The same figures over the period before the range, when it can be compared. */
  comparison: PeriodComparison | null;
  /** Key parts of the wallet's own addresses: transfers between them are not flows (`isOwnTransfer`). */
  ownBodies: ReadonlySet<string>;
  /**
   * Every network in scope is read and complete for the range
   * (`historyComplete`): a view without transfers then nets to a known $0.
   */
  complete: boolean;
  /** First load: skeleton tiles. */
  loading: boolean;
  /** Prices are still on their way: money tiles wait instead of reading "—". */
  pricesLoading: boolean;
  className?: string;
}

/**
 * The "est." tag that rides on a money label. It sits inside headings, so it
 * brings its own space and reads "(estimate)" to assistive tech: the
 * heading's name is "Fees paid (estimate)", never "Fees paidest.".
 */
export function EstTag() {
  return (
    <>
      {" "}
      <span aria-hidden className="rounded-[4px] bg-[var(--d-glass-2)] px-1 py-px font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-fg-muted">
        est.
      </span>
      <span className="sr-only">(estimate)</span>
    </>
  );
}

/**
 * The pace that reads best: "3.1 a day", "2 a week", or for a quiet account
 * "1 in 30 days" (never "0.033 a day").
 */
function paceText(count: number, days: number | null): string | null {
  if (count === 0 || days === null || days < 1) return null;
  const perDay = count / days;
  if (perDay >= 1) return `${formatNumber(perDay, { maxFraction: perDay < 10 ? 1 : 0 })} a day`;
  const perWeek = (count * 7) / days;
  if (perWeek >= 1 && days >= 14) return `${formatNumber(perWeek, { maxFraction: perWeek < 10 ? 1 : 0 })} a week`;
  return `${formatNumber(count)} in ${formatNumber(Math.round(days))} days`;
}

function Sep() {
  return <span aria-hidden className="mx-1 text-fg-faint">·</span>;
}

/**
 * A figure with its change against the previous period beside it, in neutral
 * grey (counts and fee totals are not good or bad by themselves). What it is
 * compared with is said once, in the coverage banner over the strip, and in
 * each tile's (i).
 *
 * The row is one line tall and clips what wraps: on a tile too narrow for
 * both, the change drops out of sight instead of squeezing the figure.
 */
function WithChange({ children, change }: { children: ReactNode; change: number | null | undefined }) {
  if (change === null || change === undefined) return <>{children}</>;
  return (
    <span className="flex h-[1.15em] flex-wrap items-baseline gap-x-2 overflow-hidden">
      <span className="shrink-0">{children}</span>
      <Delta value={change} kind="pct" digits={Math.abs(change) < 10 ? 1 : 0} className="tracking-normal text-fg-muted" />
    </span>
  );
}

export function ActivitySummary({ rows, prices, currency, window, trend, comparison, ownBodies, complete, loading, pricesLoading, className }: ActivitySummaryProps) {
  const model = useMemo(() => {
    const groups = groupCounts(rows);
    const stats = { count: rows.length, swaps: groups.swaps, ibcTransfers: groups.ibc, fees: feeSummary(rows, prices), success: successRate(rows) };
    // Money moved between the wallet's own accounts is neither in nor out.
    const external = rows.filter((row) => !isOwnTransfer(row, ownBodies));
    const flows = flowSummary(external, { prices });
    const swaps = flowSummary(rows, { prices, groups: ["swaps"] });
    const failedRows = rows.filter((row) => !row.success);
    const failedFees = feeSummary(failedRows, prices);
    let ibcOut = 0;
    let ibcIn = 0;
    for (const row of rows) {
      if (row.kind === "ibc-out") ibcOut += 1;
      else if (row.kind === "ibc-in") ibcIn += 1;
    }
    return { stats, flows, internal: rows.length - external.length, swaps, failedFees, ibcOut, ibcIn };
  }, [rows, prices, ownBodies]);

  const { stats, flows, internal, swaps, failedFees, ibcOut, ibcIn } = model;
  const { fees, success } = stats;
  const net = netFlowReading(flows, complete);
  const moneyLoading = loading || (pricesLoading && rows.length > 0);
  const pace = paceText(stats.count, window?.days ?? null);
  // A trend needs at least two active buckets: one bar in a month of zeros
  // draws a "spike" out of a single transaction.
  const activeBuckets = trend.filter((value) => value > 0).length;
  const unpricedFlows = flows.unpriced > 0 ? ` ${flows.unpriced} ${flows.unpriced === 1 ? "amount has" : "amounts have"} no price and ${flows.unpriced === 1 ? "is" : "are"} left out.` : "";
  const internalFlows =
    internal > 0 ? ` ${formatNumber(internal)} ${internal === 1 ? "transfer" : "transfers"} between your own accounts ${internal === 1 ? "is" : "are"} left out too.` : "";
  const change = comparison?.change;
  const isPhone = useIsPhone();
  // Said once per tile, in its (i): what the grey ▲▼ compares with.
  const versus = comparison
    ? ` The change (▲▼) compares with the ${formatNumber(Math.round((comparison.to - comparison.from) / 86_400_000))} days before, ${formatDate(comparison.from, "short")} – ${formatDate(comparison.to, "short")}, same filters.`
    : "";

  const topFees = fees.byToken.slice(0, 2);
  const feeSub: ReactNode =
    fees.count === 0 ? (
      "None paid by you"
    ) : (
      <>
        {topFees.map((token, index) => (
          <span key={token.key}>
            {index > 0 ? <Sep /> : null}
            <TokenAmount amount={token.amount} decimals={token.decimals} symbol={token.symbol} maxFraction={2} />
          </span>
        ))}
        {fees.byToken.length > 2 ? <span className="text-fg-dim"> +{fees.byToken.length - 2}</span> : null}
      </>
    );

  const failed = success.failed;
  const rateTone = success.total === 0 ? "default" : failed > 0 ? "warning" : "positive";

  return (
    <section aria-label="Activity figures" className={cn("@container", className)}>
      <div className="grid grid-cols-2 gap-[var(--d-gap)] @[640px]:grid-cols-3 @[1180px]:grid-cols-6">
        <StatTile
          label="Transactions"
          value={<WithChange change={change?.transactions}>{formatNumber(stats.count)}</WithChange>}
          sub={stats.count === 0 ? "None in this view" : (pace ?? undefined)}
          // On a phone the tile is too narrow for both: the change says more
          // than a shape the chart below draws in full.
          trend={trend.length > 1 && activeBuckets >= 2 && !(isPhone && typeof change?.transactions === "number") ? trend : undefined}
          loading={loading}
          info={`Transactions listed for your accounts in this view. One transaction between two of your own accounts counts once per account.${versus}`}
        />
        <StatTile
          label={
            <>
              Net flow
              <EstTag />
            </>
          }
          value={
            <Money
              value={net.state === "priced" ? net.net : net.state === "none" ? 0 : null}
              currency={currency}
              signed
              compact
              reason={
                net.state === "unpriced"
                  ? "No transferred token in this view has a price"
                  : "No transfer among the transactions read, but the history isn't complete for this view"
              }
            />
          }
          sub={
            net.state === "unpriced" ? (
              "Not priced"
            ) : net.state === "unknown" ? (
              "No transfers loaded"
            ) : (
              // A view without transfers still reads In $0.00 · Out $0.00: its
              // history is complete, so nothing came in and nothing went out.
              <>
                In <Money value={net.state === "priced" ? net.inValue : 0} currency={currency} compact />
                <Sep />
                Out <Money value={net.state === "priced" ? net.outValue : 0} currency={currency} compact />
              </>
            )
          }
          loading={moneyLoading}
          info={`What you received minus what you sent, through transfers and IBC transfers only (swaps and staking rewards are not counted). ${flows.method}${unpricedFlows}${internalFlows}${
            net.state === "unknown" ? " Shown as unavailable until every network's history covers this view." : ""
          }`}
        />
        <StatTile
          label={
            <>
              Fees paid
              <EstTag />
            </>
          }
          value={
            fees.value !== null || topFees.length === 0 ? (
              <WithChange change={change?.fees}>
                <Money value={fees.value ?? (fees.count === 0 ? 0 : null)} currency={currency} compact reason="No priced fee token" />
              </WithChange>
            ) : (
              <TokenAmount amount={topFees[0].amount} decimals={topFees[0].decimals} symbol={topFees[0].symbol} maxFraction={4} />
            )
          }
          sub={feeSub}
          loading={moneyLoading}
          info={`Network fees this account paid in this view, per fee token and in total. Fees covered by a fee grant or paid by another signer are not counted. ${fees.method}${versus}`}
        />
        <StatTile
          label="Swaps"
          value={<WithChange change={change?.swaps}>{formatNumber(stats.swaps)}</WithChange>}
          sub={
            stats.swaps === 0 ? (
              "None in this view"
            ) : swaps.outValue !== null ? (
              <>
                <Money value={swaps.outValue} currency={currency} compact /> sold (est.)
              </>
            ) : (
              "Not priced"
            )
          }
          loading={loading}
          info={`Swaps you made, and the value of what you sold in them at today's prices.${versus}`}
        />
        <StatTile
          label="IBC transfers"
          value={<WithChange change={change?.ibc}>{formatNumber(stats.ibcTransfers)}</WithChange>}
          sub={stats.ibcTransfers === 0 ? "None in this view" : `${formatNumber(ibcOut)} out · ${formatNumber(ibcIn)} in`}
          loading={loading}
          info={`Transfers between chains: sent from one of your accounts (out) or arrived in one (in).${versus}`}
        />
        <StatTile
          label="Success rate"
          tone={rateTone}
          value={
            success.rate === null ? (
              <Percent value={null} reason="No transactions in this view" />
            ) : (
              // Whole numbers at the ends: "100%" and "0%", never "0.0%".
              <Percent value={success.rate * 100} digits={success.rate === 1 || success.rate === 0 ? 0 : 1} />
            )
          }
          sub={
            success.total === 0 ? (
              "No transactions"
            ) : failed === 0 ? (
              "No failed transactions"
            ) : (
              <>
                {formatNumber(failed)} failed
                {failedFees.value !== null && failedFees.value > 0 ? (
                  <span className="max-sm:hidden">
                    <Sep />
                    <Money value={failedFees.value} currency={currency} compact /> lost
                  </span>
                ) : null}
              </>
            )
          }
          loading={loading}
          info="Share of transactions the chain executed. A failed transaction changes nothing but still costs its fee."
        />
      </div>
    </section>
  );
}
