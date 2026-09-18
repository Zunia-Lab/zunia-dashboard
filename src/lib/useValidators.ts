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
  logoUrl?: string;
};

type Payload = {
  validators?: ValidatorRow[];
  stub?: boolean;
  source?: string;
};

const EMPTY: Payload = { validators: [], stub: true };

/** One chain, or every id when `chainIds` is a non-empty list. */
export function useValidators(
  chainIdOrIds: string | string[] | null | undefined,
) {
  const chainIds = useMemo(() => {
    if (!chainIdOrIds) return [];
    return Array.isArray(chainIdOrIds)
      ? chainIdOrIds.filter(Boolean)
      : [chainIdOrIds];
  }, [chainIdOrIds]);

  const url = useMemo(() => {
    if (chainIds.length === 0) return null;
    if (chainIds.length === 1) {
      return `/api/validators?chainId=${encodeURIComponent(chainIds[0]!)}`;
    }
    return `/api/validators?chains=${encodeURIComponent(chainIds.join(","))}`;
  }, [chainIds]);

  const data = useJson<Payload>(url, EMPTY);

  return useMemo(
    () => ({
      rows: data?.validators ?? [],
      loading: Boolean(url) && data === null,
      sample: data?.stub === true || data?.source === "stub",
    }),
    [url, data],
  );
}
