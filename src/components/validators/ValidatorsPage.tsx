"use client";

/**
 * /validators?chain= — compare a chain's validators (spec §6, research V1–V3).
 *
 * Which chain: the URL's `?chain=` (shareable, indexable), else the scope's
 * chain, else Safrochain (or the first followed chain). Picking a chip
 * rewrites the URL in place; picking a chain in the rail after the page has
 * loaded follows the rail.
 *
 * Then: the set at a glance (active / max, Nakamoto, top-10 share, median
 * commission, APR, unbonding period), how concentrated voting power is (with
 * your validators on the curve), how commission is spread today against
 * what each validator may charge within 30 days (`CommissionCard`), and the
 * table with its filters (`ValidatorsTable`).
 *
 * A failed read stops every skeleton: the figures read "—" with the reason
 * and the cards below carry the error and Retry. A cold read that answers
 * "still loading" is retried on its own first (`useStillLoadingRetry`).
 *
 * The route hands down the bonded set of the chain the first render shows,
 * read on the server (`initial`), so the first HTML has the figures and the
 * table; both set reads start from it while they ask for that same URL.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Card, CardBody, CardHeader, ChainLogo, ChipGroup, InlineError, Percent, StatTile, TokenAmount, useNow } from "@/components/ui";
import { Page } from "@/components/shell/Page";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { useChainStats } from "@/lib/data/chains";
import { useStakingPositions } from "@/lib/data/staking";
import { useValidators } from "@/lib/data/validators";
import { useWallet } from "@/lib/connect/context";
import { formatTokenAmount } from "@/lib/format";
import type { ApiInitial } from "@/lib/useApi";
import { useChainScope } from "@/lib/useChainScope";
import { percentOf, positive, unbondingPeriodText } from "@/components/staking/model";
import { Unavailable } from "@/components/staking/ValidatorBits";
import { CommissionCard } from "./CommissionCard";
import { ConcentrationChart } from "./ConcentrationChart";
import { ConnectBanner } from "./ConnectBanner";
import { useStillLoadingRetry } from "./useStillLoadingRetry";
import { ValidatorsTable } from "./ValidatorsTable";

const DEFAULT_CHAIN = "safrochain-1";

/** Why the set figures are "—" once both reads failed. */
const SET_UNREAD = "The validator set could not be read";


function knownChain(id: string | null | undefined): string | null {
  return id && findChain(id) ? id : null;
}

export function ValidatorsPage({ initial = null }: { initial?: ApiInitial | null }) {
  return (
    <Page title="Validators" access="public">
      <ValidatorsContent initial={initial} />
    </Page>
  );
}

