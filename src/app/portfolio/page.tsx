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
  TokenLogo,
  amountHeroClass,
  cn,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { AssetRow } from "@/components/AssetRow";
import { SampleDataBanner } from "@/components/SampleDataBanner";
import { useChainScope } from "@/lib/useChainScope";
import {
  formatFiat,
  usePortfolio,
  type ChainHolding,
} from "@/lib/usePortfolio";
import { usePrefs } from "@/providers/PrefsProvider";

/** Slices for the allocation donut, strongest holdings first. */
function allocation(holdings: ChainHolding[], total: number) {
  const priced = holdings
    .filter((h) => (h.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (total <= 0 || priced.length === 0) return [];

  const head = priced.slice(0, 5).map((h) => ({
    label: h.symbol,
    chainName: h.chainName,
    iconUrl: h.iconUrl,
    value: h.value ?? 0,
    share: (h.value ?? 0) / total,
  }));
  const tail = priced.slice(5);
  if (tail.length > 0) {
    const otherValue = tail.reduce((sum, h) => sum + (h.value ?? 0), 0);
    head.push({
      label: "Other",
      chainName: `${tail.length} chains`,
      iconUrl: undefined,
      value: otherValue,
      share: otherValue / total,
    });
  }
  return head;
}

type AssetFilter = "all" | "liquid" | "staked";

export default function PortfolioPage() {
  const { snapshot, loading, sample, status, error } = usePortfolio();
  // A failed read is not a wallet holding nothing: it renders an em dash and a
  // reason, never a confident $0.00.
  const failed = status === "error";
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
        <SampleDataBanner show={sample} />

        {failed ? (
          <Callout tone="danger" title="Balances unavailable">
            The portfolio read failed
            {error?.message ? ` (${error.message})` : ""}. The figures below are
            not zero balances — they are missing ones. Nothing was read from any
            followed chain.
          </Callout>
        ) : null}

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
                  : failed
                    ? "—"
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

            {/*
              At 360px the card is ~280px inside its padding, which left each
              of three columns ~82px — "$1.23M" fit, its hint did not. One
              column per metric below sm, three from sm up.
            */}
            <div className="grid grid-cols-1 gap-3 border-t border-[var(--z-line)] pt-5 sm:grid-cols-3 sm:gap-4">
              <Metric
                label="Staked"
                value={
                  loading
                    ? "…"
                    : failed
                      ? "—"
                      : mask(formatFiat(snapshot?.staked ?? 0, currency))
                }
                hint={stakedShare == null ? undefined : `${stakedShare}% of total`}
              />
              <Metric
                label="Claimable"
                value={
                  loading
                    ? "…"
                    : failed
                      ? "—"
                      : mask(formatFiat(snapshot?.claimable ?? 0, currency))
                }
                hint={failed ? "not read" : `${snapshot?.pricedChains ?? 0} chains priced`}
              />
              <Metric label="Avg APR" value="—" hint="No yield feed" />
            </div>
          </Card>

          <Card className="@container flex flex-col gap-5 p-6 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <SectionLabel>Allocation</SectionLabel>
                <p className="mt-1 text-[13px] text-fg-dim">
                  Share of priced net worth by chain.
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11.5px] uppercase tracking-[0.1em] text-fg-dim">
                {slices.length} slice{slices.length === 1 ? "" : "s"}
                {(snapshot?.pricedChains ?? 0) > 0
                  ? ` · ${snapshot?.pricedChains} priced`
                  : ""}
              </span>
            </div>
            {slices.length === 0 ? (
              <p className="flex-1 text-[14px] leading-relaxed text-fg-dim">
                Appears once a followed chain has a priced balance.
              </p>
            ) : (
              /*
                A container query, not sm:. The Live rail docks at 1440px, which
                makes this card ~310px wide — narrower than at 1280px — so a
                640px viewport query put a 152px donut beside a 200px legend in
                a 266px box. @md fires on the card, at 448px.
              */
              <div className="@md:flex-row @md:items-center flex flex-1 flex-col gap-6">
                <DonutChart
                  size={152}
                  strokeWidth={12}
                  centerLabel={slices[0]?.label ?? "top"}
                  centerValue={`${Math.round((slices[0]?.share ?? 0) * 100)}%`}
                  segments={slices.map((s, index) => ({
                    value: s.share,
                    color: DONUT_COLORS[index % DONUT_COLORS.length],
                  }))}
                />
                <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
                  {slices.map((slice, index) => {
                    const color = DONUT_COLORS[index % DONUT_COLORS.length];
                    const pct = Math.round(slice.share * 100);
                    return (
                      <li
                        key={`${slice.label}-${slice.chainName}`}
                        className="flex items-center gap-3"
                      >
                        {slice.iconUrl ? (
                          <TokenLogo
                            src={slice.iconUrl}
                            symbol={slice.label}
                            size={22}
                          />
                        ) : (
                          <span
                            className="size-[22px] shrink-0 rounded-full"
                            style={{ background: color }}
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13.5px] font-medium tracking-tight text-fg">
                              {slice.label}
                            </span>
                            <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-fg">
                              {pct}%
                            </span>
                          </span>
                          <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-[var(--z-glass-2)]">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                background: color,
                              }}
                            />
                          </span>
                          <span className="mt-1 flex justify-between gap-2 font-mono text-[10.5px] text-fg-dim">
                            <span className="truncate">{slice.chainName}</span>
                            <span className="shrink-0 tabular-nums">
                              {mask(formatFiat(slice.value, currency))}
                            </span>
                          </span>
                        </span>
                      </li>
                    );
                  })}
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
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div>
              <h2 className="text-[18px] font-medium tracking-tight text-fg">
                Assets
              </h2>
              <p className="mt-1 text-[13.5px] text-fg-dim">
                Holdings across followed chains.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="-mx-1 overflow-x-auto px-1">
                <Segmented<AssetFilter>
                  className="min-w-max"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "liquid", label: "Liquid" },
                    { value: "staked", label: "Staked" },
                  ]}
                />
              </div>
              <Button asChild variant="secondary">
                <Link href="/networks">Manage</Link>
              </Button>
            </div>
          </div>

          <Card className="overflow-x-auto p-0">
            {loading ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-[52px] w-full" />
                <Skeleton className="h-[52px] w-full" />
                <Skeleton className="h-[52px] w-full" />
              </div>
            ) : failed ? (
              <EmptyState
                title="Balances unavailable"
                description={`The read failed${error?.message ? `: ${error.message}` : "."} No chain reported an empty balance — none of them answered.`}
              />
            ) : (snapshot?.holdings.length ?? 0) === 0 ? (
              <EmptyState
                title="No balances found"
                description="Every followed chain answered, and none of them holds a balance for this address."
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
