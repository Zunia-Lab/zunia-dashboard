"use client";

/**
 * The notification centre (design spec §6): the feed the bell shows, as a
 * history by day with filters by type and network.
 *
 * It only lists (product decision, 2026-10-07, as in the extension): what to
 * be told about, browser alerts, push and quiet hours live in Settings →
 * Notifications, which the gear in the centre's header opens. Links from
 * before the move (`/notifications#preferences`: an old tab's bell, a
 * bookmark) are sent on to that section.
 *
 * The feed is the shell's: the frame drives `useNoticeFeed` with its reads,
 * and this page only reads it, marks rows read, dismisses or clears. With one
 * chain in scope the list shows that chain's notices, with a way to see every
 * network without changing the scope of the rest of the dashboard.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IosInstallPrompt } from "@/components/IosInstallPrompt";
import { NotificationItem, useNoticeClock } from "@/components/notifications/NotificationItem";
import { Page } from "@/components/shell/Page";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  ChipGroup,
  Dialog,
  EmptyState,
  IconButton,
  Segmented,
  Skeleton,
} from "@/components/ui";
import { findChain } from "@/lib/chains";
import { NOTICE_FILTERS, filterNotices, type NoticeFilter } from "@/lib/notifications/group";
import { useChainScope } from "@/lib/useChainScope";
import { useNoticeFeed } from "@/lib/useNotifications";
import { usePrefs } from "@/providers/PrefsProvider";
import { filterCounts, groupByDay, noticeChains } from "./feed-view";

type View = "all" | "unread";

/** Where notification preferences live now; the gear and old links go there. */
const SETTINGS_HREF = "/settings#notifications";

export function NotificationsPage() {
  const router = useRouter();
  // Before the move the preferences were a card on this page, and the bell's
  // gear (in a tab opened before the update), bookmarks and shared links
  // still say `#preferences`. Replaced, not pushed, so Back skips this hop.
  // Here rather than in the body: Settings works without a wallet, so the
  // link must land there even when this page would show its connect panel.
  useEffect(() => {
    if (window.location.hash === "#preferences") router.replace(SETTINGS_HREF);
  }, [router]);

  return (
    <Page
      title="Notifications"
      access="wallet"
      connectTitle="Transfers, rewards and votes, as they happen"
      connectDescription="Connect a wallet to follow incoming transfers, rewards ready to claim, votes ending and your validators on every network you follow, here, in browser alerts or as push."
    >
      <NotificationsBody />
    </Page>
  );
}

function NotificationsBody() {
  return (
    <div className="@container flex flex-col gap-[var(--d-gap)]">
      <NotificationCenter />
      <IosInstallPrompt settingsHref={SETTINGS_HREF} />
    </div>
  );
}

