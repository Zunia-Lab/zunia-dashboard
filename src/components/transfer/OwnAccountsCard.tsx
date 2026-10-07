"use client";

/**
 * Your own address on every followed chain, one click from the recipient
 * field (moving funds between your own accounts is the most common transfer
 * there is). Each row says what you hold there.
 *
 * A chain without an address says why: it uses another key type (an
 * Ethereum-style coin type 60 chain cannot be derived from a Cosmos key, and
 * re-encoding the bytes would give an address nobody controls), or the
 * wallet has not shared it yet.
 */

import { useMemo } from "react";
import { Card, CardHeader, ChainLogo, CopyButton, Money } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/format";
import { useWallet } from "@/providers/WalletProvider";
import type { PricedSum } from "./logic";

export interface OwnAccount {
  chain: ChainEntry;
  address: string | null;
  /** Why there is no address. */
  reason: string | null;
}

/** Your address per chain, or why there is none. */
export function useOwnAccounts(chains: readonly ChainEntry[]): OwnAccount[] {
  const { addressFor, skippedChains, primaryChainId, keys } = useWallet();
  return useMemo(() => {
    const primaryCoinType = chains.find((chain) => chain.chainId === primaryChainId)?.coinType ?? 118;
    return chains.map((chain): OwnAccount => {
      const address = addressFor(chain.chainId);
      if (address && address.startsWith(`${chain.bech32Prefix}1`)) return { chain, address, reason: null };
      const skipped = skippedChains.find((entry) => entry.chainId === chain.chainId)?.reason;
      const reason =
        skipped ??
        (chain.coinType !== primaryCoinType && !keys[chain.chainId]
          ? `Uses another key type (coin type ${chain.coinType}); a Cosmos key cannot sign there.`
          : "Your wallet has not shared an address here yet.");
      return { chain, address: null, reason };
    });
  }, [chains, addressFor, skippedChains, primaryChainId, keys]);
}

/**
 * Every address the wallet has shared, on any chain (followed or not): what
 * "one of your own accounts" means when a transfer's other side is checked.
 */
export function useOwnAddressSet(accounts: readonly OwnAccount[]): ReadonlySet<string> {
  const { keys } = useWallet();
  return useMemo(() => {
    const set = new Set<string>();
    for (const row of accounts) if (row.address) set.add(row.address);
    for (const key of Object.values(keys)) if (key?.address) set.add(key.address);
    return set;
  }, [accounts, keys]);
}

export interface OwnAccountsCardProps {
  accounts: OwnAccount[];
  title?: string;
  subtitle?: string;
  onPick?: (account: { chainId: string; address: string }) => void;
  activeAddress?: string;
  /**
   * What can move from each chain the balance read covered, in `currency`
   * (see {@link HeldHere}); null for a chain that did not answer.
   */
  values?: ReadonlyMap<string, PricedSum | null>;
  currency?: string;
  className?: string;
}

/**
 * A row's value: the priced sum of what the account holds there. Unknown is
 * "—" with the reason, never $0.00 (a chain that did not answer, one whose
 * tokens have no price), and a sum that leaves tokens out counts them under
 * it.
 */
function HeldHere({ sum, currency }: { sum: PricedSum | null; currency?: string }) {
  const unpriced = sum?.unpriced ?? 0;
  return (
    <span className="shrink-0 text-right leading-tight">
      <Money
        value={sum?.value ?? null}
        currency={currency}
        compact
        reason={sum === null ? "This network did not answer the balance read" : `${unpriced} ${unpriced === 1 ? "token has" : "tokens have"} no price`}
        className="block text-[12.5px] tabular-nums text-fg-muted"
      />
      {sum === null ? (
        <span className="block text-[11px] text-fg-dim">not read</span>
      ) : unpriced > 0 ? (
        <span className="block text-[11px] text-fg-dim">
          {sum.value === null ? "" : "+"}
          {unpriced} unpriced
        </span>
      ) : null}
    </span>
  );
}

export function OwnAccountsCard({ accounts, title = "Your accounts", subtitle, onPick, activeAddress, values, currency, className }: OwnAccountsCardProps) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} />
      <ul className="-mx-2 flex flex-col">
        {accounts.map(({ chain, address, reason }) => {
          const active = address !== null && address === activeAddress;
          const body = (
            <>
              <ChainLogo chainId={chain.chainId} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-fg">{chain.chainName}</span>
                <span className={cn("block truncate text-[11.5px] text-fg-dim", address && "font-mono")}>
                  {address ? shortenAddress(address, 10, 6) : reason}
                </span>
              </span>
              {/* Only chains the balance read covered: outside the current scope a value is unknown, not "—". */}
              {address && values?.has(chain.chainId) ? <HeldHere sum={values.get(chain.chainId) ?? null} currency={currency} /> : null}
            </>
          );
          return (
            <li key={chain.chainId} className="flex items-center gap-1 rounded-[10px] pr-1 hover:bg-[var(--d-row-hover)]">
              {address && onPick ? (
                // Named by what it shows (speech input says the visible words), then what a press does.
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPick({ chainId: chain.chainId, address })}
                  className={cn("flex min-h-[48px] min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 py-1.5 text-left", active && "bg-[var(--d-row-selected)]")}
                >
                  {body}
                  <span className="sr-only">. Send to your address here</span>
                </button>
              ) : (
                <div className={cn("flex min-h-[48px] min-w-0 flex-1 items-center gap-3 px-2 py-1.5", !address && "opacity-70")}>{body}</div>
              )}
              {address ? <CopyButton value={address} label={`address on ${chain.chainName}`} size="sm" /> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
