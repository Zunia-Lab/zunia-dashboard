"use client";

/**
 * /compare: up to four chains or assets side by side.
 *
 * - Price performance on one honest axis: every series indexed to 100 at the
 *   common start (the latest first sample among them, said in words when a
 *   recently listed token moves it), with return, drawdown and volatility
 *   computed from the same series.
 * - "At a glance": who leads on the figures that decide (return, real yield,
 *   decentralisation, unbonding), then the full side-by-side table with the
 *   best value of each row marked and named.
 * - The selection is the URL (`?ids=chain:osmosis-1,asset:<key>`), so a
 *   comparison can be shared; it is rewritten in place (no history entry, no
 *   server round trip) as chips change.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LineChart, stableColorMap, type LineSeries } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import {
  AssetLogo,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  EmptyState,
  PartialDataBadge,
  Segmented,
  Skeleton,
  SourceTag,
  toast,
} from "@/components/ui";
import { useChainStats } from "@/lib/data/chains";
import { useMarkets } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { usePriceHistory, type PriceHistoryResponse } from "@/lib/data/prices";
import { formatDate, formatFiat, formatNumber, formatPercent } from "@/lib/format";
import type { PriceRange } from "@/lib/token/types";
import type { MarketAsset } from "@/lib/token/wire";
import type { ApiState } from "@/lib/useApi";
import { useWallet } from "@/providers/WalletProvider";
import { RealYieldText } from "@/components/chains/cells";
import { formatDays } from "@/components/chains/model";
import { resolveEntity, type Entity } from "./entities";
import { EntityPicker } from "./EntityPicker";
import { MetricsTable, type Facts } from "./MetricsTable";
import {
  DEFAULT_REFS,
  MAX_ENTITIES,
  bestIndexes,
  commonStart,
  compareHref,
  parseIds,
  performance,
  refKey,
  sameRefs,
  type EntityRef,
  type Performance,
} from "./model";

const RANGES: { value: PriceRange; label: string }[] = [
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "90D", label: "90D" },
  { value: "1Y", label: "1Y" },
];

const indexFormat = (v: number) => v.toFixed(1);

function initialRefs(raw: string | null): EntityRef[] {
  const parsed = parseIds(raw);
  return raw === null ? [...DEFAULT_REFS] : parsed;
}

export function ComparePage({ initialIds }: { initialIds: string | null }) {
  const [refs, setRefs] = useState<EntityRef[]>(() => initialRefs(initialIds));
  // A link to /compare?ids=… followed while already here re-renders the page
  // with new props: adopt them (React's "adjust state on prop change").
  const [source, setSource] = useState(initialIds);
  if (initialIds !== source) {
    setSource(initialIds);
    setRefs(initialRefs(initialIds));
  }

  const [range, setRange] = useState<PriceRange>("30D");
  const [view, setView] = useState<"chart" | "table">("chart");
  const { account } = useWallet();
  const markets = useMarkets();
  const portfolio = usePortfolio({ scope: "followed" });

  // The URL follows the selection without a navigation. `null` state, as the
  // Next docs do: Next's patched replaceState copies its own history state in
  // and tells the router about the new URL. Passing `window.history.state`
  // (which carries Next's `__NA` marker) made Next skip that sync, and the
  // router later wrote its stale `/compare` back over the shareable link.
  useEffect(() => {
    const current = new URL(window.location.href);
    const hadIds = current.searchParams.has("ids");
    if (!hadIds && sameRefs(refs, DEFAULT_REFS)) return;
    const target = compareHref(refs);
    if (`${current.pathname}${current.search}` !== target) window.history.replaceState(null, "", target);
  }, [refs]);

  const marketByKey = useMemo(() => {
    const map = new Map<string, MarketAsset>();
    for (const asset of markets.data?.assets ?? []) map.set(asset.key, asset);
    return map;
  }, [markets.data]);

  const entities = useMemo(
    () => refs.map((ref) => resolveEntity(ref, marketByKey)).filter((entity): entity is Entity => entity !== null),
    [refs, marketByKey],
  );
  const colors = useMemo(() => stableColorMap(entities.map((entity) => entity.id)), [entities]);

  // Fixed hook slots: one price history per possible entity.
  const h0 = usePriceHistory(entities[0]?.priceKey ?? null, range);
  const h1 = usePriceHistory(entities[1]?.priceKey ?? null, range);
  const h2 = usePriceHistory(entities[2]?.priceKey ?? null, range);
  const h3 = usePriceHistory(entities[3]?.priceKey ?? null, range);
  const histories: ApiState<PriceHistoryResponse>[] = [h0, h1, h2, h3].slice(0, MAX_ENTITIES);

  const stakingIds = useMemo(
    () => [...new Set(entities.map((entity) => entity.stakingChain?.chainId).filter((id): id is string => Boolean(id)))],
    [entities],
  );
  const stats = useChainStats(stakingIds);

  const series = useMemo<LineSeries[]>(() => {
    const answers = [h0.data, h1.data, h2.data, h3.data];
    return entities.map((entity, index) => ({
      id: entity.id,
      label: entity.ticker,
      points: (answers[index]?.points ?? []).map((p) => ({ t: p.t, v: p.v })),
    }));
  }, [entities, h0.data, h1.data, h2.data, h3.data]);
  const start = useMemo(() => commonStart(series.map((s) => s.points)), [series]);
  // The chart kit labels a series without points "(no data)": a series on
  // its first load is left out until it answers, so only real gaps say so.
  const loadingKey = [h0.loading, h1.loading, h2.loading, h3.loading].map(Number).join("");
  const chartSeries = useMemo(
    () => series.filter((_, index) => loadingKey[index] !== "1"),
    [series, loadingKey],
  );

  const facts: Facts[] = entities.map((entity, index) => {
    const history = histories[index];
    const rawStats = entity.stakingChain ? stats.statsFor(entity.stakingChain.chainId) : null;
    // An asset inherits its chain's economics only when it is the chain's
    // staking denom: Noble's catalog coin is USDC, but Noble stakes `ustake`.
    const notStaked = entity.ref.kind === "asset" && rawStats !== null && entity.priceKey !== `${rawStats.chainId}:${rawStats.nativeDenom}`;
    const chainStats = notStaked ? null : rawStats;
    const spot = chainStats?.price ?? null;
    const perf: Performance = performance(series[index]?.points ?? [], start);
    const statsState: Facts["statsState"] = !entity.stakingChain || notStaked
      ? "none"
      : chainStats
        ? "ready"
        : stats.status === "error" || (stats.data && !stats.loading && !stats.refreshing)
          ? "error"
          : "loading";
    return {
      entity,
      stats: chainStats,
      statsState,
      statsReason: stats.error?.message,
      price: entity.market?.price ?? spot?.price ?? null,
      change24h: entity.market?.change24h ?? spot?.change24h ?? null,
      change7d: entity.market?.change7d ?? spot?.change7d ?? null,
      marketCap: entity.market?.marketCap ?? null,
      volume24h: entity.market?.volume24h ?? null,
      currency: entity.market ? (markets.data?.currency ?? null) : (stats.data?.currency ?? null),
      marketLoading: !entity.market && (markets.loading || (Boolean(entity.stakingChain) && statsState === "loading")),
      perf,
      // A range switch keeps the previous range's series on screen (stale):
      // its figures must not sit under the new range's label.
      perfLoading: Boolean(entity.priceKey) && Boolean(history?.loading || history?.stale),
      holdings: account ? holdingsOf(entity, portfolio.data, portfolio.loading) : undefined,
      holdingsCurrency: portfolio.data?.currency ?? null,
    };
  });

  const historyErrors = entities.flatMap((entity, index) =>
    histories[index]?.status === "error" ? [{ scope: `${entity.ticker} price history`, message: histories[index]?.error?.message ?? "Could not be read" }] : [],
  );
  const lateStarters = entities.filter((entity, index) => {
    const coverage = histories[index]?.data?.coverage;
    return coverage && !coverage.complete && coverage.from !== null && start !== null && coverage.from >= start - 36 * 3600_000;
  });
  const sources = [...new Set(histories.map((h) => h.data?.label).filter((label): label is string => Boolean(label)))];
  const chartLoading = entities.length > 0 && series.every((s) => s.points.length === 0) && histories.some((h) => h.loading);
  const chartPending = histories.some((h) => h.refreshing);

  const add = (ref: EntityRef) => setRefs((current) => (current.length >= MAX_ENTITIES || current.some((r) => refKey(r) === refKey(ref)) ? current : [...current, ref]));
  const remove = (ref: EntityRef) => setRefs((current) => current.filter((r) => refKey(r) !== refKey(ref)));
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${compareHref(refs)}`);
      toast.success("Link copied", { description: "Anyone with it opens this comparison." });
    } catch {
      toast.error("Couldn't copy the link", { description: "Copy it from the address bar instead." });
    }
  };

  return (
    <Page title="Compare" subtitle="Chains and assets side by side" access="public">
      <Card>
        <CardHeader
          title="Your comparison"
          subtitle="Up to four chains or assets. A chain is compared through its native token on price rows, and by its own economics below."
          actions={
            <>
              {!sameRefs(refs, DEFAULT_REFS) ? (
                <Button size="sm" variant="ghost" onClick={() => setRefs([...DEFAULT_REFS])}>
                  Reset
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" iconLeft="link" onClick={() => void copyLink()} disabled={entities.length === 0}>
                Copy link
              </Button>
            </>
          }
        />
        <EntityPicker
          entities={entities}
          colors={colors}
          markets={markets.data?.assets ?? []}
          marketCurrency={markets.data?.currency ?? null}
          onAdd={add}
          onRemove={remove}
        />
      </Card>

      {entities.length === 0 ? (
        <Card>
          <EmptyState
            icon="compare"
            title="Nothing to compare yet"
            body="Add two to four chains or assets: prices are indexed to the same start, and staking economics line up side by side."
            action={
              <Button size="sm" variant="secondary" onClick={() => setRefs([...DEFAULT_REFS])}>
                Start with Safrochain, Hub, Osmosis, Celestia
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-[var(--d-gap)] xl:grid-cols-12">
            <Card className="xl:col-span-8" pending={chartPending}>
              <CardHeader
                title="Price performance"
                subtitle={start ? `Indexed to 100 on ${formatDate(start, "short")} · ${range}` : `Indexed to 100 at the common start · ${range}`}
                actions={
                  <>
                    <Segmented<PriceRange> ariaLabel="Range" value={range} onChange={setRange} options={RANGES} mono />
                    <Segmented<"chart" | "table">
                      ariaLabel="View"
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "chart", label: <Icon name="trendingUp" size={14} />, ariaLabel: "Chart" },
                        { value: "table", label: <Icon name="list" size={14} />, ariaLabel: "Table" },
                      ]}
                    />
                  </>
                }
              />
              <CardBody>
                <LineChart
                  series={chartSeries}
                  colors={colors}
                  indexed
                  height={300}
                  view={view}
                  loading={chartLoading}
                  title={`${entities.map((e) => e.ticker).join(", ")} price`}
                  valueFormatter={indexFormat}
                  empty={<span className="text-[13px] text-fg-dim">No price history for this selection in {range}.</span>}
                />
              </CardBody>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-fg-dim">
                {lateStarters.length > 0 && start ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="info" size={14} className="shrink-0" />
                    {lateStarters.map((e) => e.ticker).join(", ")} history starts {formatDate(start, "short")}: the comparison starts there.
                  </span>
                ) : null}
                <PartialDataBadge errors={historyErrors.length > 0 ? historyErrors : null} />
                <span className="flex flex-wrap gap-x-3 gap-y-1 sm:ml-auto">
                  {sources.map((label) => (
                    <SourceTag key={label} source={label} />
                  ))}
                </span>
              </div>
            </Card>
            <Glance facts={facts} colors={colors} range={range} className="xl:col-span-4" />
          </div>

          <Card>
            <CardHeader
              title="Side by side"
              subtitle="The best value of each row is marked; a row where everyone ties marks nobody."
              refreshing={stats.refreshing}
              actions={<PartialDataBadge errors={stats.data?.errors ?? null} />}
            />
            <CardBody flush className="last:mb-0">
              <MetricsTable facts={facts} colors={colors} range={range} connected={Boolean(account)} />
            </CardBody>
          </Card>
        </>
      )}
    </Page>
  );
}

/** The wallet's holdings of an entity's token across followed chains. */
function holdingsOf(entity: Entity, portfolio: ReturnType<typeof usePortfolio>["data"], loading: boolean): Facts["holdings"] {
  if (!portfolio) return { value: null, amount: null, loading };
  const key = entity.priceKey;
  if (!key) return { value: null, amount: null, loading: false };
  const rows = portfolio.assets.filter((asset) => asset.identity.key === key);
  if (rows.length === 0) return { value: 0, amount: 0, loading: false };
  const value = rows.every((asset) => asset.value === null) ? null : rows.reduce((sum, asset) => sum + (asset.value ?? 0), 0);
  const amount = rows.every((asset) => asset.total === null) ? null : rows.reduce((sum, asset) => sum + (asset.total ?? 0), 0);
  return { value, amount, loading: false };
}

