"use client";

/**
 * Pieces the staking sheets share: the network line, a fixed validator's
 * card, the amount rules, and the review rows every flow repeats.
 */

import type { ReactNode } from "react";
import { ChainLogo, Money, Select, TokenAmount, type KeyValueItem } from "@/components/ui";
import type { ValidatorLite } from "@/lib/chain/types";
import { chainNameOf } from "../hooks";
import { percentOf, toBaseUnits, toBig, validatorFlags, validatorHref, wholeText } from "../model";
import { FlagBadges, ValidatorIdentity } from "../ValidatorBits";

/** "12.34 SAF" for an estimate in whole tokens (cut, never rounded up); null when unknown. */
export function approxTokens(whole: number | null, symbol: string): string | null {
  if (whole === null || !Number.isFinite(whole)) return null;
  return `${wholeText(whole, { maxFraction: Math.abs(whole) < 1 ? 4 : 2 })} ${symbol}`.trim();
}

/** A read-only "Network" field, or a picker when several chains are possible. */
export function NetworkField({
  chainId,
  options,
  onChange,
}: {
  chainId: string | null;
  /** Chain ids to choose from; one or none renders the read-only line. */
  options?: readonly string[];
  onChange?: (chainId: string) => void;
}) {
  if (options && options.length > 1 && onChange) {
    return (
      <Select
        label="Network"
        value={chainId ?? ""}
        placeholder="Choose a network"
        onChange={onChange}
        options={options.map((id) => ({ value: id, label: chainNameOf(id) }))}
      />
    );
  }
  if (!chainId) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-fg-muted">Network</span>
      <span className="flex h-[var(--d-ctl-md)] items-center gap-2 text-[14px] text-fg">
        <ChainLogo chainId={chainId} size={20} />
        {chainNameOf(chainId)}
        <span className="font-mono text-[11.5px] text-fg-dim">{chainId}</span>
      </span>
    </div>
  );
}

/** A fixed validator (the row the flow was opened from), with its flags. */
export function ValidatorCard({ label, validator, chainId }: { label: string; validator: ValidatorLite; chainId: string }) {
  const flags = validatorFlags(validator);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-fg-muted">{label}</span>
      <div className="flex flex-col gap-2 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] px-3 py-2.5">
        <ValidatorIdentity
          moniker={validator.moniker}
          logoUrl={validator.logoUrl}
          href={validatorHref(chainId, validator.operatorAddress)}
          sub={
            <>
              Commission {percentOf(validator.commissionRate, 1)}
              {validator.apr !== null ? ` · APR ${percentOf(validator.apr)}` : ""}
              {validator.rank ? ` · #${validator.rank}` : ""}
            </>
          }
        />
        {flags.length > 0 ? <FlagBadges flags={flags} /> : null}
      </div>
    </div>
  );
}

export interface AmountCheck {
  /** Base units, when the text is a valid positive amount within `max`. */
  base: string | null;
  /** Shown under the field. */
  error: string | null;
}

/**
 * Reads the amount field: positive, within `max` (base units), in a token
 * whose decimals are known. `maxReason` says why the cap is what it is.
 */
export function checkAmount(text: string, decimals: number | null, max: string | null, maxReason: string): AmountCheck {
  if (!text.trim()) return { base: null, error: null };
  if (decimals === null) return { base: null, error: "This token's decimals are unknown, so an amount cannot be entered safely." };
  const base = toBaseUnits(text, decimals);
  const big = toBig(base);
  if (base === null || big === null) return { base: null, error: "Enter a number." };
  if (big <= BigInt(0)) return { base: null, error: null };
  const cap = toBig(max);
  if (cap !== null && big > cap) return { base: null, error: maxReason };
  return { base, error: null };
}

/** The rows every review starts with. */
export function networkItem(chainId: string): KeyValueItem {
  return {
    key: "network",
    label: "Network",
    value: (
      <span className="inline-flex items-center gap-1.5">
        <ChainLogo chainId={chainId} size={16} />
        {chainNameOf(chainId)}
      </span>
    ),
  };
}

export function amountItem(
  label: string,
  base: string,
  decimals: number | null,
  symbol: string,
  value: number | null,
  currency: string,
): KeyValueItem {
  return {
    key: "amount",
    label,
    emphasis: true,
    value: <TokenAmount amount={base} decimals={decimals} symbol={symbol} />,
    sub: <Money value={value} currency={currency} reason="No price for this token" />,
  };
}

export function validatorItem(label: string, validator: Pick<ValidatorLite, "moniker" | "commissionRate">, extra?: ReactNode): KeyValueItem {
  return {
    key: `validator-${label}`,
    label,
    value: validator.moniker,
    sub: (
      <>
        Commission {percentOf(validator.commissionRate, 1)}
        {extra}
      </>
    ),
  };
}
