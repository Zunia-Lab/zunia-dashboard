"use client";

/**
 * Where to stake next, by scope (spec §1: one chain shows its own extras):
 *
 * - All networks: `NetworkAprCard` compares what a typical validator pays on
 *   each followed network (actual APR after the median commission), with
 *   the real yield after inflation and the unbonding period beside it.
 * - One network: `ConsiderValidatorsCard` lists that chain's validators you
 *   do not use yet, ordered by the decentralisation score, each one click
 *   from the stake sheet.
 */

import { useMemo } from "react";
import { Button, Card, CardBody, CardFooter, CardHeader, ChainLogo, InlineError, Skeleton } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import type { ChainStats } from "@/lib/chain/types";
import { useValidators } from "@/lib/data/validators";
import { formatPercent } from "@/lib/format";
import { percentOf, toLite, validatorHref } from "./model";
import { cutoffRisk, decentralisationScore, rankByScore, SCORE_EXPLANATION } from "./score";
import { ScoreDots, ValidatorIdentity } from "./ValidatorBits";
import { useStakingFlows } from "./flows/StakingFlows";

interface NetworkYield {
  id: string;
  name: string;
  /** Actual APR after the median commission (fraction). */
  typical: number;
  /** `typical` − actual inflation: what staking adds to a share of supply. */
  real: number | null;
  unbondingDays: number | null;
  thirdParty: boolean;
}

/**
 * The networks side by side: what a typical validator pays, what is left
 * after inflation (a high APR on a high-inflation chain mostly keeps your
 * share of supply from shrinking), and how long unstaking takes. A small
 * table rather than a bar list, because the decision needs all three.
 */
