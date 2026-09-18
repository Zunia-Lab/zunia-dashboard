"use client";

import {
  AccountSwitcher,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@zunialab/ui";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/providers/WalletProvider";

/**
 * Account switcher sheet. Dashboard currently holds one connected account;
 * the recipe still renders so the chrome matches extension / mobile.
 */
export function AccountSwitcherModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { account } = useWallet();
  const chain = account ? findChain(account.chainId) : undefined;
  const name =
    account?.mode === "extension"
      ? account.name
      : account
        ? account.peerName
        : "Guest";

  const accounts = account
    ? [
        {
          address: account.address,
          name,
          chainLabel: chain?.chainName ?? account.chainId,
        },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100%-32px))]">
        <DialogTitle className="sr-only">Accounts</DialogTitle>
        <DialogDescription className="sr-only">
          Switch the connected account
        </DialogDescription>
        <AccountSwitcher
          accounts={accounts}
          activeAddress={account?.address}
          onSelect={() => onOpenChange(false)}
        />
        {account ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-fg-dim">
            Dashboard mirrors the wallet that is connected. Use disconnect in
            the header, then reconnect, to change accounts.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
