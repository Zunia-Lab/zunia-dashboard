"use client";

/**
 * This wallet's latest swaps in the current scope, from its on-chain history
 * (the activity reader classifies Osmosis pool swaps, contract swaps and the
 * IBC transfers that carry one). Shares the activity hook's request with the
 * rest of the dashboard and filters the loaded rows here, as the activity
 * contract recommends: the server's `kinds` filter is slow for rare kinds.
 */

import { memo, useMemo } from "react";
import {
  AssetLogo,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  DataTable,
  EmptyState,
  InlineError,
  PartialDataBadge,
  RelativeTime,
  StatusBadge,
  TokenAmount,
  chainById,
  type Column,
} from "@/components/ui";
import { formatDate, formatPercent } from "@/lib/format";
import type { ActivityAmount, ActivityItem } from "@/lib/activity/types";
import { rowKey } from "@/lib/activity/paging";
import { useSpotPrices } from "@/lib/data/prices";
import { maskAmounts } from "@/lib/notifications/text";
import { useActivity } from "@/lib/useActivity";
import { usePrefs } from "@/providers/PrefsProvider";
import { compactRatio, executedRate, type ExecutedRate } from "./swap-analysis";
import { marketRate, versus } from "./swap-view";

const SHOWN = 8;

/**
 * The row's sentence as privacy mode allows it. The activity reader's summary
 * spells out both amounts ("Swapped 3,490 SAF → 20.297 OSMO", "Failed to swap
 * 3,190 SAF for OSMO"), and it is shown as text (a failed swap moved nothing,
 * so its sentence is its only line) and as the row's tooltip: both mask every
 * amount like the TokenAmounts beside them, as every other surface showing
 * these sentences does. Tickers, addresses and ibc/ hashes stay.
 */
function summaryText(item: Pick<ActivityItem, "summary">, hidden: boolean): string {
  return hidden ? maskAmounts(item.summary, "swap") : item.summary;
}

function Amounts({ amounts, sign }: { amounts: ActivityAmount[]; sign: "−" | "+" }) {
  if (amounts.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
      {amounts.slice(0, 2).map((amount) => (
        <span key={`${amount.denom}-${amount.direction}`} className="inline-flex items-center gap-1 whitespace-nowrap">
          <AssetLogo src={amount.identity.logoUrl ?? null} symbol={amount.identity.ticker} size={18} />
          <span className={sign === "+" ? "text-[var(--d-pos)]" : "text-fg"}>
            {sign}
            <TokenAmount amount={amount.amount} decimals={amount.identity.decimals} symbol={amount.identity.ticker} maxFraction={4} />
          </span>
        </span>
      ))}
      {amounts.length > 2 ? <span className="text-fg-dim">+{amounts.length - 2}</span> : null}
    </span>
  );
}

function SwapLine({ item }: { item: ActivityItem }) {
  const { hideAmounts } = usePrefs();
  const out = item.amounts.filter((amount) => amount.direction === "out");
  const got = item.amounts.filter((amount) => amount.direction === "in");
  // Nothing moved (a failed swap): the sentence is the row's main line.
  if (out.length === 0 && got.length === 0) return <span className="truncate text-fg">{summaryText(item, hideAmounts)}</span>;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] tabular-nums">
      <Amounts amounts={out} sign="−" />
      {out.length > 0 && got.length > 0 ? <span aria-hidden className="text-fg-faint">→</span> : null}
      <Amounts amounts={got} sign="+" />
    </span>
  );
}

function Status({ item }: { item: ActivityItem }) {
  return item.success ? (
    <StatusBadge tone="success">Done</StatusBadge>
  ) : (
    <StatusBadge tone="danger">Failed</StatusBadge>
  );
}

