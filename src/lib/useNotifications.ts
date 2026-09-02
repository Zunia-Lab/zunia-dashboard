"use client";

import { useMemo } from "react";
import { useJson } from "@/lib/useJson";
import { formatFiat, usePortfolio } from "@/lib/usePortfolio";
import { useStoredValue } from "@/lib/useStoredValue";

export interface Note {
  id: string;
  title: string;
  meta: string;
  href?: string;
  tone?: "info" | "warning";
}

type FeedPayload = { items?: Array<{ title: string; meta: string }> };

const FEED_STUB: FeedPayload = { items: [] };
const READ_KEY = "zunia.dashboard.readNotifications";

/**
 * Merges the backend feed with alerts derived from what the dashboard can
 * already see, so the inbox is useful before any push service is configured.
 */
export function useNotifications() {
  const feed = useJson<FeedPayload>("/api/notifications", FEED_STUB);
  const { snapshot, connected } = usePortfolio();
  const [read, setRead] = useStoredValue<string[]>(READ_KEY, []);

  const notes = useMemo<Note[]>(() => {
    const items: Note[] = (feed?.items ?? []).map((item) => ({
      id: `feed:${item.title}:${item.meta}`,
      title: item.title,
      meta: item.meta,
    }));

    if (!connected || !snapshot) return items;

    if (snapshot.claimable > 0) {
      items.unshift({
        id: `claimable:${snapshot.claimable.toFixed(2)}`,
        title: `${formatFiat(snapshot.claimable, snapshot.currency ?? "USD")} in staking rewards`,
        meta: `Across ${snapshot.pricedChains} chains · claim from your wallet`,
        href: "/staking",
      });
    }

    for (const holding of snapshot.holdings) {
      if (!holding.error) continue;
      items.push({
        id: `error:${holding.chainId}`,
        title: `${holding.chainName} did not respond`,
        meta: `${holding.error} · balance may be out of date`,
        href: "/networks",
        tone: "warning",
      });
    }

    if (snapshot.unpricedChains > 0) {
      items.push({
        id: `unpriced:${snapshot.unpricedChains}`,
        title: `${snapshot.unpricedChains} chains have no price feed`,
        meta: "Amounts are shown in coins instead of fiat",
        href: "/portfolio",
      });
    }

    return items;
  }, [feed, snapshot, connected]);

  const unread = notes.filter((note) => !read.includes(note.id));

  return {
    notes,
    unreadCount: unread.length,
    isRead: (id: string) => read.includes(id),
    markAllRead: () => setRead(notes.map((note) => note.id)),
  };
}
