/**
 * Point lookups of `ibc/` vouchers against the holding chain's LCD: the I/O
 * half of token identity.
 *
 * Mirrors what the extension's engine resolver does (zunia-sdk interchain
 * `denom.ts`, used by zunia-extension lib/token-identity.ts @ 1453e7a):
 *
 * 1. `GET /ibc/apps/transfer/v1/denom_traces/{HASH}`. Cosmos Hub retired it
 *    (HTTP 501, gRPC code 12), and ibc-go v9+ chains answer
 *    `/ibc/apps/transfer/v1/denoms/{HASH}` instead, so a 404/501 falls through
 *    to that path. Osmosis is the other way round. Both shapes are parsed.
 * 2. The trace must hash back to the denom (`sha256(path/base)`); a stranger's
 *    node that answers with another token is ignored, not believed.
 * 3. Each hop is walked to the chain at its far end: through the registry's
 *    canonical channel table when the channel is listed (no request, and the
 *    registry is what makes a walk "proven" anyway), else through the
 *    channel's light client (`…/channels/{ch}/ports/{port}/client_state`),
 *    whose claimed chain id yields a name but never a proof.
 *
 * Every read goes through `fetchJson` (timeout, per-host cap) and `cached`
 * (single flight, failures remembered: a minute for a trace, ten for a hop's
 * light client), so a wallet with forty vouchers on a cold cache costs at most
 * 32 trace reads plus the walks, and a second visitor holding the same tokens
 * costs nothing.
 */

import "server-only";

import { cached } from "@/lib/server/cache";
import { restOf } from "@/lib/server/chains";
import { fetchJson, mapLimit, UpstreamError } from "@/lib/server/http";
import { parseTraceBody, traceUnimplemented, readClientChainId, type Trace } from "./trace-body";
import {
  canonicalCounterpartyOf,
  MAX_LOOKUPS,
  traceMatches,
  type DenomTraceResolver,
  type ResolvedTrace,
  type TransientMiss,
} from "./engine";

/** A miss (an unknown hash) is asked again after this; found traces never change. */
const TRACE_TTL_MS = 30 * 60_000;
/** A channel's light client keeps its chain id for the channel's life. */
const CLIENT_CHAIN_TTL_MS = 6 * 60 * 60_000;
/** How long a failed read is remembered before the next attempt. */
const ERROR_TTL_MS = 60_000;
const TIMEOUT_MS = 6_000;
/**
 * The light-client read of a hop, which only runs for channels the registry
 * does not list, gets one short attempt, and a failure is remembered for ten
 * minutes. The hop that fails here is typically a dead one (a chain wound
 * down, a node that no longer answers) and fails the same way on every
 * attempt: at 6 s with a retry (~12 s) it outlasted the portfolio's 8 s
 * identity budget, so a cold /api/portfolio waited the whole budget, and with
 * a one-minute error memory the next reads did again each time the voucher's
 * two-minute transient miss ran out. A node that is up answers a read this
 * small well within 3 s; a voucher behind a failed hop keeps its readable
 * stand-in name until the next attempt, never a wrong one.
 */
const CLIENT_CHAIN_TIMEOUT_MS = 3_000;
const DEAD_HOP_TTL_MS = 10 * 60_000;
/** Longer traces exist but cannot be walked within one request's budget. */
const MAX_WALK_HOPS = 4;
const HASH = /^[0-9A-F]{64}$/;

function gone(error: unknown): boolean {
  return error instanceof UpstreamError && error.kind === "http" && (error.status === 404 || error.status === 501);
}

/**
 * The trace of `ibc/{hash}` on `chainId`; null when the chain says it has no
 * such denom (or cannot be asked), throws when the read failed transiently.
 */
async function fetchTrace(chainId: string, hash: string): Promise<Trace | null> {
  const rest = restOf(chainId);
  if (!rest) return null;
  return cached(`token-trace:${chainId}:${hash}`, { ttlMs: TRACE_TTL_MS, staleMs: 0, errorTtlMs: ERROR_TTL_MS }, async () => {
    try {
      const body = await fetchJson(`${rest}/ibc/apps/transfer/v1/denom_traces/${hash}`, {
        timeoutMs: TIMEOUT_MS,
        retries: 1,
      });
      if (!traceUnimplemented(body)) return parseTraceBody(body);
    } catch (error) {
      if (!gone(error)) throw error;
    }
    try {
      const body = await fetchJson(`${rest}/ibc/apps/transfer/v1/denoms/${hash}`, {
        timeoutMs: TIMEOUT_MS,
        retries: 1,
      });
      return traceUnimplemented(body) ? null : parseTraceBody(body);
    } catch (error) {
      if (gone(error)) return null;
      throw error;
    }
  });
}

