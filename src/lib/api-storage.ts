/**
 * The localStorage copy of `/api/*` answers that lets a reload paint at once
 * (see `@/lib/useApi`), kept from filling the origin's storage.
 *
 * Copies are keyed per URL, and URLs vary with scope, chain, currency, voter
 * and range, so they accumulate across visits. Once the origin's ~5 MB quota
 * is full, every write in the app fails — prefs, followed chains, the wallet
 * hint — and silently. So: an expired copy is deleted where it is found, the
 * first write of a page load sweeps every expired copy and keeps the total
 * under a budget (oldest first), and a write the quota refuses evicts the
 * oldest copies and is tried once more.
 *
 * Pure over a `Storage`-shaped object, so the rules are tested with a fake.
 */

export const PERSIST_PREFIX = "zunia.dashboard.api.v1:";
/** A copy older than this is never shown, and is deleted. */
export const PERSIST_TTL_MS = 10 * 60_000;
/** Largest single answer worth a copy (characters). */
export const PERSIST_MAX_CHARS = 400_000;
/** Every copy together (characters; localStorage keeps UTF-16, so about 3 MB). */
export const PERSIST_TOTAL_MAX = 1_500_000;

export type CopyStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

/** A fresh copy of `url`'s answer, or null (an expired one is deleted on the way). */
export function readCopy(storage: CopyStorage, url: string, now = Date.now()): { data: unknown; at: number } | null {
  try {
    const key = PERSIST_PREFIX + url;
    const raw = storage.getItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as { at?: unknown; data?: unknown };
    if (typeof record.at !== "number" || now - record.at > PERSIST_TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return { data: record.data, at: record.at };
  } catch {
    return null;
  }
}

interface StoredCopy {
  key: string;
  /** Write time; 0 when unreadable (oldest, first to go). */
  at: number;
  size: number;
}

/** Every copy with its age and size. The time comes from the record's head, without parsing the answer. */
function storedCopies(storage: CopyStorage): StoredCopy[] {
  const out: StoredCopy[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !key.startsWith(PERSIST_PREFIX)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const head = /^\{"at":(\d{1,16})[,}]/.exec(raw);
    out.push({ key, at: head ? Number(head[1]) : 0, size: key.length + raw.length });
  }
  return out;
}

/**
 * Deletes expired copies, then the oldest ones until `room` more characters
 * fit under {@link PERSIST_TOTAL_MAX}. `keep` (the copy about to be replaced)
 * is only deleted when expired. Returns how many characters it freed.
 */
export function pruneCopies(storage: CopyStorage, room: number, keep: string | null = null, now = Date.now()): number {
  let freed = 0;
  try {
    const copies = storedCopies(storage).sort((a, b) => a.at - b.at);
    let total = copies.reduce((sum, copy) => sum + copy.size, 0);
    for (const copy of copies) {
      const expired = now - copy.at > PERSIST_TTL_MS;
      if (!expired && (copy.key === keep || total + room <= PERSIST_TOTAL_MAX)) continue;
      storage.removeItem(copy.key);
      total -= copy.size;
      freed += copy.size;
    }
  } catch {
    /* storage unreadable: nothing to prune */
  }
  return freed;
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22;
}

/**
 * Stores `data` as `url`'s copy. With `sweep` (once per page load) expired and
 * over-budget copies go first. Returns whether the copy was kept.
 */
export function writeCopy(storage: CopyStorage, url: string, data: unknown, options: { now?: number; sweep?: boolean } = {}): boolean {
  const now = options.now ?? Date.now();
  let raw: string;
  try {
    raw = JSON.stringify({ at: now, data });
  } catch {
    return false;
  }
  if (raw.length > PERSIST_MAX_CHARS) return false;
  const key = PERSIST_PREFIX + url;
  if (options.sweep) pruneCopies(storage, raw.length, key, now);
  try {
    storage.setItem(key, raw);
    return true;
  } catch (error) {
    if (!isQuotaError(error)) return false;
    // Full: make room from the oldest copies (the whole budget's worth, in
    // case other data filled the quota), then one more try.
    if (pruneCopies(storage, PERSIST_TOTAL_MAX, key, now) === 0) return false;
    try {
      storage.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  }
}

/** Deletes every copy whose URL starts with `prefix`. */
export function clearCopies(storage: CopyStorage, prefix: string): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(PERSIST_PREFIX + prefix)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    /* private mode */
  }
}
