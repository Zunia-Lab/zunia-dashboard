/**
 * What the dashboard keeps in this browser, and clearing it.
 *
 * Every key the dashboard writes starts with `zunia.dashboard.` (followed
 * networks, preferences, notification state, address book, watchlist, the
 * short cache of reads, the reconnect hint). The theme is the one preference
 * kept on purpose: it lives under ThemeProvider's own key (`zunia-theme`),
 * outside the prefix, so a clear never flashes the page into the other
 * theme. The wallet's own session record (the SDK's `zunia.connect.*` keys)
 * is not the dashboard's to delete: Disconnect ends it.
 *
 * Pure over a Storage-shaped object, so `node --test` runs it with a fake.
 */

export const DASHBOARD_PREFIX = "zunia.dashboard.";

/** The part of `Storage` these helpers use. */
export interface KeyStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/** The dashboard's keys in `store`, sorted. */
export function dashboardKeys(store: KeyStore): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith(DASHBOARD_PREFIX)) keys.push(key);
  }
  return keys.sort();
}

export interface Footprint {
  count: number;
  /** UTF-16 code units × 2: what the browser counts against its quota. */
  bytes: number;
}

export function footprint(store: KeyStore): Footprint {
  let bytes = 0;
  const keys = dashboardKeys(store);
  for (const key of keys) bytes += (key.length + (store.getItem(key)?.length ?? 0)) * 2;
  return { count: keys.length, bytes };
}

/**
 * Removes every dashboard key from each store and says how many went.
 * Collects first, then removes: deleting while walking `key(i)` skips
 * entries, because the indexes shift under the loop.
 */
export function clearDashboardData(stores: readonly KeyStore[]): number {
  let removed = 0;
  for (const store of stores) {
    for (const key of dashboardKeys(store)) {
      store.removeItem(key);
      removed += 1;
    }
  }
  return removed;
}

/** "12 KB", "1.4 MB", "640 B". */
export function bytesText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
