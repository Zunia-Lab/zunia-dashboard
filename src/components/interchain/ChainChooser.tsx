"use client";

/**
 * Pick any chain in the catalog, not only a followed one.
 *
 * A swap or an NFT transfer is asked for precisely because the user holds
 * something on a chain they have not followed, or wants it delivered to one,
 * so this lists the whole catalog (or the `chains` given), searchable, as the
 * kit's picker (a popover on desktop, a sheet on phones). Kept under this
 * name and props for the screens built against it; the picker itself is the
 * transfer pages' `ChainPicker`.
 */

import { useId, useMemo } from "react";
import { ChainPicker } from "@/components/transfer/ChainPicker";
import { cn } from "@/lib/cn";
import { searchChains, sortChains, type ChainEntry } from "@/lib/chains";

export interface ChainChooserProps {
  readonly value: string;
  readonly onValueChange: (chainId: string) => void;
  /** Field label, shown above the trigger and used as its accessible name. */
  readonly label: string;
  /** Restrict the list. Omit for the whole catalog. */
  readonly chains?: readonly ChainEntry[];
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
  readonly className?: string;
}

export function ChainChooser({ value, onValueChange, label, chains, disabled = false, disabledReason, className }: ChainChooserProps) {
  const labelId = useId();
  const pool = useMemo(() => (chains ? sortChains([...chains]) : searchChains("")), [chains]);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-[12.5px] font-medium text-fg-muted">
        {label}
      </span>
      <ChainPicker
        label={label}
        value={value || null}
        onChange={onValueChange}
        chains={pool}
        disabled={disabled}
        disabledReason={disabledReason ?? null}
      />
    </div>
  );
}
