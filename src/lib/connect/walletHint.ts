/**
 * Persists a reconnect hint for the dashboard wallet session.
 * Never stores keys, only connection mode + chain for silent restore.
 */

const KEY = "zunia.dashboard.walletHint";

export type WalletHint =
  | {
      mode: "extension";
      wallet: "zunia" | "keplr";
      chainId: string;
    }
  | {
      mode: "walletconnect" | "native-ws";
      chainId: string;
    };

export function readWalletHint(): WalletHint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletHint;
    if (
      parsed?.mode === "extension" &&
      (parsed.wallet === "zunia" || parsed.wallet === "keplr") &&
      typeof parsed.chainId === "string"
    ) {
      return parsed;
    }
    if (
      (parsed?.mode === "walletconnect" || parsed?.mode === "native-ws") &&
      typeof parsed.chainId === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeWalletHint(hint: WalletHint): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(hint));
}

export function clearWalletHint(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
