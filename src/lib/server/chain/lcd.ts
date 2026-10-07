/**
 * Cached reads against a chain's public REST (LCD) endpoint.
 *
 * Every chain analytics read goes through `lcd()` (one path) or `lcdPages()`
 * (a paginated list), which add three things on top of `fetchJson`:
 *
 * - **A cache per path** (`cached()` from `@/lib/server/cache`): economics,
 *   validator sets and proposals are identical for every visitor, so a busy
 *   page costs one upstream read per TTL instead of one per visitor — the
 *   difference between a working dashboard and the server's IP being
 *   throttled by the Keplr LCDs most of the catalog points at.
 * - **Permanent answers cached as values.** A 501 ("Not Implemented": the
 *   chain does not run that module, e.g. x/mint on Osmosis) or a 404/400
 *   (no such proposal, no vote yet) is not going to change in 30 seconds;
 *   it is remembered for the full TTL as a `miss`, so a page does not
 *   re-probe a route every chain answers the same way.
 * - **Transient failures cached briefly** (`errorTtlMs`, default 30 s):
 *   a node that is down costs one timeout per half minute, not one per
 *   request.
 *
 * Values carry `at` (when they were read), so responses can say how old the
 * figures are instead of claiming they are live.
 */

import "server-only";
import { cached, invalidate, invalidatePrefix } from "@/lib/server/cache";
import { restOf, type ServerChainEntry } from "@/lib/server/chains";
import { describeUpstreamError, fetchJson, UpstreamError } from "@/lib/server/http";
import { nextKey } from "@/lib/chain/parse";

/** Why a path answered without data, as remembered in the cache. */
export type LcdMiss = "not-implemented" | "not-found" | "rejected";

export type LcdResult<T> =
  | { ok: true; data: T; at: number }
  | { ok: false; miss: LcdMiss; status: number; at: number };

/**
 * A failure whose message was written here and is safe to show (no upstream
 * body, no stack): `describeLcdError` passes it through instead of the
 * generic "Upstream read failed".
 */
export class ReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadError";
  }
}

/** The catalog has no REST endpoint for this chain. */
export class NoEndpointError extends ReadError {
  constructor(chainId: string) {
    super(`No public REST endpoint is known for ${chainId}`);
    this.name = "NoEndpointError";
  }
}

export interface LcdOptions<T> {
  /** How long an answer (data or miss) is fresh. */
  ttlMs: number;
  /**
   * How long past `ttlMs` a stale answer may still be served while it
   * refreshes (default 4 × ttl). Per-account reads use a short window so a
   * user who just voted or delegated sees it on the next refresh.
   */
  staleMs?: number;
  /** How long a transient failure is remembered. Default 30 s. */
  errorTtlMs?: number;
  /** Upstream timeout. Default 6 s (fetchJson's). */
  timeoutMs?: number;
  /**
   * Narrows the body before it is cached, so a 1 MB proposal list or a
   * 120 KB block is stored as the few fields we use. Requires `name`.
   */
  map?: (body: unknown) => T;
  /** Distinguishes cache entries of the same path read through different maps. */
  name?: string;
}

/** Base REST URL of a chain, or throws NoEndpointError. */
export function restBase(chain: ServerChainEntry): string {
  const base = restOf(chain.chainId);
  if (!base) throw new NoEndpointError(chain.chainId);
  return base;
}

function missFor(status: number): LcdMiss | null {
  if (status === 501) return "not-implemented";
  if (status === 404) return "not-found";
  // gRPC-gateway maps InvalidArgument (unknown voter, bad params type) to 400.
  if (status === 400) return "rejected";
  return null;
}

/**
 * Version of the shapes `map` / `item` store. The cache lives on
 * `globalThis`, which survives dev hot reloads, so a change to a parsed shape
 * (a new field on `RawValidator`, say) must not be served entries parsed by
 * the previous code. Bump it with any such change.
 */
const SHAPE_VERSION = 2;

function cacheKey(chain: ServerChainEntry, path: string, name?: string): string {
  return `lcd${SHAPE_VERSION}:${chain.chainId}:${name ? `${name}:` : ""}${path}`;
}

/**
 * GETs `path` (no leading slash) from the chain's LCD through the cache.
 *
 * Resolves with data or a remembered miss; rejects only on transient
 * failures (timeouts, 5xx, 429, unreachable host) and missing endpoints.
 */
export async function lcd<T = unknown>(
  chain: ServerChainEntry,
  path: string,
  options: LcdOptions<T>,
): Promise<LcdResult<T>> {
  const base = restBase(chain);
  return cached<LcdResult<T>>(
    cacheKey(chain, path, options.map ? (options.name ?? "mapped") : options.name),
    { ttlMs: options.ttlMs, staleMs: options.staleMs, errorTtlMs: options.errorTtlMs ?? 30_000 },
    async () => {
      try {
        const body = await fetchJson<unknown>(`${base}/${path}`, { timeoutMs: options.timeoutMs });
        return { ok: true, data: options.map ? options.map(body) : (body as T), at: Date.now() };
      } catch (error) {
        if (error instanceof UpstreamError && error.kind === "http" && error.status !== undefined) {
          const miss = missFor(error.status);
          if (miss) return { ok: false, miss, status: error.status, at: Date.now() };
        }
        throw error;
      }
    },
  );
}

