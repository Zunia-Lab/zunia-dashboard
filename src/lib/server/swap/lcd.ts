/**
 * Chain REST reads for the swap engine, through the dashboard's one HTTP
 * door (`fetchJson`: hard timeout, per-host cap, typed failures).
 *
 * The engine's parsers (`readRoutingTable`, the SDK's trace and channel
 * helpers) take an `LcdClient`; this adapts `fetchJson` to that interface so
 * they run on the same protections as every other upstream read. Errors come
 * back as `InterchainError`s whose message names the host and the status
 * only: an upstream body is never carried, so it can never be echoed.
 *
 * Hosts come from the catalog (`restOf`) and paths from this module's
 * callers; nothing here accepts either from a request.
 */

import "server-only";

import { InterchainError, type LcdClient, type LcdRequestOptions } from "@zunialab/interchain";

import { describeUpstreamError, fetchJson, UpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";

const DEFAULT_TIMEOUT_MS = 8_000;

function withQuery(url: string, query: LcdRequestOptions["query"]): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

/** An `LcdClient` for `chainId`'s catalog REST endpoint, or `null` when the catalog has none. */
export function restLcd(chainId: string, defaults: { readonly timeoutMs?: number; readonly retries?: number } = {}): LcdClient | null {
  const base = restOf(chainId);
  if (!base || !base.startsWith("https://")) return null;
  return {
    chainId,
    async getJson(path: string, options: LcdRequestOptions = {}): Promise<unknown> {
      if (options.signal?.aborted) {
        throw new InterchainError("aborted", `${chainId}: request cancelled`, { chainId });
      }
      const url = withQuery(`${base}${path.startsWith("/") ? path : `/${path}`}`, options.query);
      try {
        return await fetchJson<unknown>(url, {
          timeoutMs: options.timeoutMs ?? defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          retries: Math.min(options.retries ?? defaults.retries ?? 0, 2),
        });
      } catch (error) {
        if (error instanceof UpstreamError) {
          throw new InterchainError(
            error.kind === "parse" ? "malformed-response" : "lcd-unreachable",
            // Never `error.message`: it names the endpoint's host, and this
            // text reaches the swap screen.
            `${chainId}: ${describeUpstreamError(error)}`,
            { chainId, ...(error.status !== undefined ? { httpStatus: error.status } : {}) },
          );
        }
        throw new InterchainError("lcd-unreachable", `${chainId}: read failed`, { chainId });
      }
    },
  };
}
