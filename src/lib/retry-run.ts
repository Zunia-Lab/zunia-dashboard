/**
 * One press of a "Retry" / "Check again" control, as a promise: the pending
 * window is never shorter than `minMs`, so a read that fails in a few
 * milliseconds still shows "Checking…" long enough to be seen, and the
 * outcome is what the caller can tell afterwards.
 */

export interface RetryRunOptions {
  /** Shortest time the control shows as pending. */
  minMs?: number;
  /** Timer, replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export const RETRY_MIN_PENDING_MS = 600;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `action` (sync or async, never rejecting out of here) and waits at least `minMs`. */
export async function runRetry(action: () => unknown, options: RetryRunOptions = {}): Promise<void> {
  const sleep = options.sleep ?? realSleep;
  const floor = sleep(options.minMs ?? RETRY_MIN_PENDING_MS);
  try {
    await action();
  } catch {
    // The failure is the caller's state (an error value); the outcome line says "still unavailable".
  }
  await floor;
}