function ValidatorsContent({ initial }: { initial: ApiInitial | null }) {
  const params = useSearchParams();
  const { selectedChainId, followedOnNetwork } = useChainScope();
  const { account } = useWallet();
  const connect = useConnectModal();
  const hydrated = useNow() !== null;

  // A rail pick made after load wins over the URL; the first value seen
  // after hydration is the baseline, not a pick (the stored scope arrives
  // with hydration, which must not override a deep link).
  const [baseline, setBaseline] = useState<{ scope: string | null } | null>(null);
  const [railPick, setRailPick] = useState<string | null>(null);
  if (hydrated && baseline === null) setBaseline({ scope: selectedChainId });
  if (baseline !== null && baseline.scope !== selectedChainId) {
    setBaseline({ scope: selectedChainId });
    if (selectedChainId) setRailPick(selectedChainId);
  }

  const urlChain = knownChain(params.get("chain"));
  const fallback = followedOnNetwork.includes(DEFAULT_CHAIN) ? DEFAULT_CHAIN : (followedOnNetwork[0] ?? DEFAULT_CHAIN);
  const chainId = railPick ?? urlChain ?? selectedChainId ?? fallback;

  const choose = (next: string) => {
    setRailPick(null);
    // Native history integrates with the router: useSearchParams follows.
    window.history.replaceState(null, "", `/validators?chain=${encodeURIComponent(next)}`);
  };
  // Keep the address bar shareable after a rail pick.
  useEffect(() => {
    if (railPick && railPick !== urlChain) window.history.replaceState(null, "", `/validators?chain=${encodeURIComponent(railPick)}`);
  }, [railPick, urlChain]);

  const [activeOnly, setActiveOnly] = useState(true);

  const set = useValidators(chainId, { status: activeOnly ? "bonded" : "all", initial });
  const bonded = useValidators(chainId, { initial });
  // "Still loading" (a cold read past the route's budget) is retried, and
  // reads as loading meanwhile; any other failure is an error at once.
  const setRetry = useStillLoadingRetry(set, `${chainId}|${activeOnly ? "bonded" : "all"}`);
  const bondedRetry = useStillLoadingRetry(bonded, chainId);
  const setFailed = set.status === "error" && !setRetry.retrying;
  const bondedFailed = bonded.status === "error" && !bondedRetry.retrying;
  const stats = useChainStats([chainId]);
  const positions = useStakingPositions({ chainIds: account ? [chainId] : [] });
  const chainStats = stats.statsFor(chainId);
  const data = set.data?.chainId === chainId ? set.data : null;
  const bondedSet = bonded.data?.chainId === chainId ? bonded.data : null;
  const summary = (data ?? bondedSet)?.summary ?? null;
  // Shimmer only while a read runs. With "Active only" off the two reads
  // differ and either can bring the summary, so it waits for both to fail.
  const summaryLoading = !summary && !(setFailed && bondedFailed);
  const unread = !summary && !summaryLoading ? SET_UNREAD : undefined;
  const chainName = data?.chainName ?? findChain(chainId)?.chainName ?? chainId;
  const symbol = data?.symbol ?? chainStats?.nativeSymbol ?? findChain(chainId)?.coinDenom ?? "";
  const decimals = data?.decimals ?? chainStats?.nativeDecimals ?? null;

  const staking = positions.chainFor(chainId);
  const mine = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of staking?.delegations ?? []) if (positive(d.amount)) map.set(d.validator.operatorAddress, d.amount);
    return map;
  }, [staking]);
  const mineSet = useMemo(() => new Set(mine.keys()), [mine]);

  const chips = useMemo(() => {
    const list = followedOnNetwork.filter((id) => findChain(id)?.network === "mainnet" || id === chainId);
    return list.includes(chainId) ? list : [chainId, ...list];
  }, [followedOnNetwork, chainId]);

  const concentration = useMemo(
    () =>
      (bondedSet?.validators ?? [])
        .filter((row) => row.status === "bonded" && row.rank !== null && row.cumulative !== null)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        .map((row) => ({
          rank: row.rank ?? 0,
          moniker: row.moniker,
          operatorAddress: row.operatorAddress,
          votingPower: row.votingPower,
          cumulative: row.cumulative ?? 0,
        })),
    [bondedSet],
  );

  const active = useMemo(() => (bondedSet ? bondedSet.validators.filter((row) => row.status === "bonded") : null), [bondedSet]);

  const partial = [...(data?.errors ?? []), ...(chainStats?.errors ?? [])];
  const yourTotal = staking?.totals.staked ?? null;
  const period = unbondingPeriodText(chainStats?.unbondingDays);
  const openSlots = summary?.maxValidators ? Math.max(0, summary.maxValidators - summary.active) : null;
  const aprActual = summary?.aprActual ?? chainStats?.apr.actual ?? null;
  const naiveDiffers =
    chainStats?.apr.naive != null && chainStats.apr.actual != null && Math.abs(chainStats.apr.naive - chainStats.apr.actual) > 0.0005;

  return (
    <>
      <ChipGroup
        type="single"
        ariaLabel="Network"
        size="md"
        scroll
        value={chainId}
        onChange={choose}
        items={chips.map((id) => ({
          value: id,
          label: findChain(id)?.chainName ?? id,
          leading: <ChainLogo chainId={id} size={18} />,
        }))}
      />

      <section aria-label={`${chainName} validator set`} className={cn("@container transition-opacity duration-[160ms]", bonded.stale && "opacity-60")}>
        <div className="grid grid-cols-2 gap-[var(--d-gap)] @[640px]:grid-cols-3 @[1180px]:grid-cols-6">
          <StatTile
            label="Active validators"
            icon="validators"
            loading={summaryLoading}
            value={summary ? `${summary.active}${summary.maxValidators ? ` / ${summary.maxValidators}` : ""}` : <Unavailable reason={unread} />}
            sub={
              summary?.activeSetFull && summary.cutoffTokens && decimals !== null
                ? `full · min ${formatTokenAmount(summary.cutoffTokens, decimals, { compact: true, maxFraction: 1 })} ${symbol}`
                : openSlots
                  ? `${openSlots} open slot${openSlots === 1 ? "" : "s"}`
                  : "in the active set"
            }
          />
          <StatTile
            label="Nakamoto"
            icon="shield"
            loading={summaryLoading}
            tone={summary?.nakamoto != null && summary.nakamoto <= 3 ? "warning" : "default"}
            value={summary?.nakamoto ?? <Unavailable reason={unread} />}
            sub="validators could halt it"
            info="The Nakamoto coefficient: the smallest number of validators that together hold more than a third of voting power, enough to stop the chain producing blocks. Higher is more decentralised."
          />
          <StatTile
            label="Top 10 share"
            icon="layers"
            loading={summaryLoading}
            value={<Percent value={summary?.top10Share == null ? null : summary.top10Share * 100} digits={1} reason={unread} />}
            sub="of voting power"
          />
          <StatTile
            label="Median commission"
            icon="compare"
            loading={summaryLoading}
            value={<Percent value={summary?.medianCommission == null ? null : summary.medianCommission * 100} digits={1} reason={unread} />}
            sub={chainStats?.minCommission != null ? `chain minimum ${percentOf(chainStats.minCommission, 0)}` : "of active validators"}
          />
          <StatTile
            label="Staking APR"
            icon="trendingUp"
            // The chain stats carry the same actual APR: the figure does not
            // wait for (or fail with) the validator set.
            loading={summaryLoading && chainStats?.apr.actual == null}
            value={<Percent value={aprActual === null ? null : aprActual * 100} reason={summary?.aprNote ?? unread} />}
            sub={naiveDiffers ? `naive ${percentOf(chainStats?.apr.naive)}` : "before commission"}
            info="Actual APR: the chain's issuance at its real block time, after the community tax, divided by bonded stake; a validator pays this minus its commission. The naive figure assumes the block time in the chain's parameters. Mint rewards only."
          />
          <StatTile
            label="Unbonding"
            icon="hourglass"
            loading={!chainStats && stats.loading}
            value={period ?? <span title="Staking parameters could not be read">—</span>}
            sub="to unstake"
          />
        </div>
      </section>

      {!account ? (
        <ConnectBanner onConnect={() => connect.open()}>
          <span className="font-medium text-fg">Connect to see your position.</span> Your validators get marked on the curve and in the
          table, with your stake beside them.
        </ConnectBanner>
      ) : staking && (staking.status === "error" || staking.totals.staked === null) ? (
        <p className="-mt-1 text-[13px] text-fg-dim">
          Your stake on {chainName} could not be read just now, so your validators are not marked.{" "}
          <button type="button" onClick={positions.refetch} className="font-medium text-[var(--d-accent-text)] underline-offset-[3px] hover:underline">
            Retry
          </button>
        </p>
      ) : yourTotal !== null && positive(yourTotal) ? (
        <p className="-mt-1 text-[13px] text-fg-dim">
          You stake <TokenAmount amount={yourTotal} decimals={decimals} symbol={symbol} maxFraction={2} className="font-medium text-fg" /> with{" "}
          {mine.size} validator{mine.size === 1 ? "" : "s"} on {chainName}
          {[...mineSet].some((op) => bondedSet?.validators.find((row) => row.operatorAddress === op)?.inNakamotoSet)
            ? ", some of it inside the Nakamoto set."
            : "."}
        </p>
      ) : null}

      {/* Lite: concentration and commission reach are analysis (CSS: this page renders on the server). */}
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-12 lite:hidden">
        <Card as="section" aria-label="Voting power concentration" className="lg:col-span-7" pending={bonded.stale}>
          <CardHeader
            title="Voting power concentration"
            subtitle={
              summary?.nakamoto
                ? `The largest ${summary.nakamoto} validators hold over a third; an even split would need ${Math.max(1, Math.ceil((active?.length ?? 0) / 3))}`
                : "Cumulative share of voting power, largest validators first"
            }
            info="Each point is the share of voting power held by the largest N validators together. The dotted diagonal is what an even split would look like: the further the curve bows above it, the more concentrated the set."
          />
          <CardBody className="flex flex-col gap-2">
            {mineSet.size > 0 ? (
              <span className="flex items-center gap-1.5 text-[12px] text-fg-dim">
                <span aria-hidden className="size-2.5 rounded-full bg-[var(--viz-2)]" /> Your validators, on the curve
              </span>
            ) : null}
            {bondedFailed && !bondedSet ? (
              <InlineError message={bonded.error?.message ?? "The validator set could not be read."} onRetry={bonded.refetch} />
            ) : concentration.length > 0 ? (
              <ConcentrationChart rows={concentration} mine={mineSet} nakamoto={summary?.nakamoto ?? null} chainName={chainName} />
            ) : (
              <div className="d-skeleton h-[232px] w-full rounded-[12px]" aria-hidden />
            )}
          </CardBody>
        </Card>

        <CommissionCard
          className="lg:col-span-5"
          active={active}
          chainName={chainName}
          error={bondedFailed ? (bonded.error?.message ?? "The validator set could not be read.") : null}
          onRetry={bonded.refetch}
          pending={bonded.stale}
        />
      </div>

      <ValidatorsTable
        chainId={chainId}
        chainName={chainName}
        data={data}
        error={setFailed ? (set.error?.message ?? "The validator set could not be read.") : null}
        onRetry={set.refetch}
        pending={set.stale}
        activeOnly={activeOnly}
        onActiveOnlyChange={setActiveOnly}
        mine={mine}
        symbol={symbol}
        decimals={decimals}
        aprNote={summary?.aprNote}
        partial={partial}
      />
    </>
  );
}
