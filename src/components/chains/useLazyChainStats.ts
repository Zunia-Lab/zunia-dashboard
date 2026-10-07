"use client";

/**
 * Chain stats for the rows the Chains table shows, loaded as they appear.
 *
 * The route answers at most 40 chains per request and rate-limits by chain
 * count, so the table never asks for the whole catalog: `stats-plan.ts`
 * turns the ids on screen into a few stable chunks, and each chunk is one
 * `useChainStats` read (a fixed number of hook slots, because hooks cannot
 * be called in a loop). Rows already loaded are served from whichever chunk
 * holds them, so "Show more", a search or a re-sort never re-asks for them.
 *
 * Failure handling, per the contract:
 * - a chain the server ran out of time on is retried once (it keeps loading
 *   into the server cache meanwhile);
 * - a rate-limited chunk (429) is retried every 12 s until it gets through;
 * - a chunk where nothing could be read (503, which the route also answers
 *   when every chain in it timed out on a cold cache) is retried once after
 *   10 s, its rows still loading; if that fails too they show "—" with the
 *   reason, and `retryFailed()` asks again;
 * - every chunk refreshes on the hook's own 5-minute poll.
 */

import { useEffect, useMemo, useState } from "react";
import type { PartError } from "@/lib/chain/types";
import { MAX_STATS_CHAINS, useChainStats, type ChainStats, type ChainStatsState } from "@/lib/data/chains";
import type { FiatCurrency } from "@/lib/token/types";
import { planChunks, timedOutIds, type Chunk } from "./stats-plan";

/**
 * Hook slots: 222 mainnets in chunks of 40 is six, plus room for the first
 * screen, timeout retries and searches, so the planner never has to start
 * over (which would ask for every row again).
 */
const SLOTS = 16;
const NONE: readonly string[] = [];
/** Wait before asking for a newly shown set (typing a search). */
const SETTLE_MS = 280;
/** Retry interval for a rate-limited chunk. */
const RATE_LIMIT_RETRY_MS = 12_000;
/** Wait before the one retry of a chunk that failed outright (a 503 is no-store). */
const FAILED_RETRY_MS = 10_000;

export type RowStatus = "loading" | "ready" | "error";

export interface RowState {
  status: RowStatus;
  /** Why the row has no stats (status "error"). */
  reason?: string;
}

export interface LazyChainStats {
  statsFor: (chainId: string) => ChainStats | null;
  rowState: (chainId: string) => RowState;
  /** Stats of the wanted ids that have loaded, in the order asked. */
  loaded: ChainStats[];
  /** Currency of every `price` (null before the first answer). */
  currency: FiatCurrency | null;
  /** Some chunk is loading or refreshing. */
  busy: boolean;
  /** Nothing loaded yet for the wanted ids. */
  initialLoading: boolean;
  /** Wanted chains that could not be read, for a PartialDataBadge. */
  errors: PartError[];
  /** Chunks that failed outright (not rate limits). */
  failedChunks: number;
  retryFailed: () => void;
  /** Oldest live figure among the answers (epoch ms). */
  updatedAt: number | null;
}

function reasonFor(slot: ChainStatsState): string {
  const error = slot.error;
  if (!error) return "Could not be read right now";
  if (error.status === 429) return "Waiting for the rate limit; retrying shortly";
  if (error.code === "upstream_failed" || error.status === 503) return "This network's public endpoints are not answering right now";
  if (error.kind === "network") return "The dashboard server could not be reached";
  return error.message;
}

/** Ids on screen, debounced so typing a search does not plan a chunk per keystroke. */
function useSettled(ids: readonly string[]): readonly string[] {
  const key = ids.join(",");
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    if (key === settled) return;
    const timer = window.setTimeout(() => setSettled(key), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [key, settled]);
  return useMemo(() => (settled ? settled.split(",") : []), [settled]);
}

