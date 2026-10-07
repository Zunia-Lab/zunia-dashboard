"use client";

/**
 * Recent transfers, read from the chains (`useActivity`): sends, receipts and
 * IBC transfers in and out, newest first, with the counterparty named from
 * the address book when it is saved there. Each row opens the transaction.
 *
 * The rows are what the activity read has loaded so far; the caption says
 * from when, because a pruned node's history is not a lifetime.
 */

import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  DataTable,
  EmptyState,
  InlineError,
  RelativeTime,
  TokenAmount,
  type Column,
} from "@/components/ui";
import type { ActivityItem } from "@/lib/activity/types";
import { cn } from "@/lib/cn";
import { MINUS, shortenAddress } from "@/lib/format";
import { activityRowKey, isOutgoing, isRefund } from "./logic";
import { chainName as nameOfChain } from "./names";

const chainName = (chainId: string | undefined | null) => nameOfChain(chainId, "another chain");

/**
 * "Sent to Mom", "Received from cosmos1…", "Sent to Osmosis" (IBC), with a
 * `short` title for phone rows ("To Mom", "From cosmos1…"): the arrow and the
 * sign already say the direction, and a long title would be cut mid-address.
 */
function describe(item: ActivityItem, nameFor: (address: string) => string | null): { title: string; short: string; sub: string } {
  const who = item.counterparty ? (nameFor(item.counterparty) ?? shortenAddress(item.counterparty, 8, 4)) : null;
  // A refund's counterparty is the intended receiver, not a sender: never "Received from" them.
  if (isRefund(item)) return { title: "Refund: your transfer came back", short: "Refund", sub: chainName(item.chainId) };
  switch (item.kind) {
    case "send":
      return { title: who ? `Sent to ${who}` : "Sent", short: who ? `To ${who}` : "Sent", sub: chainName(item.chainId) };
    case "receive":
      return { title: who ? `Received from ${who}` : "Received", short: who ? `From ${who}` : "Received", sub: chainName(item.chainId) };
    case "ibc-out": {
      const to = who ?? chainName(item.ibc?.destChainId);
      return { title: `Sent to ${to}`, short: `To ${to}`, sub: `${chainName(item.chainId)} → ${chainName(item.ibc?.destChainId)} · IBC` };
    }
    case "ibc-in": {
      const from = who ?? chainName(item.ibc?.sourceChainId);
      return {
        title: who ? `Received from ${who}` : `Arrived from ${from}`,
        short: `From ${from}`,
        sub: `${chainName(item.ibc?.sourceChainId)} → ${chainName(item.chainId)} · IBC`,
      };
    }
    default:
      return { title: item.summary, short: item.summary, sub: chainName(item.chainId) };
  }
}

function Amount({ item }: { item: ActivityItem }) {
  const out = isOutgoing(item);
  const moved = item.amounts.find((amount) => amount.direction === (out ? "out" : "in")) ?? item.amounts[0];
  if (!moved) return <span className="text-fg-dim">—</span>;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", !item.success ? "text-fg-dim line-through" : out ? "text-fg" : "text-[var(--d-pos)]")}>
      {/* Amounts are positive base units; the direction is the sign. */}
      <span aria-hidden>{out ? MINUS : "+"}</span>
      <span className="sr-only">{out ? "out" : "in"}</span>
      <TokenAmount amount={moved.amount} decimals={moved.identity.decimals} symbol={moved.identity.ticker} maxFraction={4} />
    </span>
  );
}

function DirectionMark({ item }: { item: ActivityItem }) {
  const out = isOutgoing(item);
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full",
        !item.success ? "bg-[var(--z-danger-fill)] text-[var(--z-danger)]" : "bg-[var(--d-glass-2)] text-fg-muted",
      )}
    >
      <Icon name={out ? "arrowUpRight" : "arrowDownRight"} size={15} />
      <span className="absolute -bottom-[2px] -right-[3px] rounded-full shadow-[0_0_0_2px_var(--d-card)]">
        <ChainLogo chainId={item.chainId} size={13} />
      </span>
    </span>
  );
}

export interface RecentTransfersProps {
  items: ActivityItem[];
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
  nameFor?: (address: string) => string | null;
  /** IBC sends whose receipt is loaded too (`pairOwnIbc`): shown as arrived. */
  delivered?: ReadonlySet<string>;
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  empty?: ReactNode;
  className?: string;
}

export function RecentTransfers({
  items,
  loading,
  refreshing,
  error,
  onRetry,
  nameFor = () => null,
  delivered,
  title = "Recent transfers",
  subtitle,
  actions,
  empty,
  className,
}: RecentTransfersProps) {
  const columns: Column<ActivityItem>[] = [
    {
      key: "what",
      header: "Transfer",
      cell: (item) => {
        const text = describe(item, nameFor);
        return (
          <span className="flex min-w-0 items-center gap-3">
            <DirectionMark item={item} />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-medium text-fg">{text.title}</span>
              <span className="block truncate text-[12px] text-fg-dim">{text.sub}</span>
            </span>
          </span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (item) => <Amount item={item} />,
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "md",
      cell: (item) =>
        item.success ? (
          <span className="inline-flex items-center gap-1 text-[12.5px] text-fg-dim">
            <Icon name="check" size={13} className="text-[var(--d-pos)]" />
            {delivered?.has(activityRowKey(item)) ? "Arrived" : item.kind === "ibc-out" ? "Sent" : "Done"}
          </span>
        ) : (
          <Badge tone="danger" size="sm">
            Failed
          </Badge>
        ),
    },
    {
      key: "time",
      header: "When",
      align: "right",
      hideBelow: "sm",
      cell: (item) => <RelativeTime at={Date.parse(item.time)} className="whitespace-nowrap text-[12.5px] text-fg-dim" />,
    },
  ];

  return (
    <Card pending={refreshing} className={className}>
      <CardHeader title={title} subtitle={subtitle} actions={actions} />
      {error && items.length === 0 ? (
        <InlineError message={error} onRetry={onRetry} />
      ) : (
        <CardBody flush>
          <DataTable<ActivityItem>
            ariaLabel={title}
            columns={columns}
            rows={items}
            loading={loading}
            skeletonRows={4}
            getRowKey={(item) => `${item.chainId}:${item.hash}:${item.address}`}
            rowHref={(item) => `/activity/${item.hash}?chainId=${encodeURIComponent(item.chainId)}`}
            stickyHeader={false}
            empty={empty ?? <EmptyState inline icon="activity" title="No transfers yet" body="Sends and IBC transfers show here once the chains report them." />}
            mobileCard={(item) => {
              const text = describe(item, nameFor);
              return (
                <span className="flex min-w-0 items-center gap-3">
                  <DirectionMark item={item} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-fg">{text.short}</span>
                    <span className="block truncate text-[12px] text-fg-dim">
                      <RelativeTime at={Date.parse(item.time)} /> · {text.sub}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[13px]">
                    <Amount item={item} />
                  </span>
                </span>
              );
            }}
          />
        </CardBody>
      )}
    </Card>
  );
}
