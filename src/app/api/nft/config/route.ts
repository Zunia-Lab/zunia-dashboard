/**
 * Can this deployment show NFTs on this chain, and what is configured?
 *
 * The NFT page asks this first and disables everything with `reason` until the
 * answer is `supported`. That ordering is the same one `/api/interchain/config`
 * enforces for swap, and for the same reason: discovering at transfer time that
 * no ICS721 bridge was configured is the worst possible moment.
 *
 * Three statuses, three different screens:
 *
 * - `supported`   — the registry declares `cosmwasm` (or the operator's
 *                   override let us ask the chain and it answered).
 * - `unsupported` — the registry has a feature list and `cosmwasm` is not in
 *                   it. There are no CW721 contracts here to hold anything.
 * - `unverified`  — nobody has said either way. Today this is every chain,
 *                   because the catalog generator drops `features[]`.
 */

import { NextRequest } from "next/server";
import { findChain } from "@/lib/chains";
import {
  ics721DestinationsFrom,
  nftConfig,
  ICS721_BRIDGES_KEY,
  ICS721_CHANNELS_KEY,
  NFT_ALLOW_UNKNOWN_FEATURES_KEY,
  NFT_ARWEAVE_KEY,
  NFT_CONTRACTS_KEY,
  NFT_EXPLORER_KEY,
  NFT_INDEXER_KEY,
  NFT_IPFS_KEY,
  TX_EXPLORER_KEY,
} from "@/lib/server/nft-config";
import { nftChainSupport } from "@/lib/server/nft";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get("chainId")?.trim() ?? "";
  if (!chainId) {
    return Response.json(
      { ok: false, code: "bad-request", message: "A chain id is required." },
      { status: 400 },
    );
  }

  const config = nftConfig();
  const support = await nftChainSupport(chainId, { config });
  const bridgeContract = config.bridges[chainId] ?? null;
  const destinations = ics721DestinationsFrom(config, chainId).map((link) => ({
    chainId: link.destChainId,
    chainName: findChain(link.destChainId)?.chainName ?? link.destChainId,
    channelId: link.channelId,
    /** A destination whose chain the catalog does not carry cannot be addressed. */
    inCatalog: Boolean(findChain(link.destChainId)),
  }));

  // Two separate halves, and the message names whichever is missing. A bridge
  // with no channel and a channel with no bridge are both unbuildable, and an
  // operator debugging one of them needs to know which.
  const ics721Reason = bridgeContract
    ? destinations.length === 0
      ? `A cw-ics721 bridge is configured for ${support.chainName} (${ICS721_BRIDGES_KEY}) but no ICS721 channel is. Set ${ICS721_CHANNELS_KEY} to "${chainId}>destChainId=channel-N". ICS721 does not run on the transfer port, so Zunia cannot discover this channel — it is deployment data.`
      : null
    : `Cross-chain NFT transfer is off for this deployment: ${ICS721_BRIDGES_KEY} names no cw-ics721 bridge contract on ${support.chainName}. Zunia will not guess one — an NFT sent to a wrong address is escrowed by nothing and cannot be recalled.`;

  const knownContracts = config.knownContracts[chainId] ?? [];

  return Response.json({
    ok: true,
    config: {
      chainId,
      chainName: support.chainName,
      status: support.status,
      basis: support.basis,
      reason: support.reason,
      note: support.note,
      featuresDeclared: support.featuresDeclared,
      allowUnknownFeatures: support.allowUnknownFeatures,
      discovery: {
        knownContractCount: knownContracts.length,
        indexerConfigured: config.indexerUrl !== null,
        indexerName: config.indexerUrl !== null ? config.indexerName : null,
      },
      media: {
        ipfsGatewayCount: config.ipfsGateways.length,
        arweaveGatewayCount: config.arweaveGateways.length,
      },
      // Templates rather than URLs: the substitution happens in the browser, so
      // a token id is encoded into the path at render time. Null for a chain
      // with no template, and the detail view then shows the contract and id as
      // plain text — an invented explorer domain is a fabrication.
      explorer: {
        nftTemplate: config.nftExplorer[chainId] ?? null,
        txTemplate: config.txExplorer[chainId] ?? null,
      },
      ics721: {
        bridgeContract,
        destinations,
        reason: ics721Reason,
      },
      configKeys: {
        allowUnknownFeatures: NFT_ALLOW_UNKNOWN_FEATURES_KEY,
        knownContracts: NFT_CONTRACTS_KEY,
        indexer: NFT_INDEXER_KEY,
        bridges: ICS721_BRIDGES_KEY,
        channels: ICS721_CHANNELS_KEY,
        ipfsGateways: NFT_IPFS_KEY,
        arweaveGateways: NFT_ARWEAVE_KEY,
        nftExplorer: NFT_EXPLORER_KEY,
        txExplorer: TX_EXPLORER_KEY,
      },
      problems: config.problems,
    },
  });
}
