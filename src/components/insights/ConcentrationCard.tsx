"use client";

/**
 * How spread the priced value is, by asset or by network: an allocation bar
 * with the numbers, the largest holding's share, and the Herfindahl–Hirschman
 * index (Σ share²) with its plain reading, "as concentrated as N equal
 * holdings". The figure the concentration insight quotes is this one.
 *
 * Unpriced holdings are not in it (they have no value to share out), and the
 * card says how many were left out rather than letting a smaller total pass
 * for the whole.
 */

import { useMemo, useState } from "react";
import { Meter, StackedBar, stableColorMap } from "@/components/charts";
import { useMoneyFormatters } from "@/components/overview/useFormatters";
import { Badge, Card, CardBody, CardFooter, CardHeader, EmptyState, InlineError, Segmented, Skeleton } from "@/components/ui";
import type { PortfolioState } from "@/lib/data/portfolio";
import { formatPercent } from "@/lib/format";
import { HHI_CONCENTRATED, HHI_MODERATE, LEVEL_LABEL, assetSlices, chainSlices, concentrationOf } from "./model";

type View = "asset" | "chain";

export interface ConcentrationCardProps {
  portfolio: PortfolioState;
  /** One chain in scope: a by-network split would be a single bar. */
  singleChain: boolean;
  className?: string;
}

export function ConcentrationCard({ portfolio, singleChain, className }: ConcentrationCardProps) {
  const [chosen, setChosen] = useState<View>("asset");
  const data = portfolio.data;
  const money = useMoneyFormatters(data?.currency ?? "usd");

  const byAsset = useMemo(() => (data ? concentrationOf(assetSlices(data)) : null), [data]);
  const byChain = useMemo(() => (data ? concentrationOf(chainSlices(data)) : null), [data]);
  // Colours from the full list, largest first, so a slice keeps its hue.
  const assetColors = useMemo(() => stableColorMap(byAsset?.slices.map((slice) => slice.id) ?? []), [byAsset]);
  const chainColors = useMemo(() => stableColorMap(byChain?.slices.map((slice) => slice.id) ?? []), [byChain]);

  const chainsAvailable = !singleChain && (byChain?.slices.length ?? 0) >= 2;
  const view: View = chainsAvailable ? chosen : "asset";
  const figures = view === "asset" ? byAsset : byChain;
  const unpriced = data?.totals.unpricedAssetCount ?? 0;
  const noun = view === "asset" ? "asset" : "network";

  return (
    <Card pending={portfolio.stale} className={className}>
      <CardHeader
        title="Concentration"
        subtitle={`How spread your priced value is, by ${noun}`}
        icon="layers"
        refreshing={portfolio.refreshing && !portfolio.stale}
        info={
          <span className="block max-w-[300px] text-[12.5px] leading-snug text-fg-muted">
            HHI (Herfindahl–Hirschman index) = Σ share². 1.00 means everything sits in one {noun}; N equal holdings give 1/N. Above{" "}
            {HHI_CONCENTRATED.toFixed(2)} is “highly concentrated” and {HHI_MODERATE.toFixed(2)}–{HHI_CONCENTRATED.toFixed(2)} “moderately” in the
            antitrust convention it comes from: a yardstick, not a verdict.
          </span>
        }
        actions={
          chainsAvailable ? (
            <Segmented<View>
              ariaLabel="Split by"
              value={view}
              onChange={setChosen}
              options={[
                { value: "asset", label: "Asset" },
                { value: "chain", label: "Network" },
              ]}
            />
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-4">
        {portfolio.loading && !data ? (
          <div aria-hidden className="flex flex-col gap-3">
            <Skeleton className="h-7 w-28 rounded-[7px]" />
            <Skeleton className="h-3 w-full rounded-full" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : portfolio.status === "error" && !data ? (
          <InlineError message={portfolio.error?.message ?? "Balances could not be read."} onRetry={portfolio.refetch} retrying={portfolio.refreshing} />
        ) : !figures || figures.slices.length === 0 ? (
          <EmptyState
            inline
            icon="layers"
            title="Nothing priced to split"
            body={unpriced > 0 ? `${unpriced} ${unpriced === 1 ? "asset has" : "assets have"} no price, so there is no value to share out.` : "Holdings with a price show up here."}
          />
        ) : figures.slices.length === 1 && figures.top ? (
          // One holding is all of itself: a fact the holder knows, not a measure.
          <EmptyState
            inline
            icon="layers"
            title={`All of it is ${figures.top.label}`}
            body={
              singleChain
                ? "One priced asset in this scope, so there is nothing to spread. Select All chains on the rail to measure your whole portfolio."
                : "One priced asset, so there is nothing to spread."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <div className="text-[12.5px] text-fg-dim">Largest {noun}</div>
                <div className="mt-1 flex min-w-0 items-baseline gap-2">
                  <span className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-fg [font-variant-numeric:proportional-nums]">
                    {figures.topShare !== null ? formatPercent(figures.topShare * 100, { digits: 1 }) : "—"}
                  </span>
                  <span className="truncate text-[14px] font-medium text-fg-muted">{figures.top?.label}</span>
                </div>
              </div>
              {figures.level ? (
                <Badge tone={figures.level === "concentrated" ? "warning" : figures.level === "moderate" ? "neutral" : "success"} size="md">
                  {LEVEL_LABEL[figures.level]}
                </Badge>
              ) : null}
            </div>

            <StackedBar
              data={figures.slices}
              colors={view === "asset" ? assetColors : chainColors}
              valueFormatter={money.compact}
              maxSegments={5}
              title={`Priced value by ${noun}`}
            />

            {figures.hhi !== null ? (
              <div className="flex flex-col gap-2 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3">
                <Meter
                  value={figures.hhi}
                  max={1}
                  size="sm"
                  label="HHI"
                  valueLabel={figures.hhi.toFixed(2)}
                  // Amber, like the badge above, and never red: a yardstick, not a verdict.
                  thresholds={{ warning: HHI_CONCENTRATED }}
                  statusLabels={{ warning: "High" }}
                  markers={[
                    { value: HHI_MODERATE, label: `Moderate from ${HHI_MODERATE.toFixed(2)}` },
                    { value: HHI_CONCENTRATED, label: `High from ${HHI_CONCENTRATED.toFixed(2)}` },
                  ]}
                  ariaLabel="Herfindahl–Hirschman index"
                />
                <p className="text-[12.5px] leading-snug text-fg-muted">
                  {figures.effective !== null ? (
                    <>
                      As concentrated as <span className="font-medium text-fg">{figures.effective.toFixed(1)}</span> equal{" "}
                      {figures.effective.toFixed(1) === "1.0" ? noun : `${noun}s`} would be.
                    </>
                  ) : null}
                  {figures.top && figures.topShare !== null && view === "asset" ? (
                    <> A 10% move in {figures.top.label} moves your priced net worth {formatPercent(figures.topShare * 10, { digits: 1 })}.</>
                  ) : null}
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
      {data && figures && figures.slices.length > 0 ? (
        <CardFooter className="text-[12px]">
          Priced value only
          {unpriced > 0 ? ` · ${unpriced} unpriced ${unpriced === 1 ? "asset" : "assets"} not counted` : ""}
          {money.hidden ? "" : ` · ${money.compact(figures.total)} in all`}
        </CardFooter>
      ) : null}
    </Card>
  );
}
