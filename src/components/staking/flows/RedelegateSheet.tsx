"use client";

/**
 * Move stake (redelegate) from one validator to another: instant, no
 * unbonding, never stops earning. Two SDK rules, checked here before the
 * wallet opens and explained in plain words:
 *
 * - **No transitive moves**: stake that arrived at a validator by
 *   redelegation cannot be moved on until that redelegation matures (one
 *   unbonding period). While any is pending, the chain refuses every
 *   redelegation *from* that validator, whatever the amount.
 * - **Seven pending moves** per pair of validators (`max_entries`).
 */

import { useMemo, useState } from "react";
import {
  AmountInput,
  Callout,
  EmptyState,
  InlineError,
  Select,
  useNow,
  type KeyValueItem,
} from "@/components/ui";
import { formatDate, formatTokenAmount } from "@/lib/format";
import type { ValidatorRow } from "@/lib/data/validators";
import { useValidators } from "@/lib/data/validators";
import { buildRedelegate } from "@/lib/tx/messages";
import type { SignRequest } from "@/lib/tx/types";
import { usePrefs } from "@/providers/PrefsProvider";
import { useChainStakingContext } from "../hooks";
import { DAY_MS, lockFor, MAX_ENTRIES, pairEntries, positive, toDisplay, toLite, toWhole, unbondingPeriodText, valueOf } from "../model";
import { amountItem, checkAmount, networkItem, ValidatorCard, validatorItem } from "./fields";
import { TxSheet } from "./TxSheet";
import { ValidatorPicker } from "./ValidatorPicker";

export interface RedelegateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chainId: string;
  /** Source validator; otherwise chosen among your positions. */
  src?: string;
  /** Preselected destination. */
  dst?: string;
}

