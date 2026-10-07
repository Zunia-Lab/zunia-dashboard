"use client";

/**
 * With one chain in scope, the chains table gives way to that chain's vital
 * signs: its latest block and how old it is, the staking APR as it actually
 * pays at the observed block time (and as the mint parameters publish it,
 * when that differs), inflation, bonded ratio against its goal, unbonding
 * period, validator set and Nakamoto coefficient, and the wallet's own share
 * of the chain's bonded stake. The wording follows the chain page's.
 */

import { Meter } from "@/components/charts";
import type { ReactNode } from "react";
import {
  Button,
  Card,
  CardBody,
  ChainLogo,
  Delta,
  IconButton,
  InfoTip,
  InlineError,
  Money,
  Percent,
  RelativeTime,
  Skeleton,
  SourceTag,
  StatusBadge,
  TokenAmount,
  useNow,
} from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";
import type { ChainStats } from "@/lib/chain/types";
import type { ChainStatsState } from "@/lib/data/chains";
import type { StakingPositionsState } from "@/lib/data/staking";
import { MASK, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { stakeShare } from "./model";

/** A fraction (0.0551) in percent units (5.51), keeping unknown unknown. */
function pct(fraction: number | null | undefined): number | null {
  return fraction === null || fraction === undefined ? null : fraction * 100;
}

/** A tiny share keeps two significant digits: 0.00047%, never "<0.01%". */
function shareText(fraction: number): string {
  const percent = fraction * 100;
  if (percent >= 0.01) return formatPercent(percent, { digits: 2 });
  if (percent <= 0) return "0%";
  return `${formatNumber(percent, { maxFraction: Math.min(8, 1 - Math.floor(Math.log10(percent))) })}%`;
}

export function ChainHeader({ chain, stats, staking }: { chain: ChainEntry; stats: ChainStatsState; staking: StakingPositionsState }) {
  const { hideAmounts } = usePrefs();
  const s = stats.statsFor(chain.chainId);
  const position = staking.chainFor(chain.chainId);
  const loading = stats.loading && !s;
  const reasons = s?.reasons ?? {};
  // Stake with inactive or jailed validators is not in the chain's bonded
  // tokens: only the bonded part is a share of them (and of voting power).
  const stake = stakeShare(position, s?.bondedTokens);
  const apr = s?.apr ?? null;
  const aprDiffers = apr !== null && apr.naive !== null && apr.actual !== null && Math.abs(apr.actual - apr.naive) > 1e-4;
  const now = useNow();
  const read = s?.latestBlockTime ? Date.parse(s.latestBlockTime) : null;
  // The shared clock ticks every 30 s: a block that fresh must not read as
  // "in under a minute".
  const latest = read !== null && now !== null ? Math.min(read, now) : read;
  const chainHref = `/chains/${encodeURIComponent(chain.chainId)}`;

  return (
    <Card as="section" pending={stats.stale} aria-labelledby="overview-chain-header">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <ChainLogo chainId={chain.chainId} size={40} />
        <div className="min-w-0 flex-1">
          <h2 id="overview-chain-header" className="truncate text-[18px] font-semibold tracking-[-0.02em] text-fg">
            {chain.chainName}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-fg-dim">
            <span className="font-mono">{chain.chainId}</span>
            {s?.price ? (
              <>
                {/* Phones wrap the price under the id: no dot left at a line end. */}
                <span aria-hidden className="max-sm:hidden">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {s.nativeSymbol}
                  <Money value={s.price.price} currency={stats.data?.currency} masked={false} className="font-medium text-fg-muted" />
                  <Delta value={s.price.change24h} period="24h" />
                </span>
                {s.price.label ? <SourceTag source={s.price.label} /> : null}
              </>
            ) : null}
          </div>
        </div>
        {/* On a phone the status drops to its own line under the name, and
            the way to the chain page stays in the top corner as an arrow. */}
        <div className="flex flex-wrap items-center gap-2.5 max-sm:order-last max-sm:w-full">
          {loading ? (
            <Skeleton className="h-6 w-48" />
          ) : s ? (
            s.halted ? (
              <StatusBadge tone="warning" size="md">
                Halted or node stalled
              </StatusBadge>
            ) : (
              <StatusBadge tone="success" size="md" pulse>
                Live
              </StatusBadge>
            )
          ) : null}
          {s?.latestHeight ? (
            <span className="text-[12.5px] tabular-nums text-fg-dim">
              Block {formatNumber(s.latestHeight)} · <RelativeTime at={latest} />
            </span>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" href={chainHref} iconRight="arrowRight" className="max-sm:hidden">
          Chain page
        </Button>
        <IconButton label={`${chain.chainName} chain page`} icon="arrowRight" href={chainHref} size="sm" className="sm:hidden" />
      </div>

      {stats.status === "error" && !s ? (
        <InlineError message={stats.error?.message ?? "Chain economics could not be read."} onRetry={stats.refetch} />
      ) : (
        <CardBody flush className="@container">
          <dl className="grid grid-cols-2 gap-px border-t border-[var(--d-hairline)] bg-[var(--d-hairline)] @[520px]:grid-cols-4 @[1080px]:grid-cols-8">
            <Vital
              label="Staking APR"
              loading={loading}
              value={<Percent value={pct(apr?.actual)} digits={2} reason={reasons.apr ?? apr?.note} />}
              sub={
                aprDiffers && apr?.naive != null
                  ? `Published ${formatPercent(apr.naive * 100, { digits: 2 })}`
                  : apr?.source === "cosmos.directory"
                    ? "cosmos.directory (3P)"
                    : "Before commission"
              }
              info={<AprInfo stats={s} />}
            />
            <Vital
              label="Inflation"
              loading={loading}
              value={<Percent value={pct(s?.inflation.actual)} digits={2} reason={reasons.inflation} />}
              sub={
                s?.realYield != null
                  ? `real yield ${formatPercent(s.realYield * 100, { digits: Math.abs(s.realYield) < 0.001 ? 2 : 1, signed: true })}`
                  : s?.inflation.param != null
                    ? `param ${formatPercent(s.inflation.param * 100, { digits: 2 })}`
                    : undefined
              }
              info="Issuance actually happening per year ÷ total supply, corrected for the observed block time. Real yield is the actual APR minus this: what staking adds to your share of supply."
            />
            <Vital
              label="Bonded"
              loading={loading}
              value={<Percent value={pct(s?.bondedRatio)} digits={1} reason={reasons.bondedRatio} />}
              sub={
                s?.bondedRatio != null ? (
                  <Meter
                    value={s.bondedRatio}
                    size="sm"
                    ariaLabel="Bonded ratio"
                    markers={s.goalBonded != null ? [{ value: s.goalBonded, label: `Goal ${formatPercent(s.goalBonded * 100, { digits: 0 })}` }] : undefined}
                    className="mt-1 w-full max-w-[120px]"
                  />
                ) : undefined
              }
            />
            <Vital
              label="Unbonding"
              loading={loading}
              value={s?.unbondingDays != null ? `${formatNumber(s.unbondingDays, { maxFraction: 0 })} days` : <Percent value={null} reason={reasons.unbondingDays} />}
              sub="to unlock stake"
            />
            <Vital
              label="Validators"
              loading={loading}
              value={
                s?.activeValidators != null ? (
                  <span>
                    {s.activeValidators}
                    {s.maxValidators != null ? <span className="text-[14px] font-medium text-fg-dim"> / {s.maxValidators}</span> : null}
                  </span>
                ) : (
                  <Percent value={null} reason={reasons.activeValidators} />
                )
              }
              sub={s?.top10Share != null ? `top 10 hold ${formatPercent(s.top10Share * 100, { digits: 0 })}` : undefined}
            />
            <Vital
              label="Nakamoto"
              loading={loading}
              value={s?.nakamoto != null ? String(s.nakamoto) : <Percent value={null} reason={reasons.nakamoto} />}
              sub="hold over 1/3"
              info="The smallest number of validators that together hold more than a third of the voting power: enough to halt the chain. Higher is more decentralised."
            />
            <Vital
              label="Block time"
              loading={loading}
              value={s?.blockTimeSec != null ? formatDuration(s.blockTimeSec) : <Percent value={null} reason={reasons.blockTimeSec} />}
              sub={s?.paramsBlockTimeSec != null ? `assumed ${formatDuration(s.paramsBlockTimeSec)}` : undefined}
              info="The average time between the last blocks, against the block time the chain's mint parameters assume. Faster blocks mean more issuance per year than the parameters state, which is why the staking APR differs from the published one."
            />
            <Vital
              // Short enough to keep its (i) in an eighth of the card.
              label="Your share"
              loading={loading || staking.loading}
              value={
                stake?.share == null ? (
                  <Percent
                    value={null}
                    reason={stake === null ? "Staking not read" : stake.statusUnknown ? "Validator status unknown" : "Bonded total unknown"}
                  />
                ) : hideAmounts ? (
                  MASK
                ) : (
                  shareText(stake.share)
                )
              }
              sub={
                stake && position ? (
                  <>
                    <TokenAmount
                      amount={stake.bonded}
                      decimals={position.decimals}
                      symbol={position.symbol}
                      compact={stake.bonded > BigInt(10) ** BigInt(10)}
                    />
                    {stake.outside > BigInt(0) ? " active" : null}
                  </>
                ) : undefined
              }
              info={
                <div className="flex max-w-[280px] flex-col gap-1.5 text-[12.5px] leading-snug text-fg-muted">
                  <p>
                    Your stake with validators in the active set ÷ the chain&apos;s bonded tokens: your share of its voting
                    power.
                  </p>
                  {stake && position && stake.outside > BigInt(0) ? (
                    <p>
                      <TokenAmount amount={stake.outside} decimals={position.decimals} symbol={position.symbol} className="text-fg" /> with
                      inactive or jailed validators is not bonded, so it is left out.
                    </p>
                  ) : null}
                </div>
              }
            />
          </dl>
        </CardBody>
      )}
    </Card>
  );
}

function AprInfo({ stats }: { stats: ChainStats | null }) {
  if (!stats) return null;
  return (
    <div className="flex max-w-[300px] flex-col gap-1.5 text-[12.5px] leading-snug text-fg-muted">
      <p>
        <span className="font-medium text-fg">Actual</span> rescales the published (naive) rate by the blocks actually
        produced per year: x/mint pays per block, so faster blocks pay more. Mint rewards only, before your validator&apos;s
        commission.
      </p>
      {stats.apr.method ? <p className="font-mono text-[11.5px] text-fg-dim">{stats.apr.method}</p> : null}
      {stats.apr.note ? <p>{stats.apr.note}</p> : null}
      {stats.apr.source === "cosmos.directory" ? <p>Source: cosmos.directory (third party).</p> : null}
    </div>
  );
}

function Vital({
  label,
  value,
  sub,
  info,
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  info?: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-[var(--d-card)] px-[var(--d-pad)] py-3.5">
      <dt className="flex items-center gap-1 text-[12px] text-fg-dim">
        <span className="truncate">{label}</span>
        {info ? <InfoTip size={13} content={typeof info === "string" ? <p className="max-w-[280px] text-[12.5px] leading-snug text-fg-muted">{info}</p> : info} /> : null}
      </dt>
      <dd className="text-[18px] font-semibold tabular-nums leading-tight tracking-[-0.02em] text-fg">
        {loading ? <Skeleton className="my-0.5 h-[18px] w-16" /> : value}
      </dd>
      {/* A caption may take a second line in an eighth of the card
          ("Before commission" at 1440) rather than lose its end. */}
      {sub && !loading ? (
        <dd className={cn("min-w-0 text-[12px] text-fg-dim", typeof sub === "string" ? "line-clamp-2" : "truncate")}>{sub}</dd>
      ) : null}
    </div>
  );
}
