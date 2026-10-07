"use client";

/**
 * The connected wallet's staking positions and security review.
 *
 * Both ask about one address per chain in scope, from
 * `useWallet().addressFor(chainId)`: the wallet's own key for that chain,
 * else the connected account re-encoded on a chain of the same key scheme —
 * never across schemes, where re-encoding yields an address the user does
 * not control. Chains with no address are listed in `skipped` so the page
 * can say "Connect on Injective to see your stake there".
 *
 * Private data: answers are never persisted to localStorage (an address's
 * positions must not outlive the session on a shared computer). After a
 * delegate, claim or vote, call `revalidateApi("/api/staking")`.
 */

import { useMemo } from "react";
import { formatAccounts, type ChainAccount } from "@/lib/chain/accounts";
import { rec } from "@/lib/chain/parse";
import type { SecurityReviewResponse, StakingChain, StakingResponse } from "@/lib/chain/types";
import { useWallet } from "@/lib/connect/context";
import { apiUrl, useApi, type ApiState } from "@/lib/useApi";
import { useChainScope } from "@/lib/useChainScope";

export type { SecurityReviewResponse, StakingChain, StakingResponse } from "@/lib/chain/types";

/** The routes accept at most this many accounts per request. */
export const MAX_ACCOUNTS = 40;

export interface ScopeAccounts {
  /** One address per chain, in scope order (at most 40). */
  accounts: ChainAccount[];
  /** Chains in scope without a known address for this wallet. */
  skipped: string[];
  /** A wallet is connected. */
  connected: boolean;
}

/**
 * The connected wallet's address on each chain of `chainIds` (default: the
 * current scope).
 */
export function useScopeAccounts(chainIds?: readonly string[] | null): ScopeAccounts {
  const { account, addressFor } = useWallet();
  const { scopedChainIds } = useChainScope();
  const key = (chainIds ?? scopedChainIds).filter(Boolean).join(",");
  const connected = account !== null;

  return useMemo(() => {
    if (!connected) return { accounts: [], skipped: [], connected: false };
    const accounts: ChainAccount[] = [];
    const skipped: string[] = [];
    for (const chainId of key ? key.split(",") : []) {
      const address = addressFor(chainId);
      if (address && accounts.length < MAX_ACCOUNTS) accounts.push({ chainId, address });
      else skipped.push(chainId);
    }
    return { accounts, skipped, connected: true };
  }, [key, connected, addressFor]);
}

function readStaking(raw: unknown): StakingResponse | null {
  const body = rec(raw);
  return body && Array.isArray(body.chains) ? (raw as StakingResponse) : null;
}

function readSecurity(raw: unknown): SecurityReviewResponse | null {
  const body = rec(raw);
  return body && Array.isArray(body.authzGrants) && Array.isArray(body.checked)
    ? (raw as SecurityReviewResponse)
    : null;
}

export interface StakingPositionsState extends ApiState<StakingResponse>, ScopeAccounts {
  /** Positions of one chain from the current answer. */
  chainFor: (chainId: string) => StakingChain | null;
}

/**
 * Staking positions of the connected wallet on `options.chainIds` (default:
 * scope). Idle (`status: "idle"`) without a wallet. Refreshes every minute.
 */
export function useStakingPositions(options: { chainIds?: readonly string[] | null } = {}): StakingPositionsState {
  const scope = useScopeAccounts(options.chainIds);
  const param = formatAccounts(scope.accounts);
  const state = useApi<StakingResponse>(param ? apiUrl("/api/staking", { accounts: param }) : null, {
    parse: readStaking,
    keepPreviousData: true,
    persist: false,
    refreshMs: 60_000,
    dedupeMs: 20_000,
  });
  const chains = state.data?.chains;
  const chainFor = useMemo(() => {
    const byId = new Map((chains ?? []).map((chain) => [chain.chainId, chain]));
    return (chainId: string) => byId.get(chainId) ?? null;
  }, [chains]);
  return { ...state, ...scope, chainFor };
}

export type SecurityReviewState = ApiState<SecurityReviewResponse> & ScopeAccounts;

/**
 * Authz grants, fee grants and withdraw-address changes of the connected
 * wallet on `options.chainIds` (default: scope). Idle without a wallet.
 */
export function useSecurityReview(options: { chainIds?: readonly string[] | null } = {}): SecurityReviewState {
  const scope = useScopeAccounts(options.chainIds);
  const param = formatAccounts(scope.accounts);
  const state = useApi<SecurityReviewResponse>(param ? apiUrl("/api/security", { accounts: param }) : null, {
    parse: readSecurity,
    keepPreviousData: true,
    persist: false,
    dedupeMs: 60_000,
  });
  return { ...state, ...scope };
}
