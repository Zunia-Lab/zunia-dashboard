"use client";

/**
 * The scope line under the page title (and the scope chip on phones), with
 * the picker it opens: a popover from 768 px, a bottom sheet below.
 *
 * The picker lists the followed chains of the MAIN/TEST slice with your value
 * on each and its share of your net worth, most valuable first, so choosing a
 * chain is also a glance at where the money is. The MAIN/TEST switch and
 * "Manage networks" live at the bottom.
 */

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Mark } from "@zunialab/ui";
import { Icon } from "@/components/icons";
import { ChainLogo, Money, Popover, SearchInput, Segmented, ShareBar, Sheet, Skeleton, useMediaQuery } from "@/components/ui";
import { cn } from "@/lib/cn";
import { findChain, type ChainEntry } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";
import { rankMatches } from "./palette-search";
import { useShellData } from "./ShellData";
import { byValue } from "./signals";

export const PHONE_FRAME_QUERY = "(max-width: 767px)";

/** The brand tile standing for "All chains" in lists. */
export function AllChainsMark({ size = 22, active }: { size?: number; active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        active ? "bg-[image:var(--z-accent-gradient)] text-[var(--z-accent-fg)]" : "bg-[var(--d-glass-2)] text-fg-muted",
      )}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <Mark size={Math.round(size * 0.42)} />
    </span>
  );
}

/* ------------------------------------------------------------------ list */

function ScopeRow({
  selected,
  onSelect,
  leading,
  title,
  meta,
  value,
  share,
  currency,
  loading,
  flagged,
}: {
  selected: boolean;
  onSelect: () => void;
  leading: React.ReactNode;
  title: string;
  meta: string;
  value?: number | null;
  share?: number | null;
  currency?: string;
  loading?: boolean;
  flagged?: boolean;
}) {
  return (
    <button
      type="button"
      data-scope-row=""
      aria-pressed={selected}
      onClick={onSelect}
      // The frame's focus ring draws inset (offset −2 px), so the scrolling
      // list never clips it; the glass wash is a second cue, not the only one.
      className={cn(
        "group flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left",
        "transition-colors duration-[160ms] hover:bg-[var(--d-glass)] focus-visible:bg-[var(--d-glass)] focus-visible:outline-offset-[-2px]",
        selected && "bg-[var(--d-row-selected)] hover:bg-[var(--d-row-selected)]",
        "max-md:min-h-12",
      )}
    >
      <span className="relative shrink-0">
        {leading}
        {flagged ? (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-[1.5px] border-[var(--d-pop-bg)] bg-[var(--z-brand-amber)]" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-snug text-fg">{title}</span>
        <span className="block truncate font-mono text-[11px] leading-snug text-fg-dim">{meta}</span>
      </span>
      {value !== undefined ? (
        <span className="flex shrink-0 flex-col items-end gap-1">
          {loading ? (
            <Skeleton height={10} width={56} />
          ) : (
            <Money value={value} currency={currency} compact className="text-[13px] font-medium tabular-nums text-fg" reason="Nothing priced here" />
          )}
          {share !== undefined ? <ShareBar value={share} width={40} showValue={false} /> : null}
        </span>
      ) : null}
      <span className={cn("flex size-4 shrink-0 items-center justify-center", selected ? "text-[var(--d-accent-text)]" : "text-transparent")}>
        <Icon name="check" size={15} strokeWidth={2} />
      </span>
    </button>
  );
}

export function ScopeList({ onDone, autoFocus = false }: { onDone: () => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const { account } = useWallet();
  const { network, setNetwork, selectedChainId, selectChain, followedOnNetwork } = useChainScope();
  const { portfolioData, portfolioPending, positions, attention } = useShellData();
  const currency = portfolioData?.currency;
  const loading = Boolean(account) && portfolioPending;
  const showValues = Boolean(account);

  const chains = followedOnNetwork.map((chainId) => findChain(chainId)).filter((chain): chain is ChainEntry => Boolean(chain));
  const sorted = byValue(chains, positions);
  const shown = rankMatches(query, sorted, (chain) => ({
    label: chain.chainName,
    keywords: [chain.chainId, chain.coinDenom],
  }));
  const pick = (chainId: string | null) => {
    selectChain(chainId);
    onDone();
  };

  // Arrow keys move between rows (Tab still works).
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-scope-row]") ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (at + 1) % rows.length : at <= 0 ? rows.length - 1 : at - 1;
    rows[next]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="px-3 pb-2 pt-3 max-md:px-0 max-md:pt-0">
        <SearchInput
          value={query}
          onChange={setQuery}
          size="sm"
          placeholder="Search followed chains"
          autoFocus={autoFocus}
        />
      </div>
      <div ref={listRef} role="group" aria-labelledby={labelId} className="d-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2 max-md:px-0">
        <span id={labelId} className="sr-only">
          Scope
        </span>
        {!query ? (
          <ScopeRow
            selected={selectedChainId === null}
            onSelect={() => pick(null)}
            leading={<AllChainsMark size={28} active={selectedChainId === null} />}
            title="All chains"
            meta={`${chains.length} ${chains.length === 1 ? "network" : "networks"} · ${network === "testnet" ? "Testnet" : "Mainnet"}`}
            value={showValues ? (portfolioData?.totals.value ?? null) : undefined}
            currency={currency}
            loading={loading}
          />
        ) : null}
        {shown.map((chain) => {
          const position = positions.get(chain.chainId);
          return (
            <ScopeRow
              key={chain.chainId}
              selected={selectedChainId === chain.chainId}
              onSelect={() => pick(chain.chainId)}
              leading={<ChainLogo chainId={chain.chainId} size={28} />}
              title={chain.chainName}
              meta={chain.chainId}
              value={showValues ? (position?.value ?? null) : undefined}
              share={showValues ? (position?.share ?? null) : undefined}
              currency={currency}
              loading={loading}
              flagged={attention.get(chain.chainId)?.attention}
            />
          );
        })}
        {shown.length === 0 ? (
          <p className="px-2.5 py-4 text-center text-[13px] text-fg-dim">
            {chains.length === 0 ? "No followed networks on this side yet." : "No followed chain matches."}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--d-hairline)] px-3 py-2.5 max-md:px-0 max-md:pb-1">
        <Segmented<"mainnet" | "testnet">
          ariaLabel="Network type"
          value={network}
          onChange={(next) => {
            setNetwork(next);
            if (selectedChainId && findChain(selectedChainId)?.network !== next) selectChain(null);
          }}
          options={[
            { value: "mainnet", label: "Mainnet" },
            { value: "testnet", label: "Testnet" },
          ]}
        />
        <Link
          href="/networks"
          onClick={onDone}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] font-medium text-fg-muted transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)] hover:text-fg max-md:h-11 max-md:text-[13.5px]"
        >
          <Icon name="networks" size={15} />
          Manage networks
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ trigger */

