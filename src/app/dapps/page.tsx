"use client";

import { Callout, Card, DappRow, EmptyState, Skeleton } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { useJsonState } from "@/lib/useJson";

type Dapp = { name: string; meta: string; connected?: boolean };
type Payload = { items?: Dapp[] };

export default function DappsPage() {
  // A failed read used to substitute an empty catalogue and render the same
  // "No dApps listed" copy as a successful empty one.
  const { data, error, loading } = useJsonState<Payload>("/api/dapps");
  const items = data?.items ?? [];

  return (
    <DashboardShell
      title="dApps"
      description="Catalog of apps the dashboard can deep-link. Sessions stay in the wallet."
    >
      <Card className={items.length === 0 ? undefined : "p-2"}>
        {loading && items.length === 0 ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-[56px] w-full" />
            <Skeleton className="h-[56px] w-full" />
          </div>
        ) : error && items.length === 0 ? (
          <Callout tone="danger" title="Catalogue unavailable">
            The dApp read failed ({error.message}). Nothing was listed because
            nothing answered, not because the catalogue is empty.
          </Callout>
        ) : items.length === 0 ? (
          <EmptyState
            title="No dApps listed"
            description="/api/dapps answered with an empty catalogue."
          />
        ) : (
          items.map((dapp) => <DappRow key={dapp.name} {...dapp} />)
        )}
      </Card>
    </DashboardShell>
  );
}
