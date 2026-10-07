"use client";

/**
 * "Cost of this swap": every cost of the quote on one scale, so they can be
 * compared and added up. A thin bar shows what the cost is made of; each line
 * gives its share of what is paid and its value at market prices.
 *
 * - The Zunia fee is exact (taken from the amount entered) and shows its
 *   amount in the token sold, as the spec asks.
 * - Osmosis's taker fee, the pools' spread and the price impact are the
 *   router's own percentages for this order; their values are estimates.
 * - The network fee is the simulated one, valued in its own token.
 *
 * The all-in tile above compares what is received with what is paid at
 * market prices; it differs from this total by the pools' price against the
 * market source, which the caption states with its sign rather than leaving
 * two totals that do not add up. Numbers come from `costBreakdown`.
 */

import { useMemo, useState, type ReactNode } from "react";
import { StackedBar, Swatch, stableColorMap } from "@/components/charts";
import { InfoTip } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatFiat, formatPercent } from "@/lib/format";
import { COST_IDS, type CostBreakdown as Breakdown, type CostId } from "./swap-analysis";

const COLORS = stableColorMap(COST_IDS);

const LABELS: Record<CostId, string> = {
  zunia: "Zunia fee",
  taker: "Osmosis taker fee",
  spread: "Pool spread",
  impact: "Price impact",
  network: "Network fee",
};

/** The (i) buttons' names, proper nouns kept. */
const ABOUT: Record<CostId, string> = {
  zunia: "About the Zunia fee",
  taker: "About the Osmosis taker fee",
  spread: "About the pool spread",
  impact: "About the price impact",
  network: "About the network fee",
};

const INFO: Record<CostId, string> = {
  zunia: "Zunia's commission, paid in the token you sell, in the same transaction as the swap. It is part of the amount you enter.",
  taker: "Osmosis's protocol fee on this order, as its router reports it. Taken from the amount swapped; the value is an estimate at the market price.",
  spread: "The pools' own swap fee along the route, weighted by each split. Already counted in what you receive; the value is an estimate.",
  impact: "How much this order moves the pools' price, as the router computes it. Negative means in your favour.",
  network: "Paid to the chain's validators in its fee token, measured by simulating this transaction.",
};

/** A share of the amount: two decimals, `<0.01%` for a sliver (never a flat 0.00% for a real cost). */
function share(percent: number): string {
  if (percent !== 0 && Math.abs(percent) < 0.005) return percent > 0 ? "<0.01%" : "−<0.01%";
  return formatPercent(percent, { digits: 2 });
}

export interface CostBreakdownProps {
  breakdown: Breakdown;
  currency: string;
  /** Second lines under a label (the Zunia fee in the token sold, the network fee's token amount). */
  subs?: Partial<Record<CostId, ReactNode>>;
  /** Why a line has no figure ("Measured once you enter an amount"). */
  reasons?: Partial<Record<CostId, string>>;
  /** The all-in figure the caption reconciles with, percent. */
  allInPercent: number | null;
  className?: string;
}

