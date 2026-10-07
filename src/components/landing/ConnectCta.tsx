"use client";

/**
 * The page's primary action outside the hero: "Connect wallet" (shared
 * connect modal), or "Open dashboard" once a wallet is linked.
 */

import { Button } from "@/components/ui";
import { useWallet } from "@/providers/WalletProvider";
import { useOpenConnect } from "./useOpenConnect";

export function ConnectCta({ className }: { className?: string }) {
  const { account } = useWallet();
  const openConnect = useOpenConnect();
  return account ? (
    <Button variant="primary" size="lg" href="/overview" iconRight="arrowRight" className={className}>
      Open dashboard
    </Button>
  ) : (
    <Button variant="primary" size="lg" iconLeft="wallet" className={className} onClick={() => openConnect()}>
      Connect wallet
    </Button>
  );
}
