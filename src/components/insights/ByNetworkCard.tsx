"use client";

/**
 * Where the insights are, network by network (All-chains scope): each chain
 * in scope with what was found there in words ("1 warning · 2 info"), beside
 * what you hold there and its share of your priced value, so a warning on
 * the chain that holds most of the money stands out from one on dust. Most
 * severe first.
 *
 * A chain with nothing found stays listed and says so: silence would read the
 * same as a chain that was never checked. A row puts the whole dashboard on
 * that chain. A chain you do not follow can still carry an insight (assets
 * that depend on Stride, held on the Hub): it is listed as "not followed" and
 * opens its chain page, since the dashboard cannot be scoped to it.
 */

import Link from "next/link";
import { useMemo } from "react";
import { Icon } from "@/components/icons";
import { Card, CardBody, CardFooter, CardHeader, ChainLogo, Money, Skeleton } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { formatPercent } from "@/lib/format";
import type { Insight } from "@/lib/insights/rules";
import type { PortfolioResponse } from "@/lib/token/wire";
import { SEVERITY_INK } from "./InsightsSummary";
import { SEVERITIES, chainValues, insightsByChain, severityCountText, type ChainInsightRow, type ChainValue } from "./model";

const ROW =
  "group flex min-h-14 w-full items-center gap-3 px-[var(--d-pad)] py-2.5 text-left transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)] focus-visible:outline-offset-[-2px]";

export interface ByNetworkCardProps {
  items: readonly Insight[];
  chainIds: readonly string[];
  /** The balances read: the value beside each network. */
  portfolio: PortfolioResponse | null;
  loading: boolean;
  pending: boolean;
  onSelect: (chainId: string) => void;
  className?: string;
}

export function ByNetworkCard({ items, chainIds, portfolio, loading, pending, onSelect, className }: ByNetworkCardProps) {
  const tally = useMemo(() => insightsByChain(items, chainIds), [items, chainIds]);
  const values = useMemo(() => chainValues(portfolio), [portfolio]);
  return (
    <Card pending={pending} className={className}>
      <CardHeader title="By network" subtitle="Most severe first · select one to focus the dashboard on it" icon="networks" />
      <CardBody flush>
        {loading && items.length === 0 ? (
          <ul aria-hidden className="border-t border-[var(--d-hairline)]">
            {chainIds.slice(0, 5).map((chainId) => (
              <li key={chainId} className="flex items-center gap-3 px-[var(--d-pad)] py-3">
                <Skeleton circle width={26} />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-32" />
                </span>
                <Skeleton className="h-3 w-12" />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="divide-y divide-[var(--d-hairline)] border-t border-[var(--d-hairline)]">
            {tally.rows.map((row) => {
              const name = findChain(row.chainId)?.chainName ?? row.chainId;
              const followed = chainIds.includes(row.chainId);
              const body = (
                <>
                  <ChainLogo chainId={row.chainId} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-fg">{name}</span>
                    <Found row={row} value={values.get(row.chainId) ?? null} />
                  </span>
                  <ValueCell followed={followed} value={values.get(row.chainId) ?? null} currency={portfolio?.currency ?? "usd"} />
                  <Icon name={followed ? "chevronRight" : "arrowUpRight"} size={14} className="shrink-0 text-fg-faint transition-colors group-hover:text-fg-dim" />
                </>
              );
              return (
                <li key={row.chainId}>
                  {/* The row's own text is its name (counts, value, share and the
                      privacy mask included); only the outcome is added for
                      screen readers. */}
                  {followed ? (
                    <button type="button" onClick={() => onSelect(row.chainId)} className={ROW}>
                      {body}
                      <span className="sr-only">. Show only {name}</span>
                    </button>
                  ) : (
                    <Link href={`/chains/${encodeURIComponent(row.chainId)}`} className={ROW}>
                      {body}
                      <span className="sr-only">. Open its chain page</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {tally.acrossChains > 0 ? (
        <CardFooter className="text-[12.5px]">
          {tally.acrossChains} {tally.acrossChains === 1 ? "insight is" : "insights are"} about your whole portfolio rather than one network.
        </CardFooter>
      ) : null}
    </Card>
  );
}

/**
 * "● 1 warning  ● 2 info" under the name. With nothing found, "Nothing
 * found" only where the chain's balances were read: a chain that failed or
 * was not read yet says so, since no rule could have fired there.
 */
function Found({ row, value }: { row: ChainInsightRow; value: ChainValue | null }) {
  if (row.total === 0) {
    const state = !value ? "unread" : value.failed ? "failed" : "clean";
    return (
      <span className="mt-0.5 flex items-center gap-1 text-[12px] text-fg-dim">
        <Icon
          name={state === "clean" ? "check" : state === "failed" ? "warning" : "info"}
          size={12}
          className={state === "clean" ? "text-[var(--z-success)]" : state === "failed" ? "text-[var(--z-warning)]" : undefined}
        />
        {state === "clean" ? "Nothing found" : state === "failed" ? "Balances could not be read" : "Not read yet"}
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-fg-muted">
      {SEVERITIES.filter((severity) => row.bySeverity[severity] > 0).map((severity) => (
        <span key={severity} className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: SEVERITY_INK[severity] }} />
          {severityCountText(severity, row.bySeverity[severity])}
        </span>
      ))}
    </span>
  );
}

/**
 * What you hold on the chain and its share, right-aligned. Nothing held is
 * said as such; held but unpriced, or unreadable, is "—" with the reason.
 */
function ValueCell({ followed, value, currency }: { followed: boolean; value: ChainValue | null; currency: string }) {
  if (!followed) return <span className="shrink-0 text-[12px] text-fg-dim">Not followed</span>;
  if (!value) return null;
  if (!value.failed && value.assets === 0) return <span className="shrink-0 text-[12px] text-fg-dim">Nothing held</span>;
  if (value.value === null || value.value <= 0) {
    const reason = value.failed ? "Balances could not be read" : `${value.assets} ${value.assets === 1 ? "asset" : "assets"} without a price`;
    return (
      <span className="shrink-0 text-[13.5px] text-fg-dim" title={reason}>
        —<span className="sr-only">{reason}</span>
      </span>
    );
  }
  return (
    <span className="flex shrink-0 flex-col items-end text-right">
      <span className="text-[13.5px] font-medium tabular-nums text-fg">
        <Money value={value.value} currency={currency} compact />
      </span>
      {value.share !== null ? (
        <span className="text-[11.5px] tabular-nums text-fg-dim">
          {value.share < 0.001 ? "<0.1%" : formatPercent(value.share * 100, { digits: 1 })}
        </span>
      ) : null}
    </span>
  );
}
