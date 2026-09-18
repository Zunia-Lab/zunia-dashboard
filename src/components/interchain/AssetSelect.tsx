"use client";

/**
 * Choose one of the assets the wallet actually holds on a chain.
 *
 * Rows come from `/api/interchain/balances`, which resolves `ibc/…` denoms
 * through the engine. A voucher whose trace could not be read keeps its raw
 * hash and says why: labelling an unresolved voucher with a guessed symbol is
 * how someone sends the wrong token, and the guess would be invisible.
 */

import {
  Callout,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Skeleton,
} from "@zunialab/ui";
import { formatUnits } from "@/lib/interchain/amounts";
import type { AsyncResource } from "@/lib/interchain/hooks";
import type { BalanceWire } from "@/lib/interchain/wire";
import type { BalancesState } from "@/lib/interchain/hooks";

export function assetLabel(balance: BalanceWire): string {
  if (balance.symbol) {
    return balance.originChainName && balance.isIbc
      ? `${balance.symbol} · from ${balance.originChainName}`
      : balance.symbol;
  }
  // No symbol means the trace did not resolve. Show the hash, shortened, so it
  // is at least recognisable next to a block explorer.
  const denom = balance.denom;
  return denom.length > 22 ? `${denom.slice(0, 12)}…${denom.slice(-6)}` : denom;
}

export function assetAmount(balance: BalanceWire): string {
  // Decimals are only known for an asset the catalog names. Anything else is
  // shown in base units and said to be base units, rather than divided by a
  // guessed exponent.
  return balance.decimals === null
    ? `${balance.amount} base units`
    : formatUnits(balance.amount, balance.decimals, 6);
}

export function AssetSelect({
  balances,
  value,
  onValueChange,
  label,
  emptyMessage,
}: {
  readonly balances: AsyncResource<BalancesState>;
  readonly value: string;
  readonly onValueChange: (denom: string) => void;
  readonly label: string;
  readonly emptyMessage: string;
}) {
  if (balances.status === "idle") {
    return (
      <p className="font-mono text-[length:var(--z-type-meta)] text-fg-dim">
        Connect a wallet to list what you hold.
      </p>
    );
  }

  if (balances.loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Reading balances</span>
        <Skeleton className="h-11 w-full rounded-[12px]" />
      </div>
    );
  }

  if (balances.status === "error") {
    return (
      <Callout tone="danger" title="Could not read balances">
        {balances.error?.message ??
          "The chain did not answer, so there is nothing to choose from."}{" "}
        <button
          type="button"
          onClick={balances.reload}
          className="underline underline-offset-2"
        >
          Try again
        </button>
      </Callout>
    );
  }

  const rows = balances.data?.balances ?? [];
  if (rows.length === 0) {
    return (
      <Callout tone="neutral" title="Nothing to swap">
        {emptyMessage}
      </Callout>
    );
  }

  const selected = rows.find((row) => row.denom === value);

  return (
    <div className="flex flex-col gap-2">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <span className="min-w-0 truncate">
            {selected
              ? `${assetLabel(selected)} — ${assetAmount(selected)}`
              : "Choose an asset"}
          </span>
        </SelectTrigger>
        <SelectContent>
          {rows.map((row) => (
            <SelectItem key={row.denom} value={row.denom}>
              {assetLabel(row)} — {assetAmount(row)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected?.traceError ? (
        <p className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-[var(--z-warning)]">
          {selected.traceError} This build cannot name the token, so it is shown
          by its denom hash.
        </p>
      ) : null}
      {balances.data?.notes.map((note) => (
        <p
          key={note}
          className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
        >
          {note}
        </p>
      ))}
    </div>
  );
}
