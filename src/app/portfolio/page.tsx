"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AreaChart,
  Button,
  Callout,
  Card,
  DONUT_COLORS,
  DonutChart,
  EmptyState,
  SectionLabel,
  Segmented,
  Skeleton,
  amountHeroClass,
  cn,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { AssetRow } from "@/components/AssetRow";
import { useChainScope } from "@/lib/useChainScope";
import {
  formatFiat,
  usePortfolio,
  type ChainHolding,
} from "@/lib/usePortfolio";
import { usePrefs } from "@/providers/PrefsProvider";

/** Slices for the allocation donut, with a folded "Other" tail. */
function allocation(holdings: ChainHolding[], total: number) {
  const priced = holdings.filter((h) => (h.value ?? 0) > 0);
  if (total <= 0 || priced.length === 0) return [];

  const head = priced.slice(0, 3).map((h) => ({
    label: h.symbol,
    share: (h.value ?? 0) / total,
  }));
  const tail = priced.slice(3);
  if (tail.length > 0) {
    head.push({
      label: "Other",
      share: tail.reduce((sum, h) => sum + (h.value ?? 0), 0) / total,
    });
  }
  return head;
}

type AssetFilter = "all" | "liquid" | "staked";

export default function PortfolioPage() {
  const { snapshot, loading } = usePortfolio();
  const { selectedChain } = useChainScope();
  const { mask } = usePrefs();
  const [filter, setFilter] = useState<AssetFilter>("all");
  const currency = snapshot?.currency ?? "USD";

  const slices = useMemo(
    () => allocation(snapshot?.holdings ?? [], snapshot?.total ?? 0),
    [snapshot],
  );

  // Public LCDs expose current state, not history, so the chart plots the
  // 24h move across the current total rather than inventing intermediate days.
  const trend = useMemo(() => {
    const total = snapshot?.total ?? 0;
    const change = snapshot?.change24h ?? 0;
    if (total <= 0) return [];
    const start = total / (1 + change / 100);
    return Array.from({ length: 8 }, (_, i) => start + ((total - start) * i) / 7);
  }, [snapshot]);

  const change24h = snapshot?.change24h;
  const stakedShare =
    snapshot && snapshot.total > 0
      ? Math.round((snapshot.staked / snapshot.total) * 100)
      : null;

  const filteredHoldings = useMemo(() => {
    const holdings = snapshot?.holdings ?? [];
    return holdings.filter((holding) => {
      if (filter === "liquid") return Number(holding.available) > 0;
      if (filter === "staked") return Number(holding.staked) > 0;
      return true;
    });
  }, [snapshot, filter]);

  return (
    <DashboardShell
      title="Portfolio"
      description={
        selectedChain
          ? `Balance on ${selectedChain.chainName}. Read only.`
          : "Balances across every chain you follow. Read only."
      }
    >
      <div className="flex flex-col gap-6">
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Card className="flex flex-col justify-between gap-8 p-6 sm:p-7">
            <div>
              <SectionLabel>Net worth</SectionLabel>
              <p
                className={cn(
                  amountHeroClass,
                  "mt-3 text-[40px] leading-none sm:text-[48px]",
                )}
              >
                {loading
                  ? "…"
                  : mask(formatFiat(snapshot?.total ?? 0, currency))}
              </p>
              {change24h == null ? (
                <p className="mt-3 text-[14px] text-fg-dim">24h change unavailable</p>
              ) : (
                <p
                  className={cn(
                    "mt-3 font-mono text-[13.5px] tabular-nums",
                    change24h >= 0
                      ? "text-[var(--z-success)]"
                      : "text-[var(--z-danger)]",
                  )}
                >
                  {change24h >= 0 ? "+" : ""}
                  {change24h.toFixed(1)}% over 24h
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-[var(--z-line)] pt-5">
              <Metric
                label="Staked"
                value={
                  loading
                    ? "…"
                    : mask(formatFiat(snapshot?.staked ?? 0, currency))
                }
                hint={stakedShare == null ? undefined : `${stakedShare}% of total`}
              />
              <Metric
                label="Claimable"
                value={
                  loading
                    ? "…"
                    : mask(formatFiat(snapshot?.claimable ?? 0, currency))
                }
                hint={`${snapshot?.pricedChains ?? 0} chains priced`}
              />
              <Metric label="Avg APR" value="—" hint="No yield feed" />
            </div>
          </Card>

          <Card className="flex flex-col p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <SectionLabel>Allocation</SectionLabel>
              <span className="font-mono text-[12px] text-fg-dim">
                {snapshot?.pricedChains ?? 0} priced
              </span>
            </div>
            {slices.length === 0 ? (
              <p className="mt-6 flex-1 text-[14px] leading-relaxed text-fg-dim">
                Appears once a followed chain has a priced balance.
              </p>
            ) : (
              <div className="mt-5 flex flex-1 flex-col items-center justify-center gap-5 sm:flex-row sm:items-center sm:justify-between">
                <DonutChart
                  size={148}
                  centerLabel="chains"
                  centerValue={String(snapshot?.pricedChains ?? 0)}
                  segments={slices.map((s) => ({ value: s.share }))}
                />
                <ul className="flex w-full max-w-[200px] flex-col gap-2.5">
                  {slices.map((slice, index) => (
                    <li
                      key={slice.label}
                      className="flex items-center gap-2.5 font-mono text-[13px]"
                    >
                      <span
                        className="size-[7px] shrink-0 rounded-full"
                        style={{
                          background:
                            DONUT_COLORS[index % DONUT_COLORS.length],
                        }}
                      />
                      <span className="flex-1 truncate text-fg-muted">
                        {slice.label}
                      </span>
                      <span className="tabular-nums text-fg-dim">
                        {Math.round(slice.share * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </section>

        <Card className="p-6 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Balance</SectionLabel>
            <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim">
              24h
            </span>
          </div>
          {loading ? (
            <Skeleton className="mt-4 h-[168px] w-full" />
          ) : trend.length === 0 ? (
            <p className="mt-4 text-[14px] leading-relaxed text-fg-dim">
              Nothing to chart yet. Balances appear here once a followed chain
              reports a priced holding.
            </p>
          ) : (
            <AreaChart className="mt-4" points={trend} labels={["24h ago", "now"]} />
          )}
        </Card>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-medium tracking-tight text-fg">
                Assets
              </h2>
              <p className="mt-1 text-[13.5px] text-fg-dim">
                Holdings across followed chains.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Segmented<AssetFilter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "liquid", label: "Liquid" },
                  { value: "staked", label: "Staked" },
                ]}
              />
              <Button asChild variant="secondary">
                <Link href="/networks">Manage</Link>
              </Button>
            </div>
          </div>

          <Card className="p-0">
            {loading ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-[52px] w-full" />
                <Skeleton className="h-[52px] w-full" />
                <Skeleton className="h-[52px] w-full" />
              </div>
            ) : (snapshot?.holdings.length ?? 0) === 0 ? (
              <EmptyState
                title="No balances found"
                description="None of the followed chains returned a balance for this address."
                action={
                  <Button asChild>
                    <Link href="/networks">Follow more chains</Link>
                  </Button>
                }
              />
            ) : filteredHoldings.length === 0 ? (
              <EmptyState
                title="No matching assets"
                description="Nothing in this filter. Try All, Liquid, or Staked."
              />
            ) : (
              <div className="flex flex-col divide-y divide-[var(--z-line)] p-1.5">
                {filteredHoldings.map((holding) => (
                  <AssetRow
                    key={holding.chainId}
                    holding={holding}
                    currency={currency}
                  />
                ))}
              </div>
            )}
          </Card>
        </section>

        {snapshot && snapshot.skipped.length > 0 ? (
          <Callout tone="neutral" title="Some chains were skipped">
            {snapshot.skipped.length} followed{" "}
            {snapshot.skipped.length === 1 ? "chain uses" : "chains use"} a
            different derivation path, so this address cannot be re-derived for
            them. Connect from the wallet on that chain to see those balances.
          </Callout>
        ) : null}
      </div>
    </DashboardShell>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-dim">
        {label}
      </p>
      <p className="mt-1.5 truncate text-[16px] font-semibold tabular-nums tracking-tight text-fg">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 truncate font-mono text-[11.5px] text-fg-dim">{hint}</p>
      ) : null}
    </div>
  );
}
