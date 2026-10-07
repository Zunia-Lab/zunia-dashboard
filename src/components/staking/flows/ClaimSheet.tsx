"use client";

/**
 * Claim rewards: one transaction per chain, one `MsgWithdrawDelegatorReward`
 * per validator that has something to pay (spec §6, research S4).
 *
 * With several chains to claim on, the first step picks the chain (each
 * chain is its own signature); after a claim the list refreshes and the next
 * chain can follow. "Restake" adds a `MsgDelegate` of each validator's
 * rewards back to it in the same transaction — claim and compound in one
 * signature — but only to validators that are active (stake on a jailed or
 * inactive one earns nothing) and only in the staking token.
 *
 * "Nothing to claim" is only said after the rewards were read: a failed
 * read, or a wallet with no address on these networks, says that instead.
 */

import { useMemo, useState } from "react";
import {
  ChainLogo,
  EmptyState,
  InlineError,
  Money,
  Skeleton,
  Switch,
  TokenAmount,
  type KeyValueItem,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useChainStats } from "@/lib/data/chains";
import { useStakingPositions } from "@/lib/data/staking";
import { buildDelegate, buildWithdrawReward } from "@/lib/tx/messages";
import type { SignRequest } from "@/lib/tx/types";
import { formatTokenAmount } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { chainMeta } from "../hooks";
import { positive, sumBase, toWhole, valueOf } from "../model";
import { TxSheet } from "./TxSheet";

/** Messages a chain accepts per transaction (the flow's own cap). */
const MAX_CLAIMS = 32;

export interface ClaimSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chains to claim on (one is claimed per transaction); default: the scope. */
  chainIds?: string[];
  /** Claim only from this validator. */
  validator?: string;
}

