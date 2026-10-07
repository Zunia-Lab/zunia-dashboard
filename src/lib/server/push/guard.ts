/**
 * Request hygiene for the state-changing push routes.
 *
 * They write to the server's store and make it send pushes, so they accept
 * only what the dashboard's own pages and service worker send:
 *
 * - **same origin**: `Sec-Fetch-Site: same-origin` (set by every current
 *   browser, unforgeable by page script), or, from an older browser without
 *   it, an `Origin` whose host is this request's host. A cross-site page
 *   cannot make a visitor's browser subscribe someone else's endpoint or spam
 *   test pushes. Non-browser clients can claim anything — this is CSRF
 *   protection, not authentication.
 * - **JSON only**, with a hard body cap read off the stream: a declared
 *   `content-length` can lie, so the bytes are counted as they arrive.
 *
 * Pure over the Web `Request`, so it is tested without a server.
 */

export function jsonError(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status, headers: { "cache-control": "no-store" } });
}

export function isSameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  try {
    return host !== "" && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

/** The request's JSON body, or the 4xx to answer with. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonBody> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return { ok: false, response: jsonError(415, "unsupported_media_type", "Send JSON (application/json)") };
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: jsonError(413, "body_too_large", `Body over ${maxBytes} bytes`) };
  }
  if (!req.body) return { ok: false, response: jsonError(400, "body_required", "A JSON body is required") };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, response: jsonError(413, "body_too_large", `Body over ${maxBytes} bytes`) };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: jsonError(400, "body_unreadable", "The request body could not be read") };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "The body is not valid JSON") };
  }
}