export function useLazyChainStats(wanted: readonly string[]): LazyChainStats {
  const settled = useSettled(wanted);
  const [chunks, setChunks] = useState<readonly Chunk[]>([]);
  // Chunks (by their id list) whose one retry after a failure has been sent.
  const [retried, setRetried] = useState<ReadonlySet<string>>(() => new Set());

  // A fixed number of reads; empty slots are idle (no request).
  const s0 = useChainStats(chunks[0] ?? NONE);
  const s1 = useChainStats(chunks[1] ?? NONE);
  const s2 = useChainStats(chunks[2] ?? NONE);
  const s3 = useChainStats(chunks[3] ?? NONE);
  const s4 = useChainStats(chunks[4] ?? NONE);
  const s5 = useChainStats(chunks[5] ?? NONE);
  const s6 = useChainStats(chunks[6] ?? NONE);
  const s7 = useChainStats(chunks[7] ?? NONE);
  const s8 = useChainStats(chunks[8] ?? NONE);
  const s9 = useChainStats(chunks[9] ?? NONE);
  const s10 = useChainStats(chunks[10] ?? NONE);
  const s11 = useChainStats(chunks[11] ?? NONE);
  const s12 = useChainStats(chunks[12] ?? NONE);
  const s13 = useChainStats(chunks[13] ?? NONE);
  const s14 = useChainStats(chunks[14] ?? NONE);
  const s15 = useChainStats(chunks[15] ?? NONE);
  const slots = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15];

  // Latest answer per chain: later chunks (retries) win over earlier ones.
  const byId = new Map<string, ChainStats>();
  for (const slot of slots) for (const chain of slot.data?.chains ?? []) byId.set(chain.chainId, chain);

  /** What each planned chunk says about one chain. */
  const verdict = (id: string): { covered: boolean; state: RowState } => {
    const loaded = byId.get(id);
    if (loaded) return { covered: true, state: { status: "ready" } };
    let holders = 0;
    let pending = false;
    let timedOut = false;
    let failure: string | null = null;
    chunks.forEach((chunk, index) => {
      if (!chunk.includes(id)) return;
      holders += 1;
      const slot = slots[index];
      if (!slot) return;
      if (slot.status === "loading" || slot.status === "idle") pending = true;
      else if (slot.status === "error") {
        // Rate limited, or failed once with its retry still to come: loading.
        if (slot.error?.status === 429 || !retried.has(chunk.join(","))) pending = true;
        else failure = reasonFor(slot);
      } else if (slot.data && timedOutIds([id], slot.data.chains, slot.data.errors).length > 0) timedOut = true;
      else failure = "Not in the answer";
    });
    if (holders === 0) return { covered: false, state: { status: "loading" } };
    if (pending) return { covered: true, state: { status: "loading" } };
    // One retry for a timeout: the first answer left while the reads were
    // still filling the server cache.
    if (timedOut && holders < 2) return { covered: false, state: { status: "loading" } };
    if (timedOut) return { covered: true, state: { status: "error", reason: "Answered too slowly; it will appear on the next refresh" } };
    return { covered: true, state: { status: "error", reason: failure ?? "Could not be read right now" } };
  };

  const next = planChunks(chunks, settled, { chunkSize: MAX_STATS_CHAINS, maxSlots: SLOTS }, (id) => verdict(id).covered);
  if (next !== chunks) setChunks(next);

  // Rate-limited chunks try again on a timer until they get through (a 429
  // is never cached, so the same URL is asked again).
  const limited = slots
    .map((slot, index) => (slot.status === "error" && slot.error?.status === 429 ? index : -1))
    .filter((index) => index >= 0);
  const limitedKey = limited.join(",");
  const limitedRefetch = limited.map((index) => slots[index]?.refetch);
  useEffect(() => {
    if (!limitedKey) return;
    const timer = window.setInterval(() => {
      for (const refetch of limitedRefetch) refetch?.();
    }, RATE_LIMIT_RETRY_MS);
    return () => window.clearInterval(timer);
    // The refetch functions are stable per URL; the key says which slots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limitedKey]);

  // A chunk that failed outright gets one more try after a pause: the server
  // keeps filling its cache from the first attempt meanwhile.
  const failedOnce = chunks
    .map((chunk, index) => ({ key: chunk.join(","), slot: slots[index] }))
    .filter(({ key, slot }) => slot?.status === "error" && slot.error?.status !== 429 && !retried.has(key));
  const failedOnceKey = failedOnce.map((entry) => entry.key).join("|");
  const failedOnceRefetch = failedOnce.map((entry) => entry.slot?.refetch);
  useEffect(() => {
    if (!failedOnceKey) return;
    const keys = failedOnceKey.split("|");
    const timer = window.setTimeout(() => {
      setRetried((current) => new Set([...current, ...keys]));
      for (const refetch of failedOnceRefetch) refetch?.();
    }, FAILED_RETRY_MS);
    return () => window.clearTimeout(timer);
    // Keyed by which chunks failed; their refetch functions are stable per URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedOnceKey]);

  const loaded = settled.map((id) => byId.get(id)).filter((chain): chain is ChainStats => Boolean(chain));
  const currency = slots.find((slot) => slot.data)?.data?.currency ?? null;
  const busy = slots.some((slot) => slot.loading || slot.refreshing);
  // Failed for good: the one automatic retry has been spent.
  const failedSlots = slots.filter(
    (slot, index) => slot.status === "error" && slot.error?.status !== 429 && retried.has(chunks[index]?.join(",") ?? ""),
  );

  const errors: PartError[] = [];
  for (const id of settled) {
    const { state } = verdict(id);
    if (state.status === "error") errors.push({ chainId: id, scope: "stats", message: state.reason ?? "Could not be read" });
  }

  const times = slots.map((slot) => slot.data?.updatedAt).filter((t): t is number => typeof t === "number");

  return {
    statsFor: (id) => byId.get(id) ?? null,
    rowState: (id) => verdict(id).state,
    loaded,
    currency,
    busy,
    initialLoading: loaded.length === 0 && settled.length > 0 && errors.length < settled.length,
    errors,
    failedChunks: failedSlots.length,
    retryFailed: () => {
      for (const slot of failedSlots) slot.refetch();
    },
    updatedAt: times.length > 0 ? Math.min(...times) : null,
  };
}
