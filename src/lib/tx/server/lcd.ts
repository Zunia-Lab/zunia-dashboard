/**
 * POSTs to a chain's REST gateway, for simulate and broadcast.
 *
 * Reads go through `fetchJson` (`@/lib/server/http`), which throws on any
 * non-2xx and drains the body — right for reads, wrong here: a rejected
 * simulation arrives as HTTP 400 whose JSON body (`{code, message}`) is the
 * only statement of *why* ("insufficient funds", "account sequence mismatch,
 * expected 7"), and that reason is what lets the dashboard stop before asking
 * anyone to sign a transaction that cannot succeed. So this helper keeps the
 * same protections — a hard timeout, typed failures, no cookies, a bounded
 * body, the host taken from the catalog only — and hands back the status and
 * the parsed body whatever the status is. Callers decide what an HTTP 400
 * means; they never echo the body raw (see `chainMessage`).
 */

import "server-only";
import { UpstreamError } from "@/lib/server/http";

const MAX_RESPONSE_BYTES = 2_000_000;

export interface LcdAnswer {
  status: number;
  /** Parsed JSON, or null when the body was not JSON (an HTML error page). */
  body: unknown;
}

/**
 * The body as text, refusing (and aborting the read) past `max` bytes: a node
 * answering with something enormous costs this server nothing beyond the cap.
 */
async function readCapped(response: Response, max: number, controller: AbortController): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      throw new UpstreamError("parse", "");
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

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export async function postLcd(url: string, payload: unknown, timeoutMs: number): Promise<LcdAnswer> {
  const host = hostOf(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(payload),
        signal: controller.signal,
        headers: { accept: "application/json", "content-type": "application/json" },
        cache: "no-store",
        credentials: "omit",
      });
    } catch {
      throw new UpstreamError(controller.signal.aborted ? "timeout" : "network", host);
    }
    let text: string;
    try {
      text = await readCapped(response, MAX_RESPONSE_BYTES, controller);
    } catch (error) {
      if (error instanceof UpstreamError) throw new UpstreamError(error.kind, host);
      throw new UpstreamError(controller.signal.aborted ? "timeout" : "network", host);
    }
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The chain's own message from a gRPC-gateway error body (`{code, message}`),
 * bounded and stripped of control characters, or "" when there is none.
 *
 * This is chain output (what an explorer shows for the same failure), not an
 * arbitrary upstream body: only the `message` string is ever taken, and an
 * HTML error page yields nothing.
 */
export function chainMessage(body: unknown, max = 600): string {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  const raw = typeof record.message === "string" ? record.message : typeof record.error === "string" ? record.error : "";
  const clean = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
