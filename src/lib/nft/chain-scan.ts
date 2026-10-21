/**
 * The chain scan: CW721 collections found from a chain's own wasm code list.
 *
 * CosmWasm keeps no index of NFTs by owner. `tokens` is asked of one contract
 * at a time, so without contract addresses there is nothing to ask, and on a
 * chain this deployment lists nothing for (every chain, by default) the grid
 * could only ever say "nothing was checked". The extension
 * (`scanCw721Contracts` in its lib/nft.ts) and Zunia Mobile
 * (`nft_code_scan.dart`) find candidates on the chain itself, and this is the
 * same walk, run on the server:
 *
 * 1. List the newest wasm codes.
 * 2. Contracts of one code run the same bytecode, so "is this a CW721?" is a
 *    question about the code. It is asked once per code, with the engine's own
 *    `tokens` query, on up to two instances.
 * 3. The verdict is kept for good: wasm code never changes.
 * 4. The instances of the CW721 codes, newest first and within a budget, go
 *    to `discoverNfts` as candidates.
 *
 * Candidates, deliberately not an `NftIndexer`: the engine calls a list
 * complete when an indexer answers, and a budgeted look at the newest codes is
 * never that. The result stays `complete: false`, and the page says which
 * codes were looked at.
 *
 * On the server one scan serves every visitor, which adds two rules the apps
 * do not need. The walk is single-flight per chain, so a cold cache under load
 * sends one walk to a public node instead of one per visitor. And it runs on
 * its own deadline, not on a visitor's request: whoever leaves first must not
 * cancel the walk everyone else is waiting on.
 *
 * Nothing here imports `server-only` or does I/O of its own (the chain comes
 * in as an `NftChainContext`, the disk as a {@link ChainScanFile}), so
 * node:test can load it.
 */

import {
  checkAddress,
  isInterchainError,
  listOwnedTokenIds,
  type NftChainContext,
  type NftDiscoveryResult,
  type NftHolding,
} from "@zunialab/interchain";
import type { NftDiscoverySourceWire } from "./wire";

/* -------------------------------------------------------------------------- *
 * Budget
 * -------------------------------------------------------------------------- */

/**
 * Wasm codes looked at per walk, newest first.
 *
 * Newest first because a code uploaded recently is far likelier to be a live
 * collection than code 1. The first walk of a chain spends a listing and a
 * probe or two per code; after that only the CW721 codes cost anything, since
 * every other verdict is already known.
 */
export const SCAN_MAX_CODES = 40;

/** CW721 contracts one walk hands to discovery. */
export const SCAN_MAX_CONTRACTS = 50;

/**
 * Instances listed per code. One popular code can have thousands, and a walk
 * that listed them all would spend its budget inside one code.
 */
export const SCAN_MAX_CONTRACTS_PER_CODE = 25;

/** Instances asked before a code is left unjudged: one dead contract must not condemn its code. */
const CLASSIFY_ATTEMPTS = 2;

/** How long a clean walk's contract list is reused. Verdicts never expire. */
export const SCAN_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long a walk with holes is reused: a code that did not answer, or a
 * deadline reached before the window was done. Caching that list for six hours
 * would hide the missing codes' collections from every visitor for six hours,
 * over what was only a slow node.
 */
export const SCAN_PARTIAL_TTL_MS = 10 * 60 * 1000;

/** How long a code list that did not answer is left alone before it is asked again. */
export const SCAN_FAILURE_TTL_MS = 60 * 1000;

/* -------------------------------------------------------------------------- *
 * One walk
 * -------------------------------------------------------------------------- */

/** Whether a wasm code answers the CW721 `tokens` query. */
export type CodeVerdict = "cw721" | "other";

/** The engine's gate option, as `gateOptions` in lib/server/nft builds it. */
export interface ScanGate {
  readonly allowUnknownFeatures?: boolean;
}

