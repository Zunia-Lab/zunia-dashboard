"use client";

/**
 * The strip above the Chains table: four leaders among the rows on screen,
 * each with the context that explains it (a real yield is only high where
 * few stake, so the staked share rides along).
 */

import { ChainLogo, StatTile, chainById } from "@/components/ui";
import type { ChainStats } from "@/lib/chain/types";
import { formatNumber, formatPercent } from "@/lib/format";
import { Dash, RealYieldText } from "./cells";
import { formatDays, haltedCount, leaderOf, toPct } from "./model";
import type { LazyChainStats } from "./useLazyChainStats";

function LeaderName({ stats, detail }: { stats: ChainStats; detail?: string | null }) {
  const chain = chainById(stats.chainId);
  return (
    <span className="flex min-w-0 max-w-full flex-col gap-1">
      <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-fg-muted">
        <ChainLogo chainId={stats.chainId} size={14} />
        <span className="truncate">
          {chain?.chainName ?? stats.chainName}
          {detail ? <span className="text-fg-dim max-sm:hidden"> · {detail}</span> : null}
        </span>
      </span>
      {/* The context explains the figure (a huge real yield where few
          stake): phones keep it, on a line of its own. */}
      {detail ? <span className="truncate text-fg-dim sm:hidden">{detail}</span> : null}
    </span>
  );
}

/**
 * Four leaders across the rows on screen, each with the context that
 * explains it: the strip answers "where does staking pay, who is hardest to
 * halt, where is my stake liquid soonest, is anything down" before the
 * table is read.
 */
export function ChainLeaders({ stats }: { stats: LazyChainStats }) {
  const list = stats.loaded;
  const yieldLeader = leaderOf(list, (s) => s.realYield, "max");
  const nakamoto = leaderOf(list, (s) => s.nakamoto, "max");
  const unbonding = leaderOf(list, (s) => s.unbondingDays, "min");
  const health = haltedCount(list);
  const loading = stats.initialLoading;
  const among = (n: number) => `Among the ${n} chains in the table below with this figure.`;

  return (
    <div className="grid grid-cols-2 gap-[var(--d-gap)] lg:grid-cols-4">
      <StatTile
        label="Best real yield"
        loading={loading}
        tone={yieldLeader && yieldLeader.value < 0 ? "negative" : "positive"}
        value={yieldLeader ? <RealYieldText value={yieldLeader.value} className="font-semibold" /> : <Dash reason="Not enough chains with data yet" />}
        sub={
          yieldLeader ? (
            // The bonded share explains a high figure: issuance split among few stakers.
            <LeaderName stats={yieldLeader.stats} detail={yieldLeader.stats.bondedRatio !== null ? `${formatPercent(toPct(yieldLeader.stats.bondedRatio), { digits: 0 })} staked` : null} />
          ) : null
        }
        info={
          <>
            Staking APR (block-time corrected, before validator commission) minus actual inflation: what staking adds to your
            share of supply in a year. {yieldLeader ? among(yieldLeader.among) : null}
          </>
        }
      />
      <StatTile
        label="Hardest to halt"
        loading={loading}
        value={nakamoto ? formatNumber(nakamoto.value) : <Dash reason="Not enough chains with data yet" />}
        sub={
          nakamoto ? (
            <LeaderName stats={nakamoto.stats} detail={nakamoto.stats.activeValidators !== null ? `${formatNumber(nakamoto.stats.activeValidators)} validators` : null} />
          ) : null
        }
        info={
          <>
            Nakamoto coefficient: the fewest validators that together hold more than a third of the stake, enough to halt the
            chain. Higher is harder to stop. {nakamoto ? among(nakamoto.among) : null}
          </>
        }
      />
      <StatTile
        label={
          <>
            <span className="sm:hidden">Fastest unbond</span>
            <span className="max-sm:hidden">Shortest unbonding</span>
          </>
        }
        loading={loading}
        value={unbonding ? (formatDays(unbonding.value) ?? "—") : <Dash reason="Not enough chains with data yet" />}
        sub={unbonding ? <LeaderName stats={unbonding.stats} /> : null}
        info={<>How long unstaked tokens stay locked before you can move them. {unbonding ? among(unbonding.among) : null}</>}
      />
      <StatTile
        label="Producing blocks"
        loading={loading}
        tone={health.halted > 0 ? "warning" : "default"}
        value={
          health.known > 0 ? (
            <span>
              {health.known - health.halted}
              <span className="text-fg-dim"> / {health.known}</span>
            </span>
          ) : (
            <Dash reason="No chain status yet" />
          )
        }
        sub={health.known > 0 ? (health.halted > 0 ? `${health.halted} halted or stalled` : "All chains in the table") : null}
        info="A chain whose latest block is more than five minutes old is halted, or its public node has stalled."
      />
    </div>
  );
}
