"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  connectWithZunia,
  isZuniaInstalled,
  type ZuniaSession,
} from "@zunialab/sdk-web";
import {
  connectExtension,
  isKeplrAvailable,
  isZuniaAvailable,
  type ExtensionWallet,
} from "@/lib/connect/extension";
import { getWalletConnectProjectId } from "@/lib/connect/walletconnect";
import {
  clearWalletHint,
  readWalletHint,
  writeWalletHint,
} from "@/lib/connect/walletHint";

export type ConnectedAccount =
  | {
      mode: "extension";
      wallet: ExtensionWallet;
      chainId: string;
      address: string;
      name: string;
    }
  | {
      mode: "walletconnect";
      chainId: string;
      address: string;
      peerName: string;
      topic: string;
    }
  | {
      mode: "native-ws";
      chainId: string;
      address: string;
      peerName: string;
      sessionId: string;
    };

type WalletContextValue = {
  account: ConnectedAccount | null;
  session: ZuniaSession | null;
  pairing: ZuniaSession["pairing"];
  sessionStatus: string;
  /** True until the first restore attempt finishes. */
  restoring: boolean;
  zuniaAvailable: boolean;
  keplrAvailable: boolean;
  connectWithExtension: (chainId?: string) => Promise<void>;
  connectWithKeplr: (chainId?: string) => Promise<void>;
  connectWithNativeWs: (chainId?: string) => Promise<void>;
  connectWithWalletConnect: (chainId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  busy: boolean;
  error: string | null;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const noopSubscribe = () => () => {};

function clearLegacyWatchOnly() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("zunia.dashboard.watchOnly");
}

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_ZUNIA_CONNECT_API_BASE?.replace(/\/$/, "") ||
    "http://localhost:8788"
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<ConnectedAccount | null>(null);
  const [session, setSession] = useState<ZuniaSession | null>(null);
  const [pairing, setPairing] = useState<ZuniaSession["pairing"]>();
  const [sessionStatus, setSessionStatus] = useState("idle");
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<ZuniaSession | null>(null);

  const zuniaAvailable = useSyncExternalStore(
    noopSubscribe,
    () => isZuniaAvailable() || isZuniaInstalled(),
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
        writeWalletHint({
          mode: "extension",
          wallet: next.wallet,
          chainId: next.chainId,
        });
        setSession(null);
        sessionRef.current = null;
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

  const bindSession = useCallback((next: ZuniaSession) => {
    sessionRef.current = next;
    setSession(next);
    setPairing(next.pairing);
    setSessionStatus(next.status);
    next.on("status", setSessionStatus);
    next.on("pairing", setPairing);
    next.on("accountsChanged", (accounts) => {
      const primary = accounts[0];
      if (!primary) return;
      if (next.transport === "native-ws") {
        const linked: ConnectedAccount = {
          mode: "native-ws",
          chainId: primary.chainId,
          address: primary.address,
          peerName: primary.name ?? "Zunia Mobile",
          sessionId: next.pairing?.sessionId ?? "session",
        };
        setAccount(linked);
        writeWalletHint({
          mode: linked.mode,
          chainId: linked.chainId,
        });
      } else if (next.transport === "walletconnect") {
        const linked: ConnectedAccount = {
          mode: "walletconnect",
          chainId: primary.chainId,
          address: primary.address,
          peerName: primary.name ?? "Zunia Mobile",
          topic: next.pairing?.sessionId ?? "wc",
        };
        setAccount(linked);
        writeWalletHint({
          mode: linked.mode,
          chainId: linked.chainId,
        });
      }
    });
  }, []);

  const connectWithNativeWs = useCallback(
    async (chainId = "cosmoshub-4") => {
      setBusy(true);
      setError(null);
      setSessionStatus("connecting");
      try {
        const next = await connectWithZunia({
          chains: [chainId],
          prefer: "native-ws",
          apiBase: apiBase(),
          metadata: {
            name: "Zunia Dashboard",
            url:
              typeof window !== "undefined"
                ? window.location.origin
                : "https://wallet.zunialab.com",
            icons: [
              "https://raw.githubusercontent.com/Zunia-Lab/zunia-brand/main/png/icons/app/zunia-icon-512.png",
            ],
          },
          timeoutMs: 180_000,
        });
        clearLegacyWatchOnly();
        bindSession(next);
        const primary = next.accounts[0];
        if (primary) {
          const linked: ConnectedAccount = {
            mode: "native-ws",
            chainId: primary.chainId,
            address: primary.address,
            peerName: primary.name ?? "Zunia Mobile",
            sessionId: next.pairing?.sessionId ?? "session",
          };
          setAccount(linked);
          writeWalletHint({
            mode: "native-ws",
            chainId: linked.chainId,
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Native connect failed");
        setSessionStatus("error");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [bindSession],
  );

  const connectWithWalletConnect = useCallback(
    async (chainId = "cosmoshub-4") => {
      setBusy(true);
      setError(null);
      setSessionStatus("connecting");
      try {
        const projectId = getWalletConnectProjectId();
        if (!projectId) {
          throw new Error(
            "WalletConnect project ID missing. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.",
          );
        }
        const next = await connectWithZunia({
          chains: [chainId],
          prefer: "walletconnect",
          walletConnectProjectId: projectId,
          metadata: {
            name: "Zunia Dashboard",
            url:
              typeof window !== "undefined"
                ? window.location.origin
                : "https://wallet.zunialab.com",
            icons: [
              "https://raw.githubusercontent.com/Zunia-Lab/zunia-brand/main/png/icons/app/zunia-icon-512.png",
            ],
          },
          timeoutMs: 180_000,
        });
        clearLegacyWatchOnly();
        bindSession(next);
        const primary = next.accounts[0];
        if (primary) {
          const linked: ConnectedAccount = {
            mode: "walletconnect",
            chainId: primary.chainId,
            address: primary.address,
            peerName: primary.name ?? "Zunia Mobile",
            topic: next.pairing?.sessionId ?? "wc",
          };
          setAccount(linked);
          writeWalletHint({
            mode: "walletconnect",
            chainId: linked.chainId,
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "WalletConnect failed");
        setSessionStatus("error");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [bindSession],
  );

  const disconnect = useCallback(async () => {
    clearLegacyWatchOnly();
    clearWalletHint();
    await sessionRef.current?.disconnect();
    sessionRef.current = null;
    setSession(null);
    setPairing(undefined);
    setAccount(null);
    setError(null);
    setSessionStatus("disconnected");
  }, []);

  // Silent restore: extension reconnects when already approved.
  // WalletConnect / native-ws need a live pairing after full reload.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hint = readWalletHint();
      if (!hint) {
        if (!cancelled) setRestoring(false);
        return;
      }
      try {
        if (hint.mode === "extension") {
          const next = await connectExtension(hint.chainId, hint.wallet);
          if (cancelled) return;
          clearLegacyWatchOnly();
          setAccount(next);
          writeWalletHint({
          mode: "extension",
          wallet: next.wallet,
          chainId: next.chainId,
        });
          setSessionStatus("connected");
        } else {
          clearWalletHint();
        }
      } catch {
        clearWalletHint();
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      account,
      session,
      pairing,
      sessionStatus,
      restoring,
      zuniaAvailable,
      keplrAvailable,
      connectWithExtension,
      connectWithKeplr,
      connectWithNativeWs,
      connectWithWalletConnect,
      disconnect,
      busy,
      error,
    }),
    [
      account,
      session,
      pairing,
      sessionStatus,
      restoring,
      zuniaAvailable,
      keplrAvailable,
      connectWithExtension,
      connectWithKeplr,
      connectWithNativeWs,
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
  if (account.mode === "walletconnect" || account.mode === "native-ws") {
    return account.peerName;
  }
  return account.wallet === "keplr" ? account.name || "Keplr" : account.name;
}
