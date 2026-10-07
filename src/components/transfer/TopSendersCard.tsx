"use client";

/**
 * Who sends to you most: deposits from other addresses, counted from the
 * chains' history (moves between your own accounts and refunds are left out
 * upstream, by `splitIncoming`). A saved contact shows by its name.
 */

import { Card, CardHeader, RelativeTime, ShareBar } from "@/components/ui";
import { shortenAddress } from "@/lib/format";
import { ContactAvatar } from "./AddressBookCard";
import type { Sender } from "./logic";
import { chainName } from "./names";

export function TopSendersCard({
  rows,
  contactName,
  subtitle,
  className,
}: {
  rows: Sender[];
  contactName: (address: string) => string | null;
  subtitle: string;
  className?: string;
}) {
  const top = rows[0]?.count ?? 1;
  return (
    <Card className={className}>
      <CardHeader title="Top senders" subtitle={subtitle} />
      <ul className="-mx-2 flex flex-col">
        {rows.map((row) => {
          const saved = contactName(row.address);
          return (
            <li key={row.address} className="flex min-h-[52px] items-center gap-3 rounded-[10px] px-2 py-2">
              <ContactAvatar entry={{ label: saved ?? "", address: row.address, chainId: row.chainId }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-fg" title={row.address}>
                  {saved ?? <span className="font-mono text-[13px]">{shortenAddress(row.address, 10, 6)}</span>}
                </span>
                <span className="block truncate text-[12px] text-fg-dim">
                  {chainName(row.chainId)} · last <RelativeTime at={row.lastAt} />
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[12.5px] font-medium tabular-nums text-fg-muted">
                  {row.count}×<span className="sr-only"> deposits</span>
                </span>
                <ShareBar value={(row.count / top) * 100} width={44} showValue={false} />
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
