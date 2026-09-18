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
 *
 * The rail itself lists every followed chain so turning a testnet on while
 * Main is selected still shows up; Main/Test only scopes portfolio reads.
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

  const followedKnown = useMemo(
    () => followed.filter((chainId) => Boolean(findChain(chainId))),
    [followed],
  );

  const followedOnNetwork = useMemo(
    () =>
      followedKnown.filter(
        (chainId) => findChain(chainId)?.network === network,
      ),
    [followedKnown, network],
  );

  const selectedChainId =
    storedId && followedKnown.includes(storedId) ? storedId : null;

  const selectedChain = selectedChainId
    ? findChain(selectedChainId)
    : undefined;

  // Single-chain scope always wins. With no rail selection, read every
  // followed chain (main + test) so portfolio / staking / send stay unified.
  // Memoised because consumers pass it straight into deps arrays; a fresh
  // arrayper render would re-run every dependent read.
  const scopedChainIds = useMemo(
    () => (selectedChainId ? [selectedChainId] : followedKnown),
    [selectedChainId, followedKnown],
  );

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
    /** Every followed registry chain — use for the left rail. */
    followedAll: followedKnown,
    followedOnNetwork,
    scopedChainIds,
    scopedChains,
  };
}
