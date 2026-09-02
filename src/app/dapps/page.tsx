"use client";

import { Card, DappRow, EmptyState } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { useJson } from "@/lib/useJson";

type Dapp = { name: string; meta: string; connected?: boolean };
type Payload = { items?: Dapp[] };

const STUB: Payload = { items: [] };

export default function DappsPage() {
  const data = useJson<Payload>("/api/dapps", STUB);
  const items = data?.items ?? [];

  return (
    <DashboardShell
      title="dApps"
      description="Catalog of apps the dashboard can deep-link. Sessions stay in the wallet."
    >
      <Card className={items.length === 0 ? undefined : "p-2"}>
        {items.length === 0 ? (
          <EmptyState
            title="No dApps listed"
            description="The catalog fills in from /api/dapps when the backend is up."
          />
        ) : (
          items.map((dapp) => <DappRow key={dapp.name} {...dapp} />)
        )}
      </Card>
    </DashboardShell>
  );
}
