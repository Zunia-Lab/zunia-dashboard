"use client";

/**
 * The swap page's data: what Osmosis can deliver, the live quote for the
 * form, and the transaction a frozen review signs.
 *
 * - `useSwapAssets(fromChainId)` reads `/api/swap/assets` through the shared
 *   `useApi` store (deduped, stale-while-revalidate, refreshed every five
 *   minutes while visible). The answer depends on the From's network only,
 *   so the URL carries the network, never the chain: one store entry per
 *   network, whichever chain the From is on.
 * - `useSwapQuote(request)` POSTs `/api/swap/quote`: 450 ms after the form
 *   last changed (the extension's debounce), again on its own whenever the
 *   price reaches the end of its 20-second life while the tab is visible, and
 *   never for a request that is no longer the form's (superseded requests are
 *   aborted, late answers dropped). While a new answer loads, the previous
 *   one stays on screen flagged `stale` (dim it), with a ticking expiry clock.
 *   Every answer's lifetime is moved onto this browser's clock on arrival
 *   (`quoteOnClientClock`), so a machine whose clock is off neither requotes
 *   in a loop nor signs a dead price.
 * - `buildSwapTx(review)` and `checkSwapTx(review, messages)` are the pure
 *   functions of src/lib/swap/tx.ts, re-exported: build from the frozen review
 *   only, and run the check at click time, right before the wallet is asked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { QUOTE_TTL_MS } from "@/config/interchain";
import { findChain } from "@/lib/chains";
import { networkError, parseError, readApiError } from "@/lib/api-error";
import { apiUrl, useApi, type ApiError, type ApiState } from "@/lib/useApi";
import {
  quoteOnClientClock,
  readSwapAssetsResponse,
  readSwapQuoteResponse,
  type SwapAssetsResponse,
  type SwapQuoteBlocked,
  type SwapQuoteOk,
  type SwapQuoteRequest,
  type SwapQuoteResponse,
} from "@/lib/swap/wire";

export { buildSwapTx, checkSwapTx, SwapBuildError, swapMemo, type SwapTx } from "@/lib/swap/tx";
export {
  freezeReview,
  minimumReceived,
  priceImpactLevel,
  quoteMismatch,
  quoteRequestFor,
  reviewDrift,
  signBlock,
  slippageNotice,
  swapFeeLine,
  swapFeeOutcome,
  type LiveSwap,
  type PriceImpactLevel,
} from "@/lib/swap/form";
export {
  amountUnitsOf,
  buyOptions,
  heldFromPortfolio,
  pickTo,
  sellOptions,
  type AssetOption,
  type HeldToken,
} from "@/lib/swap/assets";
export type { SwapReview, ReviewSide } from "@/lib/swap/review";
export type {
  SwapAsset,
  SwapAssetsResponse,
  SwapBlockedCode,
  SwapQuoteBlocked,
  SwapQuoteOk,
  SwapQuotePrice,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRoutePool,
  SwapRouteSplit,
} from "@/lib/swap/wire";
export type { SwapPath } from "@/lib/swap/path";
export { rememberSwapIntent, takeSwapIntent, type SwapIntent } from "@/lib/swap/intent";
export {
  DEFAULT_SLIPPAGE_PERCENT,
  explorerTxUrl,
  HIGH_SLIPPAGE_PERCENT,
  MAX_SLIPPAGE_PERCENT,
  QUOTE_TTL_MS,
  SLIPPAGE_PRESETS,
} from "@/config/interchain";

/** The extension's planning debounce: long enough to skip keystrokes, short enough to feel live. */
export const QUOTE_DEBOUNCE_MS = 450;

/**
 * How long the browser waits for one quote. The route gives up after a
 * price's life (20 s, then a 503 with the reason); this only catches a
 * connection that never answers, so the form is never stuck "updating".
 */
const QUOTE_REQUEST_TIMEOUT_MS = 30_000;

/**
 * What Osmosis can deliver for a From on `fromChainId`'s network (mainnet
 * when `null`). A chain the browser's catalog does not know is sent as is, for
 * the route to refuse with its reason.
 */
export function useSwapAssets(fromChainId: string | null): ApiState<SwapAssetsResponse> {
  const network = fromChainId === null ? "mainnet" : (findChain(fromChainId)?.network ?? null);
  const url =
    network === null
      ? apiUrl("/api/swap/assets", { fromChainId })
      : apiUrl("/api/swap/assets", { network: network === "testnet" ? "testnet" : null });
  return useApi<SwapAssetsResponse>(url, {
    parse: readSwapAssetsResponse,
    refreshMs: 5 * 60_000,
    dedupeMs: 60_000,
    keepPreviousData: true,
    // ~280 KB of rows with identities: kept in memory for the session, not
    // copied into localStorage, whose few megabytes the rest of the dashboard
    // shares (and the server answers it from cache in tens of milliseconds).
    persist: false,
  });
}

export type SwapQuoteStatus = "idle" | "loading" | "ready" | "error";

