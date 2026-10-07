/**
 * The reconnect hint: which wallet to restore on the next visit, and for which
 * chains. Never keys, never a session secret (the Zunia Connect session keeps
 * its own record, under the SDK's storage key).
 *
 * `chains` lists what was enabled last time, so a restore asks the extension
 * for exactly those (already-approved chains do not prompt). Hints written
 * before `chains` existed restore their single `chainId`.
 */

const KEY = "zunia.dashboard.walletHint";

export type WalletHint =
  | {
      mode: "extension";
      wallet: "zunia" | "keplr";
      /** Primary account chain. */
      chainId: string;
      chains?: string[];
    }
  | {
      mode: "walletconnect" | "native-ws";
      chainId: string;
      chains?: string[];
    };

function chainList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64);
  return ids.length > 0 ? ids.slice(0, 64) : undefined;
}

export function readWalletHint(): WalletHint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.chainId !== "string") return null;
    const chains = chainList(parsed.chains);
    if (parsed.mode === "extension" && (parsed.wallet === "zunia" || parsed.wallet === "keplr")) {
      return { mode: "extension", wallet: parsed.wallet, chainId: parsed.chainId, ...(chains ? { chains } : {}) };
    }
    if (parsed.mode === "walletconnect" || parsed.mode === "native-ws") {
      return { mode: parsed.mode, chainId: parsed.chainId, ...(chains ? { chains } : {}) };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeWalletHint(hint: WalletHint): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(hint));
  } catch {
    // Private mode or quota: the wallet still works, it just is not restored.
  }
}

export function clearWalletHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Same as above.
  }
}

/*
 * Disconnect, told to every tab of this site.
 *
 * Disconnecting resets the tab where it was clicked; another open tab would
 * keep the account on screen, keep polling, and write the departed wallet's
 * address-keyed reads back to localStorage — undoing what "Disconnect" (and
 * "Clear local data") promise on a shared computer. An explicit message, not a
 * `storage` event on the hint: the hint is also removed when a tab's restore
 * fails (no provider injected in time, any restore error), and a new tab
 * failing to restore must not disconnect the tabs that work.
 */
const CHANNEL = "zunia.dashboard.wallet";

/** Tell every tab of this site (this one included) that the wallet was disconnected here. */
export function announceDisconnect(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: "disconnect" });
    channel.close();
  } catch {
    // Best effort: a tab that misses it still forgets on its next reload (the hint is gone).
  }
}

/**
 * Calls `handler` when any tab announces a disconnect; returns the unsubscribe.
 * Open it in an effect, never during render: Node has `BroadcastChannel` too,
 * and a server render would hold one open.
 */
export function onDisconnectAnnounced(handler: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch {
    return () => {};
  }
  channel.onmessage = (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === "disconnect") handler();
  };
  return () => channel.close();
}