/** What the page is told about a scan. */
export interface ChainScanReport {
  /**
   * `ran`: the code list was read. `failed`: it was not, and no earlier walk
   * of this chain exists to fall back on.
   */
  readonly status: "ran" | "failed";
  /** Codes in the window that were accounted for: judged, or with no contract to judge. */
  readonly codesChecked: number;
  /** Codes in the window that did not answer this time. Any at all shortens the list's life. */
  readonly codesUnread: number;
  /**
   * False when the node refused `pagination.reverse` and the window is the
   * first page in whatever order the node keeps, so the page must not say
   * "newest".
   */
  readonly newestFirst: boolean;
  /** When the code list was read, epoch ms. Null when it never has been. */
  readonly checkedAt: number | null;
}

export interface ChainScan extends ChainScanReport {
  /** CW721 instances, newest code first. Candidates, not holdings: each one is still asked. */
  readonly contracts: readonly string[];
}

/**
 * True when a failed `tokens` query means "this contract does not implement it".
 *
 * The engine reports a contract's own refusal as `contract-error` (wasmd
 * answers a query a contract cannot parse with an error, not with data) and an
 * envelope it cannot read as `malformed-response`; a bare HTTP 400 is the same
 * refusal from a node the engine did not reclassify. All of those are answers.
 * A timeout, a 429, a struggling node's 5xx and a cancelled read are not: the
 * node said nothing about the contract, and a verdict cached from that would be
 * permanent.
 */
export function isNotCw721(error: unknown): boolean {
  if (!isInterchainError(error)) return false;
  if (error.code === "aborted" || error.code === "reads-disabled") return false;
  if (error.code === "contract-error" || error.code === "malformed-response") {
    return true;
  }
  return error.httpStatus === 400;
}

