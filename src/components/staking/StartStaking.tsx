"use client";

/**
 * The staking page for a wallet known not to stake anywhere in scope (every
 * chain answered with no stake, rewards or unbonding): one summary instead
 * of six zero figures and an empty table. It says what the wallet could
 * stake now (liquid staking token above the fee reserve), what a typical
 * validator pays, how long unstaking takes, and leads to the stake sheet —
 * or, with nothing to stake, to Receive and Swap.
 *
 * Every figure is read, not assumed: the idle balance from the portfolio,
 * the APR from each chain's actual rate after its median commission, the
 * unbonding period from staking params. Unknowns read "—" with the reason.
 */

import type { ReactNode } from "react";
import { Button, Card, ChainLogo, Money, Percent, Skeleton, TokenAmount } from "@/components/ui";
import type { ChainStats } from "@/lib/chain/types";
import { useStakingFlows } from "./flows/StakingFlows";
import { chainNameOf, type IdleItem } from "./hooks";

export interface StartStakingProps {
  idle: IdleItem[];
  idleLoading: boolean;
  idleError: boolean;
  /** The first prices and APRs are still loading: those figures are not known yet. */
  statsLoading?: boolean;
  chainIds: string[];
  statsFor: (chainId: string) => ChainStats | null;
  currency: string;
  /** The scope is this one chain: amounts read in its token. */
  singleChainId: string | null;
  pending: boolean;
  /** Chains in scope the wallet shared no address on (names). */
  skipped: string[];
}

interface Typical {
  chainId: string;
  apr: number;
}

/** What a typical validator pays on each chain: actual APR after the median commission. */
function typicalAprs(chainIds: readonly string[], statsFor: StartStakingProps["statsFor"]): Typical[] {
  const out: Typical[] = [];
  for (const chainId of chainIds) {
    const stats = statsFor(chainId);
    const actual = stats?.apr.actual ?? null;
    const median = stats?.medianCommission ?? null;
    if (actual !== null && median !== null) out.push({ chainId, apr: actual * (1 - median) });
  }
  return out.sort((a, b) => b.apr - a.apr);
}

function daysText(days: number): string {
  const rounded = Math.round(days);
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

/** One figure: a row (label left, value right) on phones, a column from `sm`. */
function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 sm:block sm:py-0">
      <dt className="shrink-0 truncate text-[12px] text-fg-dim">{label}</dt>
      <dd className="min-w-0 text-right sm:mt-1 sm:text-left">
        <span className="block truncate text-[16px] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-fg sm:text-[18px]">{value}</span>
        {sub ? <span className="mt-0.5 block truncate text-[12px] text-fg-dim">{sub}</span> : null}
      </dd>
    </div>
  );
}

