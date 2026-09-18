/**
 * Deployment configuration for the NFT surface.
 *
 * Nothing here is a constant, and nothing here has a default that reaches the
 * network. Four separate things are configured, and each one is off — with the
 * key named on screen — until an operator sets it:
 *
 * | Key | Meaning |
 * |-----|---------|
 * | `ZUNIA_NFT_CONTRACTS`   | known CW721 contracts, `chainId=addr,addr;…` |
 * | `ZUNIA_NFT_INDEXER_URL` | a real "contracts by owner" index, when one exists |
 * | `ZUNIA_NFT_INDEXER_NAME`| what to call it on screen |
 * | `ZUNIA_ICS721_BRIDGES`  | cw-ics721 bridge contract, `chainId=addr;…` |
 * | `ZUNIA_ICS721_CHANNELS` | ICS721 channels, `src>dst=channel-N;…` |
 * | `ZUNIA_NFT_IPFS_GATEWAYS`    | `ipfs://` gateway bases, https only |
 * | `ZUNIA_NFT_ARWEAVE_GATEWAYS` | `ar://` gateway bases, https only |
 * | `ZUNIA_NFT_EXPLORER`    | NFT explorer template, `chainId=https://…{contract}…{tokenId}…` |
 * | `ZUNIA_EXPLORER_TX`     | transaction explorer template, `chainId=https://…{hash}…` |
 * | `ZUNIA_NFT_ALLOW_UNKNOWN_FEATURES` | see below |
 *
 * The last one is the escape hatch for a known bug, not a convenience.
 * `zunia-extension/scripts/generate-chain-catalog.mjs` builds this app's
 * `src/data/chain-catalog.json` and drops the registry's `features[]` array, so
 * today no row says `cosmwasm` and `@zunialab/interchain` correctly refuses
 * every CW721 query with `unsupported-chain`. Until the generator carries the
 * array through, an operator who knows a chain runs `x/wasm` can set this to
 * `1` and the surface will instead probe the chain and say what it found. It is
 * an operator's informed override; it is never on by default, and the UI always
 * says which of the two answers it is acting on.
 *
 * No gateway is defaulted. A hardcoded IPFS gateway would send every user's
 * holdings to one operator, and which gateway a deployment trusts is not a
 * decision this file gets to make. See `@zunialab/interchain`'s
 * `ResolveTokenUriOptions`, which takes the same position.
 */

import "server-only";
import {
  parseAddressByChain,
  parseContractsByChain,
  parseFlag,
  parseGateways,
  parseIcs721Links,
  parseTemplateByChain,
  type ConfigProblem,
  type Ics721Link,
} from "@/lib/nft/parse-config";

export const NFT_CONTRACTS_KEY = "ZUNIA_NFT_CONTRACTS";
export const NFT_INDEXER_KEY = "ZUNIA_NFT_INDEXER_URL";
export const NFT_INDEXER_NAME_KEY = "ZUNIA_NFT_INDEXER_NAME";
export const ICS721_BRIDGES_KEY = "ZUNIA_ICS721_BRIDGES";
export const ICS721_CHANNELS_KEY = "ZUNIA_ICS721_CHANNELS";
export const NFT_IPFS_KEY = "ZUNIA_NFT_IPFS_GATEWAYS";
export const NFT_ARWEAVE_KEY = "ZUNIA_NFT_ARWEAVE_GATEWAYS";
export const NFT_ALLOW_UNKNOWN_FEATURES_KEY = "ZUNIA_NFT_ALLOW_UNKNOWN_FEATURES";
export const NFT_EXPLORER_KEY = "ZUNIA_NFT_EXPLORER";
export const TX_EXPLORER_KEY = "ZUNIA_EXPLORER_TX";