/** Memoised: it takes no props, so the page's per-second clock never re-renders it. */
export const RecentSwaps = memo(function RecentSwaps() {
  const { hideAmounts } = usePrefs();
  const activity = useActivity();
  const swaps = useMemo(() => activity.items.filter((item) => item.kind === "swap").slice(0, SHOWN), [activity.items]);
  // The rate each swap gave, and today's market rate for the same pair: how
  // the swap compares now (fees and price moves since, together).
  const rates = useMemo(() => new Map(swaps.map((item) => [rowKey(item), executedRate(item)] as const)), [swaps]);
  const priceKeys = useMemo(() => [...new Set([...rates.values()].flatMap((rate) => (rate ? [rate.fromKey, rate.toKey] : [])))], [rates]);
  const spot = useSpotPrices(priceKeys);
  const priceOf = (key: string) => spot.data?.prices[key]?.price ?? null;
  const vsNow = (rate: ExecutedRate) => versus(rate.rate, marketRate(priceOf(rate.fromKey), priceOf(rate.toKey)));
  const oldest = useMemo(() => {
    const times = activity.coverage.map((entry) => (entry.oldest ? Date.parse(entry.oldest) : NaN)).filter(Number.isFinite);
    return times.length > 0 ? Math.max(...times) : null;
  }, [activity.coverage]);

  const columns: Column<ActivityItem>[] = [
    {
      key: "swap",
      header: "Swap",
      cell: (item) => {
        const summary = summaryText(item, hideAmounts);
        return (
          <div className="min-w-0 py-1" title={summary}>
            <SwapLine item={item} />
            {item.amounts.length === 0 ? null : item.success ? null : (
              <p className="mt-0.5 truncate text-[12px] text-fg-dim">{summary}</p>
            )}
          </div>
        );
      },
      minWidth: 280,
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      hideBelow: "md",
      cell: (item) => {
        const rate = rates.get(rowKey(item));
        if (!rate) return <span className="text-fg-dim">—</span>;
        const now = vsNow(rate);
        return (
          <span className="block whitespace-nowrap text-right tabular-nums">
            <span className="text-fg">
              1 {rate.fromTicker} = {compactRatio(rate.rate) ?? "—"} {rate.toTicker}
            </span>
            {now !== null ? (
              <span
                className="block text-[12px] text-fg-dim"
                title="This swap's rate against the market rate now, from today's prices (an estimate): fees and price moves since, together."
              >
                {formatPercent(now, { signed: true, digits: 1 })} vs now
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "chain",
      header: "Chain",
      hideBelow: "lg",
      cell: (item) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-fg-muted">
          <ChainLogo chainId={item.chainId} size={18} />
          {chainById(item.chainId)?.chainName ?? item.chainId}
        </span>
      ),
    },
    {
      key: "fee",
      header: "Network fee",
      align: "right",
      hideBelow: "lg",
      cell: (item) =>
        item.fee && item.feePaid ? (
          <TokenAmount amount={item.fee.amount} decimals={item.fee.decimals ?? null} symbol={item.fee.symbol} maxFraction={4} className="text-fg-muted" />
        ) : (
          <span className="text-fg-dim">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (item) => <Status item={item} />,
    },
    {
      key: "time",
      header: "When",
      align: "right",
      cell: (item) => <RelativeTime at={Date.parse(item.time)} className="whitespace-nowrap text-fg-muted" />,
    },
  ];

  const empty = (
    <EmptyState
      inline
      icon="swap"
      title="No swaps in the loaded history"
      body="Swaps you make, here or in any Osmosis app, show up once they are in your on-chain history."
    />
  );

  return (
    <Card as="section" padding="default" pending={activity.stale} aria-labelledby="swap-recent-title">
      <CardHeader
        id="swap-recent-title"
        title="Your recent swaps"
        subtitle={
          oldest !== null
            ? `From your on-chain history in this scope, loaded back to ${formatDate(oldest, "short")}`
            : "From your on-chain history in this scope"
        }
        refreshing={activity.refreshing}
        actions={
          <>
            <PartialDataBadge errors={activity.errors.length > 0 ? activity.errors : null} />
            <Button variant="ghost" size="sm" href="/activity" iconRight="arrowRight">
              All activity
            </Button>
          </>
        }
      />
      {activity.error && activity.items.length === 0 ? (
        <InlineError title="Couldn't load your history" message={activity.error.message} onRetry={activity.refetch} />
      ) : swaps.length === 0 && !activity.loading ? (
        // No table frame around nothing: the header row of five columns over an
        // empty line reads as a broken table.
        empty
      ) : (
        <CardBody flush>
          <DataTable<ActivityItem>
            ariaLabel="Your recent swaps"
            columns={columns}
            rows={swaps}
            getRowKey={(item) => `${item.chainId}:${item.hash}:${item.address}`}
            rowHref={(item) => `/activity/${item.hash}?chainId=${encodeURIComponent(item.chainId)}`}
            loading={activity.loading}
            skeletonRows={3}
            stickyHeader={false}
            mobileCard={(item) => (
              <div className="flex min-w-0 flex-col gap-1.5">
                <SwapLine item={item} />
                {(() => {
                  const rate = rates.get(rowKey(item));
                  if (!rate) return null;
                  const now = vsNow(rate);
                  return (
                    <p className="truncate text-[12px] tabular-nums text-fg-muted">
                      1 {rate.fromTicker} = {compactRatio(rate.rate) ?? "—"} {rate.toTicker}
                      {now !== null ? <span className="text-fg-dim"> · {formatPercent(now, { signed: true, digits: 1 })} vs now</span> : null}
                    </p>
                  );
                })()}
                <div className="flex items-center justify-between gap-3 text-[12px] text-fg-dim">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <ChainLogo chainId={item.chainId} size={16} />
                    <span className="truncate">{chainById(item.chainId)?.chainName ?? item.chainId}</span>
                    <span aria-hidden>·</span>
                    <RelativeTime at={Date.parse(item.time)} />
                  </span>
                  <Status item={item} />
                </div>
              </div>
            )}
          />
        </CardBody>
      )}
    </Card>
  );
});
