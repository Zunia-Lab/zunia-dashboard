/**
 * Response helpers that set caching on purpose instead of by accident.
 *
 * Two kinds of payload leave the API:
 *
 * - **Public market and chain data** (prices, APRs, validators, proposals):
 *   identical for every visitor, safe for Cloudflare and the browser to cache
 *   briefly. `publicJson` marks them `public` with `s-maxage` and
 *   `stale-while-revalidate`.
 * - **Anything keyed by an address** (balances, history, rewards): `private`,
 *   never stored by a shared cache. A CDN that cached one wallet's portfolio
 *   under a URL another visitor can guess would be a privacy leak even though
 *   the data is on chain — the link between this person and that address is
 *   not.
 */

import "server-only";

export function publicJson(
  body: unknown,
  { maxAge = 30, sMaxAge = 60, swr = 300 }: { maxAge?: number; sMaxAge?: number; swr?: number } = {},
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set(
    "cache-control",
    `public, max-age=${maxAge}, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
  );
  return Response.json(body, { ...init, headers });
}

export function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

/**
 * A failed read, phrased for the UI. Never includes upstream bodies.
 *
 * 503, not 502: Cloudflare replaces origin 502 bodies with its own error
 * page, so the browser would never see this JSON.
 */
export function upstreamFailure(message: string, status = 503): Response {
  return Response.json(
    { error: "upstream_failed", message },
    { status, headers: { "cache-control": "no-store" } },
  );
}
