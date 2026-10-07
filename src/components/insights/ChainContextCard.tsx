"use client";

/**
 * The selected chain's staking economics, next to its insights: the figures
 * an idle-balance or validator decision rests on. Actual APR is the
 * block-time corrected rate (spec §8), shown with the naive one it replaces;
 * real yield is APR minus actual inflation, what staking adds to your share
 * of supply. A third-party APR (cosmos.directory) is labelled as such.
 */

import { Button, Card, CardBody, CardFooter, CardHeader, Delta, InlineError, KeyValueList, Percent, Skeleton, type KeyValueItem } from "@/components/ui";
import type { ChainStatsField } from "@/lib/chain/types";
import type { ChainEntry } from "@/lib/chains";
import type { ChainStatsState } from "@/lib/data/chains";
import type { StakingPositionsState } from "@/lib/data/staking";
import { formatDuration, formatPercent } from "@/lib/format";

export interface ChainContextCardProps {
  chain: ChainEntry;
  stats: ChainStatsState;
  staking: StakingPositionsState;
  className?: string;
}

const pct = (fraction: number | null | undefined) => (fraction === null || fraction === undefined ? null : fraction * 100);

export function ChainContextCard({ chain, stats, staking, className }: ChainContextCardProps) {
  const row = stats.statsFor(chain.chainId);
  const mine = staking.chainFor(chain.chainId);
  const reason = (field: ChainStatsField) => row?.reasons?.[field] ?? "Not reported by this chain";

  const items: KeyValueItem[] = row
    ? [
        {
          key: "apr",
          label: "Actual APR",
          info:
            row.apr.source === "cosmos.directory"
              ? "From cosmos.directory (third party): this chain exposes no mint data Zunia can read."
              : (row.apr.method ?? "Annual provisions × observed ÷ assumed blocks per year × (1 − community tax) ÷ bonded tokens. Mint rewards only."),
          value: <Percent value={pct(row.apr.actual)} reason={row.apr.note ?? reason("apr")} />,
          sub:
            row.apr.naive !== null && row.apr.actual !== null && Math.abs(row.apr.naive - row.apr.actual) > 1e-4
              ? `${formatPercent(row.apr.naive * 100)} from the mint parameters alone`
              : row.apr.source === "cosmos.directory"
                ? "cosmos.directory"
                : undefined,
        },
        {
          key: "real",
          label: "Real yield",
          info: "Actual APR minus actual inflation: how much staking grows your share of the supply. Unstaked tokens shrink by the inflation rate.",
          value:
            row.realYield !== null ? <Delta value={row.realYield * 100} kind="pct" size="md" /> : <Percent value={null} reason={reason("realYield")} />,
        },
        { key: "inflation", label: "Inflation", value: <Percent value={pct(row.inflation.actual ?? row.inflation.param)} reason={reason("inflation")} /> },
        { key: "bonded", label: "Bonded ratio", value: <Percent value={pct(row.bondedRatio)} digits={1} reason={reason("bondedRatio")} /> },
        {
          key: "unbonding",
          label: "Unbonding",
          value: row.unbondingDays !== null ? formatDuration(row.unbondingDays * 86_400, { style: "long" }) : <Percent value={null} reason={reason("unbondingDays")} />,
        },
        {
          key: "nakamoto",
          label: "Nakamoto coefficient",
          info: "The fewest validators that together hold over a third of the voting power: enough to halt the chain.",
          value: row.nakamoto ?? <Percent value={null} reason={reason("nakamoto")} />,
        },
        { key: "commission", label: "Median commission", value: <Percent value={pct(row.medianCommission)} digits={1} reason={reason("medianCommission")} /> },
        ...(mine?.apr.weighted !== null && mine?.apr.weighted !== undefined
          ? [
              {
                key: "yours",
                label: "Your APR",
                info: "Weighted by your stake on each validator, after their commission.",
                value: <Percent value={mine.apr.weighted * 100} />,
                emphasis: true,
              } satisfies KeyValueItem,
            ]
          : []),
      ]
    : [];

  return (
    <Card pending={stats.stale} className={className}>
      <CardHeader title={`${chain.chainName} economics`} subtitle="What staking here earns and costs" icon="chains" refreshing={stats.refreshing && !stats.stale} />
      <CardBody>
        {stats.loading && !row ? (
          <div aria-hidden className="flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        ) : stats.status === "error" && !row ? (
          <InlineError message={stats.error?.message ?? "The chain's economics could not be read."} onRetry={stats.refetch} retrying={stats.refreshing} />
        ) : row ? (
          <KeyValueList divided items={items} />
        ) : (
          <p className="text-[13px] text-fg-dim">No figures for {chain.chainName} yet.</p>
        )}
      </CardBody>
      <CardFooter className="justify-between gap-2">
        <Button size="sm" variant="ghost" href={`/chains/${encodeURIComponent(chain.chainId)}`} iconRight="arrowRight" className="-ml-2">
          Chain details
        </Button>
        <Button size="sm" variant="ghost" href={`/validators?chain=${encodeURIComponent(chain.chainId)}`} iconRight="arrowRight" className="-mr-2">
          Validators
        </Button>
      </CardFooter>
    </Card>
  );
}
