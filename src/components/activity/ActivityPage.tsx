"use client";

/**
 * /activity: every transaction of the connected accounts across the chain
 * scope, with the analytics the extension popup has no room for.
 *
 * Reading order (spec §6): the filter row, how far back the history goes,
 * the KPI strip, the analysis cards, then the list grouped by day. All of it
 * reads one slice: the rows loaded for the date range (older pages load on
 * their own until the range is complete), narrowed by the type chips and the
 * search, client-side.
 *
 * With a date range the hook is asked for twice its length: the period
 * before the range is loaded too, only so the strip can say what changed
 * ("72 transactions ▲ 18%", the banner naming the dates compared). Those
 * older rows never reach the list, the charts or the export.
 *
 * Filters live in the URL (`?range=7d&kind=swaps,ibc&failed=1&asset=…&q=…`)
 * so other pages can link to a filtered view (an asset page links its own
 * key) and a view can be shared; they are mirrored with
 * `history.replaceState`, which Next's router follows without a server round
 * trip.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Page } from "@/components/shell/Page";
import { Button, Card, EmptyState, InlineError, PartialDataBadge, SourceTag, chainById, csvFileName, downloadCsv, toast, useNow } from "@/components/ui";
import {
  activityByPeriod,
  GROUP_LABELS,
  activityCsv,
  filterActivity,
  groupCounts,
  priceMapFrom,
} from "@/lib/activity/analytics";
import { useSpotPrices } from "@/lib/data/prices";
import type { PriceSource } from "@/lib/token/types";
import { useActivity } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { ActivityFees, ActivityFlows, ActivityOverTime, ActivityRhythm, ActivityUsage } from "./ActivityCharts";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityList } from "./ActivityList";
import { ActivitySummary } from "./ActivitySummary";
import { CoverageNote } from "./CoverageNote";
import {
  assetIdentityIn,
  assetKeyLabel,
  bech32Body,
  chartWindow,
  comparePeriods,
  comparisonState,
  coverageViews,
  csvViewLine,
  feeSeries,
  filtersFromSearch,
  filtersToSearch,
  hasNarrowingFilters,
  historyComplete,
  isTxHash,
  movesAsset,
  normalizeHash,
  olderHistoryExists,
  previousSince,
  priceKeysOf,
  rangePhrase,
  rangeSince,
  retentionEdge,
  withSecondLine,
  type ActivityFilters as Filters,
  type PeriodComparison,
} from "./view";

export interface ActivityPageProps {
  /** Filters read from the URL by the server page. */
  initialFilters: Filters;
}

/** Whether a comparison has a change any tile can print. */
function hasChange(comparison: PeriodComparison | null): boolean {
  return comparison !== null && Object.values(comparison.change).some((value) => value !== null);
}

/** Where a spot price came from, as the provenance tag names it. */
const PRICE_SOURCE_NAMES: Readonly<Record<PriceSource, string>> = {
  numia: "Numia",
  coingecko: "CoinGecko",
  coinstore: "Coinstore",
  "osmosis-sqs": "Osmosis",
};

export function ActivityPage({ initialFilters }: ActivityPageProps) {
  return (
    <Page
      title="Activity"
      access="wallet"
      connectTitle="See your activity"
      connectDescription="Every transfer, IBC transfer, swap, stake and vote across your networks, with fees, flows and coverage. Connecting only reads your addresses: nothing is signed."
    >
      <ActivityView initialFilters={initialFilters} />
    </Page>
  );
}

