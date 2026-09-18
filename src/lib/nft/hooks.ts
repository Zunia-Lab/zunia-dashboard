"use client";

/**
 * Async state for the NFT screens.
 *
 * Thin wrappers over `useAsyncResource` from `lib/interchain/hooks.ts`. That
 * loader already does the two things these screens need and are easy to get
 * wrong: it aborts a request whose key has been superseded, and it drops the
 * previous answer rather than showing it beside new inputs. A grid that kept
 * the last chain's tokens on screen while a new chain loaded would be telling
 * the user they hold something they do not.
 */

import { useEffect } from "react";
import { useAsyncResource, type AsyncResource } from "@/lib/interchain/hooks";
import {
  fetchNftCollections,
  fetchNftConfig,
  fetchNftTokens,
  fetchNftTrack,
} from "./client";
import type {
  NftCollectionsBody,
  NftConfigWire,
  NftTokensBody,
  NftTrackWire,
} from "./wire";

export type { AsyncResource } from "@/lib/interchain/hooks";

/** Can this deployment show NFTs on this chain, and what is configured? */
export function useNftConfig(chainId: string | null): AsyncResource<NftConfigWire> {
  return useAsyncResource<NftConfigWire>(chainId, async (signal) => {
    if (!chainId) {
      return { ok: false, code: "bad-request", message: "No chain selected." };
    }
    const response = await fetchNftConfig(chainId, signal);
    return response.ok ? { ok: true, data: response.config } : response;
  });
}

/**
 * Discovery over all three paths.
 *
 * `userContracts` is part of the key, so adding an address re-runs discovery
 * rather than appending to a stale list.
 */
export function useNftCollections(params: {
  readonly chainId: string | null;
  readonly address: string | null;
  readonly userContracts: readonly string[];
  readonly enabled: boolean;
}): AsyncResource<NftCollectionsBody> {
  const key =
    params.enabled && params.chainId && params.address
      ? `${params.chainId}|${params.address}|${[...params.userContracts].sort().join(",")}`
      : null;

  return useAsyncResource<NftCollectionsBody>(key, async (signal) => {
    if (!params.chainId || !params.address) {
      return { ok: false, code: "bad-request", message: "No account connected." };
    }
    const response = await fetchNftCollections(
      {
        chainId: params.chainId,
        address: params.address,
        userContracts: params.userContracts,
      },
      signal,
    );
    return response.ok ? { ok: true, data: response.collections } : response;
  });
}

/**
 * On-chain detail for a bounded set of token ids in one collection.
 *
 * `media` is in the key: turning artwork on has to re-read, because the token
 * document is where the image URL comes from and it was deliberately not read
 * the first time.
 */
export function useNftTokens(params: {
  readonly chainId: string | null;
  readonly contract: string | null;
  readonly tokenIds: readonly string[];
  readonly media: boolean;
  readonly withCollection?: boolean;
}): AsyncResource<NftTokensBody> {
  const ids = params.tokenIds.join(",");
  const key =
    params.chainId && params.contract && ids.length > 0
      ? `${params.chainId}|${params.contract}|${ids}|${params.media ? "1" : "0"}`
      : null;

  return useAsyncResource<NftTokensBody>(key, async (signal) => {
    if (!params.chainId || !params.contract || params.tokenIds.length === 0) {
      return { ok: false, code: "bad-request", message: "No token to read." };
    }
    const response = await fetchNftTokens(
      {
        chainId: params.chainId,
        contract: params.contract,
        tokenIds: params.tokenIds,
        media: params.media,
        ...(params.withCollection ? { withCollection: true } : {}),
      },
      signal,
    );
    return response.ok ? { ok: true, data: response.page } : response;
  });
}

/**
 * Follow one NFT transfer until it settles.
 *
 * Polling stops when the transaction failed (no packet was ever sent), when
 * there is no packet at all (a same-chain transfer, which the transaction
 * status alone answers), and when the packet reaches a terminal state. It does
 * not stop merely because the transaction succeeded: for a cross-chain transfer
 * that is the halfway point, and stopping there is how a UI reports success for
 * a token still in flight.
 */
export function useNftTrack(
  input: {
    readonly chainId: string;
    readonly hash: string;
    readonly destChainId?: string | null;
    readonly bridgeContract?: string | null;
  } | null,
  options: { readonly pollMs?: number } = {},
): AsyncResource<NftTrackWire> {
  const pollMs = options.pollMs ?? 6_000;
  const key = input ? `${input.chainId}|${input.hash}` : null;

  const resource = useAsyncResource<NftTrackWire>(key, async (signal) => {
    if (!input) {
      return { ok: false, code: "bad-request", message: "Nothing to track." };
    }
    const response = await fetchNftTrack(input, signal);
    return response.ok ? { ok: true, data: response.trace } : response;
  });

  const { data, reload } = resource;
  const done =
    data !== null &&
    (data.tx.state === "failed" ||
      (data.tx.state === "success" && data.packet === null) ||
      (data.packet !== null && TERMINAL_PACKET_STATUSES.has(data.packet.status)));

  useEffect(() => {
    if (key === null || done) return;
    const timer = window.setInterval(reload, pollMs);
    return () => window.clearInterval(timer);
  }, [key, done, pollMs, reload]);

  return resource;
}

const TERMINAL_PACKET_STATUSES: ReadonlySet<string> = new Set([
  "acknowledged",
  "timeout",
  "failed",
]);
