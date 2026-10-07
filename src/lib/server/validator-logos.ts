/**
 * Validator logos, resolved on the server so the browser never calls Keybase
 * or the registries (their hosts would see every visitor's IP).
 *
 * Sources, best first:
 *
 * 1. **Keybase** — `description.identity` is a PGP key suffix; its account
 *    picture is the logo most explorers show (the order TheHub uses).
 * 2. **Cosmostation's chainlist** moniker images (the Mintscan logos).
 *
 * Both come in **one request per chain** from cosmos.directory's validator
 * list (`keybase_image`, `mintscan_image`), cached 12 h. Only validators that
 * list has no picture for get an individual Keybase lookup, and those are
 * capped (40 new lookups per call, 4 at a time, process-wide) and cached —
 * hits for 7 days, "no picture" for 6 hours, failures for 10 minutes. The
 * old resolver probed GitHub with up to six HEAD requests per validator,
 * uncached, on every call: one validators request on the Hub meant about a
 * thousand outbound requests.
 *
 * Logos are cosmetic, so resolution is bounded in time: callers wait at most
 * `waitMs` and get whatever is known; lookups still running land in the
 * cache for the next request. Only https images on the two hosts these
 * sources use are kept, so a third-party feed cannot inject arbitrary
 * image URLs (tracking pixels) into the page.
 */

import "server-only";
import type { ServerChainEntry } from "@/lib/server/chains";
import { fetchJson } from "@/lib/server/http";
import { arr, pick, rec, str } from "@/lib/chain/parse";

const HOUR = 3_600_000;
const DIRECTORY_TTL = 12 * HOUR;
const DIRECTORY_ERROR_TTL = 15 * 60_000;
const KEYBASE_HIT_TTL = 7 * 24 * HOUR;
const KEYBASE_MISS_TTL = 6 * HOUR;
const KEYBASE_ERROR_TTL = 10 * 60_000;
const KEYBASE_CONCURRENCY = 4;
const MAX_NEW_LOOKUPS_PER_CALL = 40;
const MAX_KEYBASE_ENTRIES = 10_000;
const ALLOWED_IMAGE_HOSTS = new Set(["s3.amazonaws.com", "raw.githubusercontent.com"]);

interface DirectoryEntry {
  images: Map<string, string>;
  /** Epoch ms after which the entry is refreshed. */
  expiresAt: number;
  inflight: Promise<void> | null;
}

interface KeybaseEntry {
  url: string | null;
  expiresAt: number;
  inflight: Promise<void> | null;
}

interface LogoState {
  directory: Map<string, DirectoryEntry>;
  keybase: Map<string, KeybaseEntry>;
  active: number;
  queue: Array<() => void>;
}

const STATE_KEY = "__zuniaValidatorLogos";

/** On `globalThis` so dev HMR keeps the caches. */
function state(): LogoState {
  const g = globalThis as unknown as Record<string, LogoState | undefined>;
  let s = g[STATE_KEY];
  if (!s) {
    s = { directory: new Map(), keybase: new Map(), active: 0, queue: [] };
    g[STATE_KEY] = s;
  }
  return s;
}

/** An https image on an allowed host, else null. */
export function safeImageUrl(raw: unknown): string | null {
  const value = str(raw);
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(url.host) ? url.href : null;
  } catch {
    return null;
  }
}

export function isValidKeybaseIdentity(identity: string | null | undefined): identity is string {
  const hex = (identity ?? "").trim();
  return hex.length >= 8 && hex.length <= 64 && /^[0-9a-f]+$/i.test(hex);
}

function loadDirectory(chain: ServerChainEntry, entry: DirectoryEntry): Promise<void> {
  const slug = chain.registrySlug;
  const run = (async () => {
    try {
      if (!slug || !/^[a-z0-9-]+$/i.test(slug)) throw new Error("no directory name");
      const body = await fetchJson<unknown>(
        `https://validators.cosmos.directory/chains/${encodeURIComponent(slug)}`,
        { timeoutMs: 8_000 },
      );
      const images = new Map<string, string>();
      for (const item of arr(pick(body, ["validators"]))) {
        const validator = rec(item);
        const operator = str(validator?.operator_address) ?? str(validator?.address);
        const image =
          safeImageUrl(validator?.keybase_image) ??
          safeImageUrl(validator?.mintscan_image) ??
          safeImageUrl(validator?.image);
        if (operator && image) images.set(operator, image);
      }
      entry.images = images;
      entry.expiresAt = Date.now() + DIRECTORY_TTL;
    } catch {
      // Keep whatever we had; retry sooner.
      entry.expiresAt = Date.now() + DIRECTORY_ERROR_TTL;
    } finally {
      entry.inflight = null;
    }
  })();
  entry.inflight = run;
  return run;
}

