"use client";

import { useMemo, useState } from "react";
import {
  ActivityRow,
  Card,
  EmptyState,
  Segmented,
  inferActivityKind,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { useActivity, type ActivityTx } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";

type Filter = "all" | "transfers" | "staking" | "swaps" | "failed";

function resolveKind(tx: ActivityTx) {
  return tx.kind ?? inferActivityKind(tx.summary);
}

function matches(tx: ActivityTx, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "failed") return !tx.success;
  const kind = resolveKind(tx);
  if (filter === "transfers") {
    return kind === "sent" || kind === "received" || kind === "ibc";
  }
  if (filter === "staking") {
    return kind === "staking" || kind === "claim" || kind === "governance";
  }
  if (filter === "swaps") return kind === "swap";
  return true;
}

export default function ActivityPage() {
  const { selectedChain } = useChainScope();
  const { items, stub } = useActivity();
  const [filter, setFilter] = useState<Filter>("all");
  const txs = useMemo(
    () => items.filter((tx) => matches(tx, filter)),
    [items, filter],
  );

  return (
    <DashboardShell
      title="Activity"
      description={
        selectedChain
          ? `History on ${selectedChain.chainName}.`
          : "Transfers, staking and swaps across followed networks."
      }
    >
      <div className="flex flex-col gap-4">
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "transfers", label: "Transfers" },
              { value: "staking", label: "Staking" },
              { value: "swaps", label: "Swaps" },
              { value: "failed", label: "Failed" },
            ]}
          />
          <Card className="p-2">
            {txs.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                description={
                  stub
                    ? "Indexer unreachable or empty."
                    : "Nothing matches this filter."
                }
              />
            ) : (
              <div className="flex flex-col">
                {txs.map((tx) => (
                  <ActivityRow
                    key={tx.hash}
                    title={tx.summary}
                    subtitle={`${tx.time} · ${tx.hash.slice(0, 10)}…`}
                    status={tx.success ? "confirmed" : "failed"}
                    kind={resolveKind(tx)}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
    </DashboardShell>
  );
}