export function ClaimSheet({ open, onOpenChange, chainIds, validator }: ClaimSheetProps) {
  const positions = useStakingPositions({ chainIds });
  const stats = useChainStats(chainIds);
  const { mask } = usePrefs();
  const [picked, setPicked] = useState<string | null>(chainIds?.length === 1 ? (chainIds[0] ?? null) : null);
  const [restake, setRestake] = useState(false);

  const chains = positions.data?.chains;
  const claimable = useMemo(
    () =>
      (chains ?? [])
        .map((chain) => {
          const own = (d: (typeof chain.delegations)[number]) =>
            BigInt(sumBase(d.rewards.filter((c) => c.denom === chain.denom).map((c) => c.amount)));
          // Largest rewards first, so a capped claim takes the ones that matter.
          const delegations = chain.delegations
            .filter(
              (d) =>
                (!validator || d.validator.operatorAddress === validator) && d.rewards.some((coin) => positive(coin.amount)),
            )
            .sort((a, b) => {
              const left = own(a);
              const right = own(b);
              return left === right ? 0 : left > right ? -1 : 1;
            });
          const rewards = sumBase(delegations.flatMap((d) => d.rewards.filter((c) => c.denom === chain.denom).map((c) => c.amount)));
          const others = new Set(delegations.flatMap((d) => d.rewards.filter((c) => c.denom !== chain.denom && positive(c.amount)).map((c) => c.denom)));
          const price = stats.statsFor(chain.chainId)?.price?.price ?? null;
          const whole = toWhole(rewards, chain.decimals);
          return { chain, delegations, rewards, others: others.size, whole, value: valueOf(whole, price), price };
        })
        .filter((entry) => entry.delegations.length > 0)
        .sort((a, b) => (b.value ?? -1) - (a.value ?? -1)),
    [chains, validator, stats],
  );

  // Choose-or-not follows the data until a claim is sent; then it is frozen:
  // after a claim the list shrinks, and the sheet must not turn into another
  // flow under its "Done" screen.
  const [frozen, setFrozen] = useState<"choose" | "single" | null>(null);
  const liveMode = claimable.length > 1 ? "choose" : "single";
  const mode = frozen ?? liveMode;
  const multi = mode === "choose";

  // A single candidate needs no choosing; otherwise the user's pick.
  const chosenId = mode === "single" ? (claimable[0]?.chain.chainId ?? picked) : picked;
  const chosen = claimable.find((entry) => entry.chain.chainId === chosenId) ?? null;
  const currency = stats.data?.currency ?? "usd";
  // While the first prices load, a missing value is not "no price" yet.
  const noPrice = stats.loading ? "Reading the price…" : "No price for this token";

  const restakeTargets = useMemo(
    () =>
      chosen
        ? chosen.delegations.filter(
            (d) => d.validator.status === "bonded" && d.validator.jailed !== true && d.rewards.some((c) => c.denom === chosen.chain.denom && positive(c.amount)),
          )
        : [],
    [chosen],
  );

  const request = useMemo<SignRequest | null>(() => {
    if (!chosen) return null;
    const claims = chosen.delegations.slice(0, MAX_CLAIMS);
    const messages = claims.map((d) =>
      buildWithdrawReward({
        delegatorAddress: chosen.chain.address,
        validatorAddress: d.validator.operatorAddress,
        summary: `Claim rewards from ${d.validator.moniker}`,
      }),
    );
    if (restake) {
      for (const d of restakeTargets.filter((target) => claims.includes(target))) {
        const amount = sumBase(d.rewards.filter((c) => c.denom === chosen.chain.denom).map((c) => c.amount));
        messages.push(
          buildDelegate({
            delegatorAddress: chosen.chain.address,
            validatorAddress: d.validator.operatorAddress,
            // The withdraw above pays at least this much (rewards only grow
            // between this read and the block), so the delegate is covered.
            amount: { denom: chosen.chain.denom, amount },
            summary: `Restake rewards with ${d.validator.moniker}`,
          }),
        );
      }
    }
    return { chainId: chosen.chain.chainId, messages };
  }, [chosen, restake, restakeTargets]);

  const symbol = chosen?.chain.symbol ?? "";
  const rewardsText = chosen ? `${formatTokenAmount(chosen.rewards, chosen.chain.decimals, { maxFraction: 4 })} ${symbol}` : "";
  const loading = positions.loading || (positions.status === "idle" && positions.accounts.length > 0);

  const chooser = multi ? (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[12.5px] font-medium text-fg-muted">Choose a network: each claim is its own signature</legend>
      {claimable.map((entry) => {
        const active = entry.chain.chainId === chosenId;
        const meta = chainMeta(entry.chain.chainId);
        return (
          <label
            key={entry.chain.chainId}
            className={cn(
              "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[var(--d-radius-inner)] border px-3 py-2.5 transition-colors duration-[160ms]",
              active
                ? "border-[var(--d-accent-line)] bg-[var(--d-accent-soft)]"
                : "border-[var(--d-hairline-strong)] hover:border-[var(--d-control-line)] hover:bg-[var(--d-glass)]",
            )}
          >
            <input
              type="radio"
              name="claim-chain"
              value={entry.chain.chainId}
              checked={active}
              onChange={() => setPicked(entry.chain.chainId)}
              className="size-4 shrink-0 accent-[var(--z-accent)]"
            />
            <ChainLogo chainId={entry.chain.chainId} size={24} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-fg">{meta.chainName}</span>
              <span className="block text-[12px] text-fg-dim">
                {entry.delegations.length} validator{entry.delegations.length === 1 ? "" : "s"}
                {entry.others > 0 ? ` · +${entry.others} other token${entry.others === 1 ? "" : "s"}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right text-[13px] tabular-nums">
              <TokenAmount amount={entry.rewards} decimals={entry.chain.decimals} symbol={entry.chain.symbol} maxFraction={4} className="block" />
              <Money value={entry.value} currency={currency} className="block text-[12px] text-fg-dim" reason={noPrice} />
            </span>
          </label>
        );
      })}
    </fieldset>
  ) : undefined;

  const reviewItems: KeyValueItem[] = chosen
    ? [
        {
          key: "network",
          label: "Network",
          value: (
            <span className="inline-flex items-center gap-1.5">
              <ChainLogo chainId={chosen.chain.chainId} size={16} />
              {chainMeta(chosen.chain.chainId).chainName}
            </span>
          ),
        },
        {
          key: "from",
          label: "From",
          value:
            chosen.delegations.length === 1
              ? chosen.delegations[0]?.validator.moniker
              : `${Math.min(chosen.delegations.length, MAX_CLAIMS)} validators`,
          sub: chosen.delegations.length > MAX_CLAIMS ? `The ${MAX_CLAIMS} largest now; claim again for the rest` : undefined,
        },
        {
          key: "rewards",
          label: "Rewards",
          emphasis: true,
          value: <TokenAmount amount={chosen.rewards} decimals={chosen.chain.decimals} symbol={symbol} />,
          sub: (
            <>
              <Money value={chosen.value} currency={currency} reason={noPrice} />
              {chosen.others > 0 ? ` · plus ${chosen.others} other token${chosen.others === 1 ? "" : "s"}` : null}
            </>
          ),
        },
        {
          key: "to",
          label: restake ? "Then" : "Paid to",
          value: restake ? `Restaked with ${restakeTargets.length} validator${restakeTargets.length === 1 ? "" : "s"}` : "Your balance",
          info: restake
            ? "Each validator's rewards in the staking token are delegated back to it in the same transaction. Inactive or jailed validators are skipped: stake there earns nothing."
            : "Rewards are paid to your address (or to the withdraw address you set on this chain).",
        },
      ]
    : [];

  const restakeSwitch =
    chosen && restakeTargets.length > 0 ? (
      <Switch
        checked={restake}
        onCheckedChange={setRestake}
        label="Restake after claiming"
        description="Compound in the same signature: the rewards go straight back to the validators that paid them."
      />
    ) : null;

  const title = validator ? "Claim rewards" : multi ? "Claim rewards" : `Claim ${symbol || "rewards"}`;

  if (loading && !chains) {
    return (
      <TxSheet
        key="loading"
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        chainId={null}
        request={null}
        reviewItems={[
          { key: "a", label: "Network", value: <Skeleton className="inline-block h-3 w-24" /> },
          { key: "b", label: "Rewards", value: <Skeleton className="inline-block h-3 w-20" /> },
        ]}
        fee={{ denom: null, price: null, currency }}
        confirmLabel="Claim"
        successText="Rewards claimed"
      />
    );
  }

  // Nothing was read: say why, never "nothing to claim".
  const unread =
    !chains && positions.status === "error" ? (
      <InlineError
        title="Couldn't read your rewards"
        message={positions.error?.message ?? "Your staking positions could not be read just now."}
        onRetry={positions.refetch}
      />
    ) : !chains && positions.accounts.length === 0 && positions.skipped.length > 0 ? (
      <EmptyState
        icon="staking"
        title={`Your wallet hasn't shared an address on ${
          positions.skipped.length === 1 ? chainMeta(positions.skipped[0] ?? "").chainName : `${positions.skipped.length} of these networks`
        }`}
        body="Rewards are read from your address on each network. Add the network in your wallet, then try again."
      />
    ) : null;
  if (unread) {
    return (
      <TxSheet
        key="unread"
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        chainId={null}
        form={unread}
        request={null}
        reviewItems={[]}
        fee={{ denom: null, price: null, currency }}
        confirmLabel="Claim"
        successText="Rewards claimed"
      />
    );
  }

  return (
    <TxSheet
      // The chooser decides whether the sheet starts on a form: a new key
      // when that changes, so the step starts over instead of sticking.
      key={mode}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        claimable.length === 0
          ? undefined
          : multi
            ? `Rewards are waiting on ${claimable.length} networks. Each network is one transaction.`
            : "Claiming pays your pending staking rewards to your balance."
      }
      chainId={chosen?.chain.chainId ?? null}
      form={chooser}
      request={request}
      blocker={multi && !chosen ? "Pick the network to claim on first." : null}
      reviewItems={
        claimable.length === 0
          ? [{ key: "none", label: "Rewards", value: "Nothing to claim right now" }]
          : reviewItems
      }
      reviewExtra={restakeSwitch}
      fee={{ denom: chosen?.chain.denom ?? null, price: chosen?.price ?? null, currency }}
      onSubmit={() => setFrozen(liveMode)}
      payout={chosen && chosen.whole !== null ? { denom: chosen.chain.denom, whole: chosen.whole, what: "rewards", symbol } : undefined}
      confirmLabel={restake ? `Claim and restake ${mask(rewardsText)}` : `Claim ${mask(rewardsText)}`}
      successText={restake ? `Claimed and restaked ${mask(rewardsText)}` : `Claimed ${mask(rewardsText)}`}
    />
  );
}
