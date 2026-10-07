"use client";

/**
 * A cold validator read can outlast the route's budget: the route answers
 * 503 `upstream_timeout` ("still loading", `Retry-After: 5`) while the read
 * keeps filling the server cache. Instead of leaving "Still loading" on
 * screen until someone clicks Retry, ask again every 5 s, six times; the
 * page keeps its skeleton meanwhile and shows the error only once the
 * retries are spent. The same rule as the proposal page's
 * (`governance/ProposalPage.tsx`).
 */

import { useEffect, useState } from "react";
import type { ApiState } from "@/lib/useApi";

const RETRY_MS = 5_000;
const MAX_RETRIES = 6;

export interface StillLoading {
  /** A timeout answer that is being retried: show it as loading, not as an error. */
  retrying: boolean;
}

/**
 * `key` names what is read (chain, filter): a new key starts its own count,
 * so a slow chain does not use up the retries of the next one.
 */
export function useStillLoadingRetry(state: Pick<ApiState<unknown>, "status" | "error" | "refetch">, key: string): StillLoading {
  const timedOut = state.status === "error" && state.error?.code === "upstream_timeout";
  const [count, setCount] = useState({ key, attempts: 0 });
  // Reset per key with a guarded render-time update (React's "information
  // from previous renders" pattern).
  if (count.key !== key) setCount({ key, attempts: 0 });
  const attempts = count.key === key ? count.attempts : 0;
  const { refetch } = state;

  useEffect(() => {
    if (!timedOut || attempts >= MAX_RETRIES) return;
    const timer = window.setTimeout(() => {
      setCount((current) => (current.key === key ? { key, attempts: current.attempts + 1 } : current));
      refetch();
    }, RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [timedOut, attempts, refetch, key]);

  return { retrying: timedOut && attempts < MAX_RETRIES };
}
