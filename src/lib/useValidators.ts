"use client";

import { useMemo } from "react";
import { useJson } from "@/lib/useJson";

export type ValidatorRow = {
  chainId: string;
  chainName: string;
  operatorAddress: string;
  moniker: string;
  identity: string;
  commission: number;
  votingPower: number;
  tokens: string;
  jailed: boolean;
};

type Payload = { validators?: ValidatorRow[]; stub?: boolean };

const EMPTY: Payload = { validators: [], stub: true };

export function useValidators(chainId: string | null | undefined) {
  const data = useJson<Payload>(
    chainId ? `/api/validators?chainId=${encodeURIComponent(chainId)}` : null,
    EMPTY,
  );

  return useMemo(
    () => ({
      rows: data?.validators ?? [],
      loading: Boolean(chainId) && data === null,
    }),
    [chainId, data],
  );
}
