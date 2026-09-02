"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  connectExtension,
  isKeplrAvailable,
  isZuniaAvailable,
  type ExtensionWallet,
} from "@/lib/connect/extension";
import { connectWalletConnectStub } from "@/lib/connect/walletconnect";

export type ConnectedAccount =
  | {
      mode: "extension";
      wallet: ExtensionWallet;
      chainId: string;
      address: string;
      name: string;
    }
  | { mode: "walletconnect"; chainId: string; address: string; peerName: string; topic: string };

type WalletContextValue = {
  account: ConnectedAccount | null;
  zuniaAvailable: boolean;
  keplrAvailable: boolean;
  connectWithExtension: (chainId?: string) => Promise<void>;
  connectWithKeplr: (chainId?: string) => Promise<void>;
  connectWithWalletConnect: (chainId?: string) => Promise<void>;
  disconnect: () => void;
  busy: boolean;
  error: string | null;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const noopSubscribe = () => () => {};

function clearLegacyWatchOnly() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("zunia.dashboard.watchOnly");
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<ConnectedAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zuniaAvailable = useSyncExternalStore(
    noopSubscribe,
    isZuniaAvailable,
    () => false,
  );
  const keplrAvailable = useSyncExternalStore(
    noopSubscribe,
    isKeplrAvailable,
    () => false,
  );

  const connectWallet = useCallback(
    async (wallet: ExtensionWallet, chainId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const next = await connectExtension(chainId, wallet);
        clearLegacyWatchOnly();
        setAccount(next);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : wallet === "keplr"
              ? "Keplr connect failed"
              : "Extension connect failed",
        );
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const connectWithExtension = useCallback(
    (chainId?: string) => connectWallet("zunia", chainId),
    [connectWallet],
  );

  const connectWithKeplr = useCallback(
    (chainId?: string) => connectWallet("keplr", chainId),
    [connectWallet],
  );

  const connectWithWalletConnect = useCallback(async (chainId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await connectWalletConnectStub(chainId);
      clearLegacyWatchOnly();
      setAccount(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "WalletConnect failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    clearLegacyWatchOnly();
    setAccount(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      account,
      zuniaAvailable,
      keplrAvailable,
      connectWithExtension,
      connectWithKeplr,
      connectWithWalletConnect,
      disconnect,
      busy,
      error,
    }),
    [
      account,
      zuniaAvailable,
      keplrAvailable,
      connectWithExtension,
      connectWithKeplr,
      connectWithWalletConnect,
      disconnect,
      busy,
      error,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export function accountLabel(account: ConnectedAccount): string {
  if (account.mode === "walletconnect") return account.peerName;
  return account.wallet === "keplr" ? account.name || "Keplr" : account.name;
}