export function StartStaking({
  idle,
  idleLoading,
  idleError,
  statsLoading = false,
  chainIds,
  statsFor,
  currency,
  singleChainId,
  pending,
  skipped,
}: StartStakingProps) {
  const flows = useStakingFlows();
  const typical = typicalAprs(chainIds, statsFor);
  const best = typical[0] ?? null;
  const periods = chainIds.map((id) => statsFor(id)?.unbondingDays ?? null).filter((days): days is number => days !== null && days > 0);
  const shortest = periods.length ? Math.min(...periods) : null;
  const longest = periods.length ? Math.max(...periods) : null;

  const one = singleChainId ? (idle.find((item) => item.chainId === singleChainId) ?? null) : null;
  const priced = idle.filter((item) => item.idleValue !== null);
  const idleValue = priced.length ? priced.reduce((sum, item) => sum + (item.idleValue ?? 0), 0) : null;
  const yearly = priced.length && priced.every((item) => item.yearlyValue !== null)
    ? priced.reduce((sum, item) => sum + (item.yearlyValue ?? 0), 0)
    : null;
  const unpriced = idle.length - priced.length;
  const largest = idle[0] ?? null;
  const scopeName = singleChainId ? chainNameOf(singleChainId) : null;

  // The headline values the idle balance and what it could earn: both come
  // from the prices read.
  const headline = idleLoading || statsLoading ? (
    <Skeleton className="inline-block h-6 w-[22ch] max-w-full align-middle" />
  ) : one ? (
    one.yearlyWhole !== null ? (
      <>
        Your idle <TokenAmount amount={one.idle} decimals={one.decimals} symbol={one.symbol} maxFraction={2} /> could earn about{" "}
        <TokenAmount amount={one.yearlyWhole} symbol={one.symbol} maxFraction={2} /> a year
      </>
    ) : (
      <>
        You have <TokenAmount amount={one.idle} decimals={one.decimals} symbol={one.symbol} maxFraction={2} /> you could stake
      </>
    )
  ) : idleValue !== null && idleValue > 0 ? (
    yearly !== null && unpriced === 0 ? (
      <>
        Your idle <Money value={idleValue} currency={currency} /> could earn about <Money value={yearly} currency={currency} /> a year
      </>
    ) : (
      <>
        You have <Money value={idleValue} currency={currency} /> you could stake{unpriced > 0 ? `, plus ${unpriced} unpriced` : ""}
      </>
    )
  ) : idle.length > 0 ? (
    `You have tokens to stake on ${idle.length} network${idle.length === 1 ? "" : "s"}`
  ) : idleError ? (
    "Start earning with staking"
  ) : (
    "Nothing to stake yet"
  );

  const body =
    !idleLoading && idle.length === 0 && !idleError
      ? `Staking uses each network's own token${scopeName ? ` (${statsFor(singleChainId ?? "")?.nativeSymbol ?? "its native token"} on ${scopeName})` : ", such as ATOM on Cosmos Hub or SAF on Safrochain"}. Receive or swap some first; a small amount always stays back for fees.`
      : "Staking delegates your tokens to a validator that helps secure the network. They stay in your account, rewards accrue every block, and you can unstake after the unbonding period.";

  const stake = () => {
    if (one) flows.open({ kind: "delegate", chainId: one.chainId, amount: one.idle });
    else if (idle.length === 1 && largest) flows.open({ kind: "delegate", chainId: largest.chainId, amount: largest.idle });
    else flows.open({ kind: "delegate", chainId: singleChainId ?? undefined });
  };
  const compareChain = singleChainId ?? largest?.chainId ?? best?.chainId ?? null;

  return (
    <Card variant="hero" as="section" aria-labelledby="start-staking-title" pending={pending} className="gap-5">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:gap-8">
        <div className="min-w-0 flex-1">
          <p className="d-label">{scopeName ? `Not staking on ${scopeName} yet` : "Not staking yet"}</p>
          <h2 id="start-staking-title" className="mt-2 text-[20px] font-semibold leading-snug tracking-[-0.025em] text-fg sm:text-[22px]">
            {headline}
          </h2>
          <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
        </div>
        <dl className="grid shrink-0 grid-cols-1 divide-y divide-[var(--d-hairline)] rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-4 py-3.5 sm:grid-cols-3 sm:gap-3 sm:divide-y-0 xl:w-[460px]">
          <Figure
            label="Idle to stake"
            value={
              idleLoading || (statsLoading && !one) ? (
                <Skeleton className="my-1 h-4 w-16" />
              ) : one ? (
                <TokenAmount amount={one.idle} decimals={one.decimals} symbol={one.symbol} compact />
              ) : idleValue !== null ? (
                <Money value={idleValue} currency={currency} compact={idleValue >= 100_000} />
              ) : idleError ? (
                <span className="text-fg-dim" title="Your balances could not be read just now">
                  —
                </span>
              ) : idle.length > 0 ? (
                <span title="No price for these tokens">{idle.length} tokens</span>
              ) : (
                <span className="text-fg-dim">None</span>
              )
            }
            sub={idleError ? "balances unreadable" : "above the fee reserve"}
          />
          <Figure
            label="Typical APR"
            value={
              statsLoading ? (
                <Skeleton className="my-1 h-4 w-14" />
              ) : (
                <Percent value={best ? best.apr * 100 : null} digits={1} reason="No APR could be read for these networks" />
              )
            }
            sub={
              best ? (
                singleChainId ? (
                  "after median commission"
                ) : (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <ChainLogo chainId={best.chainId} size={12} />
                    <span className="truncate">{chainNameOf(best.chainId)}</span>
                  </span>
                )
              ) : undefined
            }
          />
          <Figure
            label="Unbonding"
            value={
              statsLoading ? (
                <Skeleton className="my-1 h-4 w-14" />
              ) : shortest === null || longest === null ? (
                <span className="text-fg-dim" title="Staking parameters could not be read">
                  —
                </span>
              ) : shortest === longest || Math.round(shortest) === Math.round(longest) ? (
                daysText(longest)
              ) : (
                `${Math.round(shortest)}–${daysText(longest)}`
              )
            }
            sub="to get tokens back"
          />
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {idle.length > 0 || idleLoading || idleError ? (
          <Button variant="primary" iconLeft="plus" onClick={stake} disabled={idleLoading && idle.length === 0}>
            {one ? `Stake ${one.symbol}` : "Stake"}
          </Button>
        ) : (
          <>
            <Button variant="primary" iconLeft="receive" href="/receive">
              Receive
            </Button>
            <Button iconLeft="swap" href="/swap">
              Swap
            </Button>
          </>
        )}
        <Button variant="ghost" iconRight="arrowRight" href={compareChain ? `/validators?chain=${encodeURIComponent(compareChain)}` : "/validators"}>
          Compare validators
        </Button>
        {skipped.length > 0 ? (
          <span className="text-[12.5px] text-fg-dim sm:ml-auto">
            Not checked: your wallet shared no address on {skipped.length === 1 ? skipped[0] : `${skipped.length} networks`}.
          </span>
        ) : null}
      </div>
    </Card>
  );
}
