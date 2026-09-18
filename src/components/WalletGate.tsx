"use client";

import { ConnectGate } from "@/components/ConnectGate";
import { useWallet } from "@/providers/WalletProvider";

/** Renders the full-screen connect page until a wallet is linked. */
export function WalletGate({ children }: { children: React.ReactNode }) {
  const { account, restoring } = useWallet();
  if (restoring) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--z-bg)] text-[14px] text-fg-dim">
        Restoring wallet…
      </div>
    );
  }
  if (!account) return <ConnectGate />;
  return children;
}
