/**
 * Browser-side calls to `/api/nft/*`.
 *
 * The transport is `lib/interchain/client.ts`'s `getJson`, so a network failure
 * here produces the same `InterchainFailure` an interchain call does. Every
 * response is narrowed by a reader in `wire.ts` before a component sees it.
 *
 * Nothing here talks to a chain, and nothing here fetches a `token_uri`. Chain
 * reads run in the handlers; the metadata document is read there too, so the
 * host it belongs to learns the deployment's address rather than the visitor's.
 * The one thing the browser fetches directly is the artwork itself, through an
 * `<img>` whose URL these routes resolved — and that only when the user has
 * turned artwork on.
 */

import { getJson } from "@/lib/interchain/client";
import {
  readNftCollectionsResponse,
  readNftConfigResponse,
  readNftTokensResponse,
  readNftTrackResponse,
  type NftCollectionsResponse,
  type NftConfigResponse,
  type NftTokensResponse,
  type NftTrackResponse,
} from "./wire";

export async function fetchNftConfig(
  chainId: string,
  signal?: AbortSignal,
): Promise<NftConfigResponse> {
  const query = new URLSearchParams({ chainId });
  return readNftConfigResponse(
    await getJson(`/api/nft/config?${query.toString()}`, signal),
  );
}

export interface NftCollectionsInput {
  readonly chainId: string;
  readonly address: string;
  /** Contract addresses the user pasted. Always probed, even past the cap. */
  readonly userContracts: readonly string[];
}

export async function fetchNftCollections(
  input: NftCollectionsInput,
  signal?: AbortSignal,
): Promise<NftCollectionsResponse> {
  const query = new URLSearchParams({
    chainId: input.chainId,
    address: input.address,
  });
  if (input.userContracts.length > 0) {
    query.set("contracts", input.userContracts.join(","));
  }
  return readNftCollectionsResponse(
    await getJson(`/api/nft/collections?${query.toString()}`, signal),
  );
}

export interface NftTokensInput {
  readonly chainId: string;
  readonly contract: string;
  readonly tokenIds: readonly string[];
  /**
   * Read the off-chain metadata document as well.
   *
   * The user's explicit choice, never a default. Off, only what the contract
   * stores on chain is returned.
   */
  readonly media: boolean;
  /** Also read `collection_info`. The grid already has it; the detail view does not. */
  readonly withCollection?: boolean;
}

export async function fetchNftTokens(
  input: NftTokensInput,
  signal?: AbortSignal,
): Promise<NftTokensResponse> {
  const query = new URLSearchParams({
    chainId: input.chainId,
    contract: input.contract,
    ids: input.tokenIds.join(","),
    media: input.media ? "1" : "0",
  });
  if (input.withCollection) query.set("collection", "1");
  return readNftTokensResponse(
    await getJson(`/api/nft/tokens?${query.toString()}`, signal),
  );
}

export interface NftTrackInput {
  readonly chainId: string;
  readonly hash: string;
  /** Destination chain, so the receiving transaction can be found. */
  readonly destChainId?: string | null;
  /** The configured bridge, so the right `wasm.<addr>` port is matched exactly. */
  readonly bridgeContract?: string | null;
}

export async function fetchNftTrack(
  input: NftTrackInput,
  signal?: AbortSignal,
): Promise<NftTrackResponse> {
  const query = new URLSearchParams({
    chainId: input.chainId,
    hash: input.hash,
  });
  if (input.destChainId) query.set("destChainId", input.destChainId);
  if (input.bridgeContract) query.set("bridge", input.bridgeContract);
  return readNftTrackResponse(
    await getJson(`/api/nft/track?${query.toString()}`, signal),
  );
}
