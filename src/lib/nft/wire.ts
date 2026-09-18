/**
 * The JSON contract between `/api/nft/*` and the browser.
 *
 * Same two rules as `lib/interchain/wire.ts`, for the same reasons. Chain reads
 * happen in the route handlers, so the browser receives inert JSON; and the
 * browser does not trust the shape of that JSON even though it came from our
 * own origin, because a proxy, a stale service worker or a half-rolled deploy
 * can all put something else on the wire. Every field is narrowed below and a
 * row that does not narrow is dropped rather than rendered half-typed.
 *
 * The failure envelope is deliberately the interchain one: an NFT screen and a
 * swap screen must not need two error taxonomies, and `code` is what the UI
 * branches on.
 */

import type {
  InterchainFailure,
  PacketFailureWire,
  PacketStatusWire,
  TxStatusStateWire,
  TxStatusWire,
} from "@/lib/interchain/wire";
import { readFailure } from "@/lib/interchain/wire";

export type { InterchainFailure } from "@/lib/interchain/wire";

export type NftResult<T> = ({ readonly ok: true } & T) | InterchainFailure;

/* -------------------------------------------------------------------------- *
 * Availability
 * -------------------------------------------------------------------------- */

/**
 * Three states, three screens.
 *
 * `unverified` exists because the chain catalog currently ships no `features[]`
 * array. Collapsing it into `unsupported` would tell a user their chain cannot
 * hold NFTs when nobody has actually checked; collapsing it into `supported`
 * would fire wasm queries at chains that cannot answer them.
 */
export type NftChainStatusWire = "supported" | "unsupported" | "unverified";

export type NftSupportBasisWire =
  | "registry-declared"
  | "registry-denied"
  | "catalog-missing"
  | "chain-probe"
  | "probe-failed"
  | "no-endpoint";

export interface Ics721DestinationWire {
  readonly chainId: string;
  readonly chainName: string;
  readonly channelId: string;
  readonly inCatalog: boolean;
}

export interface NftConfigWire {
  readonly chainId: string;
  readonly chainName: string;
  readonly status: NftChainStatusWire;
  readonly basis: NftSupportBasisWire;
  /** Present whenever `status` is not `supported`. Shown on the disabled control. */
  readonly reason: string | null;
  /** Present when support rests on a live probe rather than the registry. */
  readonly note: string | null;
  readonly featuresDeclared: boolean;
  readonly allowUnknownFeatures: boolean;
  readonly discovery: {
    readonly knownContractCount: number;
    readonly indexerConfigured: boolean;
    readonly indexerName: string | null;
  };
  readonly media: {
    readonly ipfsGatewayCount: number;
    readonly arweaveGatewayCount: number;
  };
  /**
   * Explorer URL templates for this chain, or null.
   *
   * Null is the common case and is rendered as "no explorer is configured", not
   * as a guessed domain. `{contract}`, `{tokenId}` and `{hash}` are substituted
   * in the browser with `fillTemplate`, which URL-encodes every value.
   */
  readonly explorer: {
    readonly nftTemplate: string | null;
    readonly txTemplate: string | null;
  };
  readonly ics721: {
    readonly bridgeContract: string | null;
    readonly destinations: readonly Ics721DestinationWire[];
    /** Present whenever a cross-chain transfer cannot be built. Names the key. */
    readonly reason: string | null;
  };
  readonly configKeys: {
    readonly allowUnknownFeatures: string;
    readonly knownContracts: string;
    readonly indexer: string;
    readonly bridges: string;
    readonly channels: string;
    readonly ipfsGateways: string;
    readonly arweaveGateways: string;
    readonly nftExplorer: string;
    readonly txExplorer: string;
  };
  /** Malformed operator entries. Rendered, not swallowed. */
  readonly problems: readonly {
    readonly key: string;
    readonly entry: string;
    readonly reason: string;
  }[];
}

export type NftConfigResponse = NftResult<{ readonly config: NftConfigWire }>;

/* -------------------------------------------------------------------------- *
 * Discovery
 * -------------------------------------------------------------------------- */

