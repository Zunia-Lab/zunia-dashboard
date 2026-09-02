/**
 * Server-only proxy helpers. Browser clients must call /api/*;
 * never hit INDEXER_URL / BACKEND_URL or chain RPC from the client.
 */

const INDEXER_URL = () =>
  process.env.INDEXER_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8787";
const BACKEND_URL = () =>
  process.env.BACKEND_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8788";

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
    return await fetch(url, { ...init, headers, cache: "no-store" });
  } catch (err) {
    return Response.json(
      {
        error: "indexer_unreachable",
        message: err instanceof Error ? err.message : "fetch failed",
        stub: true,
      },
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
    return await fetch(url, { ...init, headers, cache: "no-store" });
  } catch (err) {
    return Response.json(
      {
        error: "backend_unreachable",
        message: err instanceof Error ? err.message : "fetch failed",
        stub: true,
      },
      { status: 502 },
    );
  }
}

/** JSON stub when upstream is down — keeps UI routes usable in local/dev. */
export function stubJson<T extends Record<string, unknown>>(
  body: T,
  status = 200,
): Response {
  return Response.json({ ...body, stub: true }, { status });
}
