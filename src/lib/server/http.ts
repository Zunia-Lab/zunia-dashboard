/**
 * The one way server code reads a third-party HTTP API.
 *
 * Every upstream the dashboard touches — chain LCDs from the catalog, Numia,
 * Osmosis SQS, CoinGecko, Coinstore — goes through `fetchJson`, so all of them
 * get the same three protections:
 *
 * - a hard timeout (a hung LCD must not hold a route handler open);
 * - a per-host concurrency cap (a portfolio read fans out across a dozen
 *   chains with three or four calls each; without a cap one visitor can open
 *   fifty sockets to the same public node and get the server's IP throttled
 *   for everyone);
 * - an error type that says what failed without echoing upstream bodies,
 *   which can contain anything, back to the browser.
 *
 * URLs are built by callers from catalog data and validated parameters only.
 * Nothing here accepts a host from a request.
 */

import "server-only";

export type UpstreamFailure = "timeout" | "network" | "http" | "parse";

export class UpstreamError extends Error {
  readonly kind: UpstreamFailure;
  readonly status?: number;
  readonly host: string;

  constructor(kind: UpstreamFailure, host: string, status?: number) {
    super(
      kind === "http"
        ? `${host} answered HTTP ${status}`
        : kind === "timeout"
          ? `${host} timed out`
          : kind === "parse"
            ? `${host} returned an unreadable body`
            : `${host} is unreachable`,
    );
    this.name = "UpstreamError";
    this.kind = kind;
    this.status = status;
    this.host = host;
  }
}

/**
 * The services the dashboard names to users by name, by host. They already
 * appear in the UI as price and data sources, so naming them adds nothing a
 * visitor does not see; every other host is a chain's public endpoint, which
 * is third-party infrastructure (keplr.app, polkachu, a validator's node) and
 * is not shown.
 */
const NAMED_HOSTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\.)numia\.xyz$/, "Numia"],
  [/(^|\.)coingecko\.com$/, "CoinGecko"],
  [/(^|\.)coinstore\.com$/, "Coinstore"],
  [/(^|\.)osmosis\.zone$/, "the Osmosis router"],
  [/(^|\.)cosmos\.directory$/, "cosmos.directory"],
  [/(^|\.)keybase\.io$/, "Keybase"],
];

function sourceName(host: string): string {
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  for (const [pattern, name] of NAMED_HOSTS) if (pattern.test(bare)) return name;
  return "the chain's public endpoint";
}

/**
 * Short, user-safe reason for a failed upstream read, written to sit inside a
 * sentence ("Couldn't read Akash · the chain's public endpoint timed out").
 *
 * It names the kind of failure and, for the data services the UI already
 * credits, the service. It never names a chain endpoint's host: that is
 * someone else's infrastructure, and "lcd-akash.keplr.app timed out" in
 * Zunia's UI reads as Zunia blaming (or depending on) a third party by name.
 * The host stays on `UpstreamError.host` for logs.
 */
export function describeUpstreamError(error: unknown): string {
  if (error instanceof UpstreamError) {
    const who = sourceName(error.host);
    switch (error.kind) {
      case "timeout":
        return `${who} did not answer in time`;
      case "http":
        return `${who} answered with an error (HTTP ${error.status ?? "?"})`;
      case "parse":
        return `${who} sent an unreadable answer`;
      default:
        return `${who} is unreachable`;
    }
  }
  if (error instanceof Error && error.name === "AbortError") return "the request timed out";
  return "the upstream read failed";
}

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_HOST_CONCURRENCY = 6;

interface Gate {
  active: number;
  queue: Array<() => void>;
}

const GATES_KEY = "__zuniaDashboardHostGates";

function gates(): Map<string, Gate> {
  const g = globalThis as unknown as Record<string, Map<string, Gate> | undefined>;
  let map = g[GATES_KEY];
  if (!map) {
    map = new Map();
    g[GATES_KEY] = map;
  }
  return map;
}

async function acquire(host: string, limit: number): Promise<() => void> {
  const map = gates();
  let gate = map.get(host);
  if (!gate) {
    gate = { active: 0, queue: [] };
    map.set(host, gate);
  }
  const g = gate;
  if (g.active >= limit) {
    await new Promise<void>((resolve) => g.queue.push(resolve));
  }
  g.active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    g.active -= 1;
    const next = g.queue.shift();
    if (next) next();
  };
}

export interface FetchJsonOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  /** Max simultaneous requests to this URL's host from this process. */
  hostConcurrency?: number;
  /** One retry on network errors and 5xx/429 (never on 4xx). Default 0. */
  retries?: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

async function once<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const host = hostOf(url);
  const release = await acquire(host, options.hostConcurrency ?? DEFAULT_HOST_CONCURRENCY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        body: options.body,
        signal: controller.signal,
        headers: { accept: "application/json", ...options.headers },
        cache: "no-store",
      });
    } catch (error) {
      if (controller.signal.aborted) throw new UpstreamError("timeout", host);
      void error;
      throw new UpstreamError("network", host);
    }
    if (!response.ok) {
      // Drain so the socket can be reused.
      await response.arrayBuffer().catch(() => undefined);
      throw new UpstreamError("http", host, response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      if (controller.signal.aborted) throw new UpstreamError("timeout", host);
      throw new UpstreamError("parse", host);
    }
  } finally {
    clearTimeout(timer);
    release();
  }
}

/**
 * Whether a failed read is worth a second attempt: network errors, timeouts,
 * 429 and 5xx — except 501 Not Implemented, which is the gateway saying it
 * does not serve that route at all (the Hub's retired `denom_traces`, say) and
 * answers the same a quarter of a second later.
 */
function retryable(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return false;
  if (error.kind === "network" || error.kind === "timeout") return true;
  if (error.kind !== "http") return false;
  const status = error.status ?? 0;
  return status === 429 || (status >= 500 && status !== 501);
}

/** GETs (or POSTs) JSON with a timeout, a per-host cap and typed failures. */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const retries = Math.max(0, Math.min(options.retries ?? 0, 2));
  let attempt = 0;
  for (;;) {
    try {
      return await once<T>(url, options);
    } catch (error) {
      if (attempt >= retries || !retryable(error)) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; keeps input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** `Promise.allSettled` for a keyed record: one failing read does not sink the rest. */
export async function settleAll<K extends string, V>(
  tasks: Record<K, () => Promise<V>>,
): Promise<Record<K, PromiseSettledResult<V>>> {
  const keys = Object.keys(tasks) as K[];
  const settled = await Promise.allSettled(keys.map((key) => tasks[key]()));
  const out = {} as Record<K, PromiseSettledResult<V>>;
  keys.forEach((key, index) => {
    out[key] = settled[index];
  });
  return out;
}
