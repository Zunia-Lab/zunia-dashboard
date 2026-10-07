"use client";

/**
 * Stake (delegate): network → validator (ordered by the decentralisation
 * score) → amount (your liquid balance minus a fee reserve) → review → sign.
 *
 * The network follows the wallet live: the choices are the scope's chains
 * the wallet has an address on, and they can arrive after the sheet opens
 * (a deep link right after load). One choice is taken as the network; none
 * says why and offers to add the network, instead of an empty form.
 */

import { useMemo, useState } from "react";
import { AmountInput, Button, Callout, EmptyState, toast, type KeyValueItem } from "@/components/ui";
import { useWallet } from "@/lib/connect/context";
import { explainError } from "@/lib/tx/errors";
import { formatPercent, formatTokenAmount } from "@/lib/format";
import { useValidators, type ValidatorRow } from "@/lib/data/validators";
import { buildDelegate } from "@/lib/tx/messages";
import type { SignRequest } from "@/lib/tx/types";
import { usePrefs } from "@/providers/PrefsProvider";
import { chainNameOf, useChainStakingContext } from "../hooks";
import { positive, toDisplay, toLite, toWhole, unbondingPeriodText, validatorFlags, valueOf } from "../model";
import { FlagBadges } from "../ValidatorBits";
import { amountItem, approxTokens, checkAmount, NetworkField, networkItem, validatorItem } from "./fields";
import { TxSheet } from "./TxSheet";
import { ValidatorPicker } from "./ValidatorPicker";

export interface DelegateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed network; otherwise picked from `chainOptions`. */
  chainId?: string;
  /** Networks in scope the wallet has an address on (live: they may arrive after opening). */
  chainOptions: string[];
  /** Networks in scope the wallet has not shared an address on. */
  unavailable?: string[];
  /** Preselected validator (operator address). */
  validator?: string;
  /** Prefilled amount, base units (the idle balance). */
  amount?: string;
}