export function ScopeControl({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery(PHONE_FRAME_QUERY);
  const { network, selectedChain, followedOnNetwork } = useChainScope();
  const { attention } = useShellData();
  const count = followedOnNetwork.length;
  const flagged = followedOnNetwork.some((chainId) => attention.get(chainId)?.attention);

  // Named by its visible text between two hidden words ("Scope: Osmosis ·
  // osmosis-1, change"), so the spoken name always contains what is shown
  // at each width (WCAG 2.5.3).
  const trigger = (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={phone ? () => setOpen(true) : undefined}
      className={cn(
        "d-hit group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[7px] text-fg-dim transition-colors duration-[160ms] hover:text-fg",
        "max-md:-ml-0.5 max-md:h-[22px] max-md:rounded-full max-md:border max-md:border-[var(--d-hairline-strong)] max-md:bg-[var(--d-glass)] max-md:pl-[3px] max-md:pr-2",
        "md:-ml-1 md:h-6 md:px-1 md:hover:bg-[var(--d-glass)]",
        className,
      )}
    >
      <span className="relative flex shrink-0">
        {selectedChain ? <ChainLogo chainId={selectedChain.chainId} size={15} /> : <AllChainsMark size={15} active />}
        {flagged && !selectedChain ? (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 size-[7px] rounded-full border border-[var(--z-bg)] bg-[var(--z-brand-amber)]" />
        ) : null}
      </span>
      <span className="min-w-0 truncate text-[12px] leading-none md:text-[12.5px]">
        <span className="sr-only">Scope: </span>
        {selectedChain ? (
          <>
            <span className="font-medium text-fg-muted group-hover:text-fg">{selectedChain.chainName}</span>
            <span className="max-sm:hidden"> · {selectedChain.chainId}</span>
          </>
        ) : (
          <>
            <span className="font-medium text-fg-muted group-hover:text-fg">All chains</span>
            <span className="max-sm:hidden">
              {" "}
              · {count} {count === 1 ? "network" : "networks"}
            </span>
          </>
        )}
      </span>
      {/* The warning ink is too light on the amber wash in the light theme
          (4.3:1 under hover); its darker foreground token reads there. */}
      {network === "testnet" ? (
        <span className="shrink-0 rounded-full bg-[var(--z-warning-fill)] px-1.5 py-px font-mono text-[9.5px] uppercase leading-[14px] tracking-[0.06em] text-[var(--z-warning)] light:text-[var(--z-warning-fg)]">
          Test
        </span>
      ) : null}
      <span className="sr-only">, change</span>
      <Icon name="chevronDown" size={12} className="shrink-0 opacity-70" />
    </button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen} title="Scope" description="All chains adds every followed network together; one chain shows only that chain." side="bottom">
          <ScopeList onDone={() => setOpen(false)} />
        </Sheet>
      </>
    );
  }

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} width={360} padded={false} align="start" sideOffset={10} ariaLabel="Scope" className="flex max-h-[min(70vh,var(--radix-popover-content-available-height))] flex-col overflow-hidden">
      <ScopeList onDone={() => setOpen(false)} autoFocus />
    </Popover>
  );
}