function NotificationCenter() {
  const feed = useNoticeFeed();
  const { hideAmounts } = usePrefs();
  const { selectedChain } = useChainScope();
  const now = useNoticeClock();
  const [filter, setFilter] = useState<NoticeFilter>("all");
  const [view, setView] = useState<View>("all");
  const [chainFilter, setChainFilter] = useState<string>("all");
  const [everyNetwork, setEveryNetwork] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // One chain in scope narrows the list to it, unless the reader asked for all.
  const scopedChain = selectedChain && !everyNetwork ? selectedChain.chainId : null;
  const inScope = useMemo(
    () => (scopedChain ? feed.notices.filter((notice) => notice.chainId === scopedChain) : [...feed.notices]),
    [feed.notices, scopedChain],
  );
  const chains = useMemo(() => noticeChains(inScope), [inScope]);
  const chainId = scopedChain ?? (chainFilter !== "all" && chains.some((entry) => entry.chainId === chainFilter) ? chainFilter : null);
  const byChain = useMemo(() => (chainId ? inScope.filter((notice) => notice.chainId === chainId) : inScope), [inScope, chainId]);
  const counts = useMemo(() => filterCounts(byChain), [byChain]);
  const shown = filterNotices(byChain, { filter, unreadOnly: view === "unread", isRead: feed.isRead });
  const groups = now > 0 ? groupByDay(shown, now) : [];
  const unreadHere = byChain.filter((notice) => !feed.isRead(notice.id)).length;
  const empty = feed.ready && feed.notices.length === 0;
  // Actions and filters only once there is something to act on.
  const hasNotices = feed.ready && feed.notices.length > 0;

  return (
    <Card as="section" aria-labelledby="center-title">
      <CardHeader
        id="center-title"
        title={
          <span className="inline-flex items-center gap-2">
            Notification center
            {feed.unreadCount > 0 ? (
              <Badge tone="accent" className="tabular-nums">
                {feed.unreadCount} unread
              </Badge>
            ) : null}
          </span>
        }
        subtitle={
          !feed.ready
            ? "Reading this browser's notifications…"
            : empty
              ? "Kept on this browser, newest first"
              : `${feed.notices.length} ${feed.notices.length === 1 ? "notification" : "notifications"} kept on this browser · newest first`
        }
        icon="notifications"
        actions={
          <>
            {hasNotices ? (
              <>
                <Button size="sm" variant="ghost" iconLeft="check" onClick={feed.markAllRead} disabled={feed.unreadCount === 0}>
                  Mark all read
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                  Clear
                </Button>
              </>
            ) : null}
            {/* Always there, as on the bell: the way to what this list tells you about. */}
            <IconButton label="Notification settings" icon="settings" size="sm" href={SETTINGS_HREF} />
          </>
        }
      />

      {/* Nothing to filter in an empty feed: the empty state says it alone. */}
      {!hasNotices ? null : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <ChipGroup<NoticeFilter>
              type="single"
              ariaLabel="Type"
              value={filter}
              onChange={setFilter}
              scroll
              className="min-w-0 flex-1"
              // A type with nothing in it stays in place (the row does not
              // jump between reads) but cannot be picked into an empty list.
              items={NOTICE_FILTERS.map((entry) => ({
                value: entry.value,
                label: entry.label,
                count: counts[entry.value],
                disabled: counts[entry.value] === 0 && entry.value !== filter,
              }))}
            />
            <Segmented<View>
              ariaLabel="Show"
              value={view}
              onChange={setView}
              className="self-start sm:self-auto"
              options={[
                { value: "all", label: "All" },
                { value: "unread", label: unreadHere > 0 ? `Unread · ${unreadHere}` : "Unread" },
              ]}
            />
          </div>
          {scopedChain ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-dim">
              <ChainLogo chainId={scopedChain} size={14} />
              Showing {selectedChain?.chainName ?? scopedChain} only, the network in scope.
              <button type="button" onClick={() => setEveryNetwork(true)} className="d-hit font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline">
                Show every network
              </button>
            </p>
          ) : chains.length > 1 ? (
            <ChipGroup<string>
              type="single"
              ariaLabel="Network"
              value={chainId ?? "all"}
              onChange={setChainFilter}
              scroll
              items={[
                { value: "all", label: "Every network" },
                ...chains.map((entry) => ({
                  value: entry.chainId,
                  label: findChain(entry.chainId)?.chainName ?? entry.chainId,
                  count: entry.count,
                  leading: <ChainLogo chainId={entry.chainId} size={14} />,
                })),
              ]}
            />
          ) : null}
        </div>
      )}

      <CardBody flush>
        {!feed.ready || now === 0 ? (
          <ul aria-hidden className="flex flex-col border-t border-[var(--d-hairline)] px-[var(--d-pad)] py-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <Skeleton circle width={32} />
                <span className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className="h-3.5" width="58%" />
                  <Skeleton className="h-3" width="82%" />
                </span>
              </li>
            ))}
          </ul>
        ) : groups.length === 0 ? (
          <div className="border-t border-[var(--d-hairline)] px-[var(--d-pad)]">
            <EmptyState
              icon={view === "unread" && byChain.length > 0 ? "check" : "notifications"}
              title={
                feed.notices.length === 0
                  ? "No notifications yet"
                  : view === "unread" && byChain.length > 0
                    ? "You're all caught up"
                    : "Nothing matches these filters"
              }
              body={
                feed.notices.length === 0
                  ? "Incoming transfers, IBC arrivals, rewards ready to claim, votes ending and validator alerts appear here as they happen."
                  : view === "unread" && byChain.length > 0
                    ? "Every notification here has been read."
                    : "Try another type or network."
              }
              action={
                feed.notices.length === 0 ? (
                  // Nothing yet: the next step is choosing what to hear about.
                  <Button size="sm" variant="secondary" iconLeft="settings" href={SETTINGS_HREF}>
                    Notification settings
                  </Button>
                ) : filter !== "all" || chainId !== null || view !== "all" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFilter("all");
                      setChainFilter("all");
                      setView("all");
                    }}
                  >
                    Show all
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="border-t border-[var(--d-hairline)] pb-2">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`day-${group.key}`}>
                <h3 id={`day-${group.key}`} className="d-label sticky top-[var(--d-sticky-top)] z-[1] bg-[var(--d-card)] px-[var(--d-pad)] pb-1.5 pt-3.5">
                  {group.label}
                  <span className="ml-2 tabular-nums text-fg-faint">{group.notices.length}</span>
                </h3>
                <ul className="flex flex-col px-2">
                  {group.notices.map((notice) => (
                    <li key={notice.id} className="group/row flex items-start gap-1">
                      <NotificationItem
                        notice={notice}
                        unread={!feed.isRead(notice.id)}
                        masked={hideAmounts}
                        now={now}
                        onClick={() => feed.markRead(notice.id)}
                        className="min-w-0 flex-1"
                      />
                      <IconButton
                        label={`Dismiss: ${hideAmounts ? "notification" : notice.title}`}
                        icon="close"
                        size="sm"
                        tooltip="Dismiss"
                        onClick={() => feed.dismiss(notice.id)}
                        className="mt-2.5 shrink-0 opacity-100 transition-opacity duration-[160ms] focus-visible:opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardBody>

      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear every notification?"
        description="They are removed from this browser and marked read. Anything new still appears as it happens."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                feed.clear();
                setConfirmClear(false);
              }}
            >
              Clear {feed.notices.length}
            </Button>
          </>
        }
      />
    </Card>
  );
}
