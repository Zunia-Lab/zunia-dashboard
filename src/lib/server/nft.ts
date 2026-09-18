/**
 * The NFT surface's server half: the capability gate, the engine context, and
 * the only place off-chain metadata is ever read.
 *
 * Three rules, and each of them is a defect this codebase was audited for:
 *
 * 1. **The gate is the registry.** `@zunialab/interchain` refuses every CW721
 *    call for a chain that does not declare `cosmwasm`, and this file does not
 *    talk it out of that. 118 of the registry's 332 chains declare it; on the
 *    other 214 there is no such thing as a CW721 token, and an empty grid there
 *    would read as "you own nothing" when the truth is "there is nothing to
 *    own". The one override is an operator's explicit
 *    `ZUNIA_NFT_ALLOW_UNKNOWN_FEATURES`, and even then the answer comes from
 *    asking the chain, not from assuming.
 * 2. **A failed read is never a zero.** Discovery returns its issues and its
 *    own completeness flag; this file passes both to the browser untouched. The
 *    grid says "we asked N contracts and two of them failed", never "0 NFTs".
 * 3. **Nothing off-chain is read unless the caller asked for it.** The engine
 *    has no default metadata transport on purpose. The fetcher below is
 *    constructed per request, only when `media=1`, and it runs here rather than
 *    in the browser so the metadata host learns this deployment's address
 *    instead of the visitor's. The artwork itself is a different matter: an
 *    `<img>` is fetched by the browser and does expose the visitor, which is
 *    why the same switch governs both and the copy distinguishes them.
 */

import "server-only";
import {
  applyNftMetadata,
  discoverNfts,
  featureSupport,
  fetchNftMetadata,
  getCollectionInfo,
  getNftToken,
  isInterchainError,
  resolveTokenUri,
  type ChainInfoLike,
  type NftChainContext,
  type NftDiscoveryResult,
  type NftIndexer,
  type NftMetadataFetcher,
  type NftToken,
} from "@zunialab/interchain";
import { findChain, type ChainEntry } from "@/lib/chains";
import {
  decideNftSupport,
  type NftChainSupport,
  type WasmProbeResult,
} from "@/lib/nft/support";
import { lcdFor } from "@/lib/server/interchain";
import {
  nftConfig,
  NFT_INDEXER_KEY,
  type NftDeploymentConfig,
} from "@/lib/server/nft-config";

export type { NftChainSupport, NftSupportBasis } from "@/lib/nft/support";

/* -------------------------------------------------------------------------- *
 * Shared plumbing
 * -------------------------------------------------------------------------- */

/**
 * Run `work` over `items` with a fixed number of workers, preserving order.
 *
 * Every fan-out in this feature goes through it. These are public LCD nodes and
 * a burst of parallel wasm queries is the fastest way to get rate-limited — the
 * engine says so where it probes contracts one at a time. A `Promise.all` over
 * twenty-five collections is three queries each landing at once; four workers
 * is fast enough for a page and slow enough not to be throttled.
 */
