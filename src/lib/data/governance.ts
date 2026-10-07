"use client";

/**
 * Governance for the browser: proposals across the scope (`useProposals`)
 * and one proposal in full (`useProposal`).
 *
 * With a wallet connected, requests carry the wallet's address per chain
 * (`voter=`), so voting proposals come back with the user's own vote, their
 * voting power and, when they have not voted, the vote their validators cast
 * for their stake. Those answers are private and never persisted; without a
 * wallet the same routes are public and cached.
 *
 * While a remembered wallet is still being restored, the hooks wait for its
 * addresses instead of reading the public list now and the same list again
 * with `voter=` a moment later (twice the governance rate-limit tokens, and on
 * /governance ~80 KB fetched to be thrown away). Waiting reads as loading,
 * never as an empty list.
 *
 * The public URL is not even built meanwhile, with or without a server-read
 * list (`initial`). Built, it is fetched (once the server's copy is past the
 * dedupe age) and copied to localStorage, and its answer stays on screen,
 * dimmed, under the wallet's own read, where every connected card reads the
 * missing votes as "Not in your wallet yet". A held `initial` is shown as
 * read instead: it is what the server rendered (`restoring` is true there
 * too, and until the wallet's first effect), so hydration matches; a wallet's
 * list then loads as any first read does, and without a wallet the server's
 * list stays, its URL seeded by the same answer.
 */

import { useMemo } from "react";
import { formatAccounts } from "@/lib/chain/accounts";
import { useWallet } from "@/lib/connect/context";
import { rec } from "@/lib/chain/parse";
import type {
  ProposalDetailResponse,
  ProposalRow,
  ProposalStatusFilter,
  ProposalsResponse,
} from "@/lib/chain/types";
import { apiUrl, useApi, type ApiInitial, type ApiState } from "@/lib/useApi";
import { useChainScope } from "@/lib/useChainScope";
import { useScopeAccounts } from "@/lib/data/staking";

export type {
  ProposalDetail,
  ProposalDetailResponse,
  ProposalRow,
  ProposalStatus,
  ProposalStatusFilter,
  ProposalsResponse,
  Tally,
  VoteChoice,
  VoteOptionName,
} from "@/lib/chain/types";

function readList(raw: unknown): ProposalsResponse | null {
  const body = rec(raw);
  return body && Array.isArray(body.proposals) ? (raw as ProposalsResponse) : null;
}

function readDetail(raw: unknown): ProposalDetailResponse | null {
  const body = rec(raw);
  return body && rec(body.proposal) ? (raw as ProposalDetailResponse) : null;
}

export interface ProposalsOptions {
  /** Default "all": the 20 most recent per chain plus everything in voting. */
  status?: ProposalStatusFilter;
  /** Default: the current scope (capped at 40). */
  chains?: readonly string[] | null;
  /** Include the connected wallet's votes (default true). */
  withVoter?: boolean;
  /**
   * The public list (no voter) read on the server for the first HTML, built
   * with the same `apiUrl` call (voter left out). Shown while a wallet may
   * still be restoring, and seeds that URL once none is; a connected
   * wallet's `voter=` read replaces it and never shows it meanwhile.
   */
  initial?: ApiInitial | null;
}

export interface ProposalsState extends ApiState<ProposalsResponse> {
  chainIds: string[];
  /** Voting proposals where the wallet has stake and has not voted. */
  awaitingVote: ProposalRow[];
}

export function useProposals(options: ProposalsOptions = {}): ProposalsState {
  const { restoring } = useWallet();
  const { scopedChainIds } = useChainScope();
  const status = options.status ?? "all";
  const key = (options.chains ?? scopedChainIds).filter(Boolean).slice(0, 40).join(",");
  const ids = useMemo(() => (key ? key.split(",") : []), [key]);
  const scope = useScopeAccounts(ids);
  const withVoter = options.withVoter !== false;
  const voter = withVoter ? formatAccounts(scope.accounts) : "";
  // A remembered wallet may still be restoring: wait for its addresses, and
  // build no public URL meanwhile (see the module comment). `key !== ""`
  // keeps a hook that is idle on purpose (no chains asked) idle.
  const hold = withVoter && restoring && key !== "";
  const state = useApi<ProposalsResponse>(
    key && !hold ? apiUrl("/api/governance", { chains: key, status, voter: voter || null }) : null,
    {
      parse: readList,
      keepPreviousData: true,
      persist: !voter,
      refreshMs: 2 * 60_000,
      dedupeMs: 30_000,
      initial: options.initial,
    },
  );
  // The server's list stands in only for the list this hook reads without a
  // wallet (same chains, same status), as `useApi` matches a seed: one read
  // for another scope is not this one's.
  const initial = options.initial;
  const held = useMemo(
    () =>
      hold && initial && initial.url === apiUrl("/api/governance", { chains: key, status, voter: null })
        ? readList(initial.data)
        : null,
    [hold, initial, key, status],
  );
  // Held means pending, not idle: an idle read reports `loading: false`, which
  // the governance page, the participation strip and chain detail would show
  // as "Nothing is up for a vote". With the server's list it means that list,
  // exactly as the server rendered it.
  const shown: ApiState<ProposalsResponse> = !hold
    ? state
    : held && initial
      ? { ...state, data: held, error: null, status: "ready", loading: false, refreshing: false, stale: false, updatedAt: initial.at }
      : { ...state, status: "loading", loading: true };
  const proposals = shown.data?.proposals;
  const awaitingVote = useMemo(
    () =>
      (proposals ?? []).filter(
        (p) => p.status === "voting" && p.myVoteStatus === "not-voted" && p.myVotingPower !== null && p.myVotingPower !== "0",
      ),
    [proposals],
  );
  return { ...shown, chainIds: ids, awaitingVote };
}

/** One proposal by chain and id, with the wallet's vote when connected (default). */
export function useProposal(
  chainId: string | null | undefined,
  id: string | null | undefined,
  options: { withVoter?: boolean } = {},
): ApiState<ProposalDetailResponse> {
  const { restoring } = useWallet();
  const chains = useMemo(() => (chainId ? [chainId] : []), [chainId]);
  const scope = useScopeAccounts(chains);
  const voter = options.withVoter === false ? null : (scope.accounts[0]?.address ?? null);
  // Restoring: wait for the voter (the proposal page shows its server-read
  // copy, or its skeleton, meanwhile).
  const hold = options.withVoter !== false && restoring;
  return useApi<ProposalDetailResponse>(
    !hold && chainId && id && /^\d+$/.test(id)
      ? apiUrl(`/api/governance/${encodeURIComponent(chainId)}/${id}`, { voter })
      : null,
    {
      parse: readDetail,
      keepPreviousData: true,
      persist: !voter,
      refreshMs: 2 * 60_000,
      dedupeMs: 30_000,
    },
  );
}
