"use client";

import { useMemo } from "react";
import { useChainScope } from "@/lib/useChainScope";
import { useJson } from "@/lib/useJson";
import { useWallet } from "@/providers/WalletProvider";

export type ActivityTx = {
  hash: string;
  summary: string;
  time: string;
  success: boolean;
  kind?: string;
};

type ActivityPayload = { items?: ActivityTx[]; stub?: boolean };

const STUB: ActivityPayload = { items: [], stub: true };

export function useActivity() {
  const { account } = useWallet();
  const { scopedChainIds, selectedChainId } = useChainScope();

  const query = account
    ? new URLSearchParams({
        address: account.address,
        chainId: selectedChainId ?? account.chainId,
        chains: scopedChainIds.join(","),
      }).toString()
    : null;

  const data = useJson<ActivityPayload>(
    query ? `/api/activity?${query}` : null,
    STUB,
  );

  return useMemo(
    () => ({
      items: data?.items ?? [],
      stub: Boolean(data?.stub),
      loading: Boolean(account) && data === null,
      connected: Boolean(account),
    }),
    [account, data],
  );
}