/* ------------------------------------------------------------------ at a glance */

/** A signed return, toned by direction (the sign and the word carry it too). */
function SignedPct({ value }: { value: number }) {
  const tone = value < 0 ? "text-[var(--d-neg)]" : "text-[var(--d-pos)]";
  return <span className={tone}>{formatPercent(value, { signed: true, digits: 1 })}</span>;
}

interface GlanceRow {
  id: string;
  label: string;
  values: Array<number | null>;
  rule: "max" | "min";
  format: (value: number) => ReactNode;
}

/**
 * The decision in six lines: who leads on return, real yield,
 * decentralisation, unbonding, price stability and size, with the winning
 * figure. Ties and single values crown nobody, as in the table.
 */
function Glance({ facts, colors, range, className }: { facts: readonly Facts[]; colors: ReadonlyMap<string, string>; range: PriceRange; className?: string }) {
  const rows: GlanceRow[] = [
    {
      id: "return",
      label: `Best performer · ${range}`,
      values: facts.map((f) => (f.perf.change === null ? null : f.perf.change * 100)),
      rule: "max",
      format: (v) => <SignedPct value={v} />,
    },
    {
      id: "realYield",
      label: "Highest real yield",
      values: facts.map((f) => (f.stats?.realYield ?? null) === null ? null : (f.stats?.realYield as number) * 100),
      rule: "max",
      format: (v) => <RealYieldText value={v / 100} />,
    },
    {
      id: "nakamoto",
      label: "Hardest to halt",
      values: facts.map((f) => f.stats?.nakamoto ?? null),
      rule: "max",
      format: (v) => `Nakamoto ${formatNumber(v)}`,
    },
    {
      id: "unbonding",
      label: "Shortest unbonding",
      values: facts.map((f) => f.stats?.unbondingDays ?? null),
      rule: "min",
      format: (v) => formatDays(v),
    },
    {
      id: "volatility",
      label: `Steadiest price · ${range}`,
      values: facts.map((f) => (f.perf.volatility === null ? null : f.perf.volatility * 100)),
      rule: "min",
      format: (v) => `${formatPercent(v, { digits: 0 })} vol.`,
    },
    {
      id: "marketCap",
      label: "Largest market cap",
      values: facts.map((f) => f.marketCap),
      rule: "max",
      format: (v) => formatFiat(v, facts.find((f) => f.marketCap === v)?.currency ?? "usd", { compact: true }),
    },
  ];
  const loading = facts.some((f) => f.perfLoading || f.statsState === "loading");

  return (
    <Card className={className}>
      <CardHeader title="At a glance" icon="sparkle" subtitle="Leaders among your selection" />
      <ul className="flex flex-col divide-y divide-[var(--d-hairline)]">
        {rows.map((row) => {
          const winners = [...bestIndexes(row.values, row.rule)];
          const first = winners[0];
          const fact = first !== undefined ? facts[first] : undefined;
          const value = first !== undefined ? row.values[first] : null;
          return (
            <li key={row.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-[12.5px] text-fg-dim">{row.label}</p>
                {fact ? (
                  <p className="mt-1 flex min-w-0 items-center gap-2 text-[14px] font-medium">
                    <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: colors.get(fact.entity.id) }} />
                    {fact.entity.ref.kind === "chain" ? <ChainLogo chainId={fact.entity.ref.id} size={18} /> : <AssetLogo src={fact.entity.logo} symbol={fact.entity.ticker} size={18} />}
                    <span className="truncate">{fact.entity.name}</span>
                    {winners.length > 1 ? <span className="text-[12px] font-normal text-fg-dim">+{winners.length - 1} tied</span> : null}
                  </p>
                ) : loading ? (
                  <Skeleton className="mt-1.5 h-4 w-36" />
                ) : (
                  <p className="mt-1 text-[13px] text-fg-dim">No comparison: fewer than two figures, or a tie</p>
                )}
              </div>
              {value !== null && value !== undefined ? <span className="shrink-0 text-[15px] font-semibold tabular-nums">{row.format(value)}</span> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