export type NftDiscoverySourceWire = "known" | "indexer" | "user";

export interface NftCollectionWire {
  readonly contractAddress: string;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly description: string | null;
  readonly creator: string | null;
  readonly tokenCount: number | null;
  readonly error: string | null;
}

export interface NftHoldingWire {
  readonly contractAddress: string;
  readonly source: NftDiscoverySourceWire;
  readonly tokenIds: readonly string[];
  /** The per-contract cap cut the list short. Shown, never hidden. */
  readonly truncated: boolean;
  readonly collection: NftCollectionWire | null;
}

export interface NftCollectionsBody {
  readonly chainId: string;
  readonly chainName: string;
  readonly owner: string;
  readonly holdings: readonly NftHoldingWire[];
  readonly sources: readonly NftDiscoverySourceWire[];
  /** True only when an indexer answered cleanly. Never assumed. */
  readonly complete: boolean;
  readonly limitation: string | null;
  readonly issues: readonly {
    readonly contractAddress: string | null;
    readonly message: string;
  }[];
  readonly plan: {
    readonly knownContractCount: number;
    readonly userContracts: readonly string[];
    readonly indexerName: string | null;
    readonly indexerConfigKey: string;
  };
  /**
   * How many contracts were actually asked.
   *
   * The one number that separates "you hold none" from "nothing was queried".
   * A screen that renders an empty state without reading this is repeating the
   * defect this whole surface was written to avoid.
   */
  readonly queriedContractCount: number;
}

export type NftCollectionsResponse = NftResult<{
  readonly collections: NftCollectionsBody;
}>;

/* -------------------------------------------------------------------------- *
 * Tokens
 * -------------------------------------------------------------------------- */

export interface NftTraitWire {
  readonly traitType: string;
  readonly value: string;
  readonly displayType: string | null;
}

export interface NftTokenWire {
  readonly tokenId: string;
  readonly collectionAddress: string;
  readonly chainId: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly owner: string | null;
  readonly tokenUri: string | null;
  readonly imageUri: string | null;
  /** Already resolved to something a browser can fetch, or null with a reason. */
  readonly imageUrl: string | null;
  readonly imageUrlReason: string | null;
  readonly traits: readonly NftTraitWire[];
  readonly metadataSource: "inline" | "remote" | null;
  readonly metadataError: string | null;
  /** The on-chain read failed. The token is still listed, with this sentence. */
  readonly error: string | null;
}

export interface NftTokensBody {
  readonly chainId: string;
  readonly chainName: string;
  readonly contractAddress: string;
  /** Echoed so "media off" and "media on, host silent" stay distinguishable. */
  readonly mediaRequested: boolean;
  readonly ipfsGatewayConfigured: boolean;
  readonly tokens: readonly NftTokenWire[];
  readonly collection: NftCollectionWire | null;
}

/** `page`, not `tokens`: the body is one bounded page of a collection. */
export type NftTokensResponse = NftResult<{ readonly page: NftTokensBody }>;

/* -------------------------------------------------------------------------- *
 * Readers
 * -------------------------------------------------------------------------- */

const STATUSES: ReadonlySet<string> = new Set<NftChainStatusWire>([
  "supported",
  "unsupported",
  "unverified",
]);

const BASES: ReadonlySet<string> = new Set<NftSupportBasisWire>([
  "registry-declared",
  "registry-denied",
  "catalog-missing",
  "chain-probe",
  "probe-failed",
  "no-endpoint",
]);

const SOURCES: ReadonlySet<string> = new Set<NftDiscoverySourceWire>([
  "known",
  "indexer",
  "user",
]);

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function optionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