export interface NftDeploymentConfig {
  readonly knownContracts: Readonly<Record<string, readonly string[]>>;
  readonly indexerUrl: string | null;
  readonly indexerName: string;
  readonly bridges: Readonly<Record<string, string>>;
  readonly ics721Links: readonly Ics721Link[];
  readonly ipfsGateways: readonly string[];
  readonly arweaveGateways: readonly string[];
  readonly allowUnknownFeatures: boolean;
  /** Per-chain NFT explorer templates, with `{contract}` and `{tokenId}`. */
  readonly nftExplorer: Readonly<Record<string, string>>;
  /** Per-chain transaction explorer templates, with `{hash}`. */
  readonly txExplorer: Readonly<Record<string, string>>;
  /** Malformed entries, so the config route can name them instead of hiding them. */
  readonly problems: readonly ConfigProblem[];
}

/**
 * Read the environment once per call.
 *
 * Not memoised: the whole object is a handful of string splits, and a cached
 * copy in a long-lived serverless instance would outlive an operator changing a
 * key. The expensive part — asking a chain whether it runs `x/wasm` — is cached
 * in `lib/server/nft.ts`, where the cost actually is.
 */
export function nftConfig(): NftDeploymentConfig {
  const contracts = parseContractsByChain(
    process.env[NFT_CONTRACTS_KEY],
    NFT_CONTRACTS_KEY,
  );
  const bridges = parseAddressByChain(
    process.env[ICS721_BRIDGES_KEY],
    ICS721_BRIDGES_KEY,
  );
  const links = parseIcs721Links(
    process.env[ICS721_CHANNELS_KEY],
    ICS721_CHANNELS_KEY,
  );
  const ipfs = parseGateways(process.env[NFT_IPFS_KEY], NFT_IPFS_KEY);
  const arweave = parseGateways(process.env[NFT_ARWEAVE_KEY], NFT_ARWEAVE_KEY);
  const nftExplorer = parseTemplateByChain(
    process.env[NFT_EXPLORER_KEY],
    NFT_EXPLORER_KEY,
    ["contract", "tokenId"],
  );
  const txExplorer = parseTemplateByChain(
    process.env[TX_EXPLORER_KEY],
    TX_EXPLORER_KEY,
    ["hash"],
  );

  const indexerRaw = process.env[NFT_INDEXER_KEY]?.trim() || null;
  const indexerProblems: ConfigProblem[] = [];
  let indexerUrl: string | null = null;
  if (indexerRaw !== null) {
    // http:// is refused for the same reason the gateways are: this answer
    // decides which contracts get queried for the user's holdings.
    if (indexerRaw.startsWith("https://") || indexerRaw.startsWith("http://127.0.0.1")) {
      indexerUrl = indexerRaw.replace(/\/$/, "");
    } else {
      indexerProblems.push({
        key: NFT_INDEXER_KEY,
        entry: indexerRaw,
        reason: "Must be https:// (or a loopback address for local development).",
      });
    }
  }

  return {
    knownContracts: contracts.byChainId,
    indexerUrl,
    indexerName: process.env[NFT_INDEXER_NAME_KEY]?.trim() || "the configured NFT index",
    bridges: bridges.byChainId,
    ics721Links: links.links,
    ipfsGateways: ipfs.gateways,
    arweaveGateways: arweave.gateways,
    allowUnknownFeatures: parseFlag(process.env[NFT_ALLOW_UNKNOWN_FEATURES_KEY]),
    nftExplorer: nftExplorer.byChainId,
    txExplorer: txExplorer.byChainId,
    problems: [
      ...contracts.problems,
      ...bridges.problems,
      ...links.problems,
      ...ipfs.problems,
      ...arweave.problems,
      ...nftExplorer.problems,
      ...txExplorer.problems,
      ...indexerProblems,
    ],
  };
}

/** ICS721 destinations configured out of `sourceChainId`, bridge included. */
export function ics721DestinationsFrom(
  config: NftDeploymentConfig,
  sourceChainId: string,
): readonly Ics721Link[] {
  if (!config.bridges[sourceChainId]) return [];
  return config.ics721Links.filter(
    (link) => link.sourceChainId === sourceChainId,
  );
}
