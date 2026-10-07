"use client";

import { useCallback, useMemo } from "react";
import { findChain, type ChainEntry } from "@/lib/chains";
import { useFollowedChains } from "@/lib/useFollowedChains";
import { useStoredValue } from "@/lib/useStoredValue";

const SCOPE_KEY = "zunia.dashboard.chainScope";
const NETWORK_KEY = "zunia.dashboard.network";

/**
 * Zunia mark = every followed network on the current MAIN/TEST slice.
 * A rail icon = that chain only, until the mark is clicked again.
 *
 * The rail lists every followed chain (so a testnet followed while Main is
 * selected still shows, dimmed); with no chain selected, reads cover the
 * followed chains of the current slice only.
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
  // followed chain on the current MAIN/TEST slice: testnet balances must
  // never be added into a mainnet net worth. Memoised because consumers pass
  // it straight into deps arrays; a fresh array per render would re-run every
  // dependent read.
  const scopedChainIds = useMemo(
    () => (selectedChainId ? [selectedChainId] : followedOnNetwork),
    [selectedChainId, followedOnNetwork],
  );

  const scopedChains = useMemo(
    () =>
      scopedChainIds
        .map((chainId) => findChain(chainId))
        .filter((chain): chain is ChainEntry => Boolean(chain)),
    [scopedChainIds],
  );

  // Selecting a chain of the other slice switches the slice first, so the
  // selection is never a chain the MAIN/TEST toggle hides.
  const selectChain = useCallback(
    (chainId: string | null) => {
      if (chainId) {
        const chain = findChain(chainId);
        if (chain && chain.network !== network) setNetwork(chain.network);
      }
      setSelectedChainId(chainId);
    },
    [network, setNetwork, setSelectedChainId],
  );

  return {
    network,
    setNetwork,
    selectedChainId,
    selectedChain,
    setSelectedChainId,
    /** Select a followed chain (switching MAIN/TEST when needed), or null for all chains. */
    selectChain,
    /** Every followed registry chain — use for the left rail. */
    followedAll: followedKnown,
    followedOnNetwork,
    scopedChainIds,
    scopedChains,
  };
}
