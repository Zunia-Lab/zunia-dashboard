"use client";

import { useMemo } from "react";
import { findChain, type ChainEntry } from "@/lib/chains";
import { useFollowedChains } from "@/lib/useFollowedChains";
import { useStoredValue } from "@/lib/useStoredValue";

const SCOPE_KEY = "zunia.dashboard.chainScope";
const NETWORK_KEY = "zunia.dashboard.network";

/**
 * Zunia mark = every followed network on the current MAIN/TEST slice.
 * A rail icon = that chain only, until the mark is clicked again.
 */
export function useChainScope() {
  const [followed] = useFollowedChains();
  const [network, setNetwork] = useStoredValue<"mainnet" | "testnet">(
    NETWORK_KEY,
    "mainnet",
  );
  const [storedId, setSelectedChainId] = useStoredValue<string | null>(
    SCOPE_KEY,
    null,
  );

  const followedOnNetwork = useMemo(
    () =>
      followed.filter((chainId) => findChain(chainId)?.network === network),
    [followed, network],
  );

  const selectedChainId =
    storedId && followedOnNetwork.includes(storedId) ? storedId : null;

  const selectedChain = selectedChainId
    ? findChain(selectedChainId)
    : undefined;

  const scopedChainIds = selectedChainId
    ? [selectedChainId]
    : followedOnNetwork;

  const scopedChains = useMemo(
    () =>
      scopedChainIds
        .map((chainId) => findChain(chainId))
        .filter((chain): chain is ChainEntry => Boolean(chain)),
    [scopedChainIds],
  );

  return {
    network,
    setNetwork,
    selectedChainId,
    selectedChain,
    setSelectedChainId,
    followedOnNetwork,
    scopedChainIds,
    scopedChains,
  };
}
