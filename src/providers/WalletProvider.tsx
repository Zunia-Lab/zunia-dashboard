"use client";

/**
 * The wallet: which one is connected, its keys per chain, and how to sign.
 *
 * Three transports, one model:
 * - **Zunia extension / Keplr**: one `enable([home, ...followed])` prompt,
 *   `getKey` per chain, unknown chains suggested from catalog data (the home
 *   chain at connect, others the first time they are needed).
 * - **Zunia Mobile** (Zunia Connect v2 over the relay): a long-lived
 *   `MobileConnect` created before pairing, so the QR, the verification code
 *   and every status reach the UI; the phone shares one account per approved
 *   chain, and only those chains can sign.
 * WalletConnect stays hidden (see `lib/connect/walletconnect`).
 *
 * The primary account is on Safrochain (`HOME_CHAIN_ID`) when the wallet has
 * it. Addresses on other chains come from the wallet's own keys, then from
 * same-key-scheme re-encoding, and are otherwise unknown (`addressFor`).
 *
 * State lives in a small external store rather than `useState` so every
 * callback (`ensureKey` mid-flow, wallet events) reads the current keys, not
 * the ones from the render that created it.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ZuniaAccountInfo } from "@zunialab/sdk-web";
import { ConnectModalProvider } from "@/components/connect/ConnectModal";
import { findChain } from "@/lib/chains";
import { keyScheme, resolveAddressFor } from "@/lib/connect/addresses";
import { clearAddressCaches } from "@/lib/connect/cache";
import {
  WalletContext,
  type ConnectedAccount,
  type LegacyMobileSession,
  type LegacySessionStatus,
  type MobileState,
  type SkippedChain,
  type WalletContextValue,
  type WalletKey,
  type WalletKind,
} from "@/lib/connect/context";
import {
  enableChains,
  errorText,
  getExtensionProvider,
  isKeplrAvailable,
  isUserRejection,
  isZuniaAvailable,
  readKey,
  subscribeExtensions,
  unknownChainOf,
  waitForProvider,
  walletLabel,
  type ExtensionKey,
  type ExtensionProvider,
  type ExtensionWallet,
} from "@/lib/connect/extension";
import { MobileConnect, pairingChains, relayApiBase, type MobileSnapshot } from "@/lib/connect/mobile";
import {
  announceDisconnect,
  clearWalletHint,
  onDisconnectAnnounced,
  readWalletHint,
  writeWalletHint,
  type WalletHint,
} from "@/lib/connect/walletHint";
import { stopPush } from "@/lib/data/push";
import { fetchChainInfo } from "@/lib/tx/client";
import type { TxSigner } from "@/lib/tx/flow";
import { useFollowedChains } from "@/lib/useFollowedChains";
import { clearApiCache, revalidateApi } from "@/lib/useApi";

export { accountLabel, useWallet, walletKindLabel } from "@/lib/connect/context";
export type {
  ConnectedAccount,
  MobileState,
  SkippedChain,
  WalletContextValue,
  WalletKey,
  WalletKind,
  WalletStatus,
} from "@/lib/connect/context";

/** The chain the primary account lives on. */
export const HOME_CHAIN_ID = "safrochain-1";

/** Enough for every followed chain without turning the approval prompt into a registry. */
const MAX_EXTENSION_CHAINS = 48;

const ZUNIA_ICON = "https://raw.githubusercontent.com/Zunia-Lab/zunia-brand/main/png/icons/app/zunia-icon-512.png";

interface WalletState {
  kind: WalletKind | null;
  keys: Record<string, WalletKey>;
  primaryChainId: string;
  skipped: SkippedChain[];
  connecting: boolean;
  error: string | null;
  endedReason: string | null;
  restoring: boolean;
}

const INITIAL: WalletState = {
  kind: null,
  keys: {},
  primaryChainId: HOME_CHAIN_ID,
  skipped: [],
  connecting: false,
  error: null,
  endedReason: null,
  restoring: true,
};

