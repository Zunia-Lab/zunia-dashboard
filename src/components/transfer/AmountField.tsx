"use client";

/**
 * The amount block of Send and Bridge: the kit's AmountInput (Max keeps the
 * fee reserve back), quick 25 / 50 / 75 % of what Max allows, and one line
 * on what is left after the transfer, or, before an amount is typed, what
 * Max holds back for the fee.
 *
 * Everything stays in base units until it is shown: the chips cut, never
 * round up, and "left after" subtracts the measured fee only when the token
 * being sent is also the fee token.
 */

import { useState } from "react";
import { AmountInput, Chip, TokenAmount } from "@/components/ui";
import { exceeds, fractionOf, fromBase, isPositive, type SpendableAsset } from "./logic";

const FRACTIONS = [25, 50, 75];

/**
 * Max follows the fee reserve down.
 *
 * The reserve is the fee measured on the real message, and Max changes that
 * message: the new amount is simulated again, the gas moves by a few units
 * and Max ends up a hair above the new limit, refused by the very form that
 * filled it ("Keep 0.00456 ATOM for the network fee (Max does it for you)").
 * A new recipient or route, or another fee tier, does the same. So while the
 * field still holds exactly what Max wrote, a lower Max lowers the field
 * with it. Never raised, so re-measuring settles; any edit (a key, a chip,
 * another token) ends the follow.
 *
 * Call during render, after `maxBase` is known, before what blocks the form
 * is worked out; pass the returned function to the field's `onMax`.
 */
export function useMaxFollowsReserve(
  assetKey: string | null,
  amountBase: string | null,
  maxBase: string,
  decimals: number | null,
  setAmountText: (text: string) => void,
): () => void {
  const [maxed, setMaxed] = useState<{ key: string; base: string } | null>(null);
  // Adjusted during render (React's "information from previous renders"
  // pattern); guarded: once lowered, `maxed.base` equals `maxBase`.
  if (maxed && maxed.key === assetKey && maxed.base === amountBase && isPositive(maxBase) && exceeds(maxed.base, maxBase)) {
    setMaxed({ key: maxed.key, base: maxBase });
    setAmountText(fromBase(maxBase, decimals));
  }
  return () => {
    if (assetKey) setMaxed({ key: assetKey, base: maxBase });
  };
}

export function AmountField({
  asset,
  value,
  onChange,
  maxBase,
  reserve,
  leftAfter,
  leftWhere,
  fiatValue,
  error,
  onMax,
}: {
  asset: SpendableAsset | null;
  value: string;
  /** Every change, typed or from a chip (the caller pins its defaults first). */
  onChange: (value: string) => void;
  /** After Max filled the field (see `useMaxFollowsReserve`). */
  onMax?: () => void;
  /** What Max fills: the liquid balance less the fee reserve, base units. */
  maxBase: string;
  /** Base units of the fee token Max keeps back; null when nothing is kept. */
  reserve: string | null;
  /** Base units left once the amount (and the fee, when it is this token) is gone. */
  leftAfter: string | null;
  /** "left after", "left on Safrochain". */
  leftWhere: string;
  /** The amount's value in the stored currency; undefined hides the line. */
  fiatValue: number | null | undefined;
  error?: string;
}) {
  const decimals = asset?.decimals ?? null;
  const symbol = asset?.identity.ticker ?? "";
  return (
    <div className="flex flex-col gap-2">
      <AmountInput
        label="Amount"
        value={value}
        onChange={onChange}
        symbol={symbol}
        // Without a token there is no exponent to enforce (undefined), which is not the
        // same as a token whose decimals are unknown (null: Max only).
        decimals={asset ? decimals : undefined}
        max={asset ? (decimals === null ? maxBase : fromBase(maxBase, decimals)) : undefined}
        onMax={onMax}
        fiatValue={fiatValue}
        disabled={!asset}
        error={error}
      />
      {asset && decimals !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {FRACTIONS.map((percent) => (
              <Chip key={percent} size="sm" onClick={() => onChange(fromBase(fractionOf(maxBase, percent), decimals))}>
                {percent}%
              </Chip>
            ))}
          </div>
          {leftAfter !== null ? (
            <span className="text-[12px] text-fg-dim">
              <TokenAmount amount={leftAfter} decimals={decimals} symbol={symbol} maxFraction={4} /> {leftWhere}
            </span>
          ) : reserve && isPositive(reserve) ? (
            <span className="text-[12px] text-fg-dim">
              {/* The reserve is a fee, not a balance: shown even in privacy mode. */}
              Max keeps <TokenAmount amount={reserve} decimals={decimals} maxFraction={6} masked={false} /> {symbol} for fees
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
