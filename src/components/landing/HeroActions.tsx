"use client";

/**
 * The hero's calls to action, and the hand-off to the dashboard.
 *
 * Without a wallet: "Connect wallet" (the shared connect modal) and "Explore
 * markets". With one — restored from the last visit or just connected — the
 * primary action becomes "Open dashboard" and the page moves to /overview
 * after a short beat, so a returning user lands where they work. `?stay=1`
 * (or "Stay here") keeps them on the landing page. While a remembered
 * wallet is being restored, the line under the buttons says so, instead of
 * leaving a returning user looking at "Connect wallet" for a second.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Spinner } from "@/components/ui";
import { readWalletHint } from "@/lib/connect/walletHint";
import { useWallet } from "@/providers/WalletProvider";
import { useOpenConnect } from "./useOpenConnect";

/** Long enough to read "Opening your dashboard", short enough not to wait. */
const HANDOFF_MS = 600;

function noopSubscribe() {
  return () => {};
}

/** `?stay=1` on the URL the page was opened with (empty on the server). */
function useStayParam(): boolean {
  const search = useSyncExternalStore(
    noopSubscribe,
    () => window.location.search,
    () => "",
  );
  return new URLSearchParams(search).get("stay") === "1";
}

/** This browser remembers a wallet to restore (false on the server). */
function useRememberedWallet(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => readWalletHint() !== null,
    () => false,
  );
}

export function HeroActions() {
  const { account, restoring } = useWallet();
  const openConnect = useOpenConnect();
  const router = useRouter();
  const stayParam = useStayParam();
  const remembered = useRememberedWallet();
  const [stayed, setStayed] = useState(false);
  const stay = stayParam || stayed;
  const handingOff = Boolean(account) && !stay;
  const resuming = !account && restoring && remembered;

  useEffect(() => {
    if (!handingOff) return;
    router.prefetch("/overview");
    const timer = setTimeout(() => router.replace("/overview"), HANDOFF_MS);
    return () => clearTimeout(timer);
  }, [handingOff, router]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        {account ? (
          <Button variant="primary" size="lg" href="/overview" iconRight="arrowRight" className="h-12 px-5 text-[15px] max-sm:w-full">
            Open dashboard
          </Button>
        ) : (
          <Button variant="primary" size="lg" iconLeft="wallet" className="h-12 px-5 text-[15px] max-sm:w-full" onClick={() => openConnect()}>
            Connect wallet
          </Button>
        )}
        <Button variant="ghost" size="lg" href="/markets" iconRight="arrowRight" className="h-12 px-4 text-[15px] text-fg max-sm:w-full">
          Explore markets
        </Button>
      </div>
      {/* Announced politely: the page is about to change under the reader. */}
      <p
        role="status"
        aria-live="polite"
        className={account || resuming ? "mt-3 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-dim" : undefined}
      >
        {handingOff ? (
          <>
            <Spinner size={12} />
            Wallet connected. Opening your dashboard…
            <button
              type="button"
              onClick={() => {
                setStayed(true);
                // Keep the choice on reload and on Back.
                window.history.replaceState(null, "", "?stay=1");
              }}
              className="d-hit rounded-[6px] font-medium text-fg-muted underline underline-offset-[3px] transition-colors duration-[160ms] hover:text-fg"
            >
              Stay here
            </button>
          </>
        ) : account ? (
          "Wallet connected."
        ) : resuming ? (
          <>
            <Spinner size={12} />
            Reconnecting your wallet…
          </>
        ) : null}
      </p>
    </div>
  );
}
