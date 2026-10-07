/**
 * Guards for the POST routes that relay signed transactions.
 *
 * `/api/broadcast` and `/api/tx/simulate` forward bytes to public chain nodes
 * from this server's IP. Without guards they are an open relay any page on the
 * web can drive from a visitor's browser (a `text/plain` form post needs no
 * CORS preflight), spending the shared upstream budget and the server's
 * reputation with the nodes. So:
 *
 * - **Same origin.** A browser always sends `Sec-Fetch-Site` and `Origin` on a
 *   cross-site POST; either one naming another site is refused. Requests with
 *   neither (curl, a server) carry no ambient browser authority to abuse and
 *   are left to the rate limiter.
 * - **JSON only.** `application/json` cannot be sent cross-site without a
 *   preflight, which these routes never answer.
 * - **Bounded body.** Checked against `Content-Length` before reading, and
 *   counted while it streams in (a chunked upload declares no length).
 */

import "server-only";
import { ParamError } from "@/lib/server/validate";

export function sameOriginProblem(req: Request): Response | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return Response.json(
      { error: "forbidden_origin", message: "This endpoint only answers the dashboard itself." },
      { status: 403 },
    );
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    // nginx forwards the public Host (zunia-infra app.zunialab.com.conf:
    // `proxy_set_header Host $host`); a proxy that rewrites Host would set
    // X-Forwarded-Host instead, so either may name the site. A browser cannot
    // forge either on a cross-site request without a preflight we never answer.
    const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host")]
      .map((value) => value?.split(",")[0]?.trim())
      .filter((value): value is string => Boolean(value));
    if (!originHost || !hosts.includes(originHost)) {
      return Response.json(
        { error: "forbidden_origin", message: "This endpoint only answers the dashboard itself." },
        { status: 403 },
      );
    }
  } else if (origin === "null") {
    return Response.json(
      { error: "forbidden_origin", message: "This endpoint only answers the dashboard itself." },
      { status: 403 },
    );
  }
  return null;
}

/**
 * The request body as text, refusing more than `maxBytes` while it streams
 * in. `Content-Length` is checked first by the caller, but a chunked upload
 * has none, and `req.text()` would buffer whatever arrives before anything
 * could look at its size.
 */
async function readBounded(req: Request, maxBytes: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const TOO_LARGE = { error: "payload_too_large", message: "The transaction is too large." } as const;

/** Reads a JSON object body of at most `maxBytes`. Throws ParamError (→ 400) or returns a 413/415 Response. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    return Response.json(
      { error: "unsupported_media_type", message: "Send the body as application/json." },
      { status: 415 },
    );
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return Response.json(TOO_LARGE, { status: 413 });
  const text = await readBounded(req, maxBytes);
  if (text === null) return Response.json(TOO_LARGE, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ParamError("body_invalid", "The body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ParamError("body_invalid", "The body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Largest signed transaction accepted, as base64 characters. */
export const MAX_TX_BASE64 = 512 * 1024;

/**
 * Signed (or simulation) transaction bytes, base64.
 *
 * Checked for shape only — canonical base64, non-empty, under the cap, and
 * starting like a `TxRaw` (field 1, length-delimited) — so a stray string is
 * refused here rather than spent on a node round trip. Whether the bytes are a
 * valid transaction is the chain's call.
 */
export function parseTxBytes(raw: unknown): string {
  if (typeof raw !== "string" || !raw) throw new ParamError("txBytes_required", "txBytes is required");
  const value = raw.trim();
  if (value.length > MAX_TX_BASE64) throw new ParamError("txBytes_too_large", "The transaction is too large");
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new ParamError("txBytes_invalid", "txBytes must be standard base64");
  }
  // 0x0a = field 1 (body_bytes), wire type 2: every TxRaw starts with it.
  if (atob(value.slice(0, 4)).charCodeAt(0) !== 0x0a) {
    throw new ParamError("txBytes_invalid", "txBytes is not a TxRaw");
  }
  return value;
}
