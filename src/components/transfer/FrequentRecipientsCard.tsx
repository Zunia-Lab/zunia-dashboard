"use client";

/**
 * Who you send to most, counted from the chains' history (successful sends
 * and IBC transfers you signed), not from this browser's counters: the list
 * is the same on any device. One tap fills the recipient. A saved contact
 * shows by its name, one of your own accounts by its chain.
 */

import { Card, CardHeader, ChainLogo, EmptyState, RelativeTime, ShareBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { shortenAddress } from "@/lib/format";
import { ContactAvatar } from "./AddressBookCard";
import type { FrequentRecipient } from "./logic";
import { chainName } from "./names";

export function FrequentRecipientsCard({
  rows,
  contactName,
  isOwn,
  activeAddress,
  onPick,
  since,
  className,
}: {
  rows: FrequentRecipient[];
  contactName: (address: string) => string | null;
  isOwn: (address: string) => boolean;
  activeAddress?: string;
  onPick: (address: string, chainId: string) => void;
  /** "since Sep 22": how far back the history reaches. */
  since: string | null;
  className?: string;
}) {
  const top = rows[0]?.count ?? 1;
  return (
    <Card className={className}>
      <CardHeader title="Most sent to" subtitle={since ? `From your history ${since} · tap to fill` : "From your history · tap to fill"} />
      {rows.length === 0 ? (
        <EmptyState inline icon="send" title="No sends in the loaded history" body="Recipients you use often show up here." />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((row) => {
            const saved = contactName(row.address);
            const own = isOwn(row.address);
            return (
              <li key={`${row.toChainId}|${row.address}`}>
                <button
                  type="button"
                  onClick={() => onPick(row.address, row.toChainId)}
                  aria-pressed={row.address === activeAddress}
                  className={cn(
                    "flex min-h-[52px] w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-[var(--d-row-hover)]",
                    row.address === activeAddress && "bg-[var(--d-row-selected)]",
                  )}
                >
                  {own ? (
                    <ChainLogo chainId={row.toChainId} size={32} />
                  ) : (
                    <ContactAvatar entry={{ label: saved ?? "", address: row.address, chainId: row.toChainId }} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-fg">
                      {saved ?? (own ? `You on ${chainName(row.toChainId)}` : shortenAddress(row.address, 10, 6))}
                    </span>
                    <span className="block truncate text-[12px] text-fg-dim">
                      {chainName(row.toChainId)} · last <RelativeTime at={row.lastAt} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[12.5px] font-medium tabular-nums text-fg-muted">{row.count}×</span>
                    <ShareBar value={(row.count / top) * 100} width={44} showValue={false} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