function ActivityView({ initialFilters }: ActivityPageProps) {
  // In the browser the live URL wins over the server's reading of it. Back
  // restores this page from the router's cache, rendered for the URL as it
  // was first loaded, while the URL itself carries the filters set since
  // (mirrored below); starting from the stale copy would also write it back
  // over them. On the first load both readings are the same URL.
  const [filters, setFilters] = useState<Filters>(() =>
    typeof window === "undefined" ? initialFilters : filtersFromSearch(window.location.search),
  );
  // Bumped by every change made in the filter row: the list starts that new
  // view at its newest rows. The footer's "Show all time" step does not bump
  // it, so the list carries on where it was instead of folding back to ten.
  const [listView, setListView] = useState(0);
  const changeFilters = useCallback((next: Filters) => {
    setFilters(next);
    setListView((serial) => serial + 1);
  }, []);
  const now = useNow();
  const { selectedChainId, scopedChainIds } = useChainScope();
  const prefs = usePrefs();

  // Mirror the filters into the URL (no history entry per keystroke). The
  // state is null on purpose: Next's patched replaceState copies its own
  // entry state and moves the router to the new URL, where passing the
  // current state (it carries Next's marker) would skip that sync.
  useEffect(() => {
    const url = `${window.location.pathname}${filtersToSearch(filters)}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", url);
    }
  }, [filters]);

  const since = rangeSince(filters.range, now);
  const before = previousSince(filters.range, since);
  const activity = useActivity({ since: before ?? since });
  const { coverage, errors, loading, refreshing, stale, hasMore, loadingMore, loadMore, loadedUntil } = activity;
  const loaded = activity.items;

  // The range's rows; what is older belongs to the comparison period only.
  const items = useMemo(() => (since === null ? loaded : loaded.filter((item) => Date.parse(item.time) >= since)), [loaded, since]);
  const previousItems = useMemo(
    () => (since === null || before === null ? [] : loaded.filter((item) => Date.parse(item.time) < since)),
    [loaded, since, before],
  );
  // The hook's `reachedSince` is about the comparison's start; the range
  // itself is complete as soon as the loaded list reaches back to its own.
  const loadedUntilMs = loadedUntil ? Date.parse(loadedUntil) : null;
  const rangeReached = since === null || activity.reachedSince || !hasMore || (loadedUntilMs !== null && loadedUntilMs <= since);
  // Pages loading for the comparison alone are not "loading older
  // transactions" as far as the list and the banner are concerned.
  const rangeLoading = loadingMore && (since === null || !rangeReached);

  // Prices for every amount and fee token loaded (both periods, not just the
  // filtered rows), so toggling a chip never refetches them.
  const priceKeys = useMemo(() => priceKeysOf(loaded), [loaded]);
  const prices = useSpotPrices(priceKeys);
  const priceMap = useMemo(() => priceMapFrom(prices.data?.prices), [prices.data]);
  // Money is formatted in the currency the prices came back in (an FX
  // fallback answers in USD), never the stored preference.
  const currency = prices.data?.currency ?? prefs.currency;
  const pricesLoading = prices.loading && priceKeys.length > 0;

  // An asset page's link narrows the view to the rows that moved that asset,
  // first, so the chips below count within it.
  const assetKey = filters.asset;
  const inAsset = useMemo(() => (assetKey === null ? items : items.filter((item) => movesAsset(item, assetKey))), [items, assetKey]);
  // What the filter chip calls the asset: the identity the loaded rows know,
  // else the denom from its key.
  const assetIdentity = useMemo(() => (assetKey === null ? null : assetIdentityIn(loaded, assetKey)), [loaded, assetKey]);
  const assetChip = useMemo(
    () => (assetKey === null ? null : { ticker: assetIdentity?.ticker ?? assetKeyLabel(assetKey), logoUrl: assetIdentity?.logoUrl }),
    [assetKey, assetIdentity],
  );

  const query = useDeferredValue(filters.query);
  const searched = useMemo(() => filterActivity(inAsset, { query }), [inAsset, query]);
  const counts = useMemo(
    () => groupCounts(filters.failedOnly ? searched.filter((item) => !item.success) : searched),
    [searched, filters.failedOnly],
  );
  const inGroups = useMemo(() => filterActivity(searched, { groups: filters.groups }), [searched, filters.groups]);
  const failedCount = useMemo(() => inGroups.filter((item) => !item.success).length, [inGroups]);
  const rows = useMemo(() => (filters.failedOnly ? inGroups.filter((item) => !item.success) : inGroups), [inGroups, filters.failedOnly]);
  const allCount = filters.failedOnly ? searched.filter((item) => !item.success).length : searched.length;

  const window_ = useMemo(
    () => (now === null ? null : chartWindow({ since, now, rows: items, loadedUntil: hasMore ? loadedUntil : null })),
    [since, now, items, loadedUntil, hasMore],
  );
  const periods = useMemo(
    () => (window_ ? activityByPeriod(rows, { bucket: window_.bucket, from: window_.from, to: window_.to, zone: "local" }) : []),
    [rows, window_],
  );
  const trend = useMemo(() => periods.map((period) => period.total), [periods]);
  const feeTrend = useMemo(
    () => (window_ ? feeSeries(rows, priceMap, periods.map((period) => period.start), window_.bucket) : null),
    [rows, priceMap, periods, window_],
  );

  const views = useMemo(() => coverageViews(coverage), [coverage]);
  // The banner's "complete" verdict, for the strip's known zeros.
  const notRead = activity.unavailableChains.length + activity.truncated.length;
  const complete = useMemo(() => historyComplete(views, since, notRead), [views, since, notRead]);
  const partialBefore = useMemo(() => {
    if (!window_) return null;
    const edge = retentionEdge(views, window_.from);
    return edge ? { at: edge.at, chainNames: edge.chainIds.map((id) => chainById(id)?.chainName ?? id) } : null;
  }, [views, window_]);

  // The period before the range, narrowed by the same chips and search, once
  // every chain is complete that far back (see `comparisonState`).
  const comparisonStatus = useMemo(
    () => comparisonState({ previousSince: before, reached: activity.reachedSince, views }),
    [before, activity.reachedSince, views],
  );
  const comparison = useMemo(() => {
    if (comparisonStatus.state !== "ready" || since === null || before === null) return null;
    const previousInAsset = assetKey === null ? previousItems : previousItems.filter((item) => movesAsset(item, assetKey));
    const previousRows = filterActivity(previousInAsset, { query, groups: filters.groups, failedOnly: filters.failedOnly });
    return comparePeriods(rows, previousRows, priceMap, { from: before, to: since });
  }, [comparisonStatus, since, before, previousItems, assetKey, query, filters.groups, filters.failedOnly, rows, priceMap]);

  // The wallet's own keys, so a counterparty that is the viewer on another
  // chain (an IBC transfer to themselves, their own validator) is named so.
  const ownBodies = useMemo(
    () => new Set(activity.accounts.map((account) => bech32Body(account.address)).filter((body): body is string => body !== null)),
    [activity.accounts],
  );

  const singleChain = selectedChainId !== null || scopedChainIds.length === 1;
  const filtered = filters.groups.length > 0 || filters.failedOnly || query.trim().length > 0 || assetKey !== null;
  const firstError = activity.status === "error" ? activity.error : null;
  // A failed older page matters to the list only while the range itself is
  // incomplete; one that failed for the comparison just leaves the ▲▼ out.
  const moreError = activity.status !== "error" && (since === null || !rangeReached) ? activity.error : null;

  const exportCsv = useCallback(() => {
    // `downloadCsv` adds the byte-order mark Excel needs; asking activityCsv
    // for one as well would write it twice.
    const csv = withSecondLine(activityCsv(rows, coverage), csvViewLine(filters, GROUP_LABELS, assetIdentity?.ticker));
    downloadCsv(csvFileName("zunia-activity"), csv);
    toast.success(`Exported ${rows.length} ${rows.length === 1 ? "transaction" : "transactions"}`, {
      description: "The first line says how far back each network's history goes.",
    });
  }, [rows, coverage, filters, assetIdentity]);

  const clearFilters = useCallback(() => {
    setFilters((current) => ({ ...current, groups: [], failedOnly: false, query: "", asset: null }));
    setListView((serial) => serial + 1);
  }, []);
  const showAll = useCallback(() => {
    setFilters((current) => ({ ...current, range: "all" }));
    setListView((serial) => serial + 1);
  }, []);
  // The footer's step once a range is all on screen: same view, older rows
  // after the ones already shown (the list is not sent back to ten).
  const stepToAllTime = useCallback(() => setFilters((current) => ({ ...current, range: "all" })), []);
  const accountsKey = activity.accounts.map((account) => `${account.chainId}:${account.address}`).join(",");

  const trimmedQuery = filters.query.trim();
  const hashLookup = isTxHash(trimmedQuery) && rows.length === 0 ? { hash: normalizeHash(trimmedQuery), chainIds: scopedChainIds.slice(0, 8) } : null;

  const priceSources = useMemo(() => {
    const labels = new Set<string>();
    for (const spot of Object.values(prices.data?.prices ?? {})) if (spot) labels.add(PRICE_SOURCE_NAMES[spot.source]);
    return [...labels].sort();
  }, [prices.data]);

  const pending = stale;
  const firstLoad = loading && items.length === 0;
  // Before the clock is known (the hydrating render) there is no range start
  // yet; the strip waits rather than counting the wrong window.
  const summaryLoading = firstLoad || (now === null && filters.range !== "all");
  // An empty view (a filter or a range with nothing in it) keeps the strip's
  // zeros, which say something, but not five empty chart cards, which don't.
  const emptyView = !summaryLoading && rows.length === 0;

  // Connected, but no chain in scope has an address to read (nothing
  // followed on this network, or the wallet shared no key for them): saying
  // "no transactions yet" here would be a claim about history nobody read.
  if (activity.connected && activity.accounts.length === 0 && !loading) {
    const missing = activity.unavailableChains.map((id) => chainById(id)?.chainName ?? id);
    return (
      <Card>
        <EmptyState
          icon="networks"
          title="No network to read"
          body={
            missing.length > 0
              ? `Your wallet hasn't shared an address for ${missing.join(", ")}, so their history can't be read. Reconnect and approve them, or pick another network.`
              : "Follow a network to see its activity here."
          }
          action={
            <Button size="sm" variant="secondary" href="/networks" iconLeft="networks">
              Manage networks
            </Button>
          }
        />
      </Card>
    );
  }

  if (firstError && items.length === 0) {
    return (
      <div className="flex flex-col gap-[var(--d-gap)]">
        <ActivityFilters filters={filters} onChange={changeFilters} counts={null} total={null} failed={null} asset={assetChip} />
        <InlineError
          title="Couldn't load your activity"
          message={`${firstError.message}. This is a failed read, not an empty history.`}
          onRetry={activity.refetch}
          retrying={refreshing}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--d-gap)] xl:gap-5">
      <ActivityFilters
        filters={filters}
        onChange={changeFilters}
        counts={firstLoad ? null : counts}
        total={firstLoad ? null : allCount}
        failed={firstLoad ? null : failedCount}
        asset={assetChip}
        end={
          <>
            <PartialDataBadge errors={[...errors, ...(prices.data?.errors ?? [])]} />
            {priceSources.length > 0 ? (
              <SourceTag
                estimate
                source={`Today's prices · ${priceSources.join(", ")}`}
                // The shared clock ticks every 30 s: a read newer than its
                // last tick would otherwise say "in under a minute".
                at={prices.updatedAt !== null && now !== null ? Math.min(prices.updatedAt, now) : prices.updatedAt}
              />
            ) : null}
          </>
        }
      />

      {firstError ? (
        <InlineError
          title="Showing the last successful read"
          message={`The latest refresh failed (${firstError.message}). Rows below may be out of date.`}
          onRetry={activity.refetch}
          retrying={refreshing}
        />
      ) : null}

      {!firstLoad ? (
        <CoverageNote
          views={views}
          since={since}
          rangePhrase={rangePhrase(filters.range)}
          loadingMore={rangeLoading}
          unavailable={activity.unavailableChains}
          truncated={activity.truncated}
          // The banner explains the ▲▼ only when a tile shows one (nothing
          // to compare in an empty view, or with nothing before).
          comparison={
            since !== null && before !== null && (comparisonStatus.state !== "ready" || hasChange(comparison))
              ? { state: comparisonStatus, from: before, to: since }
              : null
          }
        />
      ) : null}

      <ActivitySummary
        rows={rows}
        prices={priceMap}
        currency={currency}
        window={window_}
        trend={trend}
        comparison={comparison}
        ownBodies={ownBodies}
        complete={complete}
        loading={summaryLoading}
        pricesLoading={pricesLoading}
      />

      {!emptyView ? (
        <div className="grid grid-cols-12 gap-[var(--d-gap)]">
          <ActivityOverTime
            className="col-span-12 xl:col-span-8"
            periods={periods}
            window={window_}
            rows={rows}
            partialBefore={partialBefore}
            loading={summaryLoading}
            pending={pending}
          />
          <ActivityFees
            className="col-span-12 xl:col-span-4"
            rows={rows}
            prices={priceMap}
            currency={currency}
            trend={feeTrend}
            per={window_?.bucket === "week" ? "week" : "day"}
            singleChain={singleChain}
            loading={firstLoad || (pricesLoading && rows.length > 0)}
            pending={pending}
          />
          <ActivityUsage
            className="col-span-12 md:col-span-6 xl:col-span-4"
            rows={rows}
            singleChain={singleChain}
            ownBodies={ownBodies}
            now={now}
            loading={firstLoad}
            pending={pending}
          />
          <ActivityRhythm className="col-span-12 md:col-span-6 xl:col-span-4" rows={rows} loading={firstLoad} pending={pending} />
          <ActivityFlows
            className="col-span-12 xl:col-span-4"
            rows={rows}
            prices={priceMap}
            currency={currency}
            ownBodies={ownBodies}
            loading={firstLoad || (pricesLoading && rows.length > 0)}
            pending={pending}
          />
        </div>
      ) : null}

      <ActivityList
        rows={rows}
        prices={priceMap}
        currency={currency}
        now={now}
        loading={firstLoad}
        pending={pending}
        refreshing={refreshing}
        hasMore={hasMore}
        loadingMore={rangeLoading}
        loadMore={loadMore}
        moreError={moreError}
        range={filters.range}
        reachedSince={rangeReached}
        olderExists={olderHistoryExists({ since, hasMore, olderLoaded: previousItems.length, coverage })}
        complete={complete}
        onAllTime={stepToAllTime}
        // A new view (filter row, scope or wallet) starts the list at its
        // newest rows; see `listView`.
        viewKey={`${listView}|${accountsKey}`}
        filtered={filtered}
        onClearFilters={clearFilters}
        rangePhrase={rangePhrase(filters.range)}
        onShowAll={filters.range !== "all" && !hasNarrowingFilters(filters) ? showAll : null}
        onExport={exportCsv}
        hashLookup={hashLookup}
        ownBodies={ownBodies}
      />
    </div>
  );
}