export interface SwapQuoteState {
  /** The latest answer for the current request (or, while `stale`, for the previous one: show it dimmed). */
  readonly data: SwapQuoteResponse | null;
  /**
   * The signable quote for the *current* request, or `null` (none yet, blocked,
   * or only a stale answer on screen). Only this one may be frozen into a review.
   */
  readonly quote: SwapQuoteOk | null;
  /** `data.blocked` when the pair cannot be swapped, with the sentence to show. */
  readonly blocked: SwapQuoteBlocked["blocked"] | null;
  /** A failed request: bad input (400), another site (403), rate limited (429), router unreachable or too slow (503), network. */
  readonly error: ApiError | null;
  readonly status: SwapQuoteStatus;
  /** First answer for this request still on its way, nothing to show. */
  readonly loading: boolean;
  /** A request is in flight while an answer is on screen. */
  readonly refreshing: boolean;
  /** `data` belongs to an earlier request: show it dimmed, never sign it. */
  readonly stale: boolean;
  /** The quote on screen is past its lifetime (this browser's clock). */
  readonly expired: boolean;
  /** Whole seconds until the quote on screen expires; `null` without one. */
  readonly secondsLeft: number | null;
  /** Ask again now (the Refresh control). */
  readonly requote: () => void;
}

function keyOf(request: SwapQuoteRequest | null): string | null {
  return request ? JSON.stringify(request) : null;
}


interface Answer {
  readonly key: string;
  readonly data: SwapQuoteResponse | null;
  readonly error: ApiError | null;
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * The live quote for `request` (`null` while the form cannot be quoted). See
 * the module comment for the timing rules.
 */
export function useSwapQuote(request: SwapQuoteRequest | null): SwapQuoteState {
  const key = keyOf(request);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [inflightKey, setInflightKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const controller = useRef<AbortController | null>(null);
  const keyRef = useRef<string | null>(key);
  const inflightKeyRef = useRef<string | null>(null);

  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    inflightKeyRef.current = inflightKey;
  }, [inflightKey]);

  const run = useCallback(() => {
    const currentKey = keyRef.current;
    if (!currentKey) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, QUOTE_REQUEST_TIMEOUT_MS);
    setInflightKey(currentKey);
    void (async () => {
      let next: Answer;
      try {
        const response = await fetch("/api/swap/quote", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: currentKey,
          signal: abort.signal,
        });
        const receivedAt = Date.now();
        if (!response.ok) {
          next = { key: currentKey, data: null, error: await readApiError(response) };
        } else {
          const parsed = readSwapQuoteResponse(await response.json());
          next = parsed
            ? { key: currentKey, data: quoteOnClientClock(parsed, receivedAt, QUOTE_TTL_MS), error: null }
            : { key: currentKey, data: null, error: { kind: "parse", message: "Zunia's server sent a quote this page couldn't use" } };
        }
      } catch (error) {
        if (abort.signal.aborted && !timedOut) return;
        next = {
          key: currentKey,
          data: null,
          error: timedOut
            ? { kind: "network", message: "The price took too long to arrive. Try again." }
            : error instanceof SyntaxError
              ? parseError(error)
              : networkError(error),
        };
      } finally {
        window.clearTimeout(timer);
      }
      // A late answer for a request the form has moved on from is dropped.
      if ((abort.signal.aborted && !timedOut) || keyRef.current !== currentKey) return;
      setAnswer(next);
      setInflightKey(null);
      setNow(Date.now());
    })();
  }, []);

  // Debounced on every change of the request.
  useEffect(() => {
    if (!key) {
      controller.current?.abort();
      return;
    }
    const timer = window.setTimeout(run, QUOTE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key, run]);

  // Abort whatever is in flight when the component goes away.
  useEffect(() => () => controller.current?.abort(), []);

  const current = answer && key && answer.key === key ? answer : null;
  const shown = current ?? (key ? answer : null);
  // A stale answer is display only: it never feeds the clock or a review.
  const quote = current?.data && !current.data.blocked ? (current.data as SwapQuoteOk) : null;

  // The expiry clock ticks while the current quote is shown, and requotes
  // when it runs out with the tab visible (and again as soon as the tab comes
  // back). It never fires for a stale answer, so typing stays debounced.
  useEffect(() => {
    if (!quote) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (at >= quote.expiresAt && isVisible() && keyRef.current && inflightKeyRef.current === null) run();
    };
    const timer = window.setInterval(tick, 1_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [quote, run]);

  const requote = useCallback(() => run(), [run]);

  return useMemo<SwapQuoteState>(() => {
    const data = shown?.data ?? null;
    const error = current?.error ?? null;
    const stale = shown !== null && current === null;
    const inflight = inflightKey !== null && inflightKey === key;
    const shownQuote = data && !data.blocked ? (data as SwapQuoteOk) : null;
    const expiresAt = shownQuote?.expiresAt ?? null;
    const expired = expiresAt !== null && now >= expiresAt;
    const secondsLeft = expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));
    const status: SwapQuoteStatus = !key ? "idle" : error && !inflight ? "error" : current?.data ? "ready" : "loading";
    return {
      data,
      quote,
      blocked: data?.blocked ?? null,
      error,
      status,
      loading: Boolean(key) && data === null && error === null,
      refreshing: data !== null && (inflight || stale),
      stale,
      expired,
      secondsLeft: secondsLeft === null ? null : Math.min(secondsLeft, Math.ceil(QUOTE_TTL_MS / 1000)),
      requote,
    };
  }, [shown, current, inflightKey, key, quote, now, requote]);
}
