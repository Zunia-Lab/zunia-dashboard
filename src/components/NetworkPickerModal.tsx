"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  NetworkPickerSheet,
} from "@zunialab/ui";
import { findChain } from "@/lib/chains";
import { useChainScope } from "@/lib/useChainScope";

/** Followed-network picker using the shared NetworkPickerSheet recipe. */
export function NetworkPickerModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    followedAll,
    selectedChainId,
    setSelectedChainId,
    network,
    setNetwork,
  } = useChainScope();
  const [search, setSearch] = useState("");

  const networks = useMemo(
    () =>
      followedAll
        .map((chainId) => findChain(chainId))
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({
          chainId: c.chainId,
          name: c.chainName,
          symbol: c.coinDenom,
        })),
    [followedAll],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(420px,calc(100%-32px))]">
        <DialogTitle className="sr-only">Networks</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a followed network to scope the desk
        </DialogDescription>
        <NetworkPickerSheet
          networks={[
            { chainId: "__all__", name: "All followed", symbol: "ALL" },
            ...networks,
          ]}
          activeChainId={selectedChainId ?? "__all__"}
          search={search}
          onSearchChange={setSearch}
          onSelect={(chainId) => {
            if (chainId === "__all__") {
              setSelectedChainId(null);
            } else {
              const chain = findChain(chainId);
              if (chain && chain.network !== network) {
                setNetwork(chain.network);
              }
              setSelectedChainId(chainId);
            }
            onOpenChange(false);
            setSearch("");
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
