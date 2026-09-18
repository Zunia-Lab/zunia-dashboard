"use client";

/**
 * Async state for the interchain screens.
 *
 * One generic loader plus four thin wrappers. The generic is here rather than
 * in `useJson.ts` because these are POSTs with structured bodies, they are
 * debounced (a plan is re-requested as the user types an amount), and one of
 * them polls until the packet reaches a terminal state.
 *
 * Every state this returns is one of exactly four, and screens are expected to
 * render all four: idle (no input yet), loading, error, ready. There is no
 * fifth state where stale data is shown as if it were current — a superseded
 * key drops its data, because a quote for the previous amount rendered next to
 * the new amount is a lie the user will act on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkChannel,
  fetchBalances,
  fetchPlan,
  fetchQuote,
  fetchSwapConfig,
  fetchTrace,
  fetchTxStatus,
  type PlanInput,
  type QuoteInput,
  type TrackInput,
} from "./client";
import type {
  BalanceWire,
  ChannelCheckWire,
  InterchainFailure,
  PlanResponseBody,
  RouteTraceWire,
  SwapConfigWire,
  SwapQuoteWire,
  TxStatusWire,
} from "./wire";

export type AsyncStatus = "idle" | "loading" | "error" | "ready";

export interface AsyncResource<T> {
  readonly status: AsyncStatus;
  /** Non-null only when `status` is `ready`. */
  readonly data: T | null;
  /** Non-null only when `status` is `error`. */
  readonly error: InterchainFailure | null;
  readonly loading: boolean;
  /** Re-run the loader for the current key. No-op while idle. */
  readonly reload: () => void;
}

/** Discriminated so `result.ok` narrows; a bare `{data}` would not. */
export type LoadResult<T> = { readonly ok: true; readonly data: T } | InterchainFailure;

interface Settled<T> {
  readonly key: string;
  readonly nonce: number;
  readonly data: T | null;
  readonly error: InterchainFailure | null;
}

/**
 * Load `T` whenever `key` changes, dropping any answer that arrives for a key
 * the caller has since moved on from.
 *
 * `key` being null means "nothing to load" and produces the idle state, which
 * is how a screen waits for a wallet connection or a non-empty amount.
 *
 * Exported for `lib/nft/hooks.ts`. The NFT screens need exactly this — a
 * keyed, abortable, superseded-answers-dropped loader with the same four
 * states — and a second implementation would be a second place for the
 * stale-data bug this one exists to prevent.
 */
export function useAsyncResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<LoadResult<T>>,
  options: { readonly debounceMs?: number } = {},
): AsyncResource<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const debounceMs = options.debounceMs ?? 0;

  // The loader closes over the caller's inputs and is a new function every
  // render; the request keys off `key` and `nonce` only, so the latest loader
  // is read through a ref rather than restarting the request on every render.
  // Written in an effect, not during render: a ref mutated while rendering is
  // lost if React discards the render.
  const loadRef = useRef(load);
  useEffect(() => {
    // Declared before the request effect, so it has already run by the time
    // that one reads the ref.
    loadRef.current = load;
  });

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    let cancelled = false;

    const run = () => {
      void loadRef
        .current(controller.signal)
        .then((result) => {
          if (cancelled) return;
          setSettled(
            result.ok === false
              ? { key, nonce, data: null, error: result }
              : { key, nonce, data: result.data, error: null },
          );
        })
        .catch(() => {
          if (cancelled) return;
          setSettled({
            key,
            nonce,
            data: null,
            error: {
              ok: false,
              code: "server-error",
              message: "The request failed before it could be read.",
            },
          });
        });
    };

    const timer =
      debounceMs > 0 ? window.setTimeout(run, debounceMs) : (run(), null);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [key, nonce, debounceMs]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return useMemo<AsyncResource<T>>(() => {
    if (key === null) {
      return { status: "idle", data: null, error: null, loading: false, reload };
    }
    const current = settled?.key === key && settled.nonce === nonce ? settled : null;
    if (!current) {
      return { status: "loading", data: null, error: null, loading: true, reload };
    }
    if (current.error) {
      return {
        status: "error",
        data: null,
        error: current.error,
        loading: false,
        reload,
      };
    }
    return {
      status: "ready",
      data: current.data,
      error: null,
      loading: false,
      reload,
    };
  }, [key, nonce, settled, reload]);
}

/** Is cross-chain swap configured and verified for this deployment? */
export function useSwapConfig(): AsyncResource<SwapConfigWire> {
  return useAsyncResource<SwapConfigWire>("swap-config", async (signal) => {
    const response = await fetchSwapConfig(signal);
    return response.ok ? { ok: true, data: response.config } : response;
  });
}

export interface BalancesState {
  readonly balances: readonly BalanceWire[];
  readonly notes: readonly string[];
}

export function useBalances(
  chainId: string | null,
  address: string | null,
): AsyncResource<BalancesState> {
  const key = chainId && address ? `${chainId}|${address}` : null;
  return useAsyncResource<BalancesState>(key, async (signal) => {
    if (!chainId || !address) {
      return { ok: false, code: "bad-request", message: "No account connected." };
    }
    const response = await fetchBalances({ chainId, address }, signal);
    return response.ok
      ? { ok: true, data: { balances: response.balances, notes: response.notes } }
      : response;
  });
}

