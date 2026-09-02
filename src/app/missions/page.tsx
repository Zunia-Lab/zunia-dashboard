"use client";

import { useEffect, useState } from "react";
import { Card, EmptyState, MissionRow } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";

type Mission = { title: string; xp: string; done?: boolean };

export default function MissionsPage() {
  const [items, setItems] = useState<Mission[]>([]);

  useEffect(() => {
    void fetch("/api/missions")
      .then((r) => r.json())
      .then((j: { items?: Mission[] }) => setItems(j.items ?? []))
      .catch(() => setItems([]));
  }, []);

  return (
    <DashboardShell
      title="Missions"
      description="Season checklist. The catalog fills in from the backend."
    >
      <Card className={items.length === 0 ? undefined : "p-2"}>
        {items.length === 0 ? (
          <EmptyState
            title="No missions"
            description="Coming soon. The stub API is wired so this page stays ready."
          />
        ) : (
          items.map((mission) => <MissionRow key={mission.title} {...mission} />)
        )}
      </Card>
    </DashboardShell>
  );
}
