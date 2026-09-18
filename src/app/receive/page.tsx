"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  QrFrame,
  SectionLabel,
} from "@zunialab/ui";
import { DashboardShell } from "@/components/DashboardShell";
import { QrCode } from "@/components/QrCode";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/providers/WalletProvider";

export default function ReceivePage() {
  const { account } = useWallet();
  const [copied, setCopied] = useState(false);
  const chain = account ? findChain(account.chainId) : undefined;

  async function copy() {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <DashboardShell
      title="Receive"
      description={
        chain
          ? `Address on ${chain.chainName}.`
          : "Share your connected address."
      }
    >
      {!account ? (
        <EmptyState
          title="No wallet connected"
          description="Connect a wallet to see an address to receive on."
          action={
            <Button asChild>
              <Link href="/portfolio">Back to portfolio</Link>
            </Button>
          }
        />
      ) : (
        <div className="mx-auto flex w-full max-w-md flex-col gap-5">
          <Card className="flex flex-col items-center gap-4 p-6 sm:p-7">
            <SectionLabel>
              {chain?.chainName ?? account.chainId}
            </SectionLabel>
            <QrFrame size={180}>
              <QrCode value={account.address} size={180} />
            </QrFrame>
            <p className="w-full select-all break-all rounded-[14px] bg-[var(--z-glass)] px-3.5 py-3 text-center font-mono text-[12.5px] leading-relaxed text-fg">
              {account.address}
            </p>
            <Button className="w-full" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy address"}
            </Button>
          </Card>
          <Callout tone="warning" title="One chain only">
            This address is valid on {chain?.chainName ?? account.chainId} and
            on chains that share its derivation path. Assets sent from a
            different address prefix will not arrive.
          </Callout>
        </div>
      )}
    </DashboardShell>
  );
}
