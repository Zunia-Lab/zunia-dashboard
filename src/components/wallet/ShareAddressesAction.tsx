"use client";

import { useState } from "react";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Button, toast } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/lib/connect/context";
import { requestChains } from "@/lib/connect/request-chains";
import { explainError } from "@/lib/tx/errors";

/**
 * "Share Injective": the way out of "No address for these networks".
 *
 * A browser wallet is asked for the chains it has not shared (and has them
 * added when it does not know them); the pages re-read as soon as the keys
 * arrive. A phone shares only the chains its pairing asked for, so a phone
 * session pairs again with them added: a new code to scan, and the current
 * session ends. Nothing when there are no chains to ask for.
 */
export function ShareAddressesAction({ chainIds }: { chainIds: readonly string[] }) {
  const wallet = useWallet();
  const connect = useConnectModal();
  const [busy, setBusy] = useState(false);
  const askable = chainIds.filter((id) => findChain(id) && !wallet.keys[id]);
  if (!wallet.walletKind || askable.length === 0) return null;
  const names = askable.map((id) => findChain(id)?.chainName ?? id);
  const label = names.length <= 2 ? names.join(" and ") : `${names.length} networks`;
  if (wallet.walletKind === "zunia-mobile") {
    return (
      <Button
        size="sm"
        iconLeft="mobile"
        onClick={() => {
          // What the phone shares now, plus what is missing.
          void wallet.mobile.start({ chains: [...Object.keys(wallet.keys), ...askable] });
          connect.open("mobile");
        }}
      >
        Pair again with {label}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      iconLeft="plus"
      loading={busy}
      onClick={() => {
        setBusy(true);
        requestChains(askable, wallet.ensureChain)
          .then(({ failed }) => {
            for (const { error } of failed) {
              const explained = explainError(error);
              toast.error(explained.title, { description: explained.message });
            }
          })
          .finally(() => setBusy(false));
      }}
    >
      Share {label}
    </Button>
  );
}

/**
 * The second sentence of "No address for these networks": a phone shares only
 * what its pairing asked for, so approving "in your wallet" is not a way out
 * there; pairing again is.
 */
export function NoAddressHint() {
  const { walletKind } = useWallet();
  return walletKind === "zunia-mobile" ? (
    <>Your phone shares only the networks it was paired with: pair again to add them, or pick another scope on the rail.</>
  ) : (
    <>Approve them in your wallet, or pick another scope on the rail.</>
  );
}