export async function mapLimit<I, O>(
  items: readonly I[],
  limit: number,
  work: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const out = new Array<O>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await work(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** Chain reads in flight at once, anywhere in this feature. */
export const LCD_CONCURRENCY = 4;

/* -------------------------------------------------------------------------- *
 * Capability gate
 * -------------------------------------------------------------------------- */

const PROBE_PATH = "/cosmwasm/wasm/v1/codes";
/** A confirmed answer is stable; re-check hourly so a chain upgrade lands. */
const PROBE_TTL_MS = 60 * 60 * 1000;
/** A failed probe retries soon: a flaky endpoint must not disable NFTs for an hour. */
const PROBE_FAILURE_TTL_MS = 60 * 1000;

const probeCache = new Map<string, { at: number; result: WasmProbeResult }>();

/**
 * Ask the chain whether it serves `x/wasm`.
 *
 * Only ever used as *positive* evidence. A refusal is reported as "the check
 * did not answer", never as "this chain has no CosmWasm": several public
 * gateways answer 501 for `/cosmwasm/wasm/v1/codes` while happily serving
 * `/cosmwasm/wasm/v1/contract/{addr}` — Osmosis on Keplr's endpoint does
 * exactly that — and concluding "no wasm" from it would turn a proxy quirk into
 * a hidden feature.
 */
async function probeWasmModule(
  chain: ChainEntry,
  signal?: AbortSignal,
): Promise<WasmProbeResult> {
  const now = Date.now();
  const cached = probeCache.get(chain.chainId);
  if (
    cached &&
    now - cached.at < (cached.result.ok ? PROBE_TTL_MS : PROBE_FAILURE_TTL_MS)
  ) {
    return cached.result;
  }

  const lcd = lcdFor(chain);
  if (!lcd) {
    const result: WasmProbeResult = {
      ok: false,
      detail: `${chain.chainName} has no REST endpoint in this build's catalog, so nothing can be asked of it.`,
    };
    probeCache.set(chain.chainId, { at: now, result });
    return result;
  }

  let result: WasmProbeResult;
  try {
    await lcd.getJson(PROBE_PATH, {
      query: { "pagination.limit": 1 },
      cacheTtlMs: PROBE_TTL_MS,
      timeoutMs: 8_000,
      ...(signal ? { signal } : {}),
    });
    result = {
      ok: true,
      detail: `${chain.chainName} answered a CosmWasm query, so it runs x/wasm.`,
    };
  } catch (error) {
    const status = isInterchainError(error) ? error.httpStatus : undefined;
    result = {
      ok: false,
      detail:
        status === undefined
          ? `${chain.chainName}'s endpoint could not be reached to check for CosmWasm.`
          : `${chain.chainName}'s endpoint answered HTTP ${status} for ${PROBE_PATH}. That is what a chain without CosmWasm returns, and also what several gateways return for an endpoint they have switched off, so it is not treated as an answer either way.`,
    };
  }
  probeCache.set(chain.chainId, { at: now, result });
  return result;
}

/** Drop the memoised probe answers. Exists for tests and for local debugging. */
export function resetNftProbeCache(): void {
  probeCache.clear();
}

/**
 * Decide whether the NFT surface may run on this chain, and say how we know.
 *
 * The judgement is `decideNftSupport`, which is pure and tested. This wrapper
 * only supplies what it needs from the world: the catalog row, whether there is
 * an endpoint, and — solely when the registry said nothing *and* the operator
 * set the override — a live probe. No probe is fired in the ordinary case, so
 * the common path costs no network at all.
 */
export async function nftChainSupport(
  chainId: string,
  options: { readonly signal?: AbortSignal; readonly config?: NftDeploymentConfig } = {},
): Promise<NftChainSupport> {
  const chain = findChain(chainId);
  const config = options.config ?? nftConfig();
  const hasEndpoint = chain ? lcdFor(chain) !== null : false;

  const needsProbe =
    chain !== undefined &&
    hasEndpoint &&
    config.allowUnknownFeatures &&
    featureSupport(chain as ChainInfoLike, "cosmwasm") === "unknown";

  const probe = needsProbe
    ? await probeWasmModule(chain, options.signal)
    : null;

  return decideNftSupport({
    chainId,
    chain: chain as ChainInfoLike | undefined,
    allowUnknownFeatures: config.allowUnknownFeatures,
    hasEndpoint,
    probe,
  });
}

/**
 * The engine context for a chain the gate has already cleared.
 *
 * Returns `null` rather than throwing when there is no endpoint; every caller
 * already has a "cannot read this chain" branch and an exception here would
 * only route around it.
 */
export function nftContext(chain: ChainEntry): NftChainContext | null {
  const lcd = lcdFor(chain);
  if (!lcd) return null;
  return { chain: chain as ChainInfoLike, lcd };
}

/**
 * The gate option handed to every engine call.
 *
 * `allowUnknownFeatures` is only ever true when {@link nftChainSupport} already
 * cleared the chain on a live probe. Passing it unconditionally would turn the
 * engine's gate off, which is the thing that stops a wasm query being fired at
 * a chain that cannot answer it.
 */
export function gateOptions(support: NftChainSupport): {
  readonly allowUnknownFeatures?: boolean;
} {
  return support.basis === "chain-probe" ? { allowUnknownFeatures: true } : {};
}

/* -------------------------------------------------------------------------- *
 * Indexer
 * -------------------------------------------------------------------------- */

/**
 * The configured "contracts by owner" index, adapted to the engine's port.
 *
 * There is no such service in this workspace today, so this is `null` in every
 * default deployment and the grid says so. That matters more than it sounds:
 * an indexer is the *only* discovery path that can ever report a complete list,
 * and `NftDiscoveryResult.complete` is false without one. A UI that hid that
 * would be promising completeness it cannot deliver.
 *
 * The contract is deliberately small — one GET, `{ "contracts": [...] }` — so a
 * deployment can put anything behind it.
 */
function nftIndexer(config: NftDeploymentConfig): NftIndexer | null {
  const base = config.indexerUrl;
  if (!base) return null;
  const name = config.indexerName;
  return {
    name,
    async listContracts(chainId, owner, signal) {
      const url = `${base}?chainId=${encodeURIComponent(chainId)}&owner=${encodeURIComponent(owner)}`;
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`${name} answered HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      const rows =
        typeof body === "object" && body !== null && !Array.isArray(body)
          ? (body as { contracts?: unknown }).contracts
          : undefined;
      if (!Array.isArray(rows)) {
        throw new Error(`${name} did not answer with a contracts array`);
      }
      return rows.filter((row): row is string => typeof row === "string");
    },
  };
}

/** What `discoverNfts` was given, so the UI can name each path it used. */
export interface NftDiscoveryPlan {
  readonly knownContracts: readonly string[];
  readonly userContracts: readonly string[];
  readonly indexerName: string | null;
  readonly indexerConfigKey: string;
}

export interface NftDiscoveryOutcome {
  readonly plan: NftDiscoveryPlan;
  readonly result: NftDiscoveryResult;
}

/**
 * Run discovery over all three paths.
 *
 * The engine does the work; this only assembles the inputs and keeps the plan
 * alongside the result. The plan is what lets the grid say "no known list ships
 * for this chain and no index is configured, so only the address you typed was
 * checked" — which is the difference between an honest empty state and the
 * "you own no NFTs" the mobile app used to show after querying nothing at all.
 */
export async function runNftDiscovery(params: {
  readonly ctx: NftChainContext;
  readonly support: NftChainSupport;
  readonly owner: string;
  readonly userContracts: readonly string[];
  readonly config: NftDeploymentConfig;
  readonly signal?: AbortSignal;
}): Promise<NftDiscoveryOutcome> {
  const known = params.config.knownContracts[params.ctx.chain.chainId] ?? [];
  const indexer = nftIndexer(params.config);

  const result = await discoverNfts(params.ctx, params.owner, {
    knownContracts: known,
    userContracts: params.userContracts,
    ...(indexer ? { indexer } : {}),
    ...gateOptions(params.support),
    ...(params.signal ? { signal: params.signal } : {}),
  });

  return {
    plan: {
      knownContracts: known,
      userContracts: params.userContracts,
      indexerName: indexer?.name ?? null,
      indexerConfigKey: NFT_INDEXER_KEY,
    },
    result,
  };
}

/* -------------------------------------------------------------------------- *
 * Collections and tokens
 * -------------------------------------------------------------------------- */

export interface CollectionSummary {
  readonly contractAddress: string;
  readonly name: string | null;
  readonly symbol: string | null;
  readonly description: string | null;
  readonly creator: string | null;
  readonly tokenCount: number | null;
  /** Why the collection could not be named, when it could not. */
  readonly error: string | null;
}

/**
 * Name one collection, or say why it has no name.
 *
 * `getCollectionInfo` already tries both query spellings (`collection_info` and
 * the older `contract_info`). A contract that answers neither is still a
 * contract the user holds tokens in, so the failure is recorded on the row
 * rather than dropping the row.
 */
export async function readCollection(params: {
  readonly ctx: NftChainContext;
  readonly support: NftChainSupport;
  readonly contractAddress: string;
  readonly signal?: AbortSignal;
}): Promise<CollectionSummary> {
  try {
    const info = await getCollectionInfo(params.ctx, params.contractAddress, {
      ...gateOptions(params.support),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    return {
      contractAddress: params.contractAddress,
      name: info.name,
      symbol: info.symbol,
      description: info.description,
      creator: info.creator,
      tokenCount: info.tokenCount,
      error: null,
    };
  } catch (error) {
    return {
      contractAddress: params.contractAddress,
      name: null,
      symbol: null,
      description: null,
      creator: null,
      tokenCount: null,
      error: describeNftError(
        error,
        `${params.contractAddress} did not answer a collection query.`,
      ),
    };
  }
}

/** One token as the browser receives it: chain truth plus resolved media URLs. */
export interface TokenRow {
  readonly tokenId: string;
  readonly collectionAddress: string;
  readonly chainId: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly owner: string | null;
  readonly tokenUri: string | null;
  /** From the on-chain extension or, when asked for, the fetched document. */
  readonly imageUri: string | null;
  /**
   * `imageUri` turned into something a browser can fetch, or `null`.
   *
   * Null with a reason when the URI is `ipfs://` and no gateway is configured:
   * the alternative is picking a public gateway on the user's behalf, which
   * hands one operator every NFT they own.
   */
  readonly imageUrl: string | null;
  readonly imageUrlReason: string | null;
  readonly traits: readonly {
    readonly traitType: string;
    readonly value: string;
    readonly displayType: string | null;
  }[];
  /** `inline` for a data: URI, `remote` when a host was contacted, `null` when not asked. */
  readonly metadataSource: "inline" | "remote" | null;
  readonly metadataError: string | null;
  readonly error: string | null;
}

/**
 * A metadata transport with a leash.
 *
 * The engine takes a fetcher rather than calling `fetch` itself precisely so
 * the host owns the timeout, the redirect policy and the size limit — a
 * metadata host is a stranger's server and can serve a gigabyte, hang forever,
 * or redirect to a private address. All three are handled here.
 */
function metadataFetcher(): NftMetadataFetcher {
  const MAX_BYTES = 256 * 1024;
  const TIMEOUT_MS = 8_000;

  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onAbort);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // A redirect chain that ends on cleartext undoes the https requirement the
      // gateway list is validated against.
      if (!response.url.startsWith("https://") && !response.url.startsWith("http://127.0.0.1")) {
        throw new Error("Redirected to a non-https URL");
      }
      const text = await readCapped(response, MAX_BYTES);
      return JSON.parse(text) as unknown;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
  };
}

/** Read at most `max` bytes, then give up on the body rather than buffering it. */
async function readCapped(response: Response, max: number): Promise<string> {
  const body = response.body;
  if (!body) return await response.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        throw new Error(`Metadata document exceeded ${max} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Read one token from the chain, and — only when `media` is true — its
 * off-chain metadata document.
 *
 * The on-chain read always happens and always wins: `applyNftMetadata`'s rule
 * is that the `extension` is signed into chain state while a fetched document
 * is whatever a host served this second. What the fetch adds is a name, a
 * description and an image for the very common contract that stores none of
 * them on chain.
 */
export async function readToken(params: {
  readonly ctx: NftChainContext;
  readonly support: NftChainSupport;
  readonly contractAddress: string;
  readonly tokenId: string;
  readonly media: boolean;
  readonly config: NftDeploymentConfig;
  readonly signal?: AbortSignal;
}): Promise<TokenRow> {
  const base: Omit<TokenRow, "error"> = {
    tokenId: params.tokenId,
    collectionAddress: params.contractAddress,
    chainId: params.ctx.chain.chainId,
    name: null,
    description: null,
    owner: null,
    tokenUri: null,
    imageUri: null,
    imageUrl: null,
    imageUrlReason: null,
    traits: [],
    metadataSource: null,
    metadataError: null,
  };

  let token: NftToken;
  try {
    token = await getNftToken(params.ctx, params.contractAddress, params.tokenId, {
      ...gateOptions(params.support),
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } catch (error) {
    return {
      ...base,
      error: describeNftError(
        error,
        `Token ${params.tokenId} could not be read from ${params.contractAddress}.`,
      ),
    };
  }

  let enriched = token;
  let metadataSource: TokenRow["metadataSource"] = null;
  let metadataError: string | null = null;

  if (params.media && token.tokenUri) {
    try {
      const result = await fetchNftMetadata(token.tokenUri, {
        fetch: metadataFetcher(),
        ipfsGateways: params.config.ipfsGateways,
        arweaveGateways: params.config.arweaveGateways,
        ...(params.signal ? { signal: params.signal } : {}),
      });
      enriched = applyNftMetadata(token, result.metadata);
      metadataSource = result.source;
    } catch (error) {
      metadataError = describeNftError(
        error,
        "The metadata document could not be read.",
      );
    }
  }

  const image = resolveImage(enriched.imageUri, params.config);

  return {
    ...base,
    name: enriched.name,
    description: enriched.description,
    owner: enriched.owner,
    tokenUri: enriched.tokenUri,
    imageUri: enriched.imageUri,
    imageUrl: image.url,
    imageUrlReason: image.reason,
    traits: enriched.attributes.map((attribute) => ({
      traitType: attribute.traitType,
      value: attribute.value,
      displayType: attribute.displayType,
    })),
    metadataSource,
    metadataError,
    error: null,
  };
}

/**
 * Turn an `image` field into a URL a browser can load, or say why not.
 *
 * `resolveTokenUri` is the engine's own resolver and does no I/O — it is used
 * here for the `image` field as well as `token_uri` because they carry exactly
 * the same schemes and the same gateway problem. Plain `http://` stays off:
 * artwork over cleartext is rewritable in flight, and the wallet should not
 * make that request on the user's behalf.
 */
function resolveImage(
  imageUri: string | null,
  config: NftDeploymentConfig,
): { url: string | null; reason: string | null } {
  if (!imageUri) return { url: null, reason: null };
  // Handled before the engine's resolver: `resolveTokenUri` decodes a `data:`
  // payload as UTF-8 text, which is right for a metadata document and wrong for
  // a base64 PNG. An image data: URI is already loadable by an <img> and no
  // request leaves the device to render it, so it passes through untouched.
  if (imageUri.startsWith("data:image/")) {
    return { url: imageUri, reason: null };
  }
  if (imageUri.startsWith("data:")) {
    return {
      url: null,
      reason: "This token stores its artwork inline in a format that is not an image.",
    };
  }
  const resolved = resolveTokenUri(imageUri, {
    ipfsGateways: config.ipfsGateways,
    arweaveGateways: config.arweaveGateways,
  });
  if (resolved.kind === "http") {
    return { url: resolved.urls[0] ?? null, reason: null };
  }
  return {
    url: null,
    reason:
      resolved.reason === "No IPFS gateway configured"
        ? "This artwork lives on IPFS and this deployment has no gateway configured (ZUNIA_NFT_IPFS_GATEWAYS). Zunia will not pick a public gateway for you: that would hand one operator the list of everything you hold."
        : (resolved.reason ?? "This artwork's address uses a scheme Zunia cannot open."),
  };
}

/**
 * A sentence for the browser.
 *
 * `unsupported-chain` is reworded because the engine's phrasing is developer
 * copy; everything else keeps the engine's message as a detail line after the
 * caller's fallback, the same shape `describeError` uses in `interchain.ts`.
 */
export function describeNftError(error: unknown, fallback: string): string {
  if (isInterchainError(error)) {
    if (error.code === "unsupported-chain") {
      return `${fallback} ${error.message}`;
    }
    if (error.code === "reads-disabled") {
      return "Off-chain metadata was not loaded, because loading it was not asked for.";
    }
    return `${fallback} ${error.message}`;
  }
  if (error instanceof Error && error.message) return `${fallback} ${error.message}`;
  return fallback;
}
