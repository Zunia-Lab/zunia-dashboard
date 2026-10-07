"use client";

/**
 * The six staking figures (spec §6): staked, actual APR, claimable (with
 * Claim all), expected rewards, unbonding with the next release, validators
 * used. All scope adds chains together by value; one chain also shows
 * tokens.
 *
 * Three states besides the normal one, each said in its own words, never as
 * a fact about the wallet ("Nothing to claim yet" when nothing was read
 * would be a false all-clear):
 *
 * - the positions read failed: every figure is "—" with that reason, the
 *   same caption Overview uses ("staking unreadable"), and the Positions
 *   card below carries the error and Retry;
 * - the first prices are still loading: the priced figures keep their
 *   skeletons rather than reading "unpriced" for a second;
 * - the prices read failed: priced figures are "—" because prices could not
 *   be read, not because the tokens have none.
 */

import type { ReactNode } from "react";
import { Button, Money, Percent, RelativeTime, StatTile, TokenAmount } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { percentOf, type ChainView, type StakingView } from "./model";
import { Unavailable } from "./ValidatorBits";

/**
 * Exact figures up to six digits ("$18,517.15" fits a tile), compact above
 * ("$1.24M"), the same rule on every tile so they read alike.
 */
const COMPACT_FROM = 100_000;

/** Why every figure is unknown when the positions read failed (Overview says the same). */
const READ_FAILED = "Staking positions could not be read";
const READ_FAILED_CAPTION = "staking unreadable";
/** Why a priced figure is unknown when the prices read failed (the tokens may well have a price). */
const PRICES_FAILED = "Prices could not be read just now";
const PRICES_FAILED_CAPTION = "prices unavailable";

function names(chainIds: readonly string[]): string {
  const list = chainIds.map((id) => findChain(id)?.chainName ?? id);
  return list.length <= 2 ? list.join(" and ") : `${list.length} networks`;
}

export interface StakingKpisProps {
  view: StakingView | null;
  currency: string;
  /** The scope is one chain: tokens show next to values. */
  single: ChainView | null;
  loading: boolean;
  /** The positions read failed and nothing is on screen: figures are unknown, not empty. */
  failed?: boolean;
  /** The first prices are still loading: priced figures keep their skeletons. */
  pricesLoading?: boolean;
  /** The prices read failed: priced figures are unknown for that reason. */
  pricesError?: boolean;
  /** The figures belong to the previous scope while the new one loads (dimmed). */
  pending?: boolean;
  onClaim: () => void;
}

