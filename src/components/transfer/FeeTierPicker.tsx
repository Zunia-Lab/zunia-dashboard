"use client";

/**
 * The network fee, three ways: Low / Average / High, each with what it costs
 * in the fee token and in money. The figures come from simulating the real
 * transaction (`useTxPreview`) at the chain's published gas prices; the
 * wallet flow measures again when it signs, so these are what the chain
 * asked a moment ago, said as such.
 *
 * A radio group of tiles, not a select: the point is to compare the three.
 */

import { useId, useRef, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { InfoTip, Money, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";
import type { FeeQuote } from "@/lib/tx/fees";
import type { GasEstimate } from "@/lib/tx/flow";
import type { FeeTier } from "@/lib/tx/types";

const TIERS: { value: FeeTier; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "Cheapest; may wait when blocks are full" },
  { value: "average", label: "Average", hint: "What most wallets pay" },
  { value: "high", label: "High", hint: "Ahead of the queue when blocks are full" },
];

export interface FeeTierPickerProps {
  tiers: Record<FeeTier, FeeQuote> | null;
  value: FeeTier;
  onChange: (tier: FeeTier) => void;
  /** A measurement is running (the previous figures stay, dimmed). */
  loading?: boolean;
  /** Price of one whole fee token, in `currency`; null when unpriced. */
  feePrice: number | null;
  currency: string;
  gas?: GasEstimate | null;
  /** Why there are no figures (shown under the tiles). */
  problem?: string | null;
  className?: string;
}

export function FeeTierPicker({ tiers, value, onChange, loading, feePrice, currency, gas, problem, className }: FeeTierPickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const index = TIERS.findIndex((tier) => tier.value === value);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + TIERS.length) % TIERS.length;
    const tier = TIERS[next];
    if (!tier) return;
    onChange(tier.value);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="flex items-center gap-1 text-[12.5px] font-medium text-fg-muted">
          Network fee
          <InfoTip
            content={
              <>
                Measured by simulating this exact transaction on the chain, at its published gas prices. Your wallet measures
                again when it signs, so the final fee can differ slightly.
                {gas?.estimate && gas.note ? <span className="mt-1 block text-fg-dim">{gas.note}</span> : null}
              </>
            }
            size={13}
          />
        </span>
        {gas ? (
          <span className="font-mono text-[11px] tabular-nums text-fg-dim">
            {gas.method === "simulated" && gas.gasUsed ? `${Number(gas.gasUsed).toLocaleString("en-US")} gas used · ` : ""}
            limit {gas.gasLimit.toLocaleString("en-US")}
          </span>
        ) : null}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-busy={loading || undefined}
        // Three tiles side by side from 640 px; on phones one row per tier, so
        // an amount like "0.012041 OSMO" is never cut.
        className={cn("grid grid-cols-1 gap-2 transition-opacity duration-[160ms] sm:grid-cols-3", loading && tiers && "opacity-60")}
      >
        {TIERS.map((tier, i) => {
          const quote = tiers?.[tier.value] ?? null;
          const checked = tier.value === value;
          const fiat = quote && feePrice !== null ? Number(quote.display) * feePrice : null;
          return (
            <button
              key={tier.value}
              ref={(node) => {
                refs.current[i] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              title={tier.hint}
              onClick={() => onChange(tier.value)}
              onKeyDown={onKeyDown}
              className={cn(
                "d-hit relative flex min-w-0 items-center gap-3 rounded-[var(--d-radius-control)] border px-3 py-2 text-left max-sm:min-h-[44px] sm:flex-col sm:items-start sm:gap-0.5",
                "transition-[border-color,background-color,box-shadow] duration-[160ms]",
                checked
                  ? "border-[var(--d-accent-line)] bg-[var(--d-accent-soft)] shadow-[0_0_0_1px_var(--d-accent-line)_inset]"
                  : "border-[var(--d-control-line)] bg-[var(--d-input-bg)] hover:border-[color-mix(in_srgb,var(--z-fg)_26%,transparent)]",
              )}
            >
              <span
                className={cn(
                  "flex w-[76px] shrink-0 items-center gap-1 text-[11.5px] font-medium sm:w-full sm:justify-between",
                  checked ? "text-[var(--d-accent-text)]" : "text-fg-dim",
                )}
              >
                {tier.label}
                {checked ? <Icon name="check" size={12} strokeWidth={2.2} /> : null}
              </span>
              {quote ? (
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium tabular-nums text-fg sm:w-full sm:flex-none">
                  {formatAmount(quote.display, { maxFraction: 6 })}
                  <span className="ml-1 text-[12px] font-normal text-fg-dim">{quote.symbol ?? ""}</span>
                </span>
              ) : loading ? (
                <Skeleton className="my-[3px] h-3 flex-1 sm:flex-none" width="80%" />
              ) : (
                <span className="flex-1 text-[13.5px] text-fg-dim sm:flex-none">—</span>
              )}
              <span className="shrink-0 truncate text-right text-[11.5px] tabular-nums text-fg-dim sm:w-full sm:text-left">
                {quote ? (
                  fiat !== null ? (
                    <>
                      ≈ <Money value={fiat} currency={currency} masked={false} />
                    </>
                  ) : (
                    "no price"
                  )
                ) : (
                  " "
                )}
              </span>
            </button>
          );
        })}
      </div>
      {problem ? <p className="text-[12px] leading-snug text-fg-dim">{problem}</p> : null}
    </div>
  );
}
