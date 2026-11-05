"use client";

/**
 * The page's own channel checks: one per pair of networks, run as soon as the
 * pair is known and independently of any amount (`/api/interchain/channels`).
 * A pair whose first check is still reading a chain is asked again every few
 * seconds until it answers. Answers are kept for the session (10 minutes), so
 * typing an amount, or coming back to a pair, never starts over.
 */

import { useEffect, useMemo, useState } from "react";

import { fetchPairChannels } from "@/lib/interchain/client";
import { pairKey, type PairCheck } from "./channel-check";

const KEEP_MS = 10 * 60_000;
const RETRY_MS = 5_000;
const MAX_ATTEMPTS = 30;

const answers = new Map<string, { readonly check: PairCheck; readonly at: number }>();
const inflight = new Map<string, Promise<PairCheck>>();

const CHECKING: PairCheck = { status: "checking", links: [], failures: [] };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One pair's check, shared by every caller asking at the same time. */
function checkPair(from: string, to: string): Promise<PairCheck> {
  const key = pairKey(from, to);
  const running = inflight.get(key);
  if (running) return running;
  const work = (async (): Promise<PairCheck> => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await fetchPairChannels({ from, to });
      if (!response.ok) {
        if (response.code === "aborted") return CHECKING;
        return { status: "failed", links: [], failures: [response.message] };
      }
      if (!response.pending || attempt >= MAX_ATTEMPTS) {
        return { status: "done", links: response.links, failures: response.failures };
      }
      await wait(RETRY_MS);
    }
  })().then(
    (check) => {
      if (check.status !== "checking") answers.set(key, { check, at: Date.now() });
      return check;
    },
    () => ({ status: "failed", links: [], failures: ["The channel check could not be reached."] }) satisfies PairCheck,
  );
  inflight.set(key, work);
  void work.finally(() => inflight.delete(key));
  return work;
}

function kept(key: string): PairCheck | null {
  const answer = answers.get(key);
  if (!answer) return null;
  if (Date.now() - answer.at > KEEP_MS) {
    answers.delete(key);
    return null;
  }
  return answer.check;
}

/** Each pair's check, keyed by `pairKey`; a pair not answered yet reads `checking`. */
export function useChannelChecks(pairs: readonly (readonly [string, string])[]): ReadonlyMap<string, PairCheck> {
  const signature = pairs.map(([from, to]) => pairKey(from, to)).join("|");
  const [results, setResults] = useState<ReadonlyMap<string, PairCheck>>(() => new Map());

  useEffect(() => {
    let live = true;
    for (const [from, to] of pairs) {
      const key = pairKey(from, to);
      if (kept(key)) continue;
      void checkPair(from, to).then((check) => {
        if (!live || check.status === "checking") return;
        setResults((previous) => new Map(previous).set(key, check));
      });
    }
    return () => {
      live = false;
    };
    // `signature` is the pairs' identity; the array itself changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return useMemo(() => {
    const out = new Map<string, PairCheck>();
    for (const [from, to] of pairs) {
      const key = pairKey(from, to);
      out.set(key, kept(key) ?? results.get(key) ?? CHECKING);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, results]);
}
