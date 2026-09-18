"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Button, Card, TxDetail } from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { SampleDataBanner } from "@/components/SampleDataBanner";
import { findChain } from "@/lib/chains";
import { useActivity } from "@/lib/useActivity";

function ActivityDetailBody() {
  const params = useParams<{ hash: string }>();
  const search = useSearchParams();
  const hash = decodeURIComponent(params.hash ?? "");
  const chainId = search.get("chainId");
  const { items, loading } = useActivity();

  const tx = useMemo(
    () => items.find((row) => row.hash === hash),
    [items, hash],
  );

  const chain = findChain(chainId ?? tx?.chainId ?? "");
  const status = tx
    ? tx.success
      ? "success"
      : "failed"
    : ("pending" as const);

  const messages = tx
    ? [{ type: tx.kind ?? "Msg", summary: tx.summary }]
    : [
        {
          type: "Msg",
          summary:
            "Message decode is unavailable. Showing hash only until the indexer returns decoded events.",
        },
      ];

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <SampleDataBanner
        show={!tx && !loading}
        reason="No indexed row matched this hash. Details below use a placeholder message decode."
      />
      <Card className="p-5 sm:p-6">
        <TxDetail
          hash={hash}
          status={status}
          chainLabel={chain?.chainName}
          messages={messages}
          fees={tx ? undefined : [{ label: "Fee", value: "—" }]}
        />
      </Card>
    </div>
  );
}

export default function ActivityDetailPage() {
  return (
    <DashboardShell
      title="Transaction"
      description="Activity detail"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/activity">Back</Link>
        </Button>
      }
    >
      <Suspense fallback={<Card className="p-6 text-[14px] text-fg-dim">Loading…</Card>}>
        <ActivityDetailBody />
      </Suspense>
    </DashboardShell>
  );
}
