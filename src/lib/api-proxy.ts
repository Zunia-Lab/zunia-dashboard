/**
 * Server-only proxy helpers. Browser clients must call /api/*;
 * never hit INDEXER_URL / BACKEND_URL or chain RPC from the client.
 *
 * Every route handler follows the same three steps, in this order:
 *   1. ask the first-party upstream (proxyBackend / proxyIndexer);
 *   2. fall back to a documented server-side read when the route has one
 *      (/api/portfolio and /api/validators read public LCDs);
 *   3. otherwise answer with stubJson.
 *
 * A stub is placeholder shape for local development while zunia-backend's
 * /v1/* routes are undeployed. It is not an answer: it carries
 * `source: "stub"` so the UI can label it, and it is logged at error level so
 * a deployment serving stubs is visible to whoever runs it.
 */

const INDEXER_URL = () =>
  process.env.INDEXER_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8787";
const BACKEND_URL = () =>
  process.env.BACKEND_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8788";

/** Marker on every stub payload. Consumers must render it as sample data. */
export const STUB_SOURCE = "stub";

export async function proxyIndexer(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${INDEXER_URL()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  const apiKey = process.env.INDEXER_API_KEY;
  if (apiKey) headers.set("x-api-key", apiKey);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  try {
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    if (!response.ok) {
      console.error(`[api-proxy] indexer ${path} answered HTTP ${response.status}`);
    }
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    console.error(`[api-proxy] indexer ${path} unreachable: ${message}`);
    return Response.json(
      { error: "indexer_unreachable", message },
      { status: 502 },
    );
  }
}

export async function proxyBackend(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${BACKEND_URL()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  try {
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    if (!response.ok) {
      console.error(`[api-proxy] backend ${path} answered HTTP ${response.status}`);
    }
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    console.error(`[api-proxy] backend ${path} unreachable: ${message}`);
    return Response.json(
      { error: "backend_unreachable", message },
      { status: 502 },
    );
  }
}

/**
 * Placeholder payload for a route whose upstream is not deployed.
 *
 * A 2xx body is indistinguishable from a live answer once it reaches the
 * browser, so it is tagged `source: "stub"` with the reason and logged. Error
 * statuses are returned untouched: they carry their own `error` code and are
 * not sample data.
 */
export function stubJson<T extends Record<string, unknown>>(
  body: T,
  status = 200,
  reason = "upstream_unavailable",
): Response {
  if (status >= 400) return Response.json(body, { status });

  console.error(
    `[api-proxy] serving stub payload (${reason}) — this is sample data, not a live answer`,
  );
  return Response.json(
    { ...body, stub: true, source: STUB_SOURCE, stubReason: reason },
    { status },
  );
}
