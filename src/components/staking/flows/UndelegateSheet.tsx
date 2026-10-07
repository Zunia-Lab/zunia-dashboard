"use client";

/**
 * Unstake (undelegate) from one validator. The sheet states the two things
 * people regret not knowing: the unbonding period (the tokens earn nothing
 * and cannot move until it ends) and that pending rewards are paid out now.
 * The SDK allows a limited number of pending unbondings per validator
 * (`MAX_ENTRIES`); a full queue is refused here rather than by the chain.
 */

import { useMemo, useState } from "react";
import { AmountInput, Callout, EmptyState, InlineError, Skeleton, useNow, type KeyValueItem } from "@/components/ui";
import { formatDate, formatTokenAmount } from "@/lib/format";
import { buildUndelegate } from "@/lib/tx/messages";
import type { SignRequest } from "@/lib/tx/types";
import { usePrefs } from "@/providers/PrefsProvider";
import { useChainStakingContext } from "../hooks";
import { DAY_MS, MAX_ENTRIES, positive, sumBase, toDisplay, toWhole, unbondingPeriodText, valueOf } from "../model";
import { amountItem, checkAmount, networkItem, ValidatorCard, validatorItem } from "./fields";
import { TxSheet } from "./TxSheet";

export interface UndelegateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chainId: string;
  validator: string;
}

export function UndelegateSheet({ open, onOpenChange, chainId, validator }: UndelegateSheetProps) {
  const { mask } = usePrefs();
  const ctx = useChainStakingContext(chainId);
  const now = useNow();
  const [text, setText] = useState("");

  const position = ctx?.staking?.delegations.find((d) => d.validator.operatorAddress === validator) ?? null;
  const decimals = ctx?.decimals ?? null;
  const symbol = ctx?.symbol ?? "";
  const check = checkAmount(text, decimals, position?.amount ?? null, "More than you stake with this validator.");
  const pending = position && ctx?.denom ? sumBase(position.rewards.filter((c) => c.denom === ctx.denom).map((c) => c.amount)) : "0";
  const staking = ctx?.staking ?? null;
  const entries = useMemo(() => {
    if (!staking || now === null) return 0;
    return staking.unbonding
      .filter((u) => u.validator.operatorAddress === validator)
      .reduce((count, u) => count + u.entries.filter((entry) => Date.parse(entry.completionTime) > now).length, 0);
  }, [staking, validator, now]);
  const full = entries >= MAX_ENTRIES;

  const address = ctx?.address ?? null;
  const denom = ctx?.denom ?? null;
  const base = check.base;
  // Rebuilt each render: the fee preview and the sheet compare requests by
  // content (message bytes), not identity.
  const request: SignRequest | null =
    !address || !denom || !base || full
      ? null
      : { chainId, messages: [buildUndelegate({ delegatorAddress: address, validatorAddress: validator, amount: { denom, amount: base } })] };

  const period = unbondingPeriodText(ctx?.unbondingDays);
  const releaseAt = now !== null && ctx?.unbondingDays ? now + ctx.unbondingDays * DAY_MS : null;
  const whole = check.base ? toWhole(check.base, decimals) : null;
  const amountLabel = check.base && decimals !== null ? `${formatTokenAmount(check.base, decimals, { maxFraction: 4 })} ${symbol}` : symbol;

  // Unread is not "no stake here": the read failed, so say that.
  if (ctx && !ctx.stakingLoading && !position && ctx.stakingError) {
    return (
      <TxSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Unstake"
        chainId={chainId}
        form={<InlineError title={`Couldn't read your stake on ${ctx.chainName}`} message={ctx.stakingError} onRetry={ctx.retryStaking} />}
        request={null}
        reviewItems={[]}
        fee={{ denom: null, price: null, currency: ctx.currency }}
        confirmLabel="Unstake"
        successText="Unstaked"
      />
    );
  }
  if (ctx && !ctx.stakingLoading && !position) {
    return (
      <TxSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Unstake"
        chainId={chainId}
        form={<EmptyState icon="staking" title="No stake with this validator" body="Your positions may have changed since this page loaded." />}
        request={null}
        reviewItems={[]}
        fee={{ denom: null, price: null, currency: ctx.currency }}
        confirmLabel="Unstake"
        successText="Unstaked"
      />
    );
  }

  const form = position ? (
    <>
      <ValidatorCard label="From" validator={position.validator} chainId={chainId} />
      <AmountInput
        label="Amount"
        value={text}
        onChange={setText}
        symbol={symbol}
        decimals={decimals}
        max={decimals !== null ? toDisplay(position.amount, decimals) : undefined}
        fiatValue={check.base ? valueOf(whole, ctx?.price ?? null) : undefined}
        error={check.error}
      />
      <Callout tone="warning" title={period ? `Unbonding takes ${period}` : "Unbonding takes a while"}>
        Until {releaseAt ? formatDate(releaseAt, "long") : "it ends"} these tokens earn nothing and cannot be moved or sent, and
        this cannot be cancelled from Zunia.
        {positive(pending) && decimals !== null
          ? ` Your pending ${mask(`${formatTokenAmount(pending, decimals, { maxFraction: 4 })} ${symbol}`)} of rewards from this validator are paid to your balance now.`
          : " Pending rewards from this validator are paid to your balance now."}
      </Callout>
      {full ? (
        <Callout tone="danger" title={`${MAX_ENTRIES} unstakes already in progress`}>
          The network allows {MAX_ENTRIES} pending unstakes per validator. Wait for the next one to finish, or move stake to another
          validator instead (no waiting).
        </Callout>
      ) : null}
    </>
  ) : (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-16 w-full rounded-[12px]" />
      <Skeleton className="h-24 w-full rounded-[12px]" />
    </div>
  );

  const reviewItems: KeyValueItem[] =
    position && ctx && check.base
      ? [
          networkItem(chainId),
          validatorItem("From", position.validator),
          amountItem("Unstake", check.base, decimals, symbol, valueOf(whole, ctx.price), ctx.currency),
          {
            key: "release",
            label: "Available",
            value: releaseAt ? formatDate(releaseAt, "long") : "—",
            sub: period ? `after ${period} of unbonding` : undefined,
            info: "The chain releases unbonded tokens at the end of the unbonding period. They earn nothing meanwhile.",
          },
          {
            key: "rewards",
            label: "Rewards paid now",
            value: positive(pending) && decimals !== null ? mask(`${formatTokenAmount(pending, decimals, { maxFraction: 6 })} ${symbol}`) : "None pending",
          },
        ]
      : [];

  return (
    <TxSheet
      open={open}
      onOpenChange={onOpenChange}
      title={symbol ? `Unstake ${symbol}` : "Unstake"}
      description={position ? `Stop staking with ${position.validator.moniker} on ${ctx?.chainName ?? chainId}.` : undefined}
      chainId={chainId}
      form={form}
      request={request}
      blocker={full ? null : !check.base && !check.error ? "Enter the amount to unstake." : null}
      reviewItems={reviewItems}
      fee={{ denom: ctx?.denom ?? null, price: ctx?.price ?? null, currency: ctx?.currency ?? "usd" }}
      confirmLabel={`Unstake ${mask(amountLabel)}`}
      successText={`Unstaking ${mask(amountLabel)}${period ? `; available in ${period}` : ""}`}
    />
  );
}
