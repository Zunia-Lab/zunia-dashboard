"use client";

/**
 * The Bridge page's side column:
 *
 * - `InFlightCard`: transfers signed from this browser, followed until they
 *   land (the pending store, so a reload or another page loses nothing);
 * - `RouteSuggestionsCard`: routes worth one click, from what you hold and
 *   what you did (`suggestRoutes`);
 * - `DeliveryTimesCard`: how long your own transfers took per route, sent to
 *   received, measured on the chains (both ends in your history);
 * - `ChainSpreadCard`: liquid value per followed chain, what a transfer can
 *   move.
 */

import { BarList, type BarListItem } from "@/components/charts";
import { Icon } from "@/components/icons";
import { AssetLogo, Badge, Button, Card, CardHeader, ChainLogo, EmptyState, InlineError, Money, RelativeTime, Skeleton, chainById } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import { isSettled, pendingTransfers, type PendingTransfer } from "@/lib/pending-transfers";
import type { RouteSuggestion, RouteTiming, RouteTimingRow } from "./logic";
import { chainName } from "./names";
import { PendingTransferRow } from "./TransferTracker";

export function InFlightCard({ pending, className }: { pending: readonly PendingTransfer[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader
        title="In flight"
        subtitle="Signed from this browser, followed until they land"
        actions={
          pending.some((row) => isSettled(row.status)) ? (
            <Button size="sm" variant="ghost" onClick={() => pendingTransfers.clearSettled(pending.map((row) => row.id))}>
              Clear finished
            </Button>
          ) : null
        }
      />
      {pending.length === 0 ? (
        <EmptyState inline icon="pulse" title="Nothing moving" body="Transfers you sign show here with live progress for 24 hours, and in Live." />
      ) : (
        <ul className="-my-1 flex flex-col divide-y divide-[var(--d-hairline)]">
          {pending.map((row) => (
            <li key={row.id}>
              {/* The frame's watcher (mounted with the Live menu on every page) polls what is in flight; the row draws the store. */}
              <PendingTransferRow transfer={row} poll={false} onRemove={() => pendingTransfers.remove(row.id)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const REASON: Record<RouteSuggestion["reason"], { tone: "accent" | "success" | "info"; label: (route: RouteSuggestion) => string }> = {
  used: { tone: "accent", label: (route) => `Used ${route.uses}×` },
  home: { tone: "success", label: () => "Send home" },
  venue: { tone: "info", label: () => "To swap" },
};

export function RouteSuggestionsCard({
  routes,
  loading,
  timingFor,
  currency,
  onPick,
  error,
  onRetry,
  className,
}: {
  routes: RouteSuggestion[];
  loading: boolean;
  /** Your measured delivery time on a route, when the history has one. */
  timingFor: (fromChainId: string, toChainId: string) => RouteTiming | null;
  currency: string;
  onPick: (route: RouteSuggestion) => void;
  /** The balances read failed: suggestions come from balances, so "none" would be a claim nothing backs. */
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title="Routes for your holdings" subtitle="Your usual routes, tokens away from home, the swap venue · tap to fill" />
      {loading ? (
        <div className="flex flex-col gap-3 py-1" aria-hidden>
          {[0, 1].map((index) => (
            <div key={index} className="flex items-center gap-3">
              <Skeleton circle width={30} />
              <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3" width="35%" />
                <Skeleton className="h-2.5" width="60%" />
              </span>
            </div>
          ))}
        </div>
      ) : error && routes.length === 0 ? (
        <InlineError message={error} onRetry={onRetry} />
      ) : routes.length === 0 ? (
        <EmptyState inline icon="bridge" title="No suggestion yet" body="Routes appear once you hold tokens on more than one followed chain or move them." />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {routes.map((route) => {
            const reason = REASON[route.reason];
            const timing = timingFor(route.fromChainId, route.toChainId);
            return (
              <li key={route.id}>
                {/* Named by what it shows (speech input says the visible words), then what a press does. */}
                <button
                  type="button"
                  onClick={() => onPick(route)}
                  className="flex min-h-[56px] w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-[var(--d-row-hover)]"
                >
                  <AssetLogo
                    src={route.asset.identity.logoUrl}
                    symbol={route.asset.identity.ticker}
                    size={30}
                    badgeSrc={chainById(route.fromChainId)?.iconUrl ?? null}
                    badgeLabel={chainName(route.fromChainId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
                      <span className="truncate">{route.asset.identity.ticker}</span>
                      <Badge size="sm" tone={reason.tone}>
                        {reason.label(route)}
                      </Badge>
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-[12px] text-fg-dim">
                      <span className="truncate">{chainName(route.fromChainId)}</span>
                      <Icon name="arrowRight" size={11} className="shrink-0" />
                      <span className="sr-only"> to </span>
                      <span className="truncate">{chainName(route.toChainId)}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right leading-tight">
                    <Money value={route.asset.value} currency={currency} compact reason="Unpriced" className="block text-[13px] tabular-nums text-fg-muted" />
                    <span className="mt-0.5 block text-[11.5px] tabular-nums text-fg-dim">
                      {timing ? `~${formatDuration(timing.median)}` : route.lastUsedAt ? <RelativeTime at={route.lastUsedAt} /> : " "}
                    </span>
                  </span>
                  <span className="sr-only">. Fill the form with this route</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Two chain logos, the second over the first: a route. */
function RouteMark({ from, to }: { from: string; to: string }) {
  return (
    <span className="relative flex shrink-0 items-center" aria-hidden>
      <ChainLogo chainId={from} size={18} />
      <span className="-ml-1.5 rounded-full shadow-[0_0_0_2px_var(--d-card)]">
        <ChainLogo chainId={to} size={18} />
      </span>
    </span>
  );
}

const durationText = (seconds: number) => formatDuration(seconds);

export function DeliveryTimesCard({ rows, since, className }: { rows: RouteTimingRow[]; since: string | null; className?: string }) {
  const items: BarListItem[] = rows.slice(0, 5).map((row) => ({
    id: `${row.fromChainId}>${row.toChainId}`,
    label: `${chainName(row.fromChainId)} → ${chainName(row.toChainId)}`,
    value: row.median,
    icon: <RouteMark from={row.fromChainId} to={row.toChainId} />,
    detail:
      row.count === 1
        ? "1 transfer timed"
        : `${row.count} transfers timed · ${formatDuration(row.fastest)} to ${formatDuration(row.slowest)}`,
  }));
  return (
    <Card className={className}>
      <CardHeader
        title="Delivery time"
        subtitle={`Sent to received, on your own transfers${since ? ` ${since}` : ""}`}
        info="Measured, not estimated: the block time of the receipt on the destination chain minus the block time of the send, for transfers between your own accounts whose two ends are both in your history. Shorter is faster."
      />
      <BarList items={items} valueFormatter={durationText} sort={false} showShare={false} ariaLabel="Typical delivery time by route" />
    </Card>
  );
}

export function ChainSpreadCard({
  items,
  loading,
  refreshing,
  valueFormatter,
  error,
  onRetry,
  className,
}: {
  items: BarListItem[];
  loading: boolean;
  refreshing: boolean;
  valueFormatter: (value: number) => string;
  /** The balances read failed: "nothing priced" would be a claim the read cannot back. */
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card pending={refreshing} className={className}>
      <CardHeader title="Where your tokens are" subtitle="Liquid value by followed chain: what a transfer can move" />
      {loading ? (
        <BarList items={[]} loading ariaLabel="Liquid value by chain" limit={3} />
      ) : error && items.length === 0 ? (
        <InlineError message={error} onRetry={onRetry} />
      ) : items.length === 0 ? (
        <EmptyState inline icon="chains" title="Nothing priced to move" body="Liquid balances show here, valued at current prices." />
      ) : (
        <BarList items={items} valueFormatter={valueFormatter} ariaLabel="Liquid value by chain" limit={6} />
      )}
    </Card>
  );
}