export function DelegateSheet({
  open,
  onOpenChange,
  chainId: fixedChain,
  chainOptions,
  unavailable = [],
  validator: preset,
  amount: prefill,
}: DelegateSheetProps) {
  const { mask } = usePrefs();
  const [pickedChain, setPickedChain] = useState<string | null>(null);
  // Derived, not initialised once: options that arrive after the sheet
  // opened still pick the network when there is only one.
  const chainId = fixedChain ?? pickedChain ?? (chainOptions.length === 1 ? (chainOptions[0] ?? null) : null);
  const noNetwork = !chainId && chainOptions.length === 0;
  const [chosen, setChosen] = useState<ValidatorRow | null>(null);
  // Untouched (null) shows the prefilled amount once the decimals are known.
  const [typed, setTyped] = useState<string | null>(null);
  const ctx = useChainStakingContext(chainId);

  const decimals = ctx?.decimals ?? null;
  const amountText = typed ?? (prefill && decimals !== null ? toDisplay(prefill, decimals) : "");
  const valoper = chosen?.operatorAddress ?? (chosen === null && preset && chainId ? preset : null);
  const staking = ctx?.staking ?? null;
  const mine = useMemo(
    () => new Set((staking?.delegations ?? []).filter((d) => positive(d.amount)).map((d) => d.validator.operatorAddress)),
    [staking],
  );

  const reserveText = ctx && decimals !== null && positive(ctx.reserve) ? `${formatTokenAmount(ctx.reserve, decimals, { maxFraction: 4 })} ${ctx.symbol}` : null;
  const check = checkAmount(
    amountText,
    decimals,
    ctx?.available ?? null,
    reserveText ? `More than you can stake: ${reserveText} stays back for fees.` : "More than your available balance.",
  );

  const existing = ctx?.staking?.delegations.find((d) => d.validator.operatorAddress === valoper) ?? null;
  // The same bonded set the picker reads (one shared request): it resolves a
  // deep-linked validator before anyone opens the picker.
  const set = useValidators(chainId);
  const presetRow = !chosen && valoper ? (set.data?.validators.find((row) => row.operatorAddress === valoper) ?? null) : null;
  const presetInactive = Boolean(!chosen && valoper && set.data?.chainId === chainId && !presetRow && !existing);
  const lite = chosen ? toLite(chosen) : presetRow ? toLite(presetRow) : (existing?.validator ?? null);
  const flags = lite ? validatorFlags(lite) : [];
  const jailed = lite ? lite.jailed === true || lite.tombstoned === true : false;
  // Inactive (unbonding / unbonded) earns nothing either.
  const blocked = jailed || (lite !== null && lite.status !== null && lite.status !== "bonded");

  const address = ctx?.address ?? null;
  const denom = ctx?.denom ?? null;
  const base = check.base;
  // Rebuilt each render: compared by content downstream, not identity.
  // Wait for the balance: the amount is checked against it before signing.
  const balancePending = Boolean(ctx?.liquidLoading && ctx.liquid === null);
  const request: SignRequest | null =
    !chainId || !address || !denom || !valoper || !base || blocked || presetInactive || balancePending
      ? null
      : { chainId, messages: [buildDelegate({ delegatorAddress: address, validatorAddress: valoper, amount: { denom, amount: base } })] };

  const symbol = ctx?.symbol ?? "";
  const whole = check.base ? toWhole(check.base, decimals) : null;
  const value = valueOf(whole, ctx?.price ?? null);
  const apr = lite?.apr ?? null;
  const yearlyText = approxTokens(whole !== null && apr !== null ? whole * apr : null, symbol);
  const period = unbondingPeriodText(ctx?.unbondingDays);

  const blocker = noNetwork
    ? null
    : !chainId
      ? "Choose the network to stake on."
      : ctx && !ctx.address
        ? `Your wallet has not shared an address on ${ctx.chainName} yet.`
        : !valoper
          ? "Choose a validator."
          : presetInactive
            ? "That validator is not in the active set, so stake there would earn nothing. Choose another."
            : blocked
              ? jailed
                ? "This validator is jailed: stake there would earn nothing."
                : "This validator is outside the active set: stake there would earn nothing."
              : balancePending
                ? "Reading your balance…"
                : !check.base && !check.error
                  ? "Enter the amount to stake."
                  : null;

  const form = (
    <>
      {noNetwork ? (
        <NoNetwork unavailable={unavailable} />
      ) : (
        <NetworkField
          chainId={chainId}
          options={fixedChain ? undefined : chainOptions}
          onChange={(next) => {
            setPickedChain(next);
            setChosen(null);
            setTyped("");
          }}
        />
      )}
      {chainId ? (
        <ValidatorPicker
          chainId={chainId}
          value={valoper}
          onChange={(row) => setChosen(row)}
          mine={mine}
          id="stake-validator"
        />
      ) : null}
      {flags.length > 0 ? <FlagBadges flags={flags} className="-mt-1" /> : null}
      {chainId ? (
        <AmountInput
          label="Amount"
          value={amountText}
          onChange={setTyped}
          symbol={symbol}
          decimals={decimals}
          max={ctx?.available && decimals !== null ? toDisplay(ctx.available, decimals) : undefined}
          fiatValue={check.base ? value : undefined}
          error={check.error}
          disabled={!ctx?.address}
        />
      ) : null}
      {chainId && check.base && apr !== null && yearlyText ? (
        <p className="-mt-1 text-[12.5px] leading-snug text-fg-dim">
          Earns about <span className="text-fg-muted">{mask(yearlyText)}</span> a year at {formatPercent(apr * 100)}, this
          validator&apos;s APR after commission. An estimate: the APR moves with the chain.
        </p>
      ) : null}
      {reserveText ? (
        <p className="text-[12px] leading-snug text-fg-dim">
          Max keeps {mask(reserveText)} for fees: enough for three staking transactions on {ctx?.chainName}.
        </p>
      ) : null}
    </>
  );

  const reviewItems: KeyValueItem[] =
    ctx && check.base && lite
      ? [
          networkItem(ctx.chainId),
          validatorItem("Validator", lite, lite.rank ? ` · #${lite.rank}` : null),
          amountItem("Stake", check.base, decimals, symbol, value, ctx.currency),
          {
            key: "earns",
            label: "Earns (est.)",
            value: apr === null ? "—" : `${formatPercent(apr * 100)} APR`,
            sub: yearlyText ? mask(`≈ ${yearlyText} a year`) : undefined,
            info: "The chain's actual APR (block-time corrected, mint rewards only) after this validator's commission. It moves with inflation and the bonded ratio.",
          },
          {
            key: "unbonding",
            label: "Unstaking later",
            value: period ?? "—",
            info: "Unstaking takes this long. During it your tokens earn nothing and cannot be moved.",
          },
        ]
      : [];

  const notices = (
    <>
      {lite?.inNakamotoSet ? (
        <Callout tone="info" title="A large validator">
          {lite.moniker} is in the Nakamoto set: one of the few validators that together hold over a third of voting power. A smaller
          validator with similar terms spreads power out.
        </Callout>
      ) : null}
      {existing && existing.rewards.some((coin) => positive(coin.amount)) ? (
        <Callout tone="neutral" title="Pending rewards are paid out">
          Staking more with {existing.validator.moniker} pays your pending rewards from it to your balance in the same transaction.
        </Callout>
      ) : null}
    </>
  );

  const amountLabel = check.base && decimals !== null ? `${formatTokenAmount(check.base, decimals, { maxFraction: 4 })} ${symbol}` : symbol;

  return (
    <TxSheet
      open={open}
      onOpenChange={onOpenChange}
      title={symbol ? `Stake ${symbol}` : "Stake"}
      description={
        ctx
          ? `Delegate to a validator on ${ctx.chainName}. Your tokens stay in your account${period ? `; unstaking takes ${period}` : ""}.`
          : "Delegate tokens to a validator. Your tokens stay in your account."
      }
      chainId={chainId}
      form={form}
      request={request}
      blocker={blocker}
      reviewItems={reviewItems}
      notices={notices}
      fee={{ denom: ctx?.denom ?? null, price: ctx?.price ?? null, currency: ctx?.currency ?? "usd" }}
      confirmLabel={`Stake ${mask(amountLabel)}`}
      successText={`Staked ${mask(amountLabel)}${lite ? ` with ${lite.moniker}` : ""}`}
    />
  );
}

