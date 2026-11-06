"use client";

import { useState } from "react";
import { Button, toast } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/lib/connect/context";
import { requestChains } from "@/lib/connect/request-chains";
import { explainError } from "@/lib/tx/errors";

/**
 * "Ask <wallet> for Injective": the way out of "No address for these
 * networks". Asks the connected browser wallet for the chains it has not
 * shared (adding them to it when it does not know them); the pages re-read
 * as soon as the keys arrive. Nothing for a phone session, which can only be
 * widened on the phone, and nothing when there are no chains to ask for.
 */
export function ShareAddressesAction({ chainIds }: { chainIds: readonly string[] }) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const askable = chainIds.filter((id) => findChain(id) && !wallet.keys[id]);
  if (!wallet.walletKind || wallet.walletKind === "zunia-mobile" || askable.length === 0) return null;
  const names = askable.map((id) => findChain(id)?.chainName ?? id);
  const label = names.length <= 2 ? names.join(" and ") : `${names.length} networks`;
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