export function StakingKpis({
  view,
  currency,
  single,
  loading,
  failed = false,
  pricesLoading = false,
  pricesError = false,
  pending = false,
  onClaim,
}: StakingKpisProps) {
  const totals = view?.totals;
  const claimableChains = view?.claimable.length ?? 0;
  const next = view?.nextRelease ?? null;
  const unread = failed && !view;
  // The reason a "—" gives, and the line under it, when the read failed.
  const why = (reason: string) => (unread ? READ_FAILED : reason);
  const caption = (sub: ReactNode): ReactNode => (unread ? READ_FAILED_CAPTION : sub);
  const noPrice = (reason: string) => why(pricesError ? PRICES_FAILED : reason);
  const unpricedNote = (chainIds: readonly string[]) => (pricesError ? PRICES_FAILED_CAPTION : `${names(chainIds)} unpriced`);
  const priced = loading || pricesLoading;
  // Networks whose rewards / unbonding were not read: their part is unknown,
  // so neither "nothing to claim" nor "none" can be said.
  const unreadRewards = totals?.unreadRewards ?? [];
  const unreadUnbonding = totals?.unreadUnbonding ?? [];
  const noUnbonding = Boolean(view && view.timeline.every((item) => item.kind !== "unbonding") && unreadUnbonding.length === 0);
  // One chain's APR is weighted by its tokens (no price needed); across
  // chains, only by value.
  const apr = single ? single.aprWeighted : (totals?.weightedApr ?? null);

  return (
    // Columns follow the content width (like Overview's strip), not the
    // viewport: a collapsed sidebar gives six across sooner.
    <section
      aria-label="Staking summary"
      aria-busy={pending || undefined}
      className={cn("@container transition-opacity duration-[160ms]", pending && "opacity-60")}
    >
      <div className="grid grid-cols-2 gap-[var(--d-gap)] @[640px]:grid-cols-3 @[1180px]:grid-cols-6">
        <StatTile
          label="Staked"
          icon="staking"
          loading={priced}
          value={
            single && single.stakedValue === null ? (
              <TokenAmount amount={single.staked} decimals={single.decimals} symbol={single.symbol} compact reason="Positions could not be read" />
            ) : (
              <Money
                value={totals?.stakedValue ?? null}
                currency={currency}
                compact={(totals?.stakedValue ?? 0) >= COMPACT_FROM}
                animate
                reason={
                  totals && totals.unreadable.length > 0 ? "Some positions could not be read" : noPrice("No price for the staked tokens")
                }
              />
            )
          }
          sub={caption(
            single ? (
              single.stakedValue === null ? (
                single.staked === null ? (
                  "positions unreadable"
                ) : pricesError ? (
                  "price unavailable"
                ) : (
                  "No price for this token"
                )
              ) : (
                <TokenAmount amount={single.staked} decimals={single.decimals} symbol={single.symbol} maxFraction={2} />
              )
            ) : totals && totals.unreadable.length > 0 ? (
              `${names(totals.unreadable)} unreadable`
            ) : totals && totals.unpricedChains.length > 0 ? (
              pricesError ? PRICES_FAILED_CAPTION : `+ ${names(totals.unpricedChains)} unpriced`
            ) : totals ? (
              `on ${totals.chainsWithStake} network${totals.chainsWithStake === 1 ? "" : "s"}`
            ) : null,
          )}
        />
        <StatTile
          label="Actual APR"
          icon="trendingUp"
          loading={single ? loading : priced}
          info="What your stake earns now: each chain's APR from its real block time (mint rewards, after the community tax), minus each validator's commission, weighted by value across networks. Excludes fee and MEV income."
          value={<Percent value={apr === null ? null : apr * 100} reason={noPrice(single ? "APR unavailable for this chain" : "No priced stake to weigh")} />}
          sub={caption(
            single
              ? single.aprChain !== null
                ? `chain APR ${percentOf(single.aprChain)}`
                : "after commission"
              : totals && totals.aprExcluded.length > 0
                ? pricesError
                  ? PRICES_FAILED_CAPTION
                  : `excludes ${names(totals.aprExcluded)}`
                : "after commission",
          )}
        />
        <StatTile
          label="Claimable"
          tone={claimableChains > 0 ? "accent" : "default"}
          loading={priced}
          value={
            single && single.rewardsValue === null ? (
              <TokenAmount amount={single.rewards} decimals={single.decimals} symbol={single.symbol} maxFraction={4} reason="Rewards could not be read" />
            ) : (
              <Money
                value={totals?.rewardsValue ?? null}
                currency={currency}
                compact={(totals?.rewardsValue ?? 0) >= COMPACT_FROM}
                animate
                reason={
                  claimableChains === 0 && unreadRewards.length > 0
                    ? why(`Rewards on ${names(unreadRewards)} could not be read`)
                    : noPrice("No price for these rewards")
                }
              />
            )
          }
          sub={caption(
            single && single.rewards !== null ? (
              <TokenAmount amount={single.rewards} decimals={single.decimals} symbol={single.symbol} maxFraction={4} />
            ) : claimableChains > 0 ? (
              `on ${claimableChains} network${claimableChains === 1 ? "" : "s"}${
                totals && totals.unpricedRewards.length > 0 ? ` · ${unpricedNote(totals.unpricedRewards)}` : ""
              }${unreadRewards.length > 0 ? ` · ${names(unreadRewards)} unreadable` : ""}`
            ) : unreadRewards.length > 0 ? (
              `${names(unreadRewards)} unreadable`
            ) : (
              "Nothing to claim yet"
            ),
          )}
          action={
            <Button
              size="sm"
              variant={claimableChains > 0 ? "primary" : "secondary"}
              disabled={claimableChains === 0}
              title={unread ? "Rewards could not be read" : undefined}
              onClick={onClaim}
              className="h-7 px-2.5 text-[12.5px]"
            >
              Claim
            </Button>
          }
        />
        <StatTile
          label="Est. monthly"
          icon="calendar"
          loading={priced}
          info="Staked value × actual APR ÷ 12, with today's prices and APR held constant. An estimate, not a promise."
          value={
            single && single.yearlyValue === null && single.yearlyWhole !== null ? (
              <TokenAmount amount={single.yearlyWhole / 12} symbol={single.symbol} maxFraction={2} />
            ) : (
              <Money
                value={totals?.yearlyValue == null ? null : totals.yearlyValue / 12}
                currency={currency}
                compact={(totals?.yearlyValue ?? 0) / 12 >= COMPACT_FROM}
                reason={
                  totals && totals.unreadable.length > 0 ? "Some positions could not be read" : noPrice("No priced stake with a known APR")
                }
              />
            )
          }
          sub={caption(
            totals?.yearlyValue != null ? (
              <>
                <Money value={totals.yearlyValue} currency={currency} compact /> a year
                {!single && totals.unpricedChains.length > 0 ? ` · excl. ${names(totals.unpricedChains)}` : null}
              </>
            ) : single?.yearlyWhole != null ? (
              <>
                <TokenAmount amount={single.yearlyWhole} symbol={single.symbol} maxFraction={2} /> a year
              </>
            ) : pricesError ? (
              PRICES_FAILED_CAPTION
            ) : (
              "est."
            ),
          )}
        />
        <StatTile
          label="Unbonding"
          icon="hourglass"
          // "None" needs no price; an amount does.
          loading={loading || (pricesLoading && !noUnbonding)}
          value={
            noUnbonding ? (
              <span className="text-fg-dim">None</span>
            ) : single && single.unbondingValue === null ? (
              <TokenAmount amount={single.unbonding} decimals={single.decimals} symbol={single.symbol} compact reason="Unbonding could not be read" />
            ) : (
              <Money
                value={totals?.unbondingValue ?? null}
                currency={currency}
                compact={(totals?.unbondingValue ?? 0) >= COMPACT_FROM}
                reason={
                  !next && unreadUnbonding.length > 0
                    ? why(`Unbonding on ${names(unreadUnbonding)} could not be read`)
                    : noPrice("No price for this token")
                }
              />
            )
          }
          sub={caption(
            next ? (
              <span title={formatDate(next.at, "datetime")}>
                next {formatDate(next.at, "short")} · <RelativeTime at={next.at} upcoming />
                {!single && totals && totals.unpricedUnbonding.length > 0 ? ` · ${unpricedNote(totals.unpricedUnbonding)}` : null}
                {unreadUnbonding.length > 0 ? ` · ${names(unreadUnbonding)} unreadable` : null}
              </span>
            ) : unreadUnbonding.length > 0 ? (
              `${names(unreadUnbonding)} unreadable`
            ) : (
              "No releases pending"
            ),
          )}
        />
        <StatTile
          label="Validators"
          icon="validators"
          loading={loading}
          tone={totals && totals.attention > 0 ? "warning" : "default"}
          value={
            // No validator read anywhere, and some networks unread: a count of 0 would be a guess.
            totals && !(totals.validators === 0 && totals.unreadable.length > 0) ? (
              String(totals.validators)
            ) : (
              <Unavailable reason={unread ? READ_FAILED : totals ? "Positions could not be read" : undefined} />
            )
          }
          sub={caption(
            totals && totals.attention > 0
              ? `${totals.attention} need${totals.attention === 1 ? "s" : ""} attention`
              : totals && totals.unreadable.length > 0
                ? `${names(totals.unreadable)} unreadable`
                : totals && totals.validators > 0
                  ? single
                    ? "all earning"
                    : `on ${totals.chainsWithStake} network${totals.chainsWithStake === 1 ? "" : "s"}`
                  : "none yet",
          )}
        />
      </div>
    </section>
  );
}
