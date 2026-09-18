"use client";

import Link from "next/link";
import { Button, EmptyState } from "@zunialab/ui";
import { SideSheet } from "@/components/SideSheet";
import { useNotifications } from "@/lib/useNotifications";
import { cn } from "@/lib/cn";

export function NotificationsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { notes, unreadCount, isRead, markAllRead } = useNotifications();
  const close = () => onOpenChange(false);

  return (
    // The panel used to force w-[360px], which covered the whole overlay on a
    // 360px phone and left no close control, so the sheet was a trap. SideSheet
    // keeps the responsive width, adds Escape and a focus trap, and the header
    // below carries an explicit close button.
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Notifications"
      closeLabel="Close notifications"
    >
      {unreadCount > 0 ? (
        <button
          type="button"
          onClick={markAllRead}
          className="self-start font-mono text-[12px] uppercase tracking-[0.12em] text-fg-dim hover:text-fg"
        >
          Mark all read
        </button>
      ) : null}

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
                  <span className="min-w-0 text-[15px] leading-snug text-fg">
                    {note.title}
                  </span>
                </span>
                <span className="mt-1.5 block break-words pl-[14px] font-mono text-[12.5px] leading-relaxed text-fg-dim">
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
                  <Link href={note.href} onClick={close} className={shell}>
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

      <Button asChild variant="secondary" className="mt-auto w-full shrink-0">
        <Link href="/notifications" onClick={close}>
          Open notifications
        </Link>
      </Button>
    </SideSheet>
  );
}
