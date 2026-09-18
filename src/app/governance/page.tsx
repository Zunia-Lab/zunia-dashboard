"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Progress,
  ProposalCard,
  SectionLabel,
  Skeleton,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { SampleDataBanner } from "@/components/SampleDataBanner";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";
import { msgVote } from "@/lib/tx/amino-tx";
import { signAminoAndBroadcast } from "@/lib/tx/sign-broadcast";
import { resolveSignAmino } from "@/lib/tx/resolve-sign";

type Proposal = {
  id: string;
  status: string;
  title: string;
  yesPct: number;
  chainId?: string;
};
type Vote = "yes" | "no" | "veto" | "abstain";

const VOTES: { value: Vote; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "veto", label: "Veto" },
  { value: "abstain", label: "Abstain" },
];

export default function GovernancePage() {
  const { scopedChainIds, selectedChain } = useChainScope();
  const { account, session } = useWallet();
  const [open, setOpen] = useState<Proposal | null>(null);
  const [vote, setVote] = useState<Vote>("yes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const scopeKey = scopedChainIds.join(",");
  const [result, setResult] = useState<{
    key: string;
    items: Proposal[];
    sample: boolean;
    error?: string;
  } | null>(null);
  const current = result?.key === scopeKey ? result : null;
  const loading = current === null;
  const items = current?.items ?? [];
  const sample = current?.sample ?? false;

  useEffect(() => {
    let cancelled = false;
    const query = scopeKey
      ? `?${new URLSearchParams({ chains: scopeKey }).toString()}`
      : "";
    void fetch(`/api/governance${query}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as {
          items?: Proposal[];
          stub?: boolean;
          source?: string;
        };
      })
      .then((j) => {
        if (cancelled) return;
        setResult({
          key: scopeKey,
          items: j.items ?? [],
          sample: j.stub === true || j.source === "stub",
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          key: scopeKey,
          items: [],
          sample: false,
          error: err instanceof Error ? err.message : "Request failed",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  async function signVote() {
    if (!open || !account) return;
    const chainId =
      open.chainId ?? selectedChain?.chainId ?? account.chainId;
    setBusy(true);
    setError(null);
    try {
      const signAmino = await resolveSignAmino({ account, session });
      const resultTx = await signAminoAndBroadcast({
        chainId,
        signer: account.address,
        msgs: [
          msgVote({
            proposalId: open.id,
            voter: account.address,
            option: vote,
          }),
        ],
        gasLimit: 200_000,
        signAmino,
      });
      setTxHash(resultTx.txhash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardShell
      title="Governance"
      description={
        selectedChain
          ? `Open proposals on ${selectedChain.chainName}.`
          : "Open proposals on followed chains."
      }
    >
      <div className="flex flex-col gap-4">
        <SampleDataBanner show={sample} />

        {loading ? (
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-[92px] w-full" />
            <Skeleton className="h-[92px] w-full" />
            <Skeleton className="h-[92px] w-full" />
          </div>
        ) : current.error ? (
          <Callout tone="danger" title="Proposals unavailable">
            The governance read failed ({current.error}). This is not the same
            as no open proposals.
          </Callout>
        ) : items.length === 0 ? (
          <EmptyState
            title="No open proposals"
            description="The governance read succeeded and returned nothing for the followed chains."
          />
        ) : (
          <div className="grid gap-2.5">
            {items.map((proposal) => (
              <button
                key={`${proposal.chainId ?? ""}:${proposal.id}`}
                type="button"
                onClick={() => {
                  setVote("yes");
                  setError(null);
                  setTxHash(null);
                  setOpen(proposal);
                }}
                className="text-left"
              >
                <ProposalCard {...proposal} />
              </button>
            ))}
          </div>
        )}
      </div>

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
              {error ? (
                <Callout tone="danger" title="Could not vote" className="mt-3">
                  {error}
                </Callout>
              ) : null}
              {txHash ? (
                <Callout tone="info" title="Vote broadcast" className="mt-3">
                  {txHash}
                </Callout>
              ) : null}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  className="flex-1"
                  disabled={!account || busy}
                  onClick={() => void signVote()}
                >
                  {busy
                    ? "Signing…"
                    : account
                      ? `Sign ${vote}`
                      : "Connect a wallet"}
                </Button>
                <Button asChild variant="secondary" className="shadow-none">
                  <Link
                    href={`/governance/${encodeURIComponent(open.id)}`}
                    onClick={() => setOpen(null)}
                  >
                    Full text
                  </Link>
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
