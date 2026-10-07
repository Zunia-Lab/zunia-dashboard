"use client";

/**
 * The last eight transactions of the scope, newest first: what happened (in
 * the activity read's own sentence, amounts named by token identity), on
 * which chain, when, and whether it failed. Rows open the transaction page.
 *
 * Shares the Activity page's first-page request (same hook, default page
 * size), so opening Activity afterwards paints at once.
 */

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Button, Card, CardBody, CardHeader, ChainLogo, EmptyState, InlineError, PartialDataBadge, RelativeTime, Skeleton, chainById } from "@/components/ui";
import type { ActivityItem, ActivityKind } from "@/lib/data/activity";
import { maskAmounts } from "@/lib/notifications/text";
import type { UseActivityResult } from "@/lib/useActivity";
import { usePrefs } from "@/providers/PrefsProvider";
import { cn } from "@/lib/cn";

const ROWS = 8;

const KIND_ICON: Readonly<Record<ActivityKind, IconName>> = {
  send: "send",
  receive: "receive",
  "ibc-out": "bridge",
  "ibc-in": "bridge",
  swap: "swap",
  delegate: "staking",
  undelegate: "staking",
  redelegate: "staking",
  claim: "sparkle",
  vote: "governance",
  contract: "apps",
  authz: "shield",
  other: "dots",
};

/** Incoming value is tinted, outgoing and neutral rows stay quiet. */
function tintOf(item: ActivityItem): string {
  if (!item.success) return "bg-[var(--z-danger-fill)] text-[var(--z-danger)]";
  if (item.kind === "receive" || item.kind === "ibc-in" || item.kind === "claim") return "bg-[var(--z-success-fill)] text-[var(--z-success)]";
  return "bg-[var(--d-glass-2)] text-fg-muted";
}

export function RecentActivity({ activity }: { activity: UseActivityResult }) {
  const { hideAmounts } = usePrefs();
  const rows = activity.items.slice(0, ROWS);

  return (
    <Card pending={activity.stale}>
      <CardHeader
        title="Recent activity"
        subtitle={activity.connected ? "Across the chains in scope" : undefined}
        actions={
          <>
            <PartialDataBadge errors={activity.errors.filter((error) => error.scope !== "input")} />
            <Button size="sm" variant="ghost" href="/activity" iconRight="arrowRight">
              All activity
            </Button>
          </>
        }
      />
      <CardBody flush>
        {activity.status === "error" && rows.length === 0 ? (
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">
            <InlineError message={activity.error?.message ?? "The activity read failed."} onRetry={activity.refetch} />
          </div>
        ) : activity.loading ? (
          <ul aria-busy="true" aria-label="Loading activity">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-[var(--d-pad)] py-2.5">
                <Skeleton className="size-8 rounded-[10px]" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/3" />
                </span>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="px-[var(--d-pad)] pb-2">
            <EmptyState
              inline
              icon="activity"
              title="No transactions found"
              body={
                // Public nodes keep a window of history: say which, so an empty
                // list never reads as "never used".
                [...new Set(activity.coverage.map((entry) => entry.note).filter((note): note is string => Boolean(note)))].join(" ") ||
                "Transfers, swaps, staking and votes on the chains in scope show up here."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--d-hairline)]">
            {rows.map((item) => {
              const chain = chainById(item.chainId);
              const summary = hideAmounts && item.kind !== "vote" ? maskAmounts(item.summary, "transfer") : item.summary;
              const at = Date.parse(item.time);
              return (
                <li key={`${item.chainId}:${item.hash}:${item.address}`}>
                  <Link
                    href={`/activity/${encodeURIComponent(item.hash)}?chainId=${encodeURIComponent(item.chainId)}`}
                    className="flex items-center gap-3 px-[var(--d-pad)] py-2.5 transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)] focus-visible:outline-offset-[-2px]"
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px]", tintOf(item))}>
                      <Icon name={KIND_ICON[item.kind]} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* Two lines at every width: in the five-column card one
                          line kept little more than the verb ("Claimed 0.416035
                          TIA in rewards fro…"). */}
                      <span className="line-clamp-2 text-[13.5px] leading-snug text-fg" title={summary}>
                        {summary}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-fg-dim">
                        <ChainLogo chainId={item.chainId} size={14} />
                        <span className="truncate">{chain?.chainName ?? item.chainId}</span>
                        {item.via ? <span className="truncate">· via authz</span> : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <RelativeTime at={Number.isFinite(at) ? at : null} className="text-[12px] tabular-nums text-fg-dim" />
                      {!item.success ? (
                        <Badge tone="danger" size="sm">
                          Failed
                        </Badge>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
