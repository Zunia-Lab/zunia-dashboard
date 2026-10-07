"use client";

/**
 * One notification row: tone icon, title, one or two lines of body, chain,
 * relative time, unread dot. Functional and token-styled; the popover and the
 * notification centre lay rows out (spec §2 "Popovers").
 *
 * Meaning never rides on colour alone: warnings and dangers get their own
 * glyph and a screen-reader label, the unread dot has text, and the time is a
 * real `<time>`. In privacy mode amounts are replaced with dots
 * (`maskAmounts`: the notice's exact `data.amount`, then any free-standing
 * number in a transfer, IBC, swap or unbonding text, since a body written by
 * the activity read may format the amount its own way). The v1 bell leaked
 * amounts with "hide amounts" on.
 */

import Link from "next/link";
import { useSyncExternalStore, type MouseEvent } from "react";
import { Avatar } from "@zunialab/ui";
import { Icon, type IconName } from "@/components/icons";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { maskAmounts } from "@/lib/notifications/text";
import { safeNoticeUrl } from "@/lib/notifications/url";
import type { Notice, NoticeKind, NoticeSeverity } from "@/lib/notifications/types";

export interface NotificationItemProps {
  notice: Notice;
  unread: boolean;
  /** Called on activation (navigate happens through the link); mark it read here. */
  onClick?: (notice: Notice) => void;
  /** Privacy mode: the amount in the text is shown as dots. */
  masked?: boolean;
  /** Clock for the relative time; defaults to a shared clock that ticks every 30 s. */
  now?: number;
  className?: string;
}

const KIND_ICON: Record<NoticeKind, IconName> = {
  transfer: "receive",
  ibc: "bridge",
  swap: "swap",
  rewards: "staking",
  unbonding: "clock",
  governance: "governance",
  validator: "validators",
  system: "info",
};

const TONE: Record<NoticeSeverity, { icon?: IconName; className: string; label: string | null }> = {
  info: { className: "bg-[var(--z-glass)] text-fg-muted", label: null },
  success: { className: "bg-[var(--z-success-fill)] text-[var(--z-success)]", label: null },
  warning: { icon: "warning", className: "bg-[var(--z-warning-fill)] text-[var(--z-warning)]", label: "Needs attention" },
  danger: { icon: "danger", className: "bg-[var(--z-danger-fill)] text-[var(--z-danger)]", label: "Important" },
};

/*
 * A shared half-minute clock for relative times: rendering must not read the
 * time itself (renders are pure), and one ticking value keeps every row of a
 * list in agreement.
 */
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, 30_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function readClock(): number {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/** Epoch ms, refreshed every 30 s while a component uses it (0 on the server). */
export function useNoticeClock(): number {
  return useSyncExternalStore(subscribeClock, readClock, () => 0);
}

/** Latest instant a `Date` can hold (±8.64e15 ms); past it `toISOString` throws. */
const MAX_DATE_MS = 8.64e15;

/** `at` when a `Date` can represent it, else 0 (rendered as a plain date, never a crash). */
function safeTime(at: number): number {
  return Number.isFinite(at) && Math.abs(at) <= MAX_DATE_MS ? at : 0;
}

/** "now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a date. */
export function noticeTimeText(at: number, now: number): string {
  const diff = now - at;
  if (!Number.isFinite(diff) || diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(days > 300 ? { year: "numeric" } : {}),
  });
}

/**
 * Where the row links: the same rule as the service worker's (`safeNoticeUrl`),
 * resolved against a placeholder origin so only app paths pass — `/\host`
 * would otherwise reach the browser, which reads it as `//host`.
 */
function appPath(url: string | undefined): string | null {
  return url ? safeNoticeUrl(url, "https://app.invalid") : null;
}

export function NotificationItem({ notice, unread, onClick, masked = false, now, className }: NotificationItemProps) {
  const clock = useNoticeClock();
  const tone = TONE[notice.severity];
  const icon = tone.icon ?? KIND_ICON[notice.kind];
  const chain = notice.chainId ? findChain(notice.chainId) : undefined;
  const title = masked ? maskAmounts(notice.title, notice.kind, notice.data?.amount) : notice.title;
  const body = masked ? maskAmounts(notice.body, notice.kind, notice.data?.amount) : notice.body;
  const at = safeTime(notice.at);
  const href = appPath(notice.url);

  const content = (
    <>
      <span
        className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", tone.className)}
        aria-hidden
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[14px] leading-snug",
              unread ? "font-medium text-fg" : "text-fg-muted",
            )}
          >
            {tone.label ? <span className="sr-only">{tone.label}: </span> : null}
            {title}
          </span>
          {unread ? (
            <span className="mt-[7px] size-2 shrink-0 rounded-full bg-[var(--z-accent)]">
              <span className="sr-only">Unread</span>
            </span>
          ) : null}
        </span>
        {body ? (
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-fg-dim">{body}</span>
        ) : null}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-fg-dim">
          {chain ? (
            <>
              <Avatar src={chain.iconUrl} fallback={chain.chainName} size={14} />
              <span className="truncate">{chain.chainName}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <time dateTime={new Date(at).toISOString()} className="shrink-0">
            {noticeTimeText(at, now ?? clock)}
          </time>
        </span>
      </span>
    </>
  );

  const shell = cn(
    "flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors duration-150",
    "hover:bg-[var(--z-state-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--z-focus-ring)]",
    className,
  );
  const activate = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    onClick?.(notice);
  };

  if (href) {
    return (
      <Link href={href} onClick={activate} className={shell}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={activate} className={shell}>
        {content}
      </button>
    );
  }
  return <div className={shell}>{content}</div>;
}