/** A URL this app is willing to put in an href, or null. */
function httpsOnly(value: unknown): string | null {
  const url = optionalStr(value);
  return url !== null && url.startsWith("https://") ? url : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readList<T>(value: unknown, read: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const row of value) {
    const parsed = read(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

function malformed(what: string): InterchainFailure {
  return {
    ok: false,
    code: "malformed-response",
    message: `${what} answered with something this build cannot read.`,
  };
}

export function readNftCollection(value: unknown): NftCollectionWire | null {
  const row = record(value);
  if (!row) return null;
  const contractAddress = optionalStr(row.contractAddress);
  if (!contractAddress) return null;
  return {
    contractAddress,
    name: optionalStr(row.name),
    symbol: optionalStr(row.symbol),
    description: optionalStr(row.description),
    creator: optionalStr(row.creator),
    tokenCount: optionalCount(row.tokenCount),
    error: optionalStr(row.error),
  };
}

export function readNftConfig(value: unknown): NftConfigWire | null {
  const row = record(value);
  if (!row) return null;
  const chainId = optionalStr(row.chainId);
  const status = str(row.status);
  const basis = str(row.basis);
  if (!chainId || !STATUSES.has(status) || !BASES.has(basis)) return null;

  const discovery = record(row.discovery);
  const media = record(row.media);
  const ics721 = record(row.ics721);
  const explorer = record(row.explorer);
  const keys = record(row.configKeys);

  return {
    chainId,
    chainName: str(row.chainName, chainId),
    status: status as NftChainStatusWire,
    basis: basis as NftSupportBasisWire,
    reason: optionalStr(row.reason),
    note: optionalStr(row.note),
    featuresDeclared: bool(row.featuresDeclared),
    allowUnknownFeatures: bool(row.allowUnknownFeatures),
    discovery: {
      knownContractCount: count(discovery?.knownContractCount),
      indexerConfigured: bool(discovery?.indexerConfigured),
      indexerName: optionalStr(discovery?.indexerName),
    },
    media: {
      ipfsGatewayCount: count(media?.ipfsGatewayCount),
      arweaveGatewayCount: count(media?.arweaveGatewayCount),
    },
    explorer: {
      // https only, checked again here: the server validated the template but
      // this value ends up in an href and the browser is the last gate.
      nftTemplate: httpsOnly(explorer?.nftTemplate),
      txTemplate: httpsOnly(explorer?.txTemplate),
    },
    ics721: {
      bridgeContract: optionalStr(ics721?.bridgeContract),
      destinations: readList(ics721?.destinations, (entry) => {
        const dest = record(entry);
        const destChainId = dest ? optionalStr(dest.chainId) : null;
        const channelId = dest ? optionalStr(dest.channelId) : null;
        if (!destChainId || !channelId) return null;
        return {
          chainId: destChainId,
          chainName: str(dest?.chainName, destChainId),
          channelId,
          inCatalog: bool(dest?.inCatalog),
        };
      }),
      reason: optionalStr(ics721?.reason),
    },
    configKeys: {
      allowUnknownFeatures: str(keys?.allowUnknownFeatures, "ZUNIA_NFT_ALLOW_UNKNOWN_FEATURES"),
      knownContracts: str(keys?.knownContracts, "ZUNIA_NFT_CONTRACTS"),
      indexer: str(keys?.indexer, "ZUNIA_NFT_INDEXER_URL"),
      bridges: str(keys?.bridges, "ZUNIA_ICS721_BRIDGES"),
      channels: str(keys?.channels, "ZUNIA_ICS721_CHANNELS"),
      ipfsGateways: str(keys?.ipfsGateways, "ZUNIA_NFT_IPFS_GATEWAYS"),
      arweaveGateways: str(keys?.arweaveGateways, "ZUNIA_NFT_ARWEAVE_GATEWAYS"),
      nftExplorer: str(keys?.nftExplorer, "ZUNIA_NFT_EXPLORER"),
      txExplorer: str(keys?.txExplorer, "ZUNIA_EXPLORER_TX"),
    },
    problems: readList(row.problems, (entry) => {
      const problem = record(entry);
      const key = problem ? optionalStr(problem.key) : null;
      if (!key) return null;
      return {
        key,
        entry: str(problem?.entry),
        reason: str(problem?.reason),
      };
    }),
  };
}

export function readNftConfigResponse(value: unknown): NftConfigResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  const config = row && row.ok === true ? readNftConfig(row.config) : null;
  if (!config) return malformed("The NFT configuration");
  return { ok: true, config };
}

function readHolding(value: unknown): NftHoldingWire | null {
  const row = record(value);
  if (!row) return null;
  const contractAddress = optionalStr(row.contractAddress);
  if (!contractAddress) return null;
  const source = str(row.source, "known");
  return {
    contractAddress,
    source: SOURCES.has(source) ? (source as NftDiscoverySourceWire) : "known",
    tokenIds: stringList(row.tokenIds),
    truncated: bool(row.truncated),
    collection: readNftCollection(row.collection),
  };
}

export function readNftCollectionsResponse(value: unknown): NftCollectionsResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  if (!row || row.ok !== true) return malformed("The NFT collection list");
  const chainId = optionalStr(row.chainId);
  const owner = optionalStr(row.owner);
  if (!chainId || !owner) return malformed("The NFT collection list");
  const plan = record(row.plan);
  return {
    ok: true,
    collections: {
      chainId,
      chainName: str(row.chainName, chainId),
      owner,
      holdings: readList(row.holdings, readHolding),
      sources: stringList(row.sources).filter(
        (entry): entry is NftDiscoverySourceWire => SOURCES.has(entry),
      ),
      complete: bool(row.complete),
      limitation: optionalStr(row.limitation),
      issues: readList(row.issues, (entry) => {
        const issue = record(entry);
        if (!issue) return null;
        const message = optionalStr(issue.message);
        if (!message) return null;
        return { contractAddress: optionalStr(issue.contractAddress), message };
      }),
      plan: {
        knownContractCount: count(plan?.knownContractCount),
        userContracts: stringList(plan?.userContracts),
        indexerName: optionalStr(plan?.indexerName),
        indexerConfigKey: str(plan?.indexerConfigKey, "ZUNIA_NFT_INDEXER_URL"),
      },
      // Defaults to 0, which the UI reads as "nothing was queried" — the safe
      // direction if the field ever goes missing on the wire.
      queriedContractCount: count(row.queriedContractCount),
    },
  };
}

export function readNftToken(value: unknown): NftTokenWire | null {
  const row = record(value);
  if (!row) return null;
  const tokenId = optionalStr(row.tokenId);
  const collectionAddress = optionalStr(row.collectionAddress);
  if (!tokenId || !collectionAddress) return null;
  const metadataSource = str(row.metadataSource);
  return {
    tokenId,
    collectionAddress,
    chainId: str(row.chainId),
    name: optionalStr(row.name),
    description: optionalStr(row.description),
    owner: optionalStr(row.owner),
    tokenUri: optionalStr(row.tokenUri),
    imageUri: optionalStr(row.imageUri),
    imageUrl: optionalStr(row.imageUrl),
    imageUrlReason: optionalStr(row.imageUrlReason),
    traits: readList(row.traits, (entry) => {
      const trait = record(entry);
      if (!trait) return null;
      const traitValue = typeof trait.value === "string" ? trait.value : null;
      if (traitValue === null) return null;
      return {
        traitType: str(trait.traitType),
        value: traitValue,
        displayType: optionalStr(trait.displayType),
      };
    }),
    metadataSource:
      metadataSource === "inline" || metadataSource === "remote"
        ? metadataSource
        : null,
    metadataError: optionalStr(row.metadataError),
    error: optionalStr(row.error),
  };
}

export function readNftTokensResponse(value: unknown): NftTokensResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  if (!row || row.ok !== true) return malformed("The token read");
  const chainId = optionalStr(row.chainId);
  const contractAddress = optionalStr(row.contractAddress);
  if (!chainId || !contractAddress) return malformed("The token read");
  return {
    ok: true,
    page: {
      chainId,
      chainName: str(row.chainName, chainId),
      contractAddress,
      mediaRequested: bool(row.mediaRequested),
      ipfsGatewayConfigured: bool(row.ipfsGatewayConfigured),
      tokens: readList(row.tokens, readNftToken),
      collection: readNftCollection(row.collection),
    },
  };
}