export function CostBreakdown({ breakdown, currency, subs, reasons, allInPercent, className }: CostBreakdownProps) {
  const [active, setActive] = useState<string | null>(null);
  const parts = useMemo(
    () =>
      breakdown.lines
        .filter((line) => line.percent !== null && line.percent > 0)
        .map((line) => ({ id: line.id, label: LABELS[line.id], value: line.percent ?? 0 })),
    [breakdown.lines],
  );
  const networkMissing = breakdown.missing.includes("network");
  const networkKnown = !networkMissing;
  const swapCosts = breakdown.lines.reduce((sum, line) => (line.id === "network" ? sum : sum + (line.percent ?? 0)), 0);
  const gap = breakdown.marketGap;
  const showGap = gap !== null && allInPercent !== null && Math.abs(gap) >= 0.01;

  return (
    <section aria-labelledby="swap-cost-title" className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 id="swap-cost-title" className="d-label flex items-center gap-1">
          Cost of this swap
          <InfoTip
            label="How the cost is measured"
            size={12}
            content="Each cost as a share of what you pay, and its value at the market price of the token you sell. Only the Zunia fee is exact; the router's figures and the values are estimates."
          />
        </h3>
        {/* fg-dim like the section labels: faint text at this size fails contrast (2.8:1 light). */}
        <span aria-hidden className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-fg-dim">
          % of amount · value
        </span>
      </div>

      {parts.length > 0 ? (
        <StackedBar
          data={parts}
          colors={COLORS}
          legend="none"
          thickness={8}
          minSegmentWidth={4}
          valueFormatter={share}
          title="Cost of this swap"
          // The bar's own summary would give each cost's share of the total
          // cost; the list gives shares of the amount, so the summary does too.
          ariaLabel={`Cost of this swap: ${share(breakdown.totalPercent)} of the amount in all. ${parts.map((part) => `${part.label} ${share(part.value)}`).join(", ")}.`}
          activeId={active}
          onActiveChange={setActive}
        />
      ) : null}

      {/* A list of rows on one grid (subgrid), so the columns line up. */}
      <ul className="grid grid-cols-[10px_minmax(0,1fr)_auto_auto] items-baseline gap-x-2.5 text-[13px]">
        {breakdown.lines.map((line) => {
          const muted = active !== null && active !== line.id;
          const known = line.percent !== null || line.value !== null;
          const favourable = line.percent !== null && line.percent < 0;
          return (
            <li
              key={line.id}
              className={cn(
                "col-span-full grid grid-cols-subgrid items-baseline rounded-[8px] px-1.5 py-[7px] transition-[opacity,background-color] duration-[160ms] -mx-1.5",
                active === line.id && "bg-[var(--d-row-hover)]",
                muted && "opacity-55",
              )}
              onPointerEnter={line.percent !== null && line.percent > 0 ? () => setActive(line.id) : undefined}
              onPointerLeave={() => setActive(null)}
            >
              {/* A flex box, so the swatch (an inline span) takes its size. */}
              <span className="flex self-center">
                {line.percent !== null && line.percent > 0 ? <Swatch color={COLORS.get(line.id) ?? "var(--viz-other)"} /> : <span className="size-[10px]" />}
              </span>
              <span className="min-w-0">
                <span className="inline-flex max-w-full items-center gap-1 align-middle text-fg-muted">
                  <span className="truncate">{LABELS[line.id]}</span>
                  <InfoTip label={ABOUT[line.id]} content={INFO[line.id]} size={12} />
                </span>
                {subs?.[line.id] || (!known && reasons?.[line.id]) ? (
                  <span className="line-clamp-2 block text-[11.5px] leading-snug text-fg-dim">{subs?.[line.id] ?? reasons?.[line.id]}</span>
                ) : null}
              </span>
              <span className={cn("text-right tabular-nums", favourable ? "text-[var(--d-pos)]" : "text-fg-dim")}>
                {line.percent === null ? "—" : share(line.percent)}
                <span className="sr-only"> of the amount</span>
              </span>
              <span className={cn("min-w-[4.75rem] text-right tabular-nums", favourable ? "text-[var(--d-pos)]" : "text-fg")}>
                {line.value === null ? <span className="text-fg-dim">—</span> : `≈ ${formatFiat(line.value, currency, { signed: favourable })}`}
              </span>
            </li>
          );
        })}
        <li className="col-span-full grid grid-cols-subgrid items-baseline border-t border-[var(--d-hairline)] px-1.5 pt-2.5 -mx-1.5 mt-1">
          <span />
          <span className="min-w-0 font-medium text-fg">
            Total
            {networkMissing ? <span className="block text-[11.5px] font-normal leading-snug text-fg-dim">Before the network fee</span> : null}
          </span>
          <span className="text-right font-medium tabular-nums text-fg">
            {share(breakdown.totalPercent)}
            <span className="sr-only"> of the amount</span>
          </span>
          <span className="min-w-[4.75rem] text-right font-semibold tabular-nums text-fg">
            {breakdown.totalValue === null ? <span className="font-normal text-fg-dim">—</span> : `≈ ${formatFiat(breakdown.totalValue, currency)}`}
          </span>
        </li>
      </ul>

      {showGap ? (
        // The all-in tile and this total differ by the pools' price against
        // the market source: spelled out as a sum, so the two figures add up.
        <p className="text-[12px] leading-snug text-fg-dim tabular-nums">
          All-in vs market <span className="font-medium text-fg-muted">{formatPercent(allInPercent, { signed: true, digits: 2 })}</span> = these costs{" "}
          {formatPercent(-swapCosts, { signed: true, digits: 2 })}
          {networkKnown ? " (network fee aside)" : ""} + Osmosis&apos;s price against the market price {formatPercent(gap, { signed: true, digits: 2 })}.
        </p>
      ) : null}
    </section>
  );
}
