"use client";

import { ConnectGate } from "@/components/ConnectGate";
import { useWallet } from "@/providers/WalletProvider";

/** Renders the full-screen connect page until a wallet is linked. */
export function WalletGate({ children }: { children: React.ReactNode }) {
  const { account } = useWallet();
  if (!account) return <ConnectGate />;
  return children;
}