/** The chain's directory images, loading or refreshing them when due. */
function directoryFor(chain: ServerChainEntry): { entry: DirectoryEntry; ready: Promise<void> } {
  const { directory } = state();
  let entry = directory.get(chain.chainId);
  if (!entry) {
    entry = { images: new Map(), expiresAt: 0, inflight: null };
    directory.set(chain.chainId, entry);
  }
  if (entry.inflight) return { entry, ready: entry.inflight };
  if (entry.expiresAt <= Date.now()) return { entry, ready: loadDirectory(chain, entry) };
  return { entry, ready: Promise.resolve() };
}

async function withKeybaseSlot<T>(run: () => Promise<T>): Promise<T> {
  const s = state();
  if (s.active >= KEYBASE_CONCURRENCY) {
    await new Promise<void>((resolve) => s.queue.push(resolve));
  }
  s.active += 1;
  try {
    return await run();
  } finally {
    s.active -= 1;
    s.queue.shift()?.();
  }
}

function pruneKeybase(map: Map<string, KeybaseEntry>) {
  if (map.size <= MAX_KEYBASE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of map) {
    if (!entry.inflight && entry.expiresAt < now) map.delete(key);
  }
  for (const key of map.keys()) {
    if (map.size <= MAX_KEYBASE_ENTRIES) break;
    if (!map.get(key)?.inflight) map.delete(key);
  }
}

function lookupKeybase(identity: string, entry: KeybaseEntry): Promise<void> {
  const run = withKeybaseSlot(async () => {
    try {
      const body = await fetchJson<unknown>(
        `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${encodeURIComponent(identity)}&fields=pictures`,
        { timeoutMs: 5_000, hostConcurrency: KEYBASE_CONCURRENCY },
      );
      const them = arr(pick(body, ["them"]));
      const url = safeImageUrl(pick(them[0], ["pictures", "primary", "url"]));
      entry.url = url;
      entry.expiresAt = Date.now() + (url ? KEYBASE_HIT_TTL : KEYBASE_MISS_TTL);
    } catch {
      entry.expiresAt = Date.now() + KEYBASE_ERROR_TTL;
    } finally {
      entry.inflight = null;
    }
  });
  entry.inflight = run;
  return run;
}

/** Cached Keybase picture for an identity (undefined when never looked up). */
function keybaseCached(identity: string): string | null | undefined {
  const entry = state().keybase.get(identity.toLowerCase());
  return entry ? entry.url : undefined;
}

/** Waits for `promise` or `ms`, whichever comes first; never rejects. */
async function waitAtMost(promise: Promise<unknown>, ms: number): Promise<void> {
  if (ms <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface LogoTarget {
  operatorAddress: string;
  identity?: string | null;
  logoUrl?: string;
}

/**
 * Returns `rows` with `logoUrl` set where a logo is known, waiting at most
 * `waitMs` for lookups this call starts.
 *
 * `keybaseWaitMs` (default: `waitMs`) caps the part of that wait spent on
 * per-validator Keybase lookups. A whole-set answer passes 0: it waits for the
 * one cosmos.directory list only and never for Keybase, whose 40 lookups per
 * call (4 at a time) made the first two to four requests per chain after each
 * deploy pay ~1.5 s each. The lookups still start and land in the cache, so
 * the next answer carries those logos.
 */
export async function attachValidatorLogos<T extends LogoTarget>(
  chain: ServerChainEntry,
  rows: readonly T[],
  { waitMs = 1_500, keybaseWaitMs = waitMs }: { waitMs?: number; keybaseWaitMs?: number } = {},
): Promise<T[]> {
  const started = Date.now();
  const { entry: dir, ready } = directoryFor(chain);
  await waitAtMost(ready, waitMs);

  // Keybase only for validators the directory has no picture for — and only
  // once the directory has answered: while it is still loading it would
  // likely cover them, and 40 Keybase calls would be spent for nothing.
  const { keybase } = state();
  const pending: Promise<void>[] = [];
  let startedLookups = dir.inflight ? MAX_NEW_LOOKUPS_PER_CALL : 0;
  for (const row of rows) {
    if (dir.images.has(row.operatorAddress) || !isValidKeybaseIdentity(row.identity)) continue;
    const key = row.identity.trim().toLowerCase();
    let entry = keybase.get(key);
    if (entry?.inflight) {
      pending.push(entry.inflight);
      continue;
    }
    if (entry && entry.expiresAt > Date.now()) continue;
    if (startedLookups >= MAX_NEW_LOOKUPS_PER_CALL) continue;
    if (!entry) {
      entry = { url: null, expiresAt: 0, inflight: null };
      keybase.set(key, entry);
    }
    startedLookups += 1;
    pending.push(lookupKeybase(key, entry));
  }
  pruneKeybase(keybase);
  if (pending.length && keybaseWaitMs > 0) {
    await waitAtMost(Promise.all(pending), Math.min(keybaseWaitMs, waitMs - (Date.now() - started)));
  }

  return rows.map((row) => {
    const fromKeybase = isValidKeybaseIdentity(row.identity) ? keybaseCached(row.identity.trim()) : undefined;
    const url = fromKeybase ?? dir.images.get(row.operatorAddress) ?? row.logoUrl;
    return url ? { ...row, logoUrl: url } : row;
  });
}