class WalletStore {
  private state: WalletState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private restoreStarted = false;

  /** True the first time only: restore runs once per provider, StrictMode's double effects included. */
  beginRestore(): boolean {
    if (this.restoreStarted) return false;
    this.restoreStarted = true;
    return true;
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly get = (): WalletState => this.state;

  set(patch: Partial<WalletState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

const SERVER_MOBILE: MobileSnapshot = { status: "idle", chains: [], accounts: [] };

function toWalletKey(chainId: string, key: ExtensionKey): WalletKey {
  return {
    chainId,
    address: key.bech32Address,
    pubKey: key.pubKey,
    algo: key.algo || "secp256k1",
    ...(key.name ? { name: key.name } : {}),
    ...(key.isNanoLedger ? { isNanoLedger: true } : {}),
  };
}

function keysFromMobile(accounts: readonly ZuniaAccountInfo[]): Record<string, WalletKey> {
  const keys: Record<string, WalletKey> = {};
  for (const account of accounts) {
    keys[account.chainId] = {
      chainId: account.chainId,
      address: account.address,
      pubKey: account.pubkey,
      algo: account.algo,
      ...(account.name ? { name: account.name } : {}),
    };
  }
  return keys;
}

/** Safrochain when the wallet has it, else the first requested chain with a key. */
function pickPrimary(keys: Record<string, WalletKey>, order: readonly string[], preferred?: string): string {
  if (preferred && keys[preferred]) return preferred;
  if (keys[HOME_CHAIN_ID]) return HOME_CHAIN_ID;
  return order.find((id) => keys[id]) ?? Object.keys(keys)[0] ?? HOME_CHAIN_ID;
}

function chainName(chainId: string): string {
  return findChain(chainId)?.chainName ?? chainId;
}

function extensionChains(followed: readonly string[]): string[] {
  const out: string[] = [];
  for (const chainId of [HOME_CHAIN_ID, ...followed]) {
    if (out.includes(chainId) || !findChain(chainId)) continue;
    out.push(chainId);
    if (out.length >= MAX_EXTENSION_CHAINS) break;
  }
  return out;
}

/** Ask the wallet to add a chain it does not know, from catalog data (server-built). */
async function suggestChain(provider: ExtensionProvider, chainId: string): Promise<boolean> {
  if (!provider.experimentalSuggestChain) return false;
  const chainInfo: Record<string, unknown> = { ...(await fetchChainInfo(chainId)) };
  // `updatedAt` is ours, not Keplr's: its chain-info validation refuses unknown keys.
  delete chainInfo.updatedAt;
  await provider.experimentalSuggestChain(chainInfo);
  return true;
}

function writeHintFor(state: WalletState): void {
  if (!state.kind) return;
  const chains = Object.keys(state.keys);
  const hint: WalletHint =
    state.kind === "zunia-mobile"
      ? { mode: "native-ws", chainId: state.primaryChainId, chains }
      : { mode: "extension", wallet: state.kind, chainId: state.primaryChainId, chains };
  writeWalletHint(hint);
}

/**
 * Forget what this browser holds about the wallet that just left: the
 * persisted copies at once (`clearAddressCaches`: the API store and the
 * legacy JSON one), then the in-memory API cache once React has re-rendered
 * without the account — by then the cards that showed its balances have
 * unmounted or switched to the connect panel, so nothing re-reads them under
 * the old address. Reads still on screen (public market and chain data) are
 * fetched again right away so they do not sit on an empty frame.
 */
function forgetWalletData(): void {
  clearAddressCaches();
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    clearApiCache("/api/");
    revalidateApi("/api/");
  }, 50);
}

function metadata() {
  return {
    name: "Zunia Dashboard",
    url: typeof window !== "undefined" ? window.location.origin : "https://wallet.zunialab.com",
    icons: [ZUNIA_ICON],
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [followed] = useFollowedChains();
  const [{ store, mobile }] = useState(() => {
    const walletStore = new WalletStore();
    const mobileConnect = new MobileConnect({
      onAccounts: (accounts) => {
        if (accounts.length === 0) return;
        const keys = keysFromMobile(accounts);
        const order = accounts.map((a) => a.chainId);
        const current = walletStore.get();
        walletStore.set({
          kind: "zunia-mobile",
          keys,
          primaryChainId: pickPrimary(keys, order, current.kind === "zunia-mobile" ? current.primaryChainId : undefined),
          skipped: [],
          error: null,
          endedReason: null,
        });
        writeHintFor(walletStore.get());
      },
      onEnded: (error) => {
        if (walletStore.get().kind !== "zunia-mobile") return;
        walletStore.set({ kind: null, keys: {}, skipped: [], endedReason: error.message });
        clearWalletHint();
        forgetWalletData();
      },
    });
    return { store: walletStore, mobile: mobileConnect };
  });

  const state = useSyncExternalStore(store.subscribe, store.get, () => INITIAL);
  const mobileSnapshot = useSyncExternalStore(mobile.subscribe, mobile.getSnapshot, () => SERVER_MOBILE);
  const zuniaAvailable = useSyncExternalStore(subscribeExtensions, isZuniaAvailable, () => false);
  const keplrAvailable = useSyncExternalStore(subscribeExtensions, isKeplrAvailable, () => false);

  /* ------------------------------------------------------------ extension */

  const connectExtension = useCallback(
    async (wallet: ExtensionWallet) => {
      const label = walletLabel(wallet);
      store.set({ connecting: true, error: null, endedReason: null });
      try {
        const provider = await waitForProvider(wallet, 1_500);
        if (!provider) {
          throw new Error(
            wallet === "keplr"
              ? "Keplr is not installed in this browser."
              : "The Zunia extension is not installed in this browser.",
          );
        }
        const requested = extensionChains(followed);
        const outcome = await enableChains(provider, wallet, requested, {
          suggestFirst: [HOME_CHAIN_ID],
          suggest: (chainId) => suggestChain(provider, chainId),
          nameOf: chainName,
        });
        if (store.get().kind === "zunia-mobile" || mobile.getSnapshot().status !== "idle") await mobile.disconnect();
        const keys: Record<string, WalletKey> = {};
        for (const [chainId, key] of Object.entries(outcome.keys)) keys[chainId] = toWalletKey(chainId, key);
        store.set({
          kind: wallet,
          keys,
          primaryChainId: pickPrimary(keys, requested),
          skipped: outcome.skipped,
          connecting: false,
          error: null,
        });
        writeHintFor(store.get());
      } catch (error) {
        const message = isUserRejection(error) ? `You declined the connection in ${label}.` : errorText(error);
        store.set({ connecting: false, error: message });
        throw new Error(message);
      }
    },
    [followed, mobile, store],
  );

  const refreshExtensionKeys = useCallback(
    async (wallet: ExtensionWallet) => {
      const provider = getExtensionProvider(wallet);
      if (!provider || store.get().kind !== wallet) return;
      const chainIds = Object.keys(store.get().keys);
      const next: Record<string, WalletKey> = {};
      await Promise.all(
        chainIds.map(async (chainId) => {
          try {
            next[chainId] = toWalletKey(chainId, await readKey(provider, chainId));
          } catch {
            // Lost access to this chain: it is simply not signable any more.
          }
        }),
      );
      if (store.get().kind !== wallet) return;
      if (Object.keys(next).length === 0) {
        store.set({ kind: null, keys: {}, skipped: [], endedReason: `${walletLabel(wallet)} no longer shares an account with this site.` });
        clearWalletHint();
        forgetWalletData();
        return;
      }
      store.set({ keys: next, primaryChainId: pickPrimary(next, chainIds, store.get().primaryChainId) });
      writeHintFor(store.get());
    },
    [store],
  );

  // Account switches and revocations in the extension.
  useEffect(() => {
    const kind = state.kind;
    if (kind !== "zunia" && kind !== "keplr") return;
    const provider = getExtensionProvider(kind);
    const refresh = () => void refreshExtensionKeys(kind);
    const onDisconnect = (data?: unknown) => {
      const lost = (data as { chainIds?: unknown } | null | undefined)?.chainIds;
      if (Array.isArray(lost)) {
        const keys = { ...store.get().keys };
        for (const chainId of lost) if (typeof chainId === "string") delete keys[chainId];
        if (Object.keys(keys).length > 0) {
          store.set({ keys, primaryChainId: pickPrimary(keys, Object.keys(keys), store.get().primaryChainId) });
          writeHintFor(store.get());
          return;
        }
      }
      store.set({ kind: null, keys: {}, skipped: [], endedReason: `${walletLabel(kind)} disconnected this site.` });
      clearWalletHint();
      forgetWalletData();
    };
    window.addEventListener("keplr_keystorechange", refresh);
    provider?.on?.("accountsChanged", refresh);
    provider?.on?.("disconnect", onDisconnect);
    return () => {
      window.removeEventListener("keplr_keystorechange", refresh);
      provider?.off?.("accountsChanged", refresh);
      provider?.off?.("disconnect", onDisconnect);
    };
  }, [state.kind, refreshExtensionKeys, store]);

  /* ---------------------------------------------------------------- mobile */

  const requestedMobileChains = useMemo(() => pairingChains(HOME_CHAIN_ID, followed, findChain), [followed]);

  const startMobile = useCallback(
    async (options?: { chains?: string[] }) => {
      store.set({ error: null, endedReason: null });
      const chains = options?.chains ? pairingChains(HOME_CHAIN_ID, options.chains, findChain) : requestedMobileChains;
      await mobile.start({ chains, metadata: metadata() });
    },
    [mobile, requestedMobileChains, store],
  );

  /* ---------------------------------------------------------------- common */

  /**
   * The user's Disconnect. Leaving is meant for a shared computer too: every
   * tab of the site lets go of the wallet (`announceDisconnect`), and push for
   * this browser is turned off — otherwise the next person at this browser
   * keeps receiving the previous wallet's transfers on the lock screen, and
   * the server keeps watching its addresses. Only this explicit action does
   * that: a phone session that expires, or an extension that revokes the site,
   * leaves push as the user set it, and switching to another wallet without
   * disconnecting moves push to the new wallet's addresses (`usePushSync`).
   */
  const disconnect = useCallback(async () => {
    const { kind } = store.get();
    store.set({ kind: null, keys: {}, skipped: [], error: null, endedReason: null, connecting: false });
    clearWalletHint();
    forgetWalletData();
    announceDisconnect();
    const pushStopped = stopPush().catch(() => undefined);
    if (kind === "zunia" || kind === "keplr") {
      // Revoke the site's access too, so "Disconnect" means the next visit asks again.
      await getExtensionProvider(kind)?.disable?.().catch(() => undefined);
    }
    if (kind === "zunia-mobile" || mobile.getSnapshot().status !== "idle") await mobile.disconnect();
    await pushStopped;
  }, [mobile, store]);

  // Another tab disconnected (or cleared this site's data): let go here too.
  // Only the account is dropped: the sending tab already revoked the
  // extension's access and cleared the hint, and this tab must not undo a hint
  // another tab may have written since. Zunia Mobile is ended for every tab by
  // the relay itself; and the sender's own copy of the message finds no wallet
  // left, so it does nothing.
  useEffect(
    () =>
      onDisconnectAnnounced(() => {
        const { kind } = store.get();
        if (kind !== "zunia" && kind !== "keplr") return;
        store.set({ kind: null, keys: {}, skipped: [], error: null, endedReason: null, connecting: false });
        forgetWalletData();
      }),
    [store],
  );

  const ensureKey = useCallback(
    async (chainId: string): Promise<WalletKey> => {
      const current = store.get();
      const existing = current.keys[chainId];
      if (existing) return existing;
      const chain = findChain(chainId);
      if (!chain) throw new Error(`${chainId} is not a network Zunia knows.`);
      if (!current.kind) throw new Error("Connect a wallet first.");
      if (current.kind === "zunia-mobile") {
        throw new Error(`Your phone has not shared ${chain.chainName}. Connect Zunia Mobile again and include it.`);
      }
      const wallet = current.kind;
      const label = walletLabel(wallet);
      const provider = getExtensionProvider(wallet);
      if (!provider) throw new Error(`${label} is not available in this browser any more.`);
      try {
        await provider.enable(chainId);
      } catch (error) {
        if (isUserRejection(error)) throw new Error(`You declined ${chain.chainName} in ${label}.`);
        if (unknownChainOf(error) === null) throw new Error(errorText(error));
        let added = false;
        try {
          added = await suggestChain(provider, chainId);
        } catch (suggestError) {
          if (isUserRejection(suggestError)) throw new Error(`You declined adding ${chain.chainName} to ${label}.`);
          throw new Error(`${label} could not add ${chain.chainName}: ${errorText(suggestError)}`);
        }
        if (!added) throw new Error(`${label} cannot add ${chain.chainName}.`);
        try {
          await provider.enable(chainId);
        } catch (enableError) {
          if (isUserRejection(enableError)) throw new Error(`You declined ${chain.chainName} in ${label}.`);
          throw new Error(errorText(enableError));
        }
      }
      const key = toWalletKey(chainId, await readKey(provider, chainId));
      if (store.get().kind === wallet) {
        store.set({
          keys: { ...store.get().keys, [chainId]: key },
          skipped: store.get().skipped.filter((s) => s.chainId !== chainId),
        });
        writeHintFor(store.get());
      }
      return key;
    },
    [store],
  );

  const ensureChain = useCallback(async (chainId: string) => (await ensureKey(chainId)).address, [ensureKey]);

  const knownAddresses = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [chainId, key] of Object.entries(state.keys)) out[chainId] = key.address;
    return out;
  }, [state.keys]);

  const addressFor = useCallback(
    (chainId: string) => resolveAddressFor(chainId, knownAddresses, findChain, state.primaryChainId),
    [knownAddresses, state.primaryChainId],
  );

  const pubKeyFor = useCallback(
    (chainId: string): Uint8Array | null => {
      const direct = state.keys[chainId];
      if (direct) return direct.pubKey;
      // Same key scheme, same seed: the key behind a re-encoded address is the
      // one the wallet already shared for a chain of that scheme.
      const target = findChain(chainId);
      if (!target) return null;
      const scheme = keyScheme(target);
      const primary = state.keys[state.primaryChainId];
      for (const key of primary ? [primary, ...Object.values(state.keys)] : Object.values(state.keys)) {
        const source = findChain(key.chainId);
        if (source && keyScheme(source) === scheme) return key.pubKey;
      }
      return null;
    },
    [state.keys, state.primaryChainId],
  );

  const canSignOn = useCallback(
    (chainId: string) => {
      if (!state.kind || !findChain(chainId)) return false;
      if (state.kind === "zunia-mobile") return Boolean(state.keys[chainId]);
      return true;
    },
    [state.kind, state.keys],
  );

  const clearError = useCallback(() => {
    store.set({ error: null, endedReason: null });
    mobile.dismissError();
  }, [mobile, store]);

  /* ---------------------------------------------------------------- signer */

  const signer = useMemo<TxSigner | null>(() => {
    const kind = state.kind;
    if (!kind) return null;
    if (kind === "zunia-mobile") {
      return {
        kind,
        capabilities: () => ({ amino: true, direct: true }),
        ensureKey,
        signDirect: (chainId, signerAddress, doc) =>
          mobile.signDirect(chainId, signerAddress, {
            bodyBytes: doc.bodyBytes,
            authInfoBytes: doc.authInfoBytes,
            chainId: doc.chainId,
            accountNumber: doc.accountNumber,
          }),
        signAmino: async (chainId, signerAddress, doc) =>
          (await mobile.signAmino(chainId, signerAddress, doc)) as unknown as Awaited<ReturnType<TxSigner["signAmino"]>>,
      };
    }
    // Both extensions take `preferNoSetFee`: the fee the review card showed is
    // the fee the wallet prompt shows. The TxRaw is still built from what the
    // wallet returns, so a wallet that changes it anyway is handled.
    const signOptions = { preferNoSetFee: true };
    const provider = () => {
      const p = getExtensionProvider(kind);
      if (!p) throw new Error(`${walletLabel(kind)} is not available in this browser any more.`);
      return p;
    };
    return {
      kind,
      capabilities: (_chainId, key) => {
        const p = getExtensionProvider(kind);
        return { amino: Boolean(p?.signAmino), direct: Boolean(p?.signDirect), ledger: Boolean(key.isNanoLedger) };
      },
      ensureKey,
      signDirect: async (chainId, signerAddress, doc) => {
        const p = provider();
        if (!p.signDirect) throw new Error(`${walletLabel(kind)} cannot sign in direct mode.`);
        return (await p.signDirect(chainId, signerAddress, doc, signOptions)) as Awaited<ReturnType<TxSigner["signDirect"]>>;
      },
      signAmino: async (chainId, signerAddress, doc) => {
        const p = provider();
        if (!p.signAmino) throw new Error(`${walletLabel(kind)} cannot sign in amino mode.`);
        return (await p.signAmino(chainId, signerAddress, doc, signOptions)) as Awaited<ReturnType<TxSigner["signAmino"]>>;
      },
    };
  }, [state.kind, ensureKey, mobile]);

  /* --------------------------------------------------------------- restore */

  useEffect(() => {
    if (!store.beginRestore()) return;
    void (async () => {
      const hint = readWalletHint();
      try {
        if (!hint) return;
        if (hint.mode === "native-ws") {
          if (!(await mobile.restore())) clearWalletHint();
          return;
        }
        if (hint.mode !== "extension") {
          clearWalletHint();
          return;
        }
        const provider = await waitForProvider(hint.wallet, 2_500);
        if (!provider) {
          clearWalletHint();
          return;
        }
        let chains = hint.chains ?? [hint.chainId];
        if (hint.wallet === "zunia" && provider.getConnectedChains) {
          // Zunia answers this silently; restoring only what is still granted
          // means a reload never opens an approval window.
          try {
            const granted = await provider.getConnectedChains();
            chains = chains.filter((id) => granted.includes(id));
          } catch {
            // Older extension: fall through to enable, which does not prompt
            // for chains already approved.
          }
        }
        if (chains.length === 0) {
          clearWalletHint();
          return;
        }
        // The same batch logic as a connect, without suggesting anything: a
        // chain the wallet forgot since (a removed suggestion) is left out with
        // its reason instead of failing the whole restore. Already-approved
        // chains do not prompt.
        const outcome = await enableChains(provider, hint.wallet, chains, {
          suggestFirst: [],
          suggest: async () => false,
          nameOf: chainName,
        });
        const keys: Record<string, WalletKey> = {};
        for (const [chainId, key] of Object.entries(outcome.keys)) keys[chainId] = toWalletKey(chainId, key);
        if (Object.keys(keys).length === 0) {
          clearWalletHint();
          return;
        }
        store.set({ kind: hint.wallet, keys, skipped: outcome.skipped, primaryChainId: pickPrimary(keys, chains, hint.chainId) });
        writeHintFor(store.get());
      } catch {
        clearWalletHint();
      } finally {
        store.set({ restoring: false });
      }
    })();
  }, [mobile, store]);

  /* ----------------------------------------------------------------- value */

  const account = useMemo<ConnectedAccount | null>(() => {
    if (!state.kind) return null;
    const key = state.keys[state.primaryChainId];
    if (!key) return null;
    if (state.kind === "zunia-mobile") {
      return {
        mode: "native-ws",
        chainId: key.chainId,
        address: key.address,
        peerName: key.name ?? mobileSnapshot.peerName ?? "Zunia Mobile",
        sessionId: "zunia-connect",
      };
    }
    return {
      mode: "extension",
      wallet: state.kind,
      chainId: key.chainId,
      address: key.address,
      name: key.name || walletLabel(state.kind),
    };
  }, [state.kind, state.keys, state.primaryChainId, mobileSnapshot.peerName]);

  const mobileState = useMemo<MobileState>(
    () => ({
      ...mobileSnapshot,
      start: (options?: { chains?: string[] }) => startMobile(options).catch(() => undefined),
      cancel: () => mobile.cancel(),
      dismiss: () => mobile.dismissError(),
      requestedChains: requestedMobileChains,
      relayHost: (() => {
        try {
          return new URL(relayApiBase()).host;
        } catch {
          return relayApiBase();
        }
      })(),
    }),
    [mobile, mobileSnapshot, requestedMobileChains, startMobile],
  );

  const session = useMemo<LegacyMobileSession | null>(
    () =>
      state.kind === "zunia-mobile"
        ? {
            transport: "native-ws",
            signAmino: (...args) => mobile.signAmino(...args),
            signDirect: (...args) => mobile.signDirect(...args),
          }
        : null,
    [mobile, state.kind],
  );

  const sessionStatus: LegacySessionStatus = (() => {
    switch (mobileSnapshot.status) {
      case "creating":
        return "connecting";
      case "awaiting-scan":
      case "awaiting-approval":
        return "awaiting_wallet";
      case "connected":
        return "connected";
      case "reconnecting":
        return "reconnecting";
      case "error":
        return "error";
      default:
        return state.kind ? "connected" : state.connecting ? "connecting" : "idle";
    }
  })();

  const connectWithNativeWs = useCallback(async () => {
    await startMobile();
  }, [startMobile]);

  const value = useMemo<WalletContextValue>(
    () => ({
      status: account ? "connected" : state.connecting || state.restoring ? "connecting" : "disconnected",
      walletKind: state.kind,
      account,
      primaryChainId: state.primaryChainId,
      keys: state.keys,
      signableChains: Object.keys(state.keys),
      skippedChains: state.skipped,
      restoring: state.restoring,
      busy: state.connecting,
      error: state.error,
      endedReason: state.endedReason,
      zuniaAvailable,
      keplrAvailable,
      mobile: mobileState,
      signer,
      connectExtension,
      disconnect,
      addressFor,
      ensureChain,
      ensureKey,
      pubKeyFor,
      canSignOn,
      clearError,
      session,
      pairing: mobileSnapshot.uri
        ? { transport: "native-ws", uri: mobileSnapshot.uri, ...(mobileSnapshot.expiresAt ? { expiresAt: mobileSnapshot.expiresAt } : {}) }
        : undefined,
      sessionStatus,
      connectWithExtension: () => connectExtension("zunia"),
      connectWithKeplr: () => connectExtension("keplr"),
      connectWithNativeWs,
      connectWithWalletConnect: () =>
        Promise.reject(new Error("WalletConnect is not available. Connect Zunia Mobile with its QR code instead.")),
    }),
    [
      account,
      state,
      zuniaAvailable,
      keplrAvailable,
      mobileState,
      signer,
      connectExtension,
      disconnect,
      addressFor,
      ensureChain,
      ensureKey,
      pubKeyFor,
      canSignOn,
      clearError,
      session,
      mobileSnapshot.uri,
      mobileSnapshot.expiresAt,
      sessionStatus,
      connectWithNativeWs,
    ],
  );

  return (
    <WalletContext.Provider value={value}>
      <ConnectModalProvider>{children}</ConnectModalProvider>
    </WalletContext.Provider>
  );
}