/**
 * No network of the scope has an address from this wallet (another key
 * scheme, or a phone session that left it out): say so, and offer the one
 * step that fixes it — adding the network in the wallet (a connection
 * prompt, never a signature).
 */
function NoNetwork({ unavailable }: { unavailable: readonly string[] }) {
  const wallet = useWallet();
  const first = unavailable[0] ?? null;
  const phone = wallet.walletKind === "zunia-mobile";
  const named = unavailable.length === 1 && first ? chainNameOf(first) : null;
  return (
    <EmptyState
      icon="staking"
      title={named ? `Your wallet hasn't shared an address on ${named}` : "No network to stake on here yet"}
      body={
        phone
          ? "This phone session did not include the networks in this scope. Pair again and approve them to stake from here."
          : unavailable.length > 0
            ? "Staking needs your address on the network. Add it in your wallet, or pick another network in the scope."
            : "Pick a network in the scope selector, or follow one in Networks."
      }
      action={
        first && !phone ? (
          <Button
            size="sm"
            iconLeft="plus"
            onClick={() => {
              wallet.ensureChain(first).catch((error: unknown) => {
                const explained = explainError(error);
                toast.error(explained.title, { description: explained.message });
              });
            }}
          >
            Add {chainNameOf(first)}
          </Button>
        ) : !first ? (
          <Button size="sm" href="/networks" iconRight="arrowRight">
            Networks
          </Button>
        ) : undefined
      }
    />
  );
}