/**
 * Plan a route. Debounced, because the amount is typed and each keystroke would
 * otherwise cost a channel-discovery pass.
 */
export function usePlan(input: PlanInput | null): AsyncResource<PlanResponseBody> {
  const key = input ? JSON.stringify(input) : null;
  return useAsyncResource<PlanResponseBody>(
    key,
    async (signal) => {
      if (!input) {
        return { ok: false, code: "bad-request", message: "Nothing to plan." };
      }
      const response = await fetchPlan(input, signal);
      if (!response.ok) return response;
      return {
        ok: true,
        data: {
          candidates: response.candidates,
          warnings: response.warnings,
          denomStrategy: response.denomStrategy,
          outputDenom: response.outputDenom,
          outputDenomReason: response.outputDenomReason,
          discoveryFailures: response.discoveryFailures,
        },
      };
    },
    { debounceMs: 450 },
  );
}

export function useQuote(input: QuoteInput | null): AsyncResource<SwapQuoteWire> {
  const key = input ? JSON.stringify(input) : null;
  return useAsyncResource<SwapQuoteWire>(
    key,
    async (signal) => {
      if (!input) {
        return { ok: false, code: "bad-request", message: "Nothing to quote." };
      }
      const response = await fetchQuote(input, signal);
      return response.ok ? { ok: true, data: response.quote } : response;
    },
    { debounceMs: 450 },
  );
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "acknowledged",
  "timeout",
  "failed",
]);

/**
 * Follow a signed transfer until it lands or fails.
 *
 * Polling stops on a terminal status — and on `swap-delivery-failed`, which is
 * terminal for the packet but not for the user, who now has a recover action to
 * take. It does not stop on `stalled`: a stalled hop is late, not finished, and
 * the tracker's whole job at that point is to keep watching.
 */
export function useTrace(
  input: TrackInput | null,
  options: { readonly pollMs?: number } = {},
): AsyncResource<RouteTraceWire> {
  const pollMs = options.pollMs ?? 6_000;
  const key = input ? `${input.sourceTxHash}|${input.plan.hops.length}` : null;
  const resource = useAsyncResource<RouteTraceWire>(key, async (signal) => {
    if (!input) {
      return { ok: false, code: "bad-request", message: "Nothing to track." };
    }
    const response = await fetchTrace(input, signal);
    return response.ok ? { ok: true, data: response.trace } : response;
  });

  const { data, reload, status } = resource;
  const done =
    data !== null &&
    (TERMINAL_STATUSES.has(data.status) || data.failure === "swap-delivery-failed");

  useEffect(() => {
    if (key === null || done) return;
    // Re-polled on an interval rather than a chain of timeouts so a slow
    // response cannot stack requests: `useAsyncResource` aborts the previous
    // one whenever the nonce changes.
    const timer = window.setInterval(reload, pollMs);
    return () => window.clearInterval(timer);
  }, [key, done, pollMs, reload, status]);

  return resource;
}

/**
 * Poll one transaction until it is in a block.
 *
 * Stops on success or failure. `not-found` keeps polling: for the first few
 * seconds after a broadcast that is the ordinary answer, and treating it as a
 * failure is how a wallet tells someone their money vanished when it did not.
 */
export function useTxStatus(
  params: { chainId: string; hash: string } | null,
  options: { readonly pollMs?: number } = {},
): AsyncResource<TxStatusWire> {
  const pollMs = options.pollMs ?? 5_000;
  const key = params ? `${params.chainId}|${params.hash}` : null;
  const resource = useAsyncResource<TxStatusWire>(key, async (signal) => {
    if (!params) {
      return { ok: false, code: "bad-request", message: "Nothing to check." };
    }
    const response = await fetchTxStatus(params, signal);
    return response.ok ? { ok: true, data: response.status } : response;
  });

  const { data, reload } = resource;
  const settled = data?.state === "success" || data?.state === "failed";

  useEffect(() => {
    if (key === null || settled) return;
    const timer = window.setInterval(reload, pollMs);
    return () => window.clearInterval(timer);
  }, [key, settled, pollMs, reload]);

  return resource;
}

/**
 * Validate a channel id the user typed.
 *
 * Debounced hard: the field is typed into character by character and each check
 * costs a round trip to two chains.
 */
export function useChannelCheck(
  params: { source: string; channel: string; dest?: string } | null,
): AsyncResource<ChannelCheckWire> {
  const key = params
    ? `${params.source}|${params.channel}|${params.dest ?? ""}`
    : null;
  return useAsyncResource<ChannelCheckWire>(
    key,
    async (signal) => {
      if (!params) {
        return { ok: false, code: "bad-request", message: "No channel to check." };
      }
      const response = await checkChannel(params, signal);
      return response.ok ? { ok: true, data: response.check } : response;
    },
    { debounceMs: 500 },
  );
}
