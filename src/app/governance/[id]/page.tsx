"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Button,
  Card,
  EmptyState,
  Progress,
  SectionLabel,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { SampleDataBanner } from "@/components/SampleDataBanner";
import { useChainScope } from "@/lib/useChainScope";

type Proposal = {
  id: string;
  status: string;
  title: string;
  yesPct: number;
  summary?: string;
  description?: string;
};

export default function GovernanceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  const { scopedChainIds, selectedChain } = useChainScope();

  // Keyed by the scope and id it was fetched for, so "loading" is derived
  // rather than written from the effect body (react-hooks/set-state-in-effect,
  // which costs a second render pass on every scope change).
  const scopeKey = scopedChainIds.join(",");
  const resultKey = `${scopeKey}|${id}`;
  const [result, setResult] = useState<{
    key: string;
    proposal: Proposal | null;
    sample: boolean;
  } | null>(null);
  const current = result?.key === resultKey ? result : null;
  const loading = current === null;
  const proposal = current?.proposal ?? null;
  const sample = current?.sample ?? false;

  useEffect(() => {
    let cancelled = false;
    const query = scopeKey
      ? `?${new URLSearchParams({ chains: scopeKey }).toString()}`
      : "";
    void fetch(`/api/governance${query}`)
      .then((r) => r.json())
      .then((j: { items?: Proposal[]; stub?: boolean; source?: string }) => {
        if (cancelled) return;
        const items = j.items ?? [];
        setResult({
          key: resultKey,
          proposal: items.find((p) => p.id === id) ?? null,
          sample: j.stub === true || j.source === "stub",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ key: resultKey, proposal: null, sample: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, resultKey, id]);

  const body =
    proposal?.description ??
    proposal?.summary ??
    (proposal
      ? `Full proposal text for ${proposal.id} is not yet returned by the governance API. This page will show the on-chain description once the indexer exposes it.`
      : null);

  return (
    <DashboardShell
      title={proposal?.title ?? "Proposal"}
      description={
        selectedChain
          ? `Governance on ${selectedChain.chainName}`
          : "Proposal detail"
      }
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/governance">Back</Link>
        </Button>
      }
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <SampleDataBanner show={sample} />
        {loading ? (
          <Card className="p-6 text-[14px] text-fg-dim">Loading…</Card>
        ) : !proposal ? (
          <EmptyState
            title="Proposal not found"
            description="No proposal matched this id in the current scope."
            action={
              <Button asChild>
                <Link href="/governance">Governance</Link>
              </Button>
            }
          />
        ) : (
          <Card className="flex flex-col gap-5 p-5 sm:p-6">
            <div>
              <SectionLabel>
                {proposal.id} · {proposal.status}
              </SectionLabel>
              <h2 className="mt-2 text-[22px] font-medium tracking-tight text-fg">
                {proposal.title}
              </h2>
            </div>
            <div>
              <SectionLabel>Yes</SectionLabel>
              <Progress className="mt-2" value={proposal.yesPct} />
              <p className="mt-1.5 font-mono text-[13px] text-fg-dim">
                {proposal.yesPct}% yes so far
              </p>
            </div>
            <div>
              <SectionLabel>Full text</SectionLabel>
              <p className="mt-2 whitespace-pre-wrap text-[14.5px] leading-relaxed text-fg-muted">
                {body}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                className="self-start"
                disabled
                aria-describedby="governance-detail-signing-unavailable"
              >
                Sign vote
              </Button>
              <p
                id="governance-detail-signing-unavailable"
                className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
              >
                Unavailable — the dashboard cannot sign a vote. Cast it from the
                Zunia extension or the mobile app.
              </p>
            </div>
          </Card>
        )}
      </div>
    </DashboardShell>
  );
}