/** The same verdict, read off an issue: the engine writes them as `"<code>: <message>"`. */
export function isNotCw721Issue(message: string): boolean {
  return /^(contract-error|malformed-response):/.test(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Code ids are uint64s and land in a URL path, so nothing else is accepted. */
const CODE_ID = /^\d{1,20}$/;

/**
 * Wasm code ids, newest first.
 *
 * `pagination.reverse` is a standard `PageRequest` field, but a node behind a
 * trimming proxy can still reject it, so a rejection is asked once more
 * without it. Losing "newest first" narrows the scan; failing the whole page
 * over a query string would not be a trade.
 */
export async function listWasmCodeIds(
  ctx: NftChainContext,
  signal: AbortSignal,
): Promise<{ readonly ids: string[]; readonly newestFirst: boolean }> {
  const path = "/cosmwasm/wasm/v1/code";
  let body: unknown;
  let newestFirst = true;
  try {
    body = await ctx.lcd.getJson(path, {
      query: { "pagination.limit": SCAN_MAX_CODES, "pagination.reverse": true },
      signal,
    });
  } catch (error) {
    if (isInterchainError(error) && error.code === "aborted") throw error;
    newestFirst = false;
    body = await ctx.lcd.getJson(path, {
      query: { "pagination.limit": SCAN_MAX_CODES },
      signal,
    });
  }
  const rows = isRecord(body) && Array.isArray(body.code_infos) ? body.code_infos : [];
  const ids: string[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = String(row.code_id ?? row.id ?? "");
    if (CODE_ID.test(id) && !ids.includes(id)) ids.push(id);
  }
  return { ids, newestFirst };
}

/**
 * One page of a code's instances, newest first.
 *
 * Only addresses of this chain are kept: they come from a public node, they
 * end up in a cache every visitor reads, and each one is queried on the
 * visitor's behalf.
 */
export async function listCodeContracts(
  ctx: NftChainContext,
  codeId: string,
  signal: AbortSignal,
): Promise<string[]> {
  const body = await ctx.lcd.getJson(
    `/cosmwasm/wasm/v1/code/${encodeURIComponent(codeId)}/contracts`,
    {
      query: {
        "pagination.limit": SCAN_MAX_CONTRACTS_PER_CODE,
        "pagination.reverse": true,
      },
      signal,
    },
  );
  const rows = isRecord(body) && Array.isArray(body.contracts) ? body.contracts : [];
  const out: string[] = [];
  for (const row of rows) {
    if (typeof row !== "string" || out.includes(row)) continue;
    if (checkAddress(row, ctx.chain).ok) out.push(row);
  }
  return out;
}

/**
 * Decide whether a code is a CW721 by asking up to two of its instances.
 *
 * The probe is the engine's `listOwnedTokenIds`, the exact `tokens` query
 * discovery sends, so passing it means discovery's own question will be
 * understood. The owner asked about is the instance's own address, not the
 * visitor's: the verdict is shared and permanent, so it must not depend on
 * who happened to open the page first, and a contract address is a valid
 * owner on its own chain by construction.
 *
 * Null when neither instance gave an answer either way, because a verdict
 * cached from an outage would never be revisited.
 */
export async function classifyCode(
  ctx: NftChainContext,
  instances: readonly string[],
  gate: ScanGate,
  signal: AbortSignal,
): Promise<CodeVerdict | null> {
  for (const address of instances.slice(0, CLASSIFY_ATTEMPTS)) {
    try {
      await listOwnedTokenIds(ctx, address, address, { ...gate, signal });
      return "cw721";
    } catch (error) {
      if (isNotCw721(error)) return "other";
      if (signal.aborted) return null;
    }
  }
  return null;
}

type CodeOutcome =
  | { readonly kind: "cw721"; readonly instances: readonly string[] }
  | { readonly kind: "other" }
  | { readonly kind: "empty" }
  | { readonly kind: "unread" };

/** What one walk learned, before it is cached. */
export interface CodeWalk {
  /** False when the code list itself did not answer: nothing else was asked. */
  readonly listed: boolean;
  readonly newestFirst: boolean;
  /** Every verdict known after the walk: the ones it started with, plus the new ones. */
  readonly verdicts: Readonly<Record<string, CodeVerdict>>;
  readonly contracts: readonly string[];
  readonly codesChecked: number;
  readonly codesUnread: number;
}

/**
 * Walk the newest codes and collect the CW721 instances.
 *
 * Codes are judged `concurrency` at a time, in order, and the walk stops at
 * the end of the batch that fills the budget. A worker pool would be a little
 * faster, but then which codes fill the budget would depend on which node
 * answered first, and the list must be newest-first whatever the latency.
 *
 * Never throws. A code that does not answer is counted in `codesUnread` and
 * left unjudged; `signal` firing stops the walk where it is, and every verdict
 * already reached is kept.
 */
export async function walkCodes(params: {
  readonly ctx: NftChainContext;
  readonly gate: ScanGate;
  readonly verdicts: Readonly<Record<string, CodeVerdict>>;
  readonly concurrency: number;
  readonly signal: AbortSignal;
}): Promise<CodeWalk> {
  const { ctx, gate, signal } = params;
  const verdicts: Record<string, CodeVerdict> = { ...params.verdicts };

  let listing: { readonly ids: string[]; readonly newestFirst: boolean };
  try {
    listing = await listWasmCodeIds(ctx, signal);
  } catch {
    return {
      listed: false,
      newestFirst: false,
      verdicts,
      contracts: [],
      codesChecked: 0,
      codesUnread: 0,
    };
  }

  const judge = async (codeId: string): Promise<CodeOutcome> => {
    const known = verdicts[codeId];
    // A code already known not to be a CW721 costs nothing: its instances
    // are never listed and never asked.
    if (known === "other") return { kind: "other" };
    try {
      const instances = await listCodeContracts(ctx, codeId, signal);
      if (instances.length === 0) return { kind: "empty" };
      const verdict = known ?? (await classifyCode(ctx, instances, gate, signal));
      if (verdict === null) return { kind: "unread" };
      return verdict === "cw721" ? { kind: "cw721", instances } : { kind: "other" };
    } catch {
      return { kind: "unread" };
    }
  };

  const ids = listing.ids;
  const width = Math.max(1, Math.trunc(params.concurrency));
  const contracts: string[] = [];
  let codesChecked = 0;
  let codesUnread = 0;
  let next = 0;

  while (next < ids.length && contracts.length < SCAN_MAX_CONTRACTS) {
    if (signal.aborted) {
      // Out of time: the codes not reached are holes, not verdicts.
      codesUnread += ids.length - next;
      break;
    }
    const batch = ids.slice(next, next + width);
    next += batch.length;
    const outcomes = await Promise.all(batch.map(judge));
    outcomes.forEach((outcome, index) => {
      const codeId = batch[index]!;
      if (outcome.kind === "unread") {
        codesUnread += 1;
        return;
      }
      codesChecked += 1;
      if (outcome.kind === "empty") return;
      verdicts[codeId] = outcome.kind;
      if (outcome.kind !== "cw721") return;
      for (const address of outcome.instances) {
        if (contracts.length >= SCAN_MAX_CONTRACTS) break;
        if (!contracts.includes(address)) contracts.push(address);
      }
    });
  }

  return {
    listed: true,
    newestFirst: listing.newestFirst,
    verdicts,
    contracts,
    codesChecked,
    codesUnread,
  };
}

/* -------------------------------------------------------------------------- *
 * The shared cache
 * -------------------------------------------------------------------------- */

/** The disk under the cache, in the shape `JsonFile` (lib/server/push/file-store) already has. */
export interface ChainScanFile {
  read(): Promise<unknown>;
  schedule(snapshot: () => string): void;
}

/** One chain's entry: permanent verdicts, and the last list with its expiry. */
export interface ChainScanRecord {
  readonly verdicts: Readonly<Record<string, CodeVerdict>>;
  readonly scan: ChainScan;
  /** Epoch ms until which `scan` is served without a walk. */
  readonly freshUntil: number;
}

/**
 * Bumped when the shape changes, or when verdicts recorded under a bug must be
 * dropped. A code judged `other` is never asked again, so one wrong verdict
 * hides that code's collections for good: the extension had to bump its own
 * store for exactly that, after smart queries sent as unpadded base64url drew
 * HTTP 400s that read as "not a CW721".
 */
export const SCAN_FILE_VERSION = 1;

export function serializeScanFile(records: ReadonlyMap<string, ChainScanRecord>): string {
  const chains: Record<string, ChainScanRecord> = {};
  for (const [chainId, record] of records) chains[chainId] = record;
  return JSON.stringify({ version: SCAN_FILE_VERSION, chains });
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parseRecord(value: unknown): ChainScanRecord | null {
  if (!isRecord(value) || !isRecord(value.scan)) return null;
  const verdicts: Record<string, CodeVerdict> = {};
  if (isRecord(value.verdicts)) {
    for (const [codeId, verdict] of Object.entries(value.verdicts)) {
      if (CODE_ID.test(codeId) && (verdict === "cw721" || verdict === "other")) {
        verdicts[codeId] = verdict;
      }
    }
  }
  const scan = value.scan;
  const status = scan.status === "ran" || scan.status === "failed" ? scan.status : null;
  if (!status) return null;
  const contracts = Array.isArray(scan.contracts)
    ? scan.contracts
        .filter((row): row is string => typeof row === "string" && row.length > 0)
        .slice(0, SCAN_MAX_CONTRACTS)
    : [];
  return {
    verdicts,
    scan: {
      status,
      contracts,
      codesChecked: count(scan.codesChecked),
      codesUnread: count(scan.codesUnread),
      newestFirst: scan.newestFirst === true,
      checkedAt: typeof scan.checkedAt === "number" && scan.checkedAt > 0 ? scan.checkedAt : null,
    },
    freshUntil: count(value.freshUntil),
  };
}

/**
 * Read the file back. Anything unexpected is dropped, never repaired: a cache
 * rebuilt from the chain costs requests, while a wrong entry costs a hidden
 * collection.
 */
export function parseScanFile(raw: unknown): Map<string, ChainScanRecord> {
  const out = new Map<string, ChainScanRecord>();
  if (!isRecord(raw) || raw.version !== SCAN_FILE_VERSION || !isRecord(raw.chains)) {
    return out;
  }
  for (const [chainId, value] of Object.entries(raw.chains)) {
    const record = parseRecord(value);
    if (record) out.set(chainId, record);
  }
  return out;
}

export interface ChainScanCacheOptions {
  /** Codes judged at once, which is also the walk's most requests in flight. */
  readonly concurrency: number;
  /** Whole budget for one walk, every request in it included. */
  readonly deadlineMs: number;
  /** Where verdicts and lists outlive the process. Absent: memory only. */
  readonly file?: ChainScanFile | null;
  readonly now?: () => number;
}

export interface ChainScanCache {
  /**
   * The chain's CW721 candidates: the cached list while it is fresh, else one
   * walk shared by every caller that asks while it runs.
   *
   * Never rejects. A code list that does not answer gives back the previous
   * list when there is one (contracts are not deleted and their code's verdict
   * cannot change, so it is still true, only older), and a `failed` scan with
   * no contracts when there is not.
   */
  scan(ctx: NftChainContext, gate: ScanGate): Promise<ChainScan>;
}

export function createChainScanCache(options: ChainScanCacheOptions): ChainScanCache {
  const now = options.now ?? Date.now;
  const records = new Map<string, ChainScanRecord>();
  const inflight = new Map<string, Promise<ChainScan>>();
  let loaded: Promise<void> | null = null;

  const load = (): Promise<void> =>
    (loaded ??= (async () => {
      if (!options.file) return;
      try {
        const stored = parseScanFile(await options.file.read());
        // A walk that finished while the file was being read wins over it.
        for (const [chainId, record] of stored) {
          if (!records.has(chainId)) records.set(chainId, record);
        }
      } catch {
        // A cache that cannot be read is a slower first scan, never a broken page.
      }
    })());

  const failed = (previous: ChainScanRecord | undefined): ChainScan =>
    previous?.scan ?? {
      status: "failed",
      contracts: [],
      codesChecked: 0,
      codesUnread: 0,
      newestFirst: false,
      checkedAt: null,
    };

  const walk = async (ctx: NftChainContext, gate: ScanGate): Promise<ChainScan> => {
    const chainId = ctx.chain.chainId;
    const previous = records.get(chainId);
    const result = await walkCodes({
      ctx,
      gate,
      verdicts: previous?.verdicts ?? {},
      concurrency: options.concurrency,
      signal: AbortSignal.timeout(options.deadlineMs),
    });
    const at = now();
    // A walk with holes keeps what the last one found after its own finds: a
    // code that did not answer this time is usually a rate-limited node, and
    // its collections should not vanish from every visitor's grid over it.
    // They are still CW721 contracts, since a code's verdict cannot change.
    const contracts =
      result.codesUnread > 0 && previous?.scan.status === "ran"
        ? [...new Set([...result.contracts, ...previous.scan.contracts])].slice(
            0,
            SCAN_MAX_CONTRACTS,
          )
        : result.contracts;
    const record: ChainScanRecord = result.listed
      ? {
          verdicts: result.verdicts,
          scan: {
            status: "ran",
            contracts,
            codesChecked: result.codesChecked,
            codesUnread: result.codesUnread,
            newestFirst: result.newestFirst,
            checkedAt: at,
          },
          freshUntil: at + (result.codesUnread > 0 ? SCAN_PARTIAL_TTL_MS : SCAN_TTL_MS),
        }
      : {
          verdicts: result.verdicts,
          scan: failed(previous),
          freshUntil: at + SCAN_FAILURE_TTL_MS,
        };
    records.set(chainId, record);
    options.file?.schedule(() => serializeScanFile(records));
    return record.scan;
  };

  return {
    async scan(ctx, gate) {
      await load();
      const chainId = ctx.chain.chainId;
      const record = records.get(chainId);
      if (record && now() < record.freshUntil) return record.scan;
      let running = inflight.get(chainId);
      if (!running) {
        running = walk(ctx, gate)
          .catch(() => failed(records.get(chainId)))
          .finally(() => inflight.delete(chainId));
        inflight.set(chainId, running);
      }
      return running;
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Discovery, with the scan named
 * -------------------------------------------------------------------------- */

/** A holding as the page sees it: the engine's three sources, plus the scan. */
export interface AttributedHolding extends Omit<NftHolding, "source"> {
  readonly source: NftDiscoverySourceWire;
}

export interface AttributedDiscovery
  extends Omit<NftDiscoveryResult, "holdings" | "sources"> {
  readonly holdings: readonly AttributedHolding[];
  readonly sources: readonly NftDiscoverySourceWire[];
}

/**
 * Name the scan in a discovery result, and drop what it made noisy.
 *
 * The engine only knows three sources, so scanned contracts went in as
 * `known` and come back labelled "listed by this deployment", which is not
 * true of them. They are relabelled `scan` here; an address the deployment
 * lists or the user added keeps its own label.
 *
 * A scanned contract that answers `tokens` with a refusal answered "this is
 * not a collection". That is the scan reaching wide, not a failure the user
 * can do anything about, so it is dropped from the issues. The same refusal
 * from an address the user pasted stays: they asked about that contract.
 */
export function attributeScan(
  result: NftDiscoveryResult,
  scanned: readonly string[],
  userContracts: readonly string[],
): AttributedDiscovery {
  const fromScan = new Set(scanned);
  const fromUser = new Set(userContracts);

  const holdings = result.holdings.map((holding): AttributedHolding => ({
    ...holding,
    source:
      holding.source === "known" && fromScan.has(holding.contractAddress)
        ? "scan"
        : holding.source,
  }));

  // The engine's rule, recomputed with the new label: the index counts when it
  // answered, every other path when it found something.
  const sources = new Set<NftDiscoverySourceWire>(
    result.sources.filter((source) => source === "indexer"),
  );
  for (const holding of holdings) sources.add(holding.source);

  const issues = result.issues.filter(
    (issue) =>
      !(
        issue.contractAddress !== null &&
        fromScan.has(issue.contractAddress) &&
        !fromUser.has(issue.contractAddress) &&
        isNotCw721Issue(issue.message)
      ),
  );

  return { ...result, holdings, sources: [...sources], issues };
}

/**
 * The limitation sentence when the scan ran. It replaces the engine's, which
 * says the list "only covers contracts Zunia knows about" and would undersell
 * a scan, and it names the window, so a reader knows what was not looked at.
 */
export function scanLimitation(chainName: string, scan: ChainScanReport): string {
  return (
    "CosmWasm has no chain-wide index of NFTs by owner. This list covers the " +
    `collections Zunia found among ${scanWindow(scan)} on ${chainName}, plus any ` +
    "listed or added here. Add a collection's address to check one it did not reach."
  );
}

/** "the newest 16 contract codes", or without "newest" when the node would not sort them. */
export function scanWindow(scan: Pick<ChainScanReport, "codesChecked" | "newestFirst">): string {
  if (scan.codesChecked === 1) {
    return scan.newestFirst ? "the newest contract code" : "1 contract code";
  }
  const codes = `${scan.codesChecked} contract codes`;
  return scan.newestFirst ? `the newest ${codes}` : codes;
}
