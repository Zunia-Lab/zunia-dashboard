/**
 * The push watcher in production: the passes of `engine.ts` wired to the real
 * chain reads (`lcd.ts`), token naming (`identifyDenoms`) and sender
 * (`web-push`), run on an in-process timer started from `instrumentation.ts`
 * (spec §8 "Push").
 *
 * Every ~60 s (jittered, never overlapping) a fast pass looks for incoming
 * transfers and due unbondings; every 10 min a slow pass also checks votes
 * ending and the unbonding lists. What each pass does, and the bounds on its
 * cost, are documented in the engine.
 *
 * The store is saved whenever a pass changed something that matters
 * (`sentIds`, pending unbondings, removals), and for watermarks alone only
 * every `HEIGHT_SAVE_EVERY` passes: rewriting every record each minute just
 * because blocks went by is wasted disk, and a restart that resumes from a
 * height a few minutes old only re-reads blocks whose transfers `sentIds`
 * already covers.
 */

import "server-only";
import { findServerChain } from "@/lib/server/chains";
import {
  runSlowPass as runSlowPassWith,
  runTransferPass as runTransferPassWith,
  type PassReport,
  type PushDeps,
  type SlowPassReport,
} from "@/lib/server/push/engine";
import { pollerEnabled } from "@/lib/server/push/config";
import {
  bondDenom,
  counterpartyChainId,
  hasDelegation,
  latestHeight,
  searchIncoming,
  unbondingEntries,
  voteStatus,
  votingProposals,
} from "@/lib/server/push/lcd";
import { sendPush, type PushSender } from "@/lib/server/push/send";
import { pollerState } from "@/lib/server/push/status";
import { loadPushStore, type PushStore } from "@/lib/server/push/store";
import { identifyDenoms } from "@/lib/token/identity";

export type { PassReport, SlowPassReport };

const FAST_INTERVAL_MS = 60_000;
const JITTER_MS = 8_000;
const FIRST_DELAY_MS = 20_000;
const SLOW_EVERY_MS = 10 * 60_000;
/** Watermark-only saves: one pass in this many (~10 min). */
const HEIGHT_SAVE_EVERY = 10;

const LIVE_DEPS: PushDeps = {
  latestHeight,
  searchIncoming,
  votingProposals,
  hasDelegation,
  voteStatus,
  unbondingEntries,
  bondDenom,
  counterpartyChainId,
  identifyDenoms: (chainId, denoms) => identifyDenoms(chainId, denoms),
  chainName: (chainId) => findServerChain(chainId)?.chainName ?? chainId,
  send: sendPush,
};

export interface PassOptions {
  readonly now?: number;
  readonly store?: PushStore;
  /** Injected in checks; production sends real pushes. */
  readonly send?: PushSender;
  readonly deadlineMs?: number;
  readonly maxPolls?: number;
  /** Save the store even when only watermarks moved (default true). */
  readonly saveHeights?: boolean;
}

export interface SlowPassOptions extends PassOptions {
  /** How close to its end a vote must be to be pushed (default 24 h). */
  readonly governanceWindowMs?: number;
}

function deps(send: PushSender | undefined): PushDeps {
  return send ? { ...LIVE_DEPS, send } : LIVE_DEPS;
}

/** Incoming transfers and due unbondings, for every subscription, on live chains. */
export async function runTransferPass(options: PassOptions = {}): Promise<PassReport> {
  return runTransferPassWith({
    deps: deps(options.send),
    store: options.store ?? (await loadPushStore()),
    now: options.now ?? Date.now(),
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    ...(options.maxPolls !== undefined ? { maxPolls: options.maxPolls } : {}),
    ...(options.saveHeights !== undefined ? { saveHeights: options.saveHeights } : {}),
  });
}

/** Votes ending soon, the unbonding lists and housekeeping, on live chains. */
export async function runSlowPass(options: SlowPassOptions = {}): Promise<SlowPassReport> {
  return runSlowPassWith({
    deps: deps(options.send),
    store: options.store ?? (await loadPushStore()),
    now: options.now ?? Date.now(),
    ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
    ...(options.governanceWindowMs !== undefined ? { governanceWindowMs: options.governanceWindowMs } : {}),
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "unknown error";
}

function jitter(): number {
  return Math.floor((Math.random() * 2 - 1) * JITTER_MS);
}

function schedule(delayMs: number): void {
  const state = pollerState();
  state.timer = setTimeout(() => void tick(), Math.max(1_000, delayMs));
  state.timer.unref?.();
}

async function tick(): Promise<void> {
  const state = pollerState();
  if (state.running) {
    schedule(FAST_INTERVAL_MS + jitter());
    return;
  }
  state.running = true;
  try {
    const store = await loadPushStore();
    if (store.size() > 0) {
      const fast = await runTransferPass({ store, saveHeights: state.passes % HEIGHT_SAVE_EVERY === 0 });
      const slow =
        Date.now() - state.lastSlowAt >= SLOW_EVERY_MS
          ? await runSlowPass({ store }).finally(() => {
              state.lastSlowAt = Date.now();
            })
          : null;
      const pushed = fast.pushed + (slow?.pushed ?? 0);
      const failed = fast.failedReads + (slow?.failedReads ?? 0);
      const deferred = fast.deferred + (slow?.deferred ?? 0);
      // Quiet unless something was pushed or dropped, plus an hourly heartbeat
      // (which also reports work deferred past the per-pass caps).
      if (pushed > 0 || fast.removed > 0 || state.passes % 60 === 0) {
        console.info(
          `[push] pass: ${fast.subscriptions} subscriptions, ${fast.polled}/${fast.watches} watches on ${fast.chains} chains, ` +
            `${pushed} pushed, ${fast.suppressed + (slow?.suppressed ?? 0)} held back, ${failed} failed reads, ` +
            `${deferred} deferred, ${fast.removed + (slow?.removed ?? 0)} removed`,
        );
      }
    }
    state.lastPassAt = Date.now();
    state.passes += 1;
  } catch (error) {
    console.warn(`[push] pass failed: ${errorText(error)}`);
  } finally {
    state.running = false;
    schedule(FAST_INTERVAL_MS + jitter());
  }
}

/**
 * Starts the watcher once per process. Called from `instrumentation.ts`;
 * returns false when push is not configured or the watcher already runs.
 */
export function startPushPoller(): boolean {
  const state = pollerState();
  if (state.started || !pollerEnabled()) return false;
  state.started = true;
  schedule(FIRST_DELAY_MS + jitter());
  console.info("[push] watcher started");
  return true;
}
