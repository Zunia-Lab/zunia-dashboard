/**
 * Per-client token bucket for the route handlers that fan out upstream.
 *
 * The dashboard's API is same-origin and public: anyone can call
 * `/api/portfolio?chains=…` in a loop, and each call turns into dozens of
 * reads against public chain endpoints from this server's IP. The bucket keeps
 * one client from spending the shared upstream budget of everyone else.
 *
 * Client identity is `clientKey` (./client-ip.ts): the TCP peer nginx reports
 * in `x-real-ip`, or — only when that peer is a Cloudflare edge — the visitor
 * Cloudflare names in `cf-connecting-ip`; IPv6 by /64. Both headers a client
 * could set on a request sent straight to the origin (`cf-connecting-ip`,
 * `x-forwarded-for`) are ignored otherwise, so rotating them no longer buys a
 * fresh bucket per request.
 */

import "server-only";

import { clientKey } from "@/lib/server/client-ip";

export { clientKey };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const BUCKETS_KEY = "__zuniaDashboardRateBuckets";
const MAX_BUCKETS = 20_000;

function buckets(): Map<string, Bucket> {
  const g = globalThis as unknown as Record<string, Map<string, Bucket> | undefined>;
  let map = g[BUCKETS_KEY];
  if (!map) {
    map = new Map();
    g[BUCKETS_KEY] = map;
  }
  return map;
}

export interface RateLimitOptions {
  /** Bucket name, so different routes do not share a budget. */
  scope: string;
  /** Burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Tokens this request costs (e.g. one per chain in a fan-out). */
  cost?: number;
}

/**
 * Spends tokens for this request. Returns a 429 response to send back when the
 * bucket is empty, or null when the request may proceed.
 */
export function rateLimit(req: Request, options: RateLimitOptions): Response | null {
  // Local development has a single client and an unproxied socket; a limiter
  // there only gets in the way of the person building the page.
  if (process.env.NODE_ENV !== "production" && process.env.ZUNIA_RATE_LIMIT !== "1") {
    return null;
  }
  const map = buckets();
  const key = `${options.scope}:${clientKey(req)}`;
  const now = Date.now();
  const cost = Math.max(1, options.cost ?? 1);
  let bucket = map.get(key);
  if (!bucket) {
    if (map.size >= MAX_BUCKETS) {
      // Drop the oldest buckets; a full map means a flood of distinct keys.
      let dropped = 0;
      for (const k of map.keys()) {
        map.delete(k);
        dropped += 1;
        if (dropped >= MAX_BUCKETS / 10) break;
      }
    }
    bucket = { tokens: options.capacity, updatedAt: now };
    map.set(key, bucket);
  } else {
    const elapsed = (now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(options.capacity, bucket.tokens + elapsed * options.refillPerSecond);
    bucket.updatedAt = now;
  }
  if (bucket.tokens < cost) {
    const wait = Math.ceil((cost - bucket.tokens) / options.refillPerSecond);
    return Response.json(
      { error: "rate_limited", message: "Too many requests, slow down." },
      { status: 429, headers: { "retry-after": String(Math.max(1, wait)) } },
    );
  }
  bucket.tokens -= cost;
  return null;
}
