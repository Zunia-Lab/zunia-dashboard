"use client";

import { Callout, Card, EmptyState, MissionRow, Skeleton } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { useJsonState } from "@/lib/useJson";

type Mission = { title: string; xp: string; done?: boolean };

export default function MissionsPage() {
  // "No missions" used to render on the first paint and on every failed read
  // alike. useJsonState keeps loading, failed and genuinely empty apart.
  const { data, error, loading } = useJsonState<{ items?: Mission[] }>(
    "/api/missions",
  );
  const items = data?.items ?? [];

  return (
    <DashboardShell
      title="Missions"
      description="Season checklist. The catalog fills in from the backend."
    >
      <Card className={items.length === 0 ? undefined : "p-2"}>
        {loading && items.length === 0 ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-[56px] w-full" />
            <Skeleton className="h-[56px] w-full" />
          </div>
        ) : error && items.length === 0 ? (
          <Callout tone="danger" title="Missions unavailable">
            The mission read failed ({error.message}). This is not the same as
            an empty season.
          </Callout>
        ) : items.length === 0 ? (
          <EmptyState
            title="No missions"
            description="The catalog read succeeded and returned nothing for this season."
          />
        ) : (
          items.map((mission) => <MissionRow key={mission.title} {...mission} />)
        )}
      </Card>
    </DashboardShell>
  );
}
