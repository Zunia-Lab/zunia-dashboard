"use client";

/**
 * The analysis row of the Assets page:
 *
 * - **Allocation**: where the value sits (by asset, by chain, by type) and
 *   how concentrated it is (top-1 / top-3 share and the HHI).
 * - **24 h movers**: which assets moved the total today, in money, at
 *   today's amounts: bars scaled to the largest move, coloured, signed and
 *   arrowed by direction (a down day uses the whole track, not half of it).
 * - **Staking coverage**: for each chain coin you hold on its own chain, how
 *   much is staked, what is idle above a fee reserve, and what that would
 *   earn at the chain's actual APR after the median commission: the Staking
 *   page's model, so both pages print the same idle and yearly figures (an
 *   estimate, labelled).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Meter, StackedBar, stableColorMap, type PartDatum } from "@/components/charts";
import {
  AssetLogo,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Delta,
  EmptyState,
  InfoTip,
  Money,
  Percent,
  Segmented,
  Skeleton,
  TokenAmount,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ChainStatsState } from "@/lib/data/chains";
import { findChain } from "@/lib/chains";
import { MASK, formatFiat, formatPercent } from "@/lib/format";
import type { AssetGroup } from "@/lib/token/holdings";
import type { PortfolioResponse } from "@/lib/token/wire";
import { feeReserve } from "@/components/staking/model";
import { usePrefs } from "@/providers/PrefsProvider";
import { chainName } from "./AssetCells";
import { concentration, contributions, idleWorthStaking, stakeableAssets, typicalStakingRate, type Concentration } from "./holdings";
import { assetHref, stakeHref, type BondDenomOf } from "./links";

/** The "est." mark of a derived figure (the same chip as the kit's SourceTag). */
function EstChip() {
  return <span className="shrink-0 rounded-[4px] bg-[var(--d-glass-2)] px-1 font-mono text-[10.5px] text-fg-muted">est.</span>;
}

/**
 * A position's value in a legend or a mover row: cents, like the holdings
 * table. Positions are not prices, so the kit's three significant figures
 * would print a dust balance as "$0.00000001"; at two decimals it reads
 * "<$0.01" (format.ts's own dust rule), and a real one still reads "$0.96".
 */
function positionMoney(value: number, currency: string, compactFrom: number): string {
  return formatFiat(value, currency, { compact: Math.abs(value) >= compactFrom, precision: 2 });
}

function moneyFormatter(currency: string) {
  return (value: number) => positionMoney(value, currency, 100_000);
}

/* ------------------------------------------------------------------ allocation */

type AllocationView = "asset" | "chain" | "type";

const TYPE_LABELS = { liquid: "Liquid", staked: "Staked", rewards: "Rewards", unbonding: "Unbonding" } as const;

// "Moderate" is a description, not a call to act: neutral, because the kit's
// `info` is the brand amber, as loud as the `warning` of "Concentrated".
const LEVEL_TONE = { diversified: "success", moderate: "neutral", concentrated: "warning" } as const;
const LEVEL_TEXT = { diversified: "Diversified", moderate: "Moderate", concentrated: "Concentrated" } as const;

