/**
 * The push watcher's process-wide state.
 *
 * Kept apart from the poller so `/api/push/config` can say whether this
 * server is actually watching chains without pulling the poller (and
 * `web-push`) into that route. On `globalThis` because the poller runs in the
 * instrumentation module graph and the routes in another; both must see one
 * state, and a dev reload must not start a second loop.
 */

export interface PollerState {
  started: boolean;
  running: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastPassAt: number | null;
  lastSlowAt: number;
  passes: number;
  /**
   * watch key (`chainId|address`) → last poll time; the least recent goes
   * first. Keys of watches that no longer exist are dropped every pass.
   */
  lastPolled: Map<string, number>;
  /** Where the next slow pass starts in the subscription list (round-robin past its deadline). */
  slowCursor: number;
}

const KEY = "__zuniaPushPoller";

export function pollerState(): PollerState {
  const g = globalThis as unknown as Record<string, PollerState | undefined>;
  let state = g[KEY];
  if (!state) {
    state = {
      started: false,
      running: false,
      timer: null,
      lastPassAt: null,
      lastSlowAt: 0,
      passes: 0,
      lastPolled: new Map(),
      slowCursor: 0,
    };
    g[KEY] = state;
  }
  // A state created by an earlier build of this module (dev reload) lacks it.
  if (typeof state.slowCursor !== "number") state.slowCursor = 0;
  return state;
}

/** A detached state for tests and one-off checks, so they never touch the live watcher's. */
export function freshPollerState(): PollerState {
  return {
    started: false,
    running: false,
    timer: null,
    lastPassAt: null,
    lastSlowAt: 0,
    passes: 0,
    lastPolled: new Map(),
    slowCursor: 0,
  };
}

/** Whether the background watcher runs in this process, and when it last ran. */
export function watcherStatus(): { watching: boolean; lastPassAt: number | null } {
  const state = pollerState();
  return { watching: state.started, lastPassAt: state.lastPassAt };
}