export function RedelegateSheet({ open, onOpenChange, chainId, src: fixedSrc, dst: presetDst }: RedelegateSheetProps) {
  const { mask } = usePrefs();
  const ctx = useChainStakingContext(chainId);
  const now = useNow();
  const set = useValidators(chainId);
  const [srcPick, setSrcPick] = useState<string | null>(null);
  const [dstRow, setDstRow] = useState<ValidatorRow | null>(null);
  const [text, setText] = useState("");

  const staking = ctx?.staking ?? null;
  const dstPicked = dstRow?.operatorAddress ?? presetDst ?? null;
  const positions = useMemo(
    () => (staking?.delegations ?? []).filter((d) => positive(d.amount) && d.validator.operatorAddress !== dstPicked),
    [staking, dstPicked],
  );
  const srcAddress = fixedSrc ?? srcPick ?? (positions.length === 1 ? (positions[0]?.validator.operatorAddress ?? null) : null);
  const source = ctx?.staking?.delegations.find((d) => d.validator.operatorAddress === srcAddress) ?? null;
  const dstAddress = dstRow?.operatorAddress ?? (presetDst && presetDst !== srcAddress ? presetDst : null);
  const presetRow = !dstRow && dstAddress ? (set.data?.validators.find((row) => row.operatorAddress === dstAddress) ?? null) : null;
  const destination = dstRow ?? presetRow;
  // A linked destination outside the active set (the picker only lists the
  // active set): moving there would stop the stake earning.
  const dstInactive = Boolean(!dstRow && dstAddress && set.data?.chainId === chainId && !presetRow);

  const decimals = ctx?.decimals ?? null;
  const symbol = ctx?.symbol ?? "";
  const check = checkAmount(text, decimals, source?.amount ?? null, "More than you stake with this validator.");

  // Rule 1: anything redelegated *to* the source still maturing blocks it.
  const lockIso = staking && srcAddress && now !== null ? lockFor(staking.redelegations, srcAddress, now) : null;
  const lockUntil = lockIso ? Date.parse(lockIso) : null;
  // Rule 2: seven pending moves per pair.
  const pairCount = staking && srcAddress && dstAddress && now !== null ? pairEntries(staking, srcAddress, dstAddress, now) : 0;
  const pairFull = pairCount >= MAX_ENTRIES;

  const address = ctx?.address ?? null;
  const denom = ctx?.denom ?? null;
  const base = check.base;
  // Rebuilt each render: compared by content downstream, not identity.
  const request: SignRequest | null =
    !address || !denom || !srcAddress || !dstAddress || !base || lockUntil !== null || pairFull || dstInactive
      ? null
      : {
          chainId,
          messages: [
            buildRedelegate({
              delegatorAddress: address,
              validatorSrcAddress: srcAddress,
              validatorDstAddress: dstAddress,
              amount: { denom, amount: base },
            }),
          ],
        };

  const period = unbondingPeriodText(ctx?.unbondingDays);
  const lockEnd = now !== null && ctx?.unbondingDays ? now + ctx.unbondingDays * DAY_MS : null;
  const whole = check.base ? toWhole(check.base, decimals) : null;
  const amountLabel = check.base && decimals !== null ? `${formatTokenAmount(check.base, decimals, { maxFraction: 4 })} ${symbol}` : symbol;

  const hasStake = (ctx?.staking?.delegations.filter((d) => positive(d.amount)).length ?? 0) > 0;
  // Unread is not "nothing staked": the read failed, so say that.
  if (ctx && !ctx.stakingLoading && !hasStake && ctx.stakingError) {
    return (
      <TxSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Move stake"
        chainId={chainId}
        form={<InlineError title={`Couldn't read your stake on ${ctx.chainName}`} message={ctx.stakingError} onRetry={ctx.retryStaking} />}
        request={null}
        reviewItems={[]}
        fee={{ denom: null, price: null, currency: ctx.currency }}
        confirmLabel="Move stake"
        successText="Moved"
      />
    );
  }
  if (ctx && !ctx.stakingLoading && !hasStake) {
    return (
      <TxSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Move stake"
        chainId={chainId}
        form={<EmptyState icon="staking" title={`Nothing staked on ${ctx.chainName}`} body="Stake first; moving applies to existing stake." />}
        request={null}
        reviewItems={[]}
        fee={{ denom: null, price: null, currency: ctx.currency }}
        confirmLabel="Move stake"
        successText="Moved"
      />
    );
  }

  const form = (
    <>
      {fixedSrc && source ? (
        <ValidatorCard label="From" validator={source.validator} chainId={chainId} />
      ) : (
        <Select
          label="From"
          value={srcAddress ?? ""}
          placeholder="Choose one of your validators"
          onChange={(value) => setSrcPick(value)}
          options={positions.map((d) => ({
            value: d.validator.operatorAddress,
            label: `${d.validator.moniker} · ${decimals !== null ? mask(formatTokenAmount(d.amount, decimals, { maxFraction: 2, compact: true })) : "?"} ${symbol}`,
          }))}
        />
      )}
      <ValidatorPicker
        chainId={chainId}
        label="To"
        value={dstAddress}
        onChange={setDstRow}
        exclude={srcAddress ? [srcAddress] : undefined}
        id="move-destination"
      />
      {source ? (
        <AmountInput
          label="Amount"
          value={text}
          onChange={setText}
          symbol={symbol}
          decimals={decimals}
          max={decimals !== null ? toDisplay(source.amount, decimals) : undefined}
          fiatValue={check.base ? valueOf(whole, ctx?.price ?? null) : undefined}
          error={check.error}
        />
      ) : null}
      {lockUntil !== null ? (
        <Callout tone="danger" title={`Locked until ${formatDate(lockUntil, "long")}`}>
          Stake you moved to {source?.validator.moniker ?? "this validator"} is still settling. The network refuses any move away from it
          until that finishes (no transitive redelegation). You can still unstake.
        </Callout>
      ) : pairFull ? (
        <Callout tone="danger" title={`${MAX_ENTRIES} moves already pending`}>
          The network allows {MAX_ENTRIES} pending moves between the same two validators. Pick another destination or wait for one to
          finish.
        </Callout>
      ) : (
        <Callout tone="info" title="Instant, and keeps earning">
          No unbonding: the stake switches validator in the next block. The moved stake is then locked for{" "}
          {period ?? "one unbonding period"}: it cannot be moved again until {lockEnd ? formatDate(lockEnd, "long") : "then"}, and at
          most {MAX_ENTRIES} moves between the same two validators can be pending.
        </Callout>
      )}
    </>
  );

  const reviewItems: KeyValueItem[] =
    ctx && source && destination && check.base
      ? [
          networkItem(chainId),
          validatorItem("From", source.validator),
          validatorItem("To", toLite(destination), destination.rank ? ` · #${destination.rank}` : null),
          amountItem("Move", check.base, decimals, symbol, valueOf(whole, ctx.price), ctx.currency),
          {
            key: "lock",
            label: "Locked until",
            value: lockEnd ? formatDate(lockEnd, "long") : "—",
            info: "Until then this stake cannot be moved again (it can still be unstaked).",
          },
        ]
      : [];

  const blocker = !srcAddress
    ? "Choose the validator to move from."
    : !dstAddress
      ? "Choose where to move the stake."
      : dstInactive
        ? "That validator is not in the active set, so stake moved there would earn nothing. Choose another."
        : !check.base && !check.error && lockUntil === null && !pairFull
          ? "Enter the amount to move."
          : null;

  return (
    <TxSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Move stake"
      description={`Redelegate on ${ctx?.chainName ?? chainId} without unstaking.`}
      chainId={chainId}
      form={form}
      request={request}
      blocker={blocker}
      reviewItems={reviewItems}
      notices={
        <>
          {destination?.inNakamotoSet ? (
            <Callout tone="info" title="A large validator">
              {destination.moniker} is in the Nakamoto set: one of the few validators that together hold over a third of voting power.
            </Callout>
          ) : null}
          {source && source.rewards.some((coin) => positive(coin.amount)) ? (
            <Callout tone="neutral" title="Pending rewards are paid out">
              Moving stake pays your pending rewards from {source.validator.moniker} to your balance in the same transaction.
            </Callout>
          ) : null}
        </>
      }
      fee={{ denom: ctx?.denom ?? null, price: ctx?.price ?? null, currency: ctx?.currency ?? "usd" }}
      confirmLabel={`Move ${mask(amountLabel)}`}
      successText={`Moved ${mask(amountLabel)}${destination ? ` to ${destination.moniker}` : ""}`}
    />
  );
}