/** The chain id the channel's light client tracks; null when the chain cannot be asked. */
async function clientChainId(chainId: string, port: string, channel: string): Promise<string | null> {
  const rest = restOf(chainId);
  if (!rest) return null;
  return cached(
    `ibc-client-chain:${chainId}:${port}:${channel}`,
    { ttlMs: CLIENT_CHAIN_TTL_MS, staleMs: CLIENT_CHAIN_TTL_MS, errorTtlMs: DEAD_HOP_TTL_MS },
    async () => {
      try {
        // No retry: on a dead hop it only doubles the wait (see DEAD_HOP_TTL_MS).
        const body = await fetchJson(
          `${rest}/ibc/core/channel/v1/channels/${encodeURIComponent(channel)}/ports/${encodeURIComponent(port)}/client_state`,
          { timeoutMs: CLIENT_CHAIN_TIMEOUT_MS },
        );
        return readClientChainId(body);
      } catch (error) {
        if (gone(error)) return null;
        throw error;
      }
    },
  );
}

/**
 * The chain after each hop of `path`, starting from `chainId`. Stops (nulls
 * for the rest) where a chain cannot be asked; throws on a transient failure
 * so the voucher is retried soon instead of being remembered as untraceable.
 */
async function walk(chainId: string, path: string): Promise<(string | null)[]> {
  const segments = path ? path.split("/") : [];
  const hops: { port: string; channel: string }[] = [];
  for (let i = 0; i + 1 < segments.length; i += 2) {
    hops.push({ port: segments[i] ?? "", channel: segments[i + 1] ?? "" });
  }
  const out: (string | null)[] = [];
  let current: string | null = chainId;
  for (const hop of hops) {
    const from: string | null = current;
    if (from === null) {
      out.push(null);
      continue;
    }
    const canonical: string | null = hop.port === "transfer" ? canonicalCounterpartyOf(from, hop.channel) : null;
    const next: string | null = canonical ?? (await clientChainId(from, hop.port, hop.channel));
    out.push(next);
    current = next;
  }
  return out;
}

async function resolveOne(chainId: string, denom: string): Promise<ResolvedTrace | TransientMiss | null> {
  const hash = denom.slice(4).toUpperCase();
  if (!HASH.test(hash)) return null;
  let trace: Trace | null;
  try {
    trace = await fetchTrace(chainId, hash);
  } catch {
    return { transient: true };
  }
  if (!trace || !traceMatches(denom, trace.path, trace.baseDenom)) return null;
  const segments = trace.path ? trace.path.split("/") : [];
  if (segments.length === 0 || segments.length % 2 !== 0 || segments.length / 2 > MAX_WALK_HOPS) {
    return { baseDenom: trace.baseDenom, path: trace.path, originChainId: null };
  }
  let hopChainIds: (string | null)[];
  try {
    hopChainIds = await walk(chainId, trace.path);
  } catch {
    return { transient: true };
  }
  const last = hopChainIds[hopChainIds.length - 1] ?? null;
  return { baseDenom: trace.baseDenom, path: trace.path, originChainId: last, hopChainIds };
}

/** The resolver `identifyHeld` uses in the app. */
export const lcdTraceResolver: DenomTraceResolver = {
  async identifyDenoms(chainId, denoms, options) {
    const limit = Math.min(options?.maxLookups ?? MAX_LOOKUPS, MAX_LOOKUPS);
    const asked = denoms.slice(0, limit);
    const answers = await mapLimit(asked, 6, (denom) =>
      options?.signal?.aborted ? Promise.resolve(null) : resolveOne(chainId, denom),
    );
    const out = new Map<string, ResolvedTrace | TransientMiss>();
    asked.forEach((denom, index) => {
      const answer = answers[index];
      if (answer) out.set(denom, answer);
    });
    return out;
  },
};
