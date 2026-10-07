"use client";

/**
 * The bell: unread count, and the feed in a popover under it (≥ 768 px) or a
 * bottom sheet (phones). Reads the feed the frame drives (`NoticeDriver`);
 * this component never passes inputs.
 *
 * Rows group into Today / This week / Earlier; All / Unread tabs; opening a
 * row marks it read. Amounts in the text follow privacy mode. The gear opens
 * the preferences, which live in Settings → Notifications.
 */

import Link from "next/link";
import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { NotificationItem, useNoticeClock } from "@/components/notifications/NotificationItem";
import { EmptyState, IconButton, Popover, Sheet, TabPanel, Tabs, useMediaQuery } from "@/components/ui";
import { cn } from "@/lib/cn";
import { groupNotices } from "@/lib/notifications/group";
import { useNoticeFeed } from "@/lib/useNotifications";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { PHONE_FRAME_QUERY } from "./ScopeControl";

type View = "all" | "unread";

const VIEWS: readonly View[] = ["all", "unread"];

export function badgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/**
 * The count on an icon button, ringed off the bar. `alert` (unread
 * notifications): crimson with white figures. `progress` (transfers still
 * moving): the brand amber the kit uses for "info", with page-coloured
 * figures, because something in progress is not something wrong.
 */
export function CountBadge({ count, tone = "alert" }: { count: number; tone?: "alert" | "progress" }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums shadow-[0_0_0_2px_var(--z-bg)]",
        tone === "alert" ? "bg-[image:var(--z-button-gradient)] text-white" : "bg-[var(--z-info)] text-[var(--z-bg)]",
      )}
    >
      {badgeCount(count)}
    </span>
  );
}

function FeedPanel({ onNavigate }: { onNavigate: () => void }) {
  const [view, setView] = useState<View>("all");
  const tabsId = useId();
  const feed = useNoticeFeed();
  const { hideAmounts } = usePrefs();
  const { account } = useWallet();
  const now = useNoticeClock();
  const notices = view === "unread" ? feed.notices.filter((notice) => !feed.isRead(notice.id)) : feed.notices;
  const groups = now > 0 ? groupNotices(notices, now) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* On phones the sheet's own title names the panel. */}
      <div className="flex items-center gap-2 px-4 pt-3 max-md:hidden">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-fg">Notifications</h2>
        {feed.unreadCount > 0 ? (
          <span className="rounded-full bg-[var(--d-accent-soft)] px-1.5 py-px text-[11px] font-semibold tabular-nums text-[var(--d-accent-text)]">
            {feed.unreadCount} new
          </span>
        ) : null}
      </div>
      <div className="flex items-end gap-2 border-b border-[var(--d-hairline)] px-4 max-md:px-0">
        <Tabs<View>
          id={tabsId}
          ariaLabel="Show"
          size="sm"
          value={view}
          onChange={setView}
          className="min-w-0 flex-1 border-b-0"
          items={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread", count: feed.unreadCount > 0 ? badgeCount(feed.unreadCount) : undefined },
          ]}
        />
        <div className="flex shrink-0 items-center gap-0.5 pb-1">
          {feed.unreadCount > 0 ? (
            <button
              type="button"
              onClick={feed.markAllRead}
              className="d-hit h-7 rounded-[7px] px-2 text-[12.5px] font-medium text-fg-muted transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)] hover:text-fg"
            >
              Mark all read
            </button>
          ) : null}
          <IconButton label="Notification settings" icon="settings" size="sm" href="/settings#notifications" onClick={onNavigate} />
        </div>
      </div>
      <div className="d-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2 max-md:px-0">
        {/* One panel per tab, inside the scroll box (no layout of their own):
            each tab's aria-controls names a real element, and the feed is
            exposed as the panel its tab labels. The other is an empty
            `hidden` div. */}
        {VIEWS.map((value) => (
          <TabPanel key={value} tabsId={tabsId} value={value} active={view === value}>
            {!feed.ready ? null : groups.length === 0 ? (
              <EmptyState
                icon={view === "unread" ? "check" : "notifications"}
                title={view === "unread" ? "You're all caught up" : "No notifications yet"}
                body={
                  account
                    ? "Incoming transfers, rewards ready to claim, votes ending and validator alerts appear here."
                    : "Connect a wallet to get notified about transfers, rewards, votes and your validators."
                }
                className="py-8"
              />
            ) : (
              groups.map((group) => (
                <section key={group.key} aria-label={group.label} className="pb-1">
                  <h3 className="d-label px-3 pb-1 pt-2 text-[10.5px]">{group.label}</h3>
                  <ul className="flex flex-col">
                    {group.notices.map((notice) => (
                      <li key={notice.id}>
                        <NotificationItem
                          notice={notice}
                          unread={!feed.isRead(notice.id)}
                          masked={hideAmounts}
                          now={now}
                          onClick={() => {
                            feed.markRead(notice.id);
                            onNavigate();
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </TabPanel>
        ))}
      </div>
      <div className="border-t border-[var(--d-hairline)] p-2 max-md:px-0 max-md:pb-0">
        <Link
          href="/notifications"
          onClick={onNavigate}
          className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium text-fg-muted transition-colors duration-[160ms] hover:bg-[var(--d-glass-2)] hover:text-fg max-md:h-11"
        >
          Open notification center
          <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </div>
  );
}

export function NotificationsMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery(PHONE_FRAME_QUERY);
  const { unreadCount } = useNoticeFeed();
  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  const trigger = (
    <IconButton
      label={label}
      tooltip="Notifications"
      tooltipSide="bottom"
      aria-haspopup="dialog"
      onClick={phone ? () => setOpen(true) : undefined}
      className={cn(open && "bg-[var(--d-glass-2)] text-fg", className)}
    >
      <Icon name="notifications" size={18} />
      <CountBadge count={unreadCount} />
    </IconButton>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen} title="Notifications" side="bottom" bodyClassName="flex flex-col pb-3">
          <FeedPanel onNavigate={() => setOpen(false)} />
        </Sheet>
      </>
    );
  }
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      width={380}
      padded={false}
      align="end"
      sideOffset={10}
      ariaLabel="Notifications"
      className="flex max-h-[min(70vh,var(--radix-popover-content-available-height))] flex-col overflow-hidden"
    >
      <FeedPanel onNavigate={() => setOpen(false)} />
    </Popover>
  );
}
