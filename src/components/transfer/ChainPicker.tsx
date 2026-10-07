"use client";

/**
 * Pick a chain: the followed ones first, then (optionally) every other
 * network of the same kind in the catalog. Two faces:
 *
 * - `tile`: the big From / To tiles of the Bridge card (label inside, logo,
 *   name, a meta line such as what you hold there);
 * - `field`: a field-height trigger (Receive's chain selector).
 */

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { ChainLogo, Combobox } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";

export interface ChainPickerProps {
  value: string | null;
  onChange: (chainId: string) => void;
  /** Listed first, under "Followed". */
  chains: ChainEntry[];
  /** Listed after, under "All networks" (searchable). */
  more?: ChainEntry[];
  /** Field label ("From", "To") and the sheet's title. */
  label: string;
  /** Right side of a row, and the tile's meta line. */
  meta?: (chain: ChainEntry) => ReactNode;
  isDisabled?: (chain: ChainEntry) => boolean;
  variant?: "tile" | "field";
  /** The whole control is unavailable (the reason shows on hover). */
  disabled?: boolean;
  disabledReason?: string | null;
  className?: string;
}

export function ChainPicker({
  value,
  onChange,
  chains,
  more,
  label,
  meta,
  isDisabled,
  variant = "field",
  disabled,
  disabledReason,
  className,
}: ChainPickerProps) {
  const followedIds = new Set(chains.map((chain) => chain.chainId));
  const items = more ? [...chains, ...more.filter((chain) => !followedIds.has(chain.chainId))] : chains;
  const selected = items.find((chain) => chain.chainId === value) ?? null;

  // The triggers are named by what they show, in that order (speech input
  // users say the visible words), with what a press does after it.
  const trigger =
    variant === "tile" ? (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? (disabledReason ?? undefined) : undefined}
        className={cn(
          "group relative flex min-h-[76px] w-full min-w-0 flex-col justify-center gap-1 rounded-[var(--d-radius-inner)] border border-[var(--d-control-line)] bg-[var(--d-input-bg)] px-3.5 py-2.5 text-left",
          "transition-[border-color,background-color] duration-[160ms] hover:border-[color-mix(in_srgb,var(--z-fg)_26%,transparent)] hover:bg-[var(--d-glass)]",
          "data-[state=open]:border-[var(--z-focus-ring)] disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <span className="d-label">{label}</span>
        <span className="flex min-w-0 items-center gap-2.5">
          {selected ? <ChainLogo chainId={selected.chainId} size={28} /> : <span className="size-7 rounded-full bg-[var(--d-glass-2)]" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium leading-tight tracking-[-0.01em] text-fg">
              {selected?.chainName ?? "Choose a network"}
            </span>
            {selected && meta ? <span className="mt-0.5 block truncate text-[12px] leading-tight text-fg-dim">{meta(selected)}</span> : null}
          </span>
          <Icon name="chevronsUpDown" size={15} className="shrink-0 text-fg-dim group-hover:text-fg-muted" />
        </span>
        {selected ? <span className="sr-only">. Change the network</span> : null}
      </button>
    ) : (
      <button
        type="button"
        disabled={disabled}
        title={disabled ? (disabledReason ?? undefined) : undefined}
        className={cn(
          "group flex h-[var(--d-ctl-lg)] w-full min-w-0 items-center gap-2.5 rounded-[var(--d-radius-control)] border border-[var(--d-control-line)] bg-[var(--d-input-bg)] px-3 text-left",
          "transition-[border-color,background-color] duration-[160ms] hover:border-[color-mix(in_srgb,var(--z-fg)_26%,transparent)]",
          "data-[state=open]:border-[var(--z-focus-ring)] disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        {selected ? <ChainLogo chainId={selected.chainId} size={20} /> : null}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{selected?.chainName ?? "Choose a network"}</span>
        {selected ? <span className="hidden shrink-0 font-mono text-[11px] text-fg-dim sm:inline">{selected.chainId}</span> : null}
        <Icon name="chevronsUpDown" size={14} className="shrink-0 text-fg-dim" />
        {/* The field has no visible label of its own: the purpose is said after what it shows. */}
        <span className="sr-only">{selected ? `. ${label}: change` : `: ${label}`}</span>
      </button>
    );

  if (disabled) return trigger;

  return (
    <Combobox<ChainEntry>
      title={label}
      items={items}
      getKey={(chain) => chain.chainId}
      value={value}
      onSelect={(chain) => onChange(chain.chainId)}
      isDisabled={isDisabled}
      placeholder={more ? `Search ${items.length} networks` : "Search networks"}
      emptyText="No network matches"
      width={340}
      groupBy={more ? (chain) => (followedIds.has(chain.chainId) ? "Followed" : "All networks") : undefined}
      filter={(chain, query) =>
        chain.chainName.toLowerCase().includes(query) ||
        chain.chainId.toLowerCase().includes(query) ||
        chain.coinDenom.toLowerCase().includes(query)
      }
      trigger={trigger}
      renderItem={(chain) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <ChainLogo chainId={chain.chainId} size={24} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] text-fg">{chain.chainName}</span>
            <span className="block truncate font-mono text-[11px] text-fg-dim">{chain.chainId}</span>
          </span>
          {meta ? <span className="shrink-0 text-right text-[12px] tabular-nums text-fg-dim">{meta(chain)}</span> : null}
        </span>
      )}
    />
  );
}