/* -------------------------------------------------------------------------- *
 * ICS721 packet tracking
 * -------------------------------------------------------------------------- */

/**
 * Where a cross-chain NFT transfer got to.
 *
 * Two independent facts, kept apart on purpose. `tx` is whether the source
 * chain accepted the execute; `packet` is whether the destination received what
 * it sent. A successful transaction whose packet timed out is a real and common
 * state, and collapsing the two would render it as success.
 */
export interface NftTrackWire {
  readonly chainId: string;
  readonly chainName: string;
  readonly tx: TxStatusWire;
  /** Null when there is no ICS721 packet: a same-chain transfer, or not found. */
  readonly packet: {
    readonly sequence: string;
    readonly sourcePort: string;
    readonly sourceChannelId: string;
    readonly destChannelId: string;
    readonly status: PacketStatusWire;
    readonly failure: PacketFailureWire | null;
    readonly receiveTxHash: string | null;
    readonly ackTxHash: string | null;
    readonly timeoutTxHash: string | null;
    readonly error: string | null;
    /** The bridge has already given the token back. Reported, never inferred. */
    readonly fundsRefunded: boolean;
  } | null;
  /** False when the destination chain has no endpoint; the copy says so. */
  readonly destinationQueried: boolean;
  readonly notes: readonly string[];
}

