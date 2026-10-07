"use client";

/**
 * Where the net worth sits: by chain, by asset (the same asset on several
 * chains counted once) or by type (liquid, staked, rewards, unbonding).
 *
 * Five named slices and "Other" at most, each with its value and share in the
 * legend, so nothing depends on judging an angle. Colours come from the full
 * list of the view (largest first), so a chain keeps its hue when another
 * view is opened and back. Unpriced holdings are counted under the legend
 * (by asset, as the Assets page counts them), never drawn as zero-sized
 * slices.
 */

import { useMemo, useState } from "react";
import { Donut } from "@/components/charts";
import { Card, CardBody, CardHeader, Dot, IconButton, InfoTip, InlineError, Segmented } from "@/components/ui";
import type { PortfolioState } from "@/lib/data/portfolio";
import { groupAssets } from "@/lib/token/holdings";
import { UNPRICED_TEXT } from "@/lib/token/wire";
import { useStoredValue } from "@/lib/useStoredValue";
import { allocationByAsset, allocationByChain, allocationByType, assetCounts, type AllocationView } from "./model";
import { useMoneyFormatters } from "./useFormatters";

const VIEW_KEY = "zunia.dashboard.overview.allocation";

const VIEW_TITLE: Record<AllocationView, string> = {
  chain: "By chain",
  asset: "By asset",
  type: "By type",
};

export function AllocationCard({ state, singleChain }: { state: PortfolioState; singleChain: boolean }) {
  const [stored, setView] = useStoredValue<AllocationView>(VIEW_KEY, "chain");
  const [table, setTable] = useState(false);
  const data = state.data;
  const fmt = useMoneyFormatters(data?.currency ?? "usd");

  // Every view at once: they are cheap, and knowing which ones split decides
  // what the switch offers.
  const model = useMemo(() => {
    if (!data) return null;
    const groups = groupAssets(data.assets);
    return {
      views: {
        chain: allocationByChain(data),
        asset: allocationByAsset(data, groups),
        type: allocationByType(data.totals),
      },
      counts: assetCounts(groups, data.assets.length),
    };
  }, [data]);
  const views = model?.views ?? null;
  const counts = model?.counts ?? null;

  // A single slice says nothing a full ring can't (one chain in scope, one
  // asset held): such a view is disabled and the first view that splits is
  // shown instead, without overwriting the stored choice.
  const order: AllocationView[] = singleChain ? ["asset", "type"] : ["chain", "asset", "type"];
  const splits = (v: AllocationView) => (views ? views[v].parts.length >= 2 : true);
  const anySplits = order.some(splits);
  const preferred: AllocationView = singleChain && stored === "chain" ? "asset" : stored;
  const view = splits(preferred) || !anySplits ? preferred : (order.find(splits) ?? preferred);
  const allocation = views ? views[view] : null;

  const options = order.map((value) => ({
    value,
    label: value === "chain" ? "Chain" : value === "asset" ? "Asset" : "Type",
    ariaLabel: splits(value) ? VIEW_TITLE[value] : `${VIEW_TITLE[value]}: a single slice here`,
    disabled: anySplits && !splits(value),
  }));

  const priced = counts ? counts.assets - counts.unpriced : 0;
  const subtitle = data
    ? view === "chain"
      ? `Priced value · ${data.totals.chainCount} ${data.totals.chainCount === 1 ? "network" : "networks"}`
      : view === "asset"
        ? `Priced value · ${priced} priced ${priced === 1 ? "asset" : "assets"}`
        : "Priced value by state"
    : "Share of priced value";

  return (
    <Card pending={state.stale} className="h-full">
      <CardHeader
        title="Allocation"
        subtitle={subtitle}
        actions={
          <IconButton
            label={table ? "Show as chart" : "Show as table"}
            icon={table ? "activity" : "list"}
            size="sm"
            variant="ghost"
            pressed={table}
            onClick={() => setTable((on) => !on)}
          />
        }
      />
      {/* The view switch on its own row, full width in a narrow card: next to
          the title it would wrap under it at the right edge, out of line
          with everything else in the card. */}
      <Segmented<AllocationView>
        ariaLabel="Group allocation by"
        value={view}
        onChange={setView}
        options={options}
        fullWidth
        className="max-w-[22rem]"
      />
      <CardBody className="flex flex-1 flex-col justify-center">
        {state.status === "error" && !data ? (
          <InlineError message={state.error?.message ?? "The portfolio read failed."} onRetry={state.refetch} />
        ) : (
          <Donut
            data={allocation?.parts ?? []}
            colors={allocation?.colors}
            size={168}
            thickness={18}
            title={VIEW_TITLE[view]}
            // Holdings, not prices: cents at most ("<$0.01" for dust).
            valueFormatter={fmt.holding}
            centerValue={allocation ? fmt.holding(allocation.total) : undefined}
            centerCaption={allocation ? "priced" : undefined}
            loading={state.loading}
            pending={state.stale}
            view={table ? "table" : "chart"}
            empty={counts && counts.unpriced > 0 ? "Nothing here has a price yet." : "Nothing held in this scope."}
            legendFooter={
              counts && counts.unpriced > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone="warning" />
                  {counts.unpriced} unpriced {counts.unpriced === 1 ? "asset" : "assets"} not counted
                  <InfoTip
                    size={13}
                    label="Why some assets have no price"
                    content={
                      <ul className="flex max-w-[280px] flex-col gap-1 text-[12.5px] leading-snug">
                        {counts.unpricedReasons.map(({ reason, count }) => (
                          <li key={reason}>
                            <span className="font-medium text-fg">{count}</span>{" "}
                            <span className="text-fg-muted">· {UNPRICED_TEXT[reason]}</span>
                          </li>
                        ))}
                      </ul>
                    }
                  />
                </span>
              ) : undefined
            }
          />
        )}
      </CardBody>
    </Card>
  );
}