function ConcentrationLine({ facts, unit }: { facts: Concentration | null; unit: string }) {
  if (!facts || facts.count < 2) {
    return (
      <p className="text-[12.5px] text-fg-dim">
        {facts ? `All of the priced value is one ${unit}.` : `No priced ${unit} to compare yet.`}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-fg-dim">
      <span>
        Top {unit} <span className="font-medium tabular-nums text-fg">{formatPercent(facts.top1, { digits: 1 })}</span>
      </span>
      {facts.count > 3 ? (
        <span>
          Top 3 <span className="font-medium tabular-nums text-fg">{formatPercent(facts.top3, { digits: 1 })}</span>
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        HHI <span className="font-medium tabular-nums text-fg">{facts.hhi.toFixed(2)}</span>
        <Badge tone={LEVEL_TONE[facts.level]} size="sm">
          {LEVEL_TEXT[facts.level]}
        </Badge>
        <InfoTip
          size={13}
          content="Herfindahl–Hirschman index: the sum of each position's squared share. 1 means everything sits in one place; under 0.15 is usually called diversified, above 0.25 concentrated. A description, not advice."
        />
      </span>
    </div>
  );
}

export interface AllocationCardProps {
  data: PortfolioResponse | null;
  groups: AssetGroup[];
  currency: string;
  loading: boolean;
  pending: boolean;
  refreshing: boolean;
  /** One chain in scope: "By chain" would be a single bar. */
  singleChain: boolean;
}

export function AllocationCard({ data, groups, currency, loading, pending, refreshing, singleChain }: AllocationCardProps) {
  const [chosen, setChosen] = useState<AllocationView>("asset");
  const view: AllocationView = singleChain && chosen === "chain" ? "asset" : chosen;

  const { parts, colors, facts, unit } = useMemo(() => {
    if (!data) return { parts: [] as PartDatum[], colors: undefined, facts: null, unit: "asset" };
    if (view === "chain") {
      const chains = data.chains
        .filter((chain) => chain.value !== null && chain.value > 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      return {
        parts: chains.map((chain) => ({ id: chain.chainId, label: chain.chainName, value: chain.value ?? 0 })),
        colors: stableColorMap(chains.map((chain) => chain.chainId)),
        facts: concentration(chains.map((chain) => chain.value ?? 0)),
        unit: "chain",
      };
    }
    if (view === "type") {
      const keys = ["liquid", "staked", "rewards", "unbonding"] as const;
      const values = keys.map((key) => ({ id: key, label: TYPE_LABELS[key], value: data.totals[key] }));
      return {
        parts: values.filter((part) => part.value > 0),
        // Fixed order so "Staked" keeps its colour whatever the amounts.
        colors: stableColorMap(keys),
        facts: null,
        unit: "type",
      };
    }
    const priced = groups.filter((group) => group.value !== null && group.value > 0);
    return {
      parts: priced.map((group) => ({ id: group.key, label: group.identity.ticker, value: group.value ?? 0 })),
      colors: stableColorMap(priced.map((group) => group.key)),
      facts: concentration(priced.map((group) => group.value ?? 0)),
      unit: "asset",
    };
  }, [data, groups, view]);

  // The legend prints values as text, outside the kit's masked figures: mask here.
  const { hideAmounts } = usePrefs();
  const formatter = useMemo(() => (hideAmounts ? () => MASK : moneyFormatter(currency)), [currency, hideAmounts]);
  const unpriced = groups.filter((group) => group.value === null).length;
  const options = [
    { value: "asset" as const, label: "Asset" },
    ...(singleChain ? [] : [{ value: "chain" as const, label: "Chain" }]),
    { value: "type" as const, label: "Type" },
  ];

  return (
    <Card pending={pending}>
      <CardHeader
        title="Allocation"
        subtitle={data ? <>Of <Money value={data.totals.pricedValue} currency={currency} compact /> priced</> : "Where your value sits"}
        refreshing={refreshing}
        actions={<Segmented ariaLabel="Allocation by" value={view} onChange={setChosen} options={options} />}
      />
      <StackedBar
        data={parts}
        colors={colors}
        loading={loading}
        pending={pending}
        valueFormatter={formatter}
        title={`Allocation by ${view}`}
        empty={<span className="text-[13px] text-fg-dim">Nothing priced to allocate yet</span>}
      />
      <div className="-mx-[var(--d-pad)] -mb-[var(--d-pad)] mt-auto flex flex-col gap-1.5 border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-3">
        {view === "type" ? (
          <p className="text-[12.5px] text-fg-dim">Rewards are claimable now; unbonding returns to liquid when its period ends.</p>
        ) : loading ? (
          <Skeleton className="h-3" width="60%" />
        ) : (
          <ConcentrationLine facts={facts} unit={unit} />
        )}
        {unpriced > 0 && !loading ? (
          <p className="text-[12px] text-fg-dim">
            {unpriced} {unpriced === 1 ? "asset" : "assets"} without a price {unpriced === 1 ? "is" : "are"} not counted.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ movers */

export interface MoversCardProps {
  data: PortfolioResponse | null;
  groups: AssetGroup[];
  /** The Cosmos market's cap-weighted 24 h change (percent, an estimate), for comparison. */
  marketPct: number | null;
  currency: string;
  loading: boolean;
  pending: boolean;
  refreshing: boolean;
}

export function MoversCard({ data, groups, marketPct, currency, loading, pending, refreshing }: MoversCardProps) {
  const rows = useMemo(() => contributions(groups, 6), [groups]);
  const { hideAmounts } = usePrefs();
  const max = rows.reduce((m, row) => Math.max(m, Math.abs(row.abs)), 0);
  const withoutChange = groups.filter((group) => group.value !== null && group.change24hAbs === null).length;

  return (
    <Card pending={pending} className="@container">
      <CardHeader
        title="24 h movers"
        subtitle="Value change at today's amounts"
        refreshing={refreshing}
        actions={data ? <Delta value={data.totals.change24hAbs} kind="abs" currency={currency} variant="pill" size="md" /> : null}
      />
      <CardBody>
        {loading ? (
          <ul className="flex flex-col gap-3" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <Skeleton circle width={20} />
                <Skeleton className="h-3" width={48} />
                <Skeleton className="h-2 flex-1" />
                <Skeleton className="h-3" width={56} />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <EmptyState
            inline
            icon="trendingUp"
            title="Nothing moved"
            body={withoutChange > 0 ? "The priced assets here report no 24 h change." : "No priced asset changed in value over 24 h."}
          />
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Largest 24 h value changes">
            {rows.map((row) => {
              const up = row.abs > 0;
              const width = max > 0 ? Math.max(2, (Math.abs(row.abs) / max) * 100) : 0;
              return (
                <li key={row.key}>
                  {/* A 44 px row on phones (spec §3 touch targets), 34 px where a pointer aims. */}
                  <Link
                    href={assetHref(row.key)}
                    className="grid h-[34px] grid-cols-[minmax(0,88px)_1fr_auto] items-center gap-3 rounded-[8px] px-1 text-[13px] transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)] max-sm:h-11"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <AssetLogo src={row.identity.logoUrl} symbol={row.identity.ticker} size={20} />
                      <span className="truncate font-medium">{row.identity.ticker}</span>
                    </span>
                    {/* Share of the largest move; direction is in the colour, the arrow and the sign. */}
                    <span aria-hidden className="flex h-2 items-center">
                      <span
                        className={cn("h-full rounded-[3px] opacity-85", up ? "bg-[var(--d-pos)]" : "bg-[var(--d-neg)]")}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    {hideAmounts ? (
                      // Amounts hidden: the price move still says how it went, and reveals nothing.
                      <Delta value={row.pct} className="justify-end" />
                    ) : (
                      <span className="flex items-center justify-end gap-2 tabular-nums">
                        <Delta value={row.abs} kind="abs" currency={currency} format={(value) => positionMoney(value, currency, 10_000)} />
                        <span className="w-[50px] text-right text-[12px] text-fg-dim @max-[360px]:hidden">
                          {row.pct === null ? "" : formatPercent(row.pct, { signed: true, digits: 1 })}
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {!loading && withoutChange > 0 ? (
        <p className="text-[12px] text-fg-dim">
          {withoutChange} priced {withoutChange === 1 ? "asset has" : "assets have"} no 24 h change and {withoutChange === 1 ? "is" : "are"} left out.
        </p>
      ) : null}
      {!loading && data && data.totals.change24hPct !== null && marketPct !== null ? (
        <div className="-mx-[var(--d-pad)] -mb-[var(--d-pad)] mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-3 text-[12.5px] text-fg-dim">
          <span className="inline-flex items-center gap-1.5">
            Your holdings <Delta value={data.totals.change24hPct} />
          </span>
          <span className="inline-flex items-center gap-1.5">
            Cosmos market <Delta value={marketPct} />
            <EstChip />
            <InfoTip
              size={12}
              content="The market-cap-weighted 24 h change of the Cosmos-native assets on the Markets page, from each asset's price change with supplies held constant (an estimate)."
            />
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ staking coverage */

export interface StakingCoverageCardProps {
  data: PortfolioResponse | null;
  /** Bond denoms and APRs of the scope's chains (chain stats). */
  bondDenomOf: BondDenomOf;
  stats: ChainStatsState;
  currency: string;
  loading: boolean;
  pending: boolean;
  refreshing: boolean;
  className?: string;
}

/** Base units kept back for three staking transactions' fees: the Staking page's reserve. */
function reserveOf(chainId: string, denom: string): string {
  return feeReserve(findChain(chainId) ?? null, denom);
}

export function StakingCoverageCard({ data, bondDenomOf, stats, currency, loading, pending, refreshing, className }: StakingCoverageCardProps) {
  const stakeable = useMemo(() => (data ? stakeableAssets(data.assets, bondDenomOf, reserveOf) : []), [data, bondDenomOf]);
  // Which coin a chain stakes is only known once its stats land.
  const statsLoading = stats.loading;
  const shown = stakeable.slice(0, 4);

  // The Staking page's "Idle to stake", figure for figure: the liquid
  // balance above the fee reserve, dust left out, earning the chain's actual
  // APR after the median commission. The same wallet must not read $1.70
  // idle here and $1.51 there.
  const worth = stakeable.filter(idleWorthStaking);
  const idleKnown = worth.some((entry) => entry.idleValue !== null);
  const idleValue = worth.reduce((sum, entry) => sum + (entry.idleValue ?? 0), 0);
  let yearly = 0;
  let yearlyKnown = false;
  for (const entry of worth) {
    const rate = typicalStakingRate(stats.statsFor(entry.chainId));
    if (entry.idleValue === null || rate === null) continue;
    yearly += entry.idleValue * rate;
    yearlyKnown = true;
  }
  const stakeFirst = worth[0] ?? shown[0];

  return (
    <Card pending={pending} className={cn("@container", className)}>
      <CardHeader
        title="Staking coverage"
        subtitle="Staked share of each chain coin"
        refreshing={refreshing || stats.refreshing}
        info="Each chain's own coin held on that chain, the only holdings you can delegate there. Idle is the liquid balance above a reserve for three staking transactions' fees, and the rate is the chain's actual APR after the median validator commission, as on Staking: the yearly figure is an estimate at today's prices and rates."
      />
      <CardBody>
        {loading || (statsLoading && shown.length === 0) ? (
          <ul className="flex flex-col gap-4" aria-hidden>
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex flex-col gap-2">
                <span className="flex items-center gap-2">
                  <Skeleton circle width={20} />
                  <Skeleton className="h-3" width={64} />
                  <Skeleton className="ml-auto h-3" width={40} />
                </span>
                <Skeleton className="h-1.5" width="100%" />
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <EmptyState inline icon="staking" title="No chain coin to stake here" body="Hold a chain's own coin on that chain to delegate it." />
        ) : (
          <ul className={cn("grid gap-x-8 gap-y-3.5", shown.length > 1 && "@[600px]:grid-cols-2")}>
            {shown.map((entry) => {
              const chainStats = stats.statsFor(entry.chainId);
              const rate = typicalStakingRate(chainStats);
              const thirdParty = chainStats?.apr.source === "cosmos.directory";
              return (
                <li key={`${entry.chainId}:${entry.identity.denom}`} className="flex flex-col gap-1.5">
                  <div className="flex min-w-0 items-center gap-2 text-[13px]">
                    {/* Logo and ticker are one link: a 24 px target, 44 px on touch (d-hit), not a 20 px word. */}
                    <Link
                      href={assetHref(entry.key)}
                      className="d-hit group/ticker -my-0.5 flex min-h-6 min-w-0 items-center gap-2 rounded-[6px] font-medium text-fg"
                    >
                      <AssetLogo src={entry.identity.logoUrl} symbol={entry.identity.ticker} size={20} />
                      <span className="truncate underline-offset-[3px] group-hover/ticker:underline">{entry.identity.ticker}</span>
                    </Link>
                    <span className="truncate text-[12px] text-fg-dim">{chainName(entry.chainId)}</span>
                    <span className="ml-auto shrink-0 tabular-nums font-medium">
                      <Percent value={entry.bondedShare} digits={1} />
                    </span>
                  </div>
                  <Meter value={entry.bondedShare} max={100} size="sm" ariaLabel={`${entry.identity.ticker} staked share on ${chainName(entry.chainId)}`} />
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-[12px] text-fg-dim">
                    <span className="tabular-nums">
                      {idleWorthStaking(entry) ? (
                        <>
                          <TokenAmount
                            amount={entry.idle}
                            decimals={entry.identity.decimals}
                            symbol={entry.identity.ticker}
                            compact={(entry.idleWhole ?? 0) >= 100_000}
                            maxFraction={2}
                          />{" "}
                          idle
                          {entry.idleValue !== null ? (
                            <>
                              {" "}
                              · <Money value={entry.idleValue} currency={currency} compact={entry.idleValue >= 100_000} />
                            </>
                          ) : null}
                        </>
                      ) : entry.liquid === 0 || entry.bondedShare >= 99.95 ? (
                        "Fully staked"
                      ) : (
                        // Liquid, but within the fee reserve or under a cent: nothing worth a transaction.
                        <span title="What is liquid stays for fees (three staking transactions), or is worth under a cent">Nothing idle to stake</span>
                      )}
                    </span>
                    <span className="ml-auto tabular-nums">
                      {statsLoading ? (
                        <Skeleton className="inline-block h-2.5" width={52} />
                      ) : rate !== null ? (
                        <span title={thirdParty ? "Third-party APR (cosmos.directory), after the median commission" : "Actual APR after the median validator commission"}>
                          Earns ≈ {formatPercent(rate * 100, { digits: 1 })}
                        </span>
                      ) : (
                        <span title="This chain's reward rate or its validators' commission could not be measured">APR —</span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {!loading && idleKnown && idleValue > 0 ? (
        <div className="-mx-[var(--d-pad)] -mb-[var(--d-pad)] mt-auto flex items-center justify-between gap-3 border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-3 text-[12.5px] text-fg-dim">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate">
              Idle <Money value={idleValue} currency={currency} compact={idleValue >= 100_000} className="font-medium text-fg" />
              {worth.length > 1 ? ` across ${worth.length} coins` : null}
            </span>
            {yearlyKnown ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="truncate">
                  ≈ <Money value={yearly} currency={currency} compact={yearly >= 100_000} className="font-medium text-fg" /> a year if staked
                </span>
                <EstChip />
              </span>
            ) : null}
          </span>
          <Button size="sm" variant="secondary" iconLeft="staking" href={stakeFirst ? stakeHref(stakeFirst.chainId) : "/staking"} className="shrink-0">
            Stake
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
