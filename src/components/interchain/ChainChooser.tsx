"use client";

/**
 * Pick any chain in the catalog, not only a followed one.
 *
 * `ChainSelect` scopes to followed networks, which is right for Send and wrong
 * here: a swap is asked for precisely because the user holds something on a
 * chain they have not followed, or wants to be paid on one. 332 rows is too
 * many for a `<select>`, so this is a dialog with a labelled search field over
 * the shared `NetworkPickerSheet`.
 *
 * The sheet's own search input is deliberately not used — it is labelled by its
 * placeholder, and a placeholder disappears the moment someone types into it.
 * Filtering happens here and the sheet is handed the filtered rows.
 */

import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  NetworkPickerSheet,
  SearchField,
  TokenLogo,
} from "@zunialab/ui";
import { cn } from "@/lib/cn";
import { findChain, searchChains, sortChains, type ChainEntry } from "@/lib/chains";

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

export function ChainChooser({
  value,
  onValueChange,
  label,
  chains,
  disabled = false,
  disabledReason,
  className,
}: ChainChooserProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const pool = chains ? sortChains([...chains]) : searchChains("");
    if (!search.trim()) return pool.slice(0, 200);
    const needle = search.trim().toLowerCase();
    return pool
      .filter(
        (chain) =>
          chain.chainName.toLowerCase().includes(needle) ||
          chain.chainId.toLowerCase().includes(needle) ||
          chain.coinDenom.toLowerCase().includes(needle),
      )
      .slice(0, 200);
  }, [chains, search]);

  const selected = findChain(value);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span
        className="font-mono text-[length:var(--z-type-micro)] uppercase tracking-[0.14em] text-fg-muted"
        id={`chain-chooser-${label.replace(/\s+/g, "-").toLowerCase()}`}
      >
        {label}
      </span>
      <Button
        variant="secondary"
        className="w-full justify-start gap-2 text-left"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`${label}: ${selected?.chainName ?? (value || "none selected")}. Change`}
        {...(disabled && disabledReason
          ? { title: disabledReason }
          : {})}
      >
        <TokenLogo
          src={selected?.iconUrl}
          symbol={selected?.coinDenom ?? "?"}
          size={20}
        />
        <span className="min-w-0 flex-1 truncate">
          {selected ? selected.chainName : value || "Choose a network"}
        </span>
        <span className="shrink-0 font-mono text-[length:var(--z-type-micro)] text-fg-dim">
          change
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(420px,calc(100%-32px))]">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {rows.length === 200
              ? "Showing the first 200 matches. Refine the search to narrow it."
              : `${rows.length} network${rows.length === 1 ? "" : "s"}.`}
          </DialogDescription>
          <div className="mt-3 flex flex-col gap-3">
            <SearchField
              value={search}
              onValueChange={setSearch}
              placeholder="Search networks"
              aria-label={`Search networks for ${label}`}
            />
            {rows.length === 0 ? (
              <p className="py-6 text-center text-[length:var(--z-type-meta)] text-fg-dim">
                No network matches “{search}”.
              </p>
            ) : (
              <NetworkPickerSheet
                networks={rows.map((chain) => ({
                  chainId: chain.chainId,
                  name: chain.chainName,
                  symbol: chain.coinDenom,
                }))}
                activeChainId={value}
                onSelect={(chainId) => {
                  onValueChange(chainId);
                  setOpen(false);
                  setSearch("");
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
