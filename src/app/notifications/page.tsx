"use client";

import Link from "next/link";
import { Button, Card, EmptyState, NotificationRow } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { PushSubscribe } from "@/components/PushSubscribe";
import { IosInstallPrompt } from "@/components/IosInstallPrompt";
import { useNotifications } from "@/lib/useNotifications";

export default function NotificationsPage() {
  const { notes, unreadCount, isRead, markAllRead } = useNotifications();

  return (
    <DashboardShell
      title="Notifications"
      description="Rewards, failed reads and governance deadlines."
      actions={
        unreadCount > 0 ? (
          <Button variant="ghost" onClick={markAllRead}>
            Mark all read
          </Button>
        ) : null
      }
    >
      <IosInstallPrompt />
      <div className="mb-6">
        <PushSubscribe />
      </div>
      {notes.length === 0 ? (
        <EmptyState
          title="Inbox empty"
          description="Staking rewards, failed chain reads and governance deadlines show up here."
        />
      ) : (
        <Card className="p-2">
          {notes.map((note) =>
            note.href ? (
              <Link key={note.id} href={note.href} className="block">
                <NotificationRow
                  title={note.title}
                  meta={note.meta}
                  unread={!isRead(note.id)}
                />
              </Link>
            ) : (
              <NotificationRow
                key={note.id}
                title={note.title}
                meta={note.meta}
                unread={!isRead(note.id)}
              />
            ),
          )}
        </Card>
      )}
    </DashboardShell>
  );
}
