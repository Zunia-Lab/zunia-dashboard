"use client";

/**
 * Whether a public page should wait for a wallet before showing what it
 * shows visitors ("Connect to see your position", a crumb back to Markets,
 * "See what you hold").
 *
 * On a reload the wallet provider starts out restoring the last session.
 * For a returning user a wallet is a moment away, so offering "Connect"
 * meanwhile flashes the prompt and flips it to the position (the wallet
 * routes hold a skeleton through the same window, in the Page shell). Only
 * a remembered wallet waits: a visitor has nothing to restore, and holding
 * their page through the restore would trade one flip for another (a
 * skeleton in the server HTML that turns into the prompt).
 */

import { useSyncExternalStore } from "react";
import { readWalletHint } from "@/lib/connect/walletHint";
import { useWallet } from "@/providers/WalletProvider";

function noopSubscribe() {
  return () => {};
}

/** This browser remembers a wallet to restore (false on the server and while hydrating). */
function useRememberedWallet(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => readWalletHint() !== null,
    () => false,
  );
}

/** No wallet yet, but a remembered one is being restored: hold, do not prompt. */
export function useWalletRestoring(): boolean {
  const { account, restoring } = useWallet();
  const remembered = useRememberedWallet();
  return account === null && restoring && remembered;
}