export type NftTrackResponse = NftResult<{ readonly trace: NftTrackWire }>;

const PACKET_STATUSES: ReadonlySet<string> = new Set<PacketStatusWire>([
  "pending",
  "relayed",
  "received",
  "acknowledged",
  "timeout",
  "failed",
  "unknown",
]);

const PACKET_FAILURES: ReadonlySet<string> = new Set<PacketFailureWire>([
  "timeout",
  "ack-error",
  "stalled",
  "swap-delivery-failed",
]);

const TX_STATES: ReadonlySet<string> = new Set<TxStatusStateWire>([
  "pending",
  "success",
  "failed",
  "not-found",
]);

export function readNftTrackResponse(value: unknown): NftTrackResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  if (!row || row.ok !== true) return malformed("Packet tracking");
  const txRow = record(row.tx);
  const txHash = txRow ? optionalStr(txRow.txHash) : null;
  if (!txRow || !txHash) return malformed("Packet tracking");

  const state = str(txRow.state, "not-found");
  const packetRow = record(row.packet);
  const packetStatus = packetRow ? str(packetRow.status, "unknown") : "unknown";
  const packetFailure = packetRow ? str(packetRow.failure) : "";
  const sequence = packetRow ? optionalStr(packetRow.sequence) : null;

  return {
    ok: true,
    trace: {
      chainId: str(row.chainId),
      chainName: str(row.chainName, str(row.chainId)),
      tx: {
        txHash,
        // An unrecognised state becomes `not-found`, which keeps the UI polling
        // rather than declaring an outcome it did not read.
        state: TX_STATES.has(state) ? (state as TxStatusStateWire) : "not-found",
        code:
          typeof txRow.code === "number" && Number.isFinite(txRow.code)
            ? txRow.code
            : null,
        height: optionalStr(txRow.height),
        rawLog: optionalStr(txRow.rawLog),
        timestamp: optionalStr(txRow.timestamp),
      },
      packet:
        packetRow && sequence
          ? {
              sequence,
              sourcePort: str(packetRow.sourcePort),
              sourceChannelId: str(packetRow.sourceChannelId),
              destChannelId: str(packetRow.destChannelId),
              status: PACKET_STATUSES.has(packetStatus)
                ? (packetStatus as PacketStatusWire)
                : "unknown",
              failure: PACKET_FAILURES.has(packetFailure)
                ? (packetFailure as PacketFailureWire)
                : null,
              receiveTxHash: optionalStr(packetRow.receiveTxHash),
              ackTxHash: optionalStr(packetRow.ackTxHash),
              timeoutTxHash: optionalStr(packetRow.timeoutTxHash),
              error: optionalStr(packetRow.error),
              fundsRefunded: bool(packetRow.fundsRefunded),
            }
          : null,
      destinationQueried: bool(row.destinationQueried),
      notes: stringList(row.notes),
    },
  };
}