export interface PagesOptions<T> {
  ttlMs: number;
  errorTtlMs?: number;
  timeoutMs?: number;
  /** Key of the list in each page, e.g. "validators". */
  itemsKey: string;
  /** Page size asked for (nodes may cap it lower; next_key still works). */
  limit: number;
  /** Hard cap on pages, so one request cannot walk an unbounded list. */
  maxPages: number;
  /** Narrows one item; null drops it. */
  item: (raw: unknown) => T | null;
  /** Cache-entry name (the item narrowing differs per caller). */
  name: string;
}

export interface Pages<T> {
  items: T[];
  /** True when `maxPages` stopped the walk before the end of the list. */
  truncated: boolean;
  /** Entries `item` refused (unreadable fields); callers report them, never hide them. */
  dropped: number;
}

/**
 * Walks a paginated LCD list (`pagination.key`) and caches the whole result.
 *
 * A first page without the list (a gateway answering 200 with an error
 * object) is a "rejected" miss, not an empty list: an empty validator set
 * would otherwise read as "0 active validators".
 */
export async function lcdPages<T>(
  chain: ServerChainEntry,
  path: string,
  options: PagesOptions<T>,
): Promise<LcdResult<Pages<T>>> {
  const base = restBase(chain);
  const separator = path.includes("?") ? "&" : "?";
  return cached<LcdResult<Pages<T>>>(
    cacheKey(chain, path, `pages:${options.name}`),
    { ttlMs: options.ttlMs, errorTtlMs: options.errorTtlMs ?? 30_000 },
    async () => {
      const items: T[] = [];
      let dropped = 0;
      let key: string | null = null;
      for (let page = 0; page < options.maxPages; page += 1) {
        const url =
          `${base}/${path}${separator}pagination.limit=${options.limit}` +
          (key ? `&pagination.key=${encodeURIComponent(key)}` : "");
        let body: unknown;
        try {
          body = await fetchJson<unknown>(url, { timeoutMs: options.timeoutMs });
        } catch (error) {
          if (
            page === 0 &&
            error instanceof UpstreamError &&
            error.kind === "http" &&
            error.status !== undefined
          ) {
            const miss = missFor(error.status);
            if (miss) return { ok: false, miss, status: error.status, at: Date.now() };
          }
          throw error;
        }
        const list = (body as Record<string, unknown> | null)?.[options.itemsKey];
        if (!Array.isArray(list)) {
          if (page === 0) return { ok: false, miss: "rejected", status: 200, at: Date.now() };
          // A later page lost its shape: keep what was read, flagged partial.
          return { ok: true, data: { items, truncated: true, dropped }, at: Date.now() };
        }
        for (const raw of list) {
          const parsed = options.item(raw);
          if (parsed !== null) items.push(parsed);
          else dropped += 1;
        }
        key = nextKey(body);
        if (!key) return { ok: true, data: { items, truncated: false, dropped }, at: Date.now() };
      }
      return { ok: true, data: { items, truncated: true, dropped }, at: Date.now() };
    },
  );
}

/**
 * A read that answered without data (a remembered miss), thrown where a
 * caller needs a rejection. Carries the user-facing reason so it survives
 * `describeLcdError` instead of becoming "Upstream read failed".
 */
export class LcdMissError extends ReadError {
  readonly miss: LcdMiss;
  constructor(miss: LcdMiss) {
    super(describeMiss(miss));
    this.name = "LcdMissError";
    this.miss = miss;
  }
}

/** Drops one cached path (same `name` as it was read with). */
export function forgetLcd(chain: ServerChainEntry, path: string, name?: string): void {
  invalidate(cacheKey(chain, path, name));
}

/** Drops every cached path of a chain read under `name`. */
export function forgetLcdNamed(chain: ServerChainEntry, name: string): void {
  invalidatePrefix(`lcd${SHAPE_VERSION}:${chain.chainId}:${name}:`);
}

/** User-safe description of a failed read (never the upstream body). */
export function describeLcdError(error: unknown): string {
  if (error instanceof ReadError) return error.message;
  return describeUpstreamError(error);
}

/** Human phrase for a remembered miss. */
export function describeMiss(miss: LcdMiss): string {
  if (miss === "not-implemented") return "Not supported by this chain's public endpoint";
  if (miss === "not-found") return "Not found on this chain";
  return "Rejected by the chain's endpoint";
}

/**
 * Milliseconds left of a request-wide budget that started at `startedAt`
 * (at least `floorMs`, so a chain that starts late still gets a chance to
 * answer from the cache). Multi-chain routes give every chain the same end
 * time instead of a fresh timeout each, so queued chains cannot stretch the
 * response.
 */
export function remaining(startedAt: number, budgetMs: number, floorMs = 500): number {
  return Math.max(floorMs, budgetMs - (Date.now() - startedAt));
}

/**
 * Settles `promise` within `ms`; past the deadline resolves to `onTimeout()`.
 * The underlying read keeps running and still lands in the cache, so the next
 * request is fast even when this one gave up waiting.
 */
export async function within<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
