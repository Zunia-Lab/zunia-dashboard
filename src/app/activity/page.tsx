"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ActivityRow,
  Callout,
  Card,
  EmptyState,
  Segmented,
  Skeleton,
  inferActivityKind,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { SampleDataBanner } from "@/components/SampleDataBanner";
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

function txHref(tx: ActivityTx) {
  const base = `/activity/${encodeURIComponent(tx.hash)}`;
  return tx.chainId
    ? `${base}?chainId=${encodeURIComponent(tx.chainId)}`
    : base;
}

export default function ActivityPage() {
  const { selectedChain } = useChainScope();
  const { items, loading, error, failedChains, skipped, truncated, sample } =
    useActivity();
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
        <SampleDataBanner show={sample} />

        {/*
          Five uppercase labels cannot wrap and their min-content width is wider
          than a 360px content column, so the control scrolls inside its own box
          instead of pushing a horizontal scrollbar onto the page.
        */}
        <div className="overflow-x-auto pb-1">
          <Segmented<Filter>
            className="min-w-max"
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
        </div>

        {error && items.length > 0 ? (
          <Callout tone="warning" title="Showing the last successful read">
            The history request failed ({error.message}). These rows are cached
            in this browser and may be out of date.
          </Callout>
        ) : null}

        {failedChains.length > 0 ? (
          <Callout tone="warning" title="Some chains did not answer">
            No history was returned for {failedChains.join(", ")}. Transactions
            on {failedChains.length === 1 ? "that chain" : "those chains"} are
            missing from this list, not absent.
          </Callout>
        ) : null}

        {skipped.length > 0 || truncated.length > 0 ? (
          <Callout tone="neutral" title="Not every followed chain was read">
            {skipped.length > 0
              ? `${skipped.join(", ")} could not be derived from this address. `
              : ""}
            {truncated.length > 0
              ? `${truncated.join(", ")} fell past the 12-chain limit for one request. `
              : ""}
            Scope the left rail to a single chain to read it directly.
          </Callout>
        ) : null}

        <Card className="overflow-x-auto p-2">
          {loading && items.length === 0 ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-[56px] w-full" />
              <Skeleton className="h-[56px] w-full" />
              <Skeleton className="h-[56px] w-full" />
            </div>
          ) : error && items.length === 0 ? (
            <EmptyState
              title="History unavailable"
              description={`The activity read failed: ${error.message}. This is not the same as an empty wallet.`}
            />
          ) : txs.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              description={
                items.length === 0
                  ? "The indexer answered with no transactions for this address."
                  : "Nothing matches this filter."
              }
            />
          ) : (
            <div className="flex min-w-[280px] flex-col">
              {txs.map((tx) => (
                <Link
                  key={`${tx.chainId ?? ""}:${tx.hash}`}
                  href={txHref(tx)}
                  className="rounded-[12px] transition-colors hover:bg-[var(--z-state-hover)]"
                >
                  <ActivityRow
                    title={tx.summary}
                    subtitle={`${tx.time} · ${tx.hash.slice(0, 10)}…`}
                    status={tx.success ? "confirmed" : "failed"}
                    kind={resolveKind(tx)}
                  />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </DashboardShell>
  );
}
