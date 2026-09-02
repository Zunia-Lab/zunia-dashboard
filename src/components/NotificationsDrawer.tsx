"use client";

import Link from "next/link";
import { Button, Drawer, EmptyState, SectionLabel } from "@zunialab/ui";
import { useNotifications } from "@/lib/useNotifications";
import { cn } from "@/lib/cn";

export function NotificationsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { notes, unreadCount, isRead, markAllRead } = useNotifications();

  return (
    <Drawer open={open} onClose={onClose} className="w-[360px]">
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Notifications</SectionLabel>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim hover:text-fg"
            >
              Mark all read
            </button>
          ) : null}
        </div>

        {notes.length === 0 ? (
          <EmptyState
            title="Inbox empty"
            description="Rewards, failed reads and governance deadlines land here."
          />
        ) : (
          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {notes.map((note) => {
              const body = (
                <>
                  <span className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-[5px] size-[6px] shrink-0 rounded-full",
                        isRead(note.id)
                          ? "bg-[var(--z-line-strong)]"
                          : note.tone === "warning"
                            ? "bg-[var(--z-warning)]"
                            : "bg-[var(--z-info)]",
                      )}
                    />
                    <span className="text-[15px] leading-snug text-fg">
                      {note.title}
                    </span>
                  </span>
                  <span className="mt-1.5 block pl-[14px] font-mono text-[12.5px] leading-relaxed text-fg-dim">
                    {note.meta}
                  </span>
                </>
              );

              const shell = cn(
                "block rounded-[14px] px-4 py-3.5 text-left transition-colors",
                note.tone === "warning"
                  ? "bg-[var(--z-warning-fill)]"
                  : isRead(note.id)
                    ? "bg-[var(--z-glass)]"
                    : "bg-[image:var(--z-hero-soft-gradient)]",
              );

              return (
                <li key={note.id}>
                  {note.href ? (
                    <Link href={note.href} onClick={onClose} className={shell}>
                      {body}
                    </Link>
                  ) : (
                    <div className={shell}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Button asChild variant="secondary" className="w-full">
          <Link href="/notifications" onClick={onClose}>
            Open notifications
          </Link>
        </Button>
      </div>
    </Drawer>
  );
}
