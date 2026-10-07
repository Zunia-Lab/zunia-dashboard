"use client";

/**
 * Slippage tolerance: the presets the extension offers (0.5 / 1 / 3 %), any
 * value typed in (0, 50], a warning above 3 %, and the one sentence that
 * makes the number mean something: below it, the swap does not happen.
 *
 * The value is a per-viewer preference (the page keeps it in localStorage);
 * this control only edits it. A typed value takes effect only once valid, so
 * the quote never asks the router for a tolerance it would refuse.
 */

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Button, Callout, Input, Popover, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HIGH_SLIPPAGE_PERCENT, SLIPPAGE_PRESETS, slippageNotice } from "@/lib/data/swap";

export interface SlippageControlProps {
  value: number;
  onChange: (percent: number) => void;
  /** The contract path's tolerance applies to a TWAP, which is worth saying. */
  twapWindowSeconds?: number | null;
}

function presetKey(percent: number): string {
  return String(percent);
}

export function SlippageControl({ value, onChange, twapWindowSeconds }: SlippageControlProps) {
  const [open, setOpen] = useState(false);
  const preset = SLIPPAGE_PRESETS.includes(value) ? presetKey(value) : "custom";
  const [draft, setDraft] = useState<string | null>(null);
  const custom = draft ?? (preset === "custom" ? String(value) : "");
  const parsed = custom.trim() === "" ? null : Number(custom.replace(",", "."));
  const notice = parsed === null ? null : slippageNotice(parsed);
  const high = value > HIGH_SLIPPAGE_PERCENT;

  const commitDraft = (text: string) => {
    setDraft(text);
    const next = Number(text.replace(",", "."));
    if (text.trim() !== "" && slippageNotice(next).valid) onChange(next);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDraft(null);
      }}
      align="end"
      width={312}
      ariaLabel="Slippage tolerance"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Slippage tolerance ${value}%. Change`}
          className={cn("gap-1.5 px-2.5", high && "text-[var(--z-warning)]")}
          iconLeft={<Icon name="settings" size={15} />}
        >
          <span className="tabular-nums">{value}%</span>
          <span className="sr-only">slippage</span>
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[14px] font-medium text-fg">Slippage tolerance</p>
          <p className="mt-0.5 text-[12.5px] leading-[1.45] text-fg-dim">
            If the price moves against you by more than this before the swap runs, it does not happen and your tokens stay put.
          </p>
        </div>
        <Segmented
          ariaLabel="Slippage presets"
          fullWidth
          size="md"
          value={preset}
          onChange={(next) => {
            setDraft(null);
            onChange(Number(next));
          }}
          options={SLIPPAGE_PRESETS.map((percent) => ({ value: presetKey(percent), label: `${percent}%` }))}
        />
        <Input
          size="sm"
          label="Custom"
          inputMode="decimal"
          placeholder="e.g. 2"
          value={custom}
          onChange={(event) => commitDraft(event.target.value)}
          trailing={<span className="text-[13px]">%</span>}
          error={notice && !notice.valid ? notice.message : undefined}
          aria-label="Custom slippage tolerance in percent"
        />
        {notice?.valid && notice.message ? (
          <Callout tone="warning" className="py-2.5">
            {notice.message}
          </Callout>
        ) : !notice && high ? (
          <Callout tone="warning" className="py-2.5">
            {`A ${value}% tolerance lets the swap fill at up to ${value}% less than quoted. Keep it only for a thin pool.`}
          </Callout>
        ) : null}
        {twapWindowSeconds ? (
          <p className="text-[12px] leading-[1.45] text-fg-dim">
            On this cross-chain route the tolerance applies to Osmosis&apos;s {twapWindowSeconds}-second average price, checked by the contract when your tokens arrive.
          </p>
        ) : null}
      </div>
    </Popover>
  );
}
