"use client";

/**
 * Drives the notification feed. Mounted once, by the app frame.
 *
 * `useNoticeFeed(inputs)` must have exactly one caller with inputs (the feed
 * remembers per account what it already saw and announced); every other
 * surface (the bell, the notification centre) reads it without. The inputs
 * are the frame's own reads of every followed chain, mapped by
 * `noticeInputs` (which also holds back answers that belong to another
 * wallet or chain set).
 *
 * New notices are announced by the feed itself: an OS notification while the
 * tab is hidden, and here, while the user is looking, an in-app toast. Push
 * registration follows the connected wallet's followed accounts
 * (`usePushSync`; a registration that did not change is never re-sent).
 */

import { useCallback } from "react";
import { toast } from "@/components/ui";
import { useScopeAccounts } from "@/lib/data/staking";
import { maskAmounts } from "@/lib/notifications/text";
import type { Notice } from "@/lib/notifications/types";
import { safeNoticeUrl } from "@/lib/notifications/url";
import { useChainScope } from "@/lib/useChainScope";
import { useNoticeAnnouncements, useNoticeFeed, usePushSync } from "@/lib/useNotifications";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { noticeInputs } from "./notice-inputs";
import { useShellData } from "./ShellData";

export function NoticeDriver() {
  const { account } = useWallet();
  const { hideAmounts } = usePrefs();
  const { followedAll } = useChainScope();
  const { staking, proposals, activity } = useShellData();

  useNoticeFeed(
    noticeInputs({
      account: account?.address ?? null,
      staking: { data: staking.data, stale: staking.stale },
      proposals: { data: proposals.data, stale: proposals.stale },
      // `items` is [] until the first page lands: only a ready read is news.
      activity: { data: activity.status === "ready" ? activity.items : null, stale: activity.stale },
    }),
  );

  const announce = useCallback(
    (notices: readonly Notice[]) => {
      for (const notice of notices) {
        const title = hideAmounts ? maskAmounts(notice.title, notice.kind, notice.data?.amount) : notice.title;
        const body = hideAmounts ? maskAmounts(notice.body, notice.kind, notice.data?.amount) : notice.body;
        const options = {
          id: `notice:${notice.id}`,
          description: body,
          ...(notice.url ? { action: { label: "View", href: safeNoticeUrl(notice.url, window.location.origin) } } : {}),
        };
        if (notice.severity === "success") toast.success(title, options);
        else if (notice.severity === "danger") toast.error(title, options);
        else toast.info(title, options);
      }
    },
    [hideAmounts],
  );
  useNoticeAnnouncements(announce);

  const { accounts } = useScopeAccounts(followedAll);
  usePushSync(account ? accounts : null);

  return null;
}
