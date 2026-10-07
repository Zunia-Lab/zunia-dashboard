/**
 * Forget what this browser cached about the wallet that just disconnected.
 *
 * The API hooks keep their last answers in localStorage for an instant first
 * paint, and those answers are keyed by URLs that carry the address: balances,
 * history, rewards. On a shared computer, disconnecting has to mean the next
 * person does not open the dashboard onto the previous person's portfolio.
 *
 * This is the persisted half (pure, so it is tested with a fake storage);
 * `WalletProvider`'s `forgetWalletData` also drops the in-memory copies
 * (`clearApiCache`) once the page has re-rendered without the account.
 */

export const ADDRESS_CACHE_PREFIXES = ["zunia.dashboard.api.v1:", "zunia.dashboard.json.v1:"] as const;

/** Removes every localStorage key under the address-keyed cache prefixes. Returns how many. */
export function clearAddressCaches(storage: Pick<Storage, "length" | "key" | "removeItem"> | null = safeLocalStorage()): number {
  if (!storage) return 0;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && ADDRESS_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    return 0;
  }
  return doomed.length;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
