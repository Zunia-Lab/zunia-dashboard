"use client";

/**
 * Notifications: the one place their preferences live (product decision,
 * 2026-10-07, as in the extension: the notification centre only lists, and
 * the gear on it and on the bell opens this section). First the way to the
 * centre with what is waiting there, then the channels (in the app, browser
 * alerts, push to this device and its test), what to tell you about, and
 * quiet hours.
 *
 * It works without a wallet: browser alerts, kinds and quiet hours are kept
 * on this browser. Push watches addresses, so without a wallet it says it
 * needs one instead of disappearing (`NotificationSettings` draws that).
 */

import { useMemo } from "react";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";
import { Badge, Button } from "@/components/ui";
import { MAX_PUSH_ACCOUNTS } from "@/lib/data/push";
import { useScopeAccounts } from "@/lib/data/staking";
import { useChainScope } from "@/lib/useChainScope";
import { useNoticeFeed } from "@/lib/useNotifications";
import { SettingRow, SettingsSection } from "./SettingsBlocks";

export function NotificationsSection() {
  const feed = useNoticeFeed();
  const { followedAll } = useChainScope();
  // The same accounts the frame registers for push: the wallet's address on
  // every followed chain, whatever the scope (the server watches at most 32).
  // Empty without a wallet, which push reads as "connect one first".
  const { accounts } = useScopeAccounts(followedAll);
  const pushAccounts = useMemo(() => accounts.slice(0, MAX_PUSH_ACCOUNTS), [accounts]);

  return (
    <SettingsSection id="notifications" title="Notifications" subtitle="What to tell you about, and where" icon="notifications">
      <SettingRow
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
        description="Everything the bell has shown, by day, with filters by kind and network."
        control={
          <Button size="sm" variant="secondary" href="/notifications" iconRight="arrowRight">
            Open
          </Button>
        }
      />
      {/* Its groups carry their own labels (Channels, What to tell you
          about, Quiet hours); the hairline closes the row above, as between
          any two rows of a section. */}
      <NotificationSettings accounts={pushAccounts} className="border-t border-[var(--d-hairline)] pb-1" />
    </SettingsSection>
  );
}
