"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Progress,
  ProposalCard,
  SectionLabel,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";

type Proposal = { id: string; status: string; title: string; yesPct: number };
type Vote = "yes" | "no" | "veto" | "abstain";

const VOTES: { value: Vote; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "veto", label: "Veto" },
  { value: "abstain", label: "Abstain" },
];

export default function GovernancePage() {
  const { account } = useWallet();
  const { scopedChainIds, selectedChain } = useChainScope();
  const [items, setItems] = useState<Proposal[]>([]);
  const [open, setOpen] = useState<Proposal | null>(null);
  const [vote, setVote] = useState<Vote>("yes");

  useEffect(() => {
    const params = new URLSearchParams();
    if (scopedChainIds.length > 0) {
      params.set("chains", scopedChainIds.join(","));
    }
    const query = params.toString();
    void fetch(`/api/governance${query ? `?${query}` : ""}`)
      .then((r) => r.json())
      .then((j: { items?: Proposal[] }) => setItems(j.items ?? []))
      .catch(() => setItems([]));
  }, [scopedChainIds]);

  return (
    <DashboardShell
      title="Governance"
      description={
        selectedChain
          ? `Open proposals on ${selectedChain.chainName}.`
          : "Open proposals on followed chains."
      }
    >
      {items.length === 0 ? (
        <EmptyState
          title="No proposals"
          description="Loaded via /api/governance when the indexer is up."
        />
      ) : (
        <div className="grid gap-2.5">
          {items.map((proposal) => (
            <button
              key={proposal.id}
              type="button"
              onClick={() => {
                setVote("yes");
                setOpen(proposal);
              }}
              className="text-left"
            >
              <ProposalCard {...proposal} />
            </button>
          ))}
        </div>
      )}

      <Dialog open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent>
          {open ? (
            <>
              <DialogTitle>{open.title}</DialogTitle>
              <DialogDescription>
                {open.id} · {open.status}. Signing happens in your wallet.
              </DialogDescription>
              <div className="mt-4">
                <SectionLabel>Yes</SectionLabel>
                <Progress className="mt-2" value={open.yesPct} />
                <div className="mt-1.5 font-mono text-[13px] text-fg-dim">
                  {open.yesPct}% yes so far
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {VOTES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setVote(option.value)}
                    className={
                      vote === option.value
                        ? "rounded-[12px] bg-accent px-4 py-3 text-[14px] font-medium text-accent-fg"
                        : "rounded-[12px] bg-[var(--z-glass)] px-4 py-3 text-[14px] text-fg-muted hover:bg-[var(--z-state-hover)] hover:text-fg"
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" disabled>
                  {account ? `Sign ${vote}` : "Connect a wallet"}
                </Button>
                <Button
                  variant="secondary"
                  className="shadow-none"
                  onClick={() => setOpen(null)}
                >
                  Full text
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
