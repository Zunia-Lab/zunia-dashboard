"use client";

/**
 * Pick the balance to move: every spendable token in scope, named by its
 * identity ("USDC.n · Noble USDC · on Osmosis"), with what is available and
 * what it is worth. A searchable list (popover on desktop, sheet on phones),
 * grouped by chain when the scope spans several.
 */

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { AssetLogo, Combobox, Money, Skeleton, TokenAmount, chainById } from "@/components/ui";
import { cn } from "@/lib/cn";
import { tokenKeywords, tokenText } from "@/lib/token/text";
import type { SpendableAsset } from "./logic";
import { chainName } from "./names";

export interface AssetPickerProps {
  assets: SpendableAsset[];
  /** The selected balance key (`chainId|denom`). */
  value: string | null;
  onChange: (asset: SpendableAsset) => void;
  /** The currency the values are in (the portfolio response's). */
  currency: string;
  loading?: boolean;
  /** Group the list by chain (the scope spans several). */
  groupByChain?: boolean;
  /** A line under a row in the list (e.g. "Goes home first, 2 hops"). */
  detail?: (asset: SpendableAsset) => ReactNode;
  isDisabled?: (asset: SpendableAsset) => boolean;
  /** Accessible name of the trigger and the sheet's title. */
  label?: string;
  id?: string;
  emptyText?: ReactNode;
  className?: string;
}


function AssetFace({ asset, size }: { asset: SpendableAsset; size: number }) {
  const chain = chainById(asset.chainId);
  return (
    <AssetLogo
      src={asset.identity.logoUrl}
      symbol={asset.identity.ticker}
      size={size}
      badgeSrc={chain?.iconUrl ?? null}
      badgeLabel={chain?.chainName ?? asset.chainId}
    />
  );
}

export function AssetPicker({
  assets,
  value,
  onChange,
  currency,
  loading,
  groupByChain,
  detail,
  isDisabled,
  label = "Asset",
  id,
  emptyText = "No token to move here",
  className,
}: AssetPickerProps) {
  const selected = assets.find((asset) => asset.key === value) ?? null;

  if (loading && !selected) {
    return (
      <div className={cn("flex h-[64px] items-center gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-control-line)] px-3.5", className)}>
        <Skeleton circle width={36} />
        <span className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3" width="30%" />
          <Skeleton className="h-2.5" width="55%" />
        </span>
        <Skeleton className="h-3" width={72} />
      </div>
    );
  }

  // Named by what it shows, in that order (speech input users say the
  // visible words), with what a press does after it.
  const trigger = (
    <button
      type="button"
      id={id}
      disabled={assets.length === 0}
      className={cn(
        "group flex h-[64px] w-full min-w-0 items-center gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-control-line)] bg-[var(--d-input-bg)] px-3.5 text-left",
        "transition-[border-color,background-color] duration-[160ms] hover:border-[color-mix(in_srgb,var(--z-fg)_26%,transparent)] hover:bg-[var(--d-glass)]",
        "disabled:cursor-default disabled:opacity-60 data-[state=open]:border-[var(--z-focus-ring)]",
        className,
      )}
    >
      {selected ? (
        <>
          <AssetFace asset={selected} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium leading-tight tracking-[-0.01em] text-fg">{selected.identity.ticker}</span>
            <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-fg-dim">{tokenText(selected.identity, "row")}</span>
          </span>
          <span className="shrink-0 text-right leading-tight">
            <TokenAmount
              amount={selected.liquid}
              decimals={selected.decimals}
              maxFraction={4}
              className="block text-[14px] font-medium tabular-nums text-fg"
            />
            <Money
              value={selected.value}
              currency={currency}
              compact
              reason={selected.unpriced ? "No price for this token" : undefined}
              className="mt-0.5 block text-[12.5px] tabular-nums text-fg-dim"
            />
          </span>
        </>
      ) : (
        <span className="flex-1 text-[14px] text-fg-dim">{assets.length === 0 ? emptyText : "Choose a token"}</span>
      )}
      <Icon name="chevronsUpDown" size={15} className="shrink-0 text-fg-dim transition-colors group-hover:text-fg-muted" />
      <span className="sr-only">{selected ? `. ${label}: change` : `: ${label}`}</span>
    </button>
  );

  return (
    <Combobox<SpendableAsset>
      title={label}
      items={assets}
      getKey={(asset) => asset.key}
      value={value}
      onSelect={onChange}
      isDisabled={isDisabled}
      placeholder="Search by ticker, name or chain"
      emptyText="No token matches"
      width={400}
      maxHeight={380}
      groupBy={groupByChain ? (asset) => chainName(asset.chainId) : undefined}
      filter={(asset, query) => tokenKeywords(asset.identity).some((word) => word.toLowerCase().includes(query))}
      trigger={trigger}
      renderItem={(asset) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <AssetFace asset={asset} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium text-fg">{asset.identity.ticker}</span>
            <span className="block truncate text-[12px] text-fg-dim">{detail?.(asset) ?? tokenText(asset.identity, "row")}</span>
          </span>
          <span className="shrink-0 text-right leading-tight">
            <TokenAmount amount={asset.liquid} decimals={asset.decimals} compact className="block text-[13px] tabular-nums text-fg-muted" />
            <Money value={asset.value} currency={currency} compact className="block text-[12px] tabular-nums text-fg-dim" />
          </span>
        </span>
      )}
    />
  );
}