export function NetworkAprCard({
  chainIds,
  statsFor,
  loading,
  error = false,
  onRetry,
}: {
  chainIds: string[];
  statsFor: (id: string) => ChainStats | null;
  loading: boolean;
  /** The stats read failed with nothing to show: "no APR" would blame the networks. */
  error?: boolean;
  onRetry?: () => void;
}) {
  const rows = useMemo(
    () =>
      chainIds
        .map((id): NetworkYield | null => {
          const stats = statsFor(id);
          const actual = stats?.apr.actual ?? null;
          const median = stats?.medianCommission ?? null;
          if (!stats || actual === null || median === null) return null;
          const typical = actual * (1 - median);
          return {
            id,
            name: stats.chainName,
            typical,
            real: stats.inflation.actual !== null ? typical - stats.inflation.actual : null,
            unbondingDays: stats.unbondingDays,
            thirdParty: stats.apr.source === "cosmos.directory",
          };
        })
        .filter((row): row is NetworkYield => row !== null)
        .sort((a, b) => b.typical - a.typical),
    [chainIds, statsFor],
  );
  const missing = chainIds.filter((id) => !rows.some((row) => row.id === id));
  const top = rows[0]?.typical ?? 0;
  const thirdParty = rows.filter((row) => row.thirdParty).map((row) => row.name);

  return (
    <Card as="section" aria-label="Staking APR by network">
      <CardHeader
        title="APR by network"
        subtitle="Typical validator, after the median commission · real = after inflation"
        info="APR: each network's actual rate (real block time, after the community tax) minus the median commission of its active validators. Real: that APR minus the network's actual inflation, i.e. how fast staking grows your share of the supply. Unbonding: how long unstaked tokens wait, earning nothing."
      />
      <CardBody>
        {loading && rows.length === 0 ? (
          <div className="flex flex-col gap-3" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton circle width={18} />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2 flex-1 rounded-full" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        ) : error && rows.length === 0 ? (
          <InlineError title="Couldn't read the networks' APR" message="APR and prices couldn't be read just now." onRetry={onRetry} />
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-fg-dim">No APR could be read for these networks.</p>
        ) : (
          <table className="w-full border-collapse text-[13.5px]">
            <caption className="sr-only">Typical staking APR, real yield after inflation, and unbonding period by network</caption>
            <thead>
              <tr className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-dim">
                <th scope="col" className="pb-1.5 pr-3 text-left font-medium">
                  Network
                </th>
                <th scope="col" className="w-full pb-1.5 text-right font-medium">
                  APR
                </th>
                <th scope="col" className="pb-1.5 pl-4 text-right font-medium">
                  Real
                </th>
                <th scope="col" className="pb-1.5 pl-4 text-right font-medium max-sm:hidden">
                  Unbonding
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--d-hairline)]">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className="flex items-center gap-2 whitespace-nowrap text-fg">
                      <ChainLogo chainId={row.id} size={18} />
                      {row.name}
                      {row.thirdParty ? (
                        <span className="text-[11px] text-fg-dim" title="APR via cosmos.directory (third party)">
                          3P
                        </span>
                      ) : null}
                    </span>
                  </th>
                  <td className="py-2">
                    <span className="flex items-center justify-end gap-2.5">
                      <span aria-hidden className="h-1.5 min-w-0 max-w-[420px] flex-1 overflow-hidden rounded-full bg-[var(--d-glass-2)] max-sm:max-w-[72px]">
                        <span
                          className="block h-full rounded-full bg-[var(--viz-accent)]"
                          style={{ width: `${top > 0 ? Math.max(3, (row.typical / top) * 100) : 0}%` }}
                        />
                      </span>
                      <span className="w-[46px] shrink-0 text-right font-medium tabular-nums text-fg">{percentOf(row.typical, 1)}</span>
                    </span>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap py-2 pl-4 text-right tabular-nums",
                      row.real === null ? "text-fg-dim" : row.real >= 0 ? "text-[var(--d-pos)]" : "text-[var(--d-neg)]",
                    )}
                    title={row.real === null ? "Inflation unavailable for this network" : undefined}
                  >
                    {row.real === null ? "—" : formatPercent(row.real * 100, { digits: 1, signed: true })}
                  </td>
                  <td className="whitespace-nowrap py-2 pl-4 text-right tabular-nums text-fg-muted max-sm:hidden">
                    {row.unbondingDays === null ? "—" : `${Math.round(row.unbondingDays)} d`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      {(missing.length > 0 && rows.length > 0) || thirdParty.length > 0 ? (
        <CardFooter className="text-[12px]">
          {missing.length > 0 && rows.length > 0
            ? `No APR for ${missing.map((id) => findChain(id)?.chainName ?? id).join(", ")}: the network's mint data could not be read. `
            : null}
          {thirdParty.length > 0 ? `3P: APR from cosmos.directory, a third party (${thirdParty.join(", ")}).` : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function ConsiderValidatorsCard({ chainId, chainName, mine }: { chainId: string; chainName: string; mine: ReadonlySet<string> }) {
  const flows = useStakingFlows();
  const set = useValidators(chainId);
  const rows = set.data?.chainId === chainId ? set.data.validators : null;
  const summary = set.data?.summary;
  const ranked = useMemo(
    () =>
      rows
        ? rankByScore(
            rows.filter((row) => !mine.has(row.operatorAddress)),
            toLite,
            { atRisk: (row) => cutoffRisk(row, summary) },
          ).slice(0, 5)
        : [],
    [rows, mine, summary],
  );

  return (
    <Card as="section" aria-label={`Validators to consider on ${chainName}`}>
      <CardHeader
        title="Validators to consider"
        subtitle={`On ${chainName}, ordered by decentralisation score`}
        info={SCORE_EXPLANATION}
        actions={
          <Button size="sm" variant="ghost" href={`/validators?chain=${encodeURIComponent(chainId)}`} iconRight="arrowRight">
            All {set.data?.summary.active ?? ""}
          </Button>
        }
      />
      <CardBody>
        {set.status === "error" && !rows ? (
          <InlineError message={set.error?.message ?? "The validator set could not be read."} onRetry={set.refetch} />
        ) : !rows ? (
          <div className="flex flex-col gap-3" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton circle width={28} />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-6 w-14 rounded-[8px]" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="-my-1 flex flex-col divide-y divide-[var(--d-hairline)]">
            {ranked.map((row) => (
              <li key={row.operatorAddress} className="flex items-center gap-3 py-2">
                <ValidatorIdentity
                  className="flex-1"
                  moniker={row.moniker}
                  logoUrl={row.logoUrl}
                  href={validatorHref(chainId, row.operatorAddress)}
                  aside={<ScoreDots checks={decentralisationScore(toLite(row)).checks} />}
                  sub={`${percentOf(row.commission.rate, 1)} commission · ${percentOf(row.votingPower, 2)} power`}
                />
                <span className="shrink-0 text-right text-[13px] tabular-nums">
                  <span className="block font-medium text-fg">{percentOf(row.apr)}</span>
                  <span className="block text-[11.5px] text-fg-dim">APR</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => flows.open({ kind: "delegate", chainId, validator: row.operatorAddress })}>
                  Stake
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
