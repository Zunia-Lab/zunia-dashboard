/**
 * A size budget over cache keys, least recently used out first.
 *
 * The shared server cache (lib/server/cache.ts) bounds itself by entry count
 * (5,000) and drops expired entries only once it is over that count. That is
 * right for prices and chain facts, which are small; an activity page (50
 * decoded transactions, ~50 KB) or a raw transaction (a relayer's is ~90 KB,
 * a contract upload can be a megabyte) is not. Without a byte budget, a
 * crawler walking hashes or cursors could pin gigabytes in the process that
 * serves every visitor. The activity readers report each entry they keep with
 * its approximate size; whatever this pushes out, they forget in the cache.
 *
 * Pure (no timers, no I/O); the caller owns the instance.
 */

export class KeyBudget {
  private readonly sizes = new Map<string, number>();
  private readonly maxBytes: number;
  private readonly maxKeys: number;
  private used = 0;

  constructor(maxBytes: number, maxKeys: number) {
    this.maxBytes = maxBytes;
    this.maxKeys = maxKeys;
  }

  /**
   * Records `key` as just used with `bytes`; returns the keys evicted to stay
   * within budget (never `key` itself, even when it alone is over budget: the
   * caller is answering with it right now).
   */
  touch(key: string, bytes: number): string[] {
    const size = Number.isFinite(bytes) && bytes > 0 ? Math.ceil(bytes) : 0;
    const previous = this.sizes.get(key);
    if (previous !== undefined) {
      this.sizes.delete(key);
      this.used -= previous;
    }
    this.sizes.set(key, size);
    this.used += size;
    const evicted: string[] = [];
    for (const [oldest, oldestSize] of this.sizes) {
      if (this.used <= this.maxBytes && this.sizes.size <= this.maxKeys) break;
      if (oldest === key) continue;
      this.sizes.delete(oldest);
      this.used -= oldestSize;
      evicted.push(oldest);
    }
    return evicted;
  }

  forget(key: string): void {
    const size = this.sizes.get(key);
    if (size === undefined) return;
    this.sizes.delete(key);
    this.used -= size;
  }

  /** Forgets every key starting with `prefix`; returns them. */
  forgetPrefix(prefix: string): string[] {
    const out: string[] = [];
    for (const key of this.sizes.keys()) if (key.startsWith(prefix)) out.push(key);
    for (const key of out) this.forget(key);
    return out;
  }

  get bytes(): number {
    return this.used;
  }

  get keys(): number {
    return this.sizes.size;
  }
}
