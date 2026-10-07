"use client";

/**
 * The Bridge page's history figures, read from the chains (`useActivity`):
 * the route suggestions, the IBC counts without the double count of moves
 * between your own accounts, what moved out (at today's prices, an
 * estimate), and how long your own transfers took per route.
 *
 * Two windows on purpose. Counts and lists keep to the selected chain
 * (transfers that touch it) and to the loaded window their "since" caption
 * names. Route speed and suggestions read every followed chain in that
 * window: how fast Safrochain → Osmosis delivers does not depend on which
 * chain the rail has selected.
 */

import { useCallback, useMemo } from "react";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { flowSummary } from "@/lib/activity/analytics";
import type { ActivityItem } from "@/lib/activity/types";
import {
  channelFromHistory,
  historySince,
  ibcCounts,
  isIbc,
  pairOwnIbc,
  routeTiming,
  suggestRoutes,
  timingsByRoute,
  touchesChain,
  transferStats,
  withinLoaded,
  type SpendableAsset,
} from "./logic";
import { sinceText } from "./names";
import { useHistoryPrices } from "./useHistoryPrices";

export function useBridgeHistory({
  items,
  loadedUntil,
  assets,
  followed,
  selectedChainId,
}: {
  items: readonly ActivityItem[];
  loadedUntil: string | null;
  assets: readonly SpendableAsset[];
  followed: readonly string[];
  selectedChainId: string | null;
}) {
  // Figures count the window their "since" caption names (see `withinLoaded`).
  const covered = useMemo(() => withinLoaded(items, loadedUntil), [items, loadedUntil]);
  const routes = useMemo(
    () => suggestRoutes({ assets, activity: covered, followed, venueChainId: SWAP_VENUE_CHAIN_ID, limit: 5 }),
    [assets, covered, followed],
  );

  const scoped = useMemo(() => (selectedChainId ? covered.filter((item) => touchesChain(item, selectedChainId)) : covered), [covered, selectedChainId]);
  const ibcItems = useMemo(() => scoped.filter(isIbc), [scoped]);
  // Pairing needs both ends of a transfer; both touch the scoped chain when one does.
  const paired = useMemo(() => pairOwnIbc(ibcItems), [ibcItems]);
  const stats = useMemo(() => transferStats(scoped), [scoped]);
  const counts = ibcCounts(stats, paired.ownTransfers);
  const movedOutItems = useMemo(() => ibcItems.filter((item) => item.kind === "ibc-out" && item.success), [ibcItems]);
  const historyPrices = useHistoryPrices(movedOutItems);
  const movedOut = useMemo(() => flowSummary(movedOutItems, { prices: historyPrices.prices, groups: ["ibc"] }), [movedOutItems, historyPrices.prices]);

  const allTimings = useMemo(() => pairOwnIbc(covered.filter(isIbc)).timings, [covered]);
  const routeTimings = useMemo(() => timingsByRoute(allTimings), [allTimings]);
  const allSince = useMemo(() => sinceText(historySince(loadedUntil, transferStats(covered).since)), [loadedUntil, covered]);
  const timingFor = useCallback((from: string, to: string) => routeTiming(allTimings, from, to), [allTimings]);
  // Every loaded row, not only the window: a channel hint is evidence, not a figure.
  const channelFor = useCallback((from: string, to: string) => channelFromHistory(items, from, to), [items]);

  return {
    routes,
    paired,
    counts,
    movedOut,
    movedOutItems,
    historyPrices,
    /** "since Sep 22" for the scoped figures. */
    since: sinceText(historySince(loadedUntil, stats.since)),
    routeTimings,
    /** "since Sep 22" for the all-chains timings. */
    allSince,
    timingFor,
    channelFor,
  };
}
