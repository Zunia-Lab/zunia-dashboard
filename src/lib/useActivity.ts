"use client";

import { useMemo } from "react";
import { useChainScope } from "@/lib/useChainScope";
import { useJsonState, type JsonError } from "@/lib/useJson";
import { useWallet } from "@/providers/WalletProvider";

export type ActivityTx = {
  hash: string;
  summary: string;
  time: string;
  success: boolean;
  kind?: string;
  chainId?: string;
};

type ActivityPayload = {
  items?: ActivityTx[];
  chains?: string[];
  failedChains?: string[];
  skipped?: string[];
  truncated?: string[];
  stub?: boolean;
  source?: string;
};

export interface ActivityResult {
  items: ActivityTx[];
  loading: boolean;
  connected: boolean;
  /**
   * Null when the read succeeded. An empty list plus null is a real "none";
   * an error with items means the rows on screen came from the local cache.
   */
  error: JsonError | null;
  /** Reached chains that did not answer; their history is missing, not empty. */
  failedChains: string[];
  /** Followed chains this address cannot be re-derived for. */
  skipped: string[];
  /** Followed chains dropped by the per-request chain cap. */
  truncated: string[];
  /** True when the route answered with a stub / sample payload. */
  sample: boolean;
}

/**
 * Reads history for the current chain scope.
 *
 * `chains` is the read scope; `sourceChainId` names the chain the address was
 * produced on. They are separate parameters because scoping the rail to Osmosis
 * while the wallet is connected on Cosmos Hub must re-encode, not reject.
 */
export function useActivity(): ActivityResult {
  const { account } = useWallet();
  const { scopedChainIds } = useChainScope();

  const query = account
    ? new URLSearchParams({
        address: account.address,
        sourceChainId: account.chainId,
        chains: scopedChainIds.join(","),
      }).toString()
    : null;

  const { data, error, loading } = useJsonState<ActivityPayload>(
    query ? `/api/activity?${query}` : null,
  );

  return useMemo(
    () => ({
      items: data?.items ?? [],
      loading: Boolean(account) && loading,
      connected: Boolean(account),
      error,
      failedChains: data?.failedChains ?? [],
      skipped: data?.skipped ?? [],
      truncated: data?.truncated ?? [],
      sample: data?.stub === true || data?.source === "stub",
    }),
    [account, data, error, loading],
  );
}
