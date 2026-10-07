/**
 * Which `/api/chains/stats` requests the Chains table keeps open.
 *
 * The route takes at most 40 chains per request and charges a rate-limit
 * token per four chains (a 40-token bucket refilled at 0.5/s per client), so
 * the catalog's 222 mainnets cannot be asked for at once. The table asks only
 * for the rows it shows, and this planner turns "the ids on screen now" into
 * a short list of stable chunks:
 *
 * - a chunk, once planned, never changes its ids, so its URL stays the same
 *   and the shared `useApi` cache keeps answering it (and refreshes it);
 * - new ids on screen (Show more, a search) become new chunks of their own,
 *   so rows already loaded are never asked for again;
 * - when every slot is taken, chunks with nothing on screen are dropped
 *   first; only if that is not enough is the plan rebuilt from scratch.
 *
 * A chain the server timed out on (it keeps loading into the server cache)
 * is asked for once more in a retry chunk, in reverse order so its URL
 * differs from the first chunk's: the browser holds the first answer for 60
 * seconds (`max-age=60`) and would hand the timeout straight back.
 *
 * Pure: `__tests__/stats-plan.test.ts`.
 */

export interface PlanOptions {
  /** Ids per request (the route's cap is 40). */
  chunkSize: number;
  /** Requests the page can hold open at once (one hook call each). */
  maxSlots: number;
}

export type Chunk = readonly string[];

function split(ids: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

/**
 * The next chunk list for `wanted` (the ids on screen, in screen order).
 *
 * `isCovered(id)` says whether an existing chunk already answers for the id
 * (loaded, loading, or given up on); by default, being in any chunk is
 * enough. Returns `chunks` itself when nothing needs to change, so a caller
 * can compare by reference before setting state.
 */
export function planChunks(
  chunks: readonly Chunk[],
  wanted: readonly string[],
  options: PlanOptions,
  isCovered?: (id: string) => boolean,
): readonly Chunk[] {
  const size = Math.max(1, Math.floor(options.chunkSize));
  const slots = Math.max(1, Math.floor(options.maxSlots));
  const planned = new Set(chunks.flat());
  const covered = isCovered ?? ((id: string) => planned.has(id));
  const want = unique(wanted);
  const missing = want.filter((id) => !covered(id));
  if (missing.length === 0) return chunks;

  // Ids already in a chunk but not covered are retries: reversed, so the
  // retry's URL is never the URL whose answer the browser still caches.
  const fresh = missing.filter((id) => !planned.has(id));
  const retry = missing.filter((id) => planned.has(id)).reverse();
  const added = [...split(fresh, size), ...split(retry, size)];

  if (chunks.length + added.length <= slots) return [...chunks, ...added];

  const onScreen = new Set(want);
  const kept = chunks.filter((chunk) => chunk.some((id) => onScreen.has(id)));
  if (kept.length + added.length <= slots) return [...kept, ...added];

  // Fragmented beyond repair (many small search chunks): start over with
  // what is on screen. Costs one round of requests, then stays stable.
  return split(want, size).slice(0, slots);
}

/**
 * Ids a stats answer was asked about but left out because the server ran out
 * of time on them (`errors[].scope === "chain"`). Unknown ids (not in the
 * catalog) are not timeouts and are not retried.
 */
export function timedOutIds(
  asked: readonly string[],
  answered: readonly { chainId: string }[],
  errors: readonly { chainId?: string; scope: string }[] | undefined,
): string[] {
  const got = new Set(answered.map((chain) => chain.chainId));
  const timedOut = new Set((errors ?? []).filter((e) => e.scope === "chain" && e.chainId).map((e) => e.chainId as string));
  return asked.filter((id) => !got.has(id) && timedOut.has(id));
}
