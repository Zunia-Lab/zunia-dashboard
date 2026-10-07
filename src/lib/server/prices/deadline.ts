/**
 * A time budget for work a request can answer without.
 *
 * Every upstream read already has its own timeout (`fetchJson`), but a route
 * that chains them — ten bank pages, then thirty-two trace lookups, then a
 * price list — can add those up to minutes, past what nginx and Cloudflare
 * wait for. `within` stops waiting instead: the work keeps running and fills
 * the caches it was going to fill, so the next request gets it at once, while
 * this one answers with what it has and says what is missing.
 *
 * Pure (no I/O of its own), so it is tested.
 */

export type Within<T> = { done: true; value: T } | { done: false };

/**
 * `promise`'s outcome if it settles within `ms`, else `{ done: false }`.
 * A rejection inside the budget rejects; one after it is swallowed (nobody is
 * waiting for it any more, and it must not surface as an unhandled rejection).
 */
export function within<T>(promise: Promise<T>, ms: number): Promise<Within<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Within<T>>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), Math.max(0, ms));
  });
  const settled = promise.then((value): Within<T> => ({ done: true, value }));
  settled.catch(() => {});
  return Promise.race([settled, expired]).finally(() => clearTimeout(timer));
}
