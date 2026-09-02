"use client";

import { useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@zunialab/ui";
import { findChain, sortChains, type ChainEntry } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";

export function ChainSelect({
  value,
  onValueChange,
  ariaLabel,
}: {
  value: string;
  onValueChange: (chainId: string) => void;
  ariaLabel: string;
}) {
  const { followedOnNetwork, network } = useChainScope();

  const options = useMemo(() => {
    const rows = followedOnNetwork
      .map((chainId) => findChain(chainId))
      .filter((chain): chain is ChainEntry => Boolean(chain));
    return sortChains(rows);
  }, [followedOnNetwork]);

  // If the current value left the followed set, fall back to the first option.
  useEffect(() => {
    if (options.length === 0) return;
    if (!options.some((chain) => chain.chainId === value)) {
      onValueChange(options[0]!.chainId);
    }
  }, [options, value, onValueChange]);

  const selected = findChain(value);

  if (options.length === 0) {
    return (
      <div
        className="rounded-[12px] border border-[var(--z-line)] px-3 py-2.5 text-[13px] text-fg-dim"
        aria-label={ariaLabel}
      >
        No {network} networks followed
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <span className="truncate">
          {selected ? `${selected.chainName} · ${selected.coinDenom}` : value}
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((chain) => (
          <SelectItem key={chain.chainId} value={chain.chainId}>
            {chain.chainName} · {chain.coinDenom}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
