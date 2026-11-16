/**
 * Keeping balances honest around a swap, without a manual reload.
 *
 * After a swap is broadcast the destination chain's balance moves later than
 * the source's (an IBC delivery takes seconds to minutes), so the page keeps
 * re-reading it on a short interval until it changes, the tracker says the
 * swap is over (delivered, refunded or failed), or the window closes. Pure:
 * the reads, the clock and the sleeping are injected (`./balance-watch.test`).
 */

/** Between two reads of the destination balance. */
export const WATCH_INTERVAL_MS = 8_000;
/** How long a swap's balances are watched in all. */
export const WATCH_WINDOW_MS = 180_000;
/**
 * The server keeps a chain's balances for 30 s (`lib/server/portfolio/read`):
 * the closing re-read of a failed or refunded swap waits for that to lapse.
 */
export const WATCH_SETTLE_RECHECK_MS = 31_000;

export type WatchEnd = "changed" | "finished" | "timeout" | "cancelled";

/** The liquid balance of `denom` on `chainId` in a portfolio's asset list, "0" when it holds none. */
export function liquidBalance(
  assets: readonly { chainId: string; identity: { denom: string }; amounts: { liquid: string } }[],
  chainId: string,
  denom: string,
): string {
  const found = assets.find((asset) => asset.chainId === chainId && asset.identity.denom === denom);
  return found?.amounts.liquid ?? "0";
}

export interface WatchOptions {
  /** One read of the balance (base units); `null` when this read failed (tried again at the next tick). */
  read: () => Promise<string | null>;
  /** The balance before the swap; `null` takes the first successful read as the baseline. */
  baseline: string | null;
  /** The tracker reports the swap over (delivered, refunded, failed). */
  isFinished: () => boolean;
  isCancelled: () => boolean;
  intervalMs?: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Re-reads until the balance differs from the baseline, the swap is over, or the window ends. */
export async function watchBalance(options: WatchOptions): Promise<WatchEnd> {
  const interval = options.intervalMs ?? WATCH_INTERVAL_MS;
  const windowMs = options.windowMs ?? WATCH_WINDOW_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  let baseline = options.baseline;
  for (;;) {
    if (options.isCancelled()) return "cancelled";
    if (options.isFinished()) return "finished";
    if (now() - started >= windowMs) return "timeout";
    const value = await options.read();
    if (options.isCancelled()) return "cancelled";
    if (value !== null) {
      if (baseline === null) baseline = value;
      else if (value !== baseline) return "changed";
    }
    if (options.isFinished()) return "finished";
    if (now() - started + interval > windowMs) return "timeout";
    await sleep(interval);
  }
}
