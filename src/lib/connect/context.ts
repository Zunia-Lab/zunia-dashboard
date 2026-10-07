"use client";

/**
 * The wallet context: its shape and `useWallet()`.
 *
 * Kept apart from `WalletProvider` (which renders the connect modal) so the
 * connect components can read the wallet without importing the provider that
 * mounts them. `@/providers/WalletProvider` re-exports everything here.
 */

import { createContext, useContext } from "react";
import type { MobileSnapshot } from "@/lib/connect/mobile";
import type { ExtensionWallet } from "@/lib/connect/extension";
import type { NativeWsTransport } from "@zunialab/sdk-web";
import type { TxSigner } from "@/lib/tx/flow";

export type WalletKind = "zunia" | "keplr" | "zunia-mobile";

export type WalletStatus = "disconnected" | "connecting" | "connected";

/** The wallet's key on one chain (from `getKey`, or the phone's shared account). */
export interface WalletKey {
  chainId: string;
  address: string;
  /** 33-byte compressed secp256k1 public key. */
  pubKey: Uint8Array;
  algo: string;
  /** Account name in the wallet. */
  name?: string;
  isNanoLedger?: boolean;
}

/**
 * The primary account. The union and its fields are the pre-v2 shape, kept
 * because pages read `mode`, `wallet`, `name` and `peerName`.
 */
export type ConnectedAccount =
  | {
      mode: "extension";
      wallet: ExtensionWallet;
      chainId: string;
      address: string;
      name: string;
    }
  | {
      /** @deprecated Never produced: WalletConnect is hidden (see lib/connect/walletconnect). */
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
      /** A label, not a secret: the relay session id and tokens stay in the SDK's record. */
      sessionId: string;
    };

/** A chain the connect step left out, and why (shown in the connect UI). */
export interface SkippedChain {
  chainId: string;
  reason: string;
}

/** `sessionStatus` as pre-v2 pages read it (the SDK's status names). */
export type LegacySessionStatus =
  | "idle"
  | "connecting"
  | "awaiting_wallet"
  | "connected"
  | "reconnecting"
  | "locked"
  | "disconnected"
  | "error";

/** The phone session as `resolveSignAmino` used to receive it. */
export interface LegacyMobileSession {
  readonly transport: "native-ws";
  signAmino: NativeWsTransport["signAmino"];
  signDirect: NativeWsTransport["signDirect"];
}

export interface MobileState extends MobileSnapshot {
  /**
   * Pair a phone. Requests the home chain + followed chains by default, or
   * `chains` (a chain picker); either way the home chain comes first,
   * Ethereum-key chains are left out (the phone does not share them) and at
   * most 32 are asked for. Never throws: the outcome is in the snapshot.
   */
  start: (options?: { chains?: string[] }) => Promise<void>;
  /** Stop waiting and end the relay session. */
  cancel: () => Promise<void>;
  /** Clear a shown error (the "Try again" button calls `start`). */
  dismiss: () => void;
  /** The chains a pairing would request now. */
  requestedChains: string[];
  /** Relay base in use, for the "end-to-end encrypted via …" line. */
  relayHost: string;
}

export interface WalletContextValue {
  /* ---------------------------------------------------------------- state */
  status: WalletStatus;
  walletKind: WalletKind | null;
  /** The primary account (on `primaryChainId`). */
  account: ConnectedAccount | null;
  /** Safrochain by default; the first chain with a key when the wallet refused it. */
  primaryChainId: string;
  /** Keys the wallet gave, by chain id. */
  keys: Readonly<Record<string, WalletKey>>;
  /** Chains with a signing key right now. */
  signableChains: string[];
  /** Chains the last connect left out, with the reason. */
  skippedChains: SkippedChain[];
  /** True until the first restore attempt finishes. */
  restoring: boolean;
  busy: boolean;
  error: string | null;
  /** Why the session ended by itself (phone, expiry, extension), until the next connect. */
  endedReason: string | null;
  /**
   * A remembered Zunia extension connection is waiting for the wallet to be
   * unlocked. The restore found the site's grant but Zunia locked (it locks
   * after 10 idle minutes, on browser close, on device lock), so it asked for
   * nothing: a key read would have opened Zunia's unlock window on page load.
   * Offer "Zunia is locked — Unlock" where Connect would be: that click calls
   * `connectExtension("zunia")`, and the unlock window opens on a gesture.
   * An unlock made in Zunia itself restores the connection on its own.
   */
  zuniaLocked: boolean;
  zuniaAvailable: boolean;
  keplrAvailable: boolean;
  /** Zunia Mobile pairing / session state and actions. */
  mobile: MobileState;
  /** The signer the sign flow uses; null when disconnected. */
  signer: TxSigner | null;

  /* -------------------------------------------------------------- actions */
  /** Enable the home chain + followed chains in one prompt; suggests chains the wallet lacks. */
  connectExtension: (wallet: ExtensionWallet) => Promise<void>;
  disconnect: () => Promise<void>;
  /** The wallet's address on a chain; same-scheme re-encoding otherwise; null when unknowable. */
  addressFor: (chainId: string) => string | null;
  /** Make the chain signable (enable / suggest) and return its address. Readable errors. */
  ensureChain: (chainId: string) => Promise<string>;
  /** As `ensureChain`, returning the whole key. */
  ensureKey: (chainId: string) => Promise<WalletKey>;
  /** The public key for direct signing, when the wallet has shared it. */
  pubKeyFor: (chainId: string) => Uint8Array | null;
  /** Whether this wallet can sign on the chain at all (mobile: approved chains only). */
  canSignOn: (chainId: string) => boolean;
  clearError: () => void;

  /* ------------------------------------------------------ legacy (pre-v2) */
  /** @deprecated Use `mobile` and `signer`. The phone session, for `resolveSignAmino`. */
  session: LegacyMobileSession | null;
  /** @deprecated Use `mobile.uri` / `mobile.expiresAt`. */
  pairing: { transport: "native-ws"; uri: string; expiresAt?: number } | undefined;
  /** @deprecated Use `status` and `mobile.status`. */
  sessionStatus: LegacySessionStatus;
  /** @deprecated Use `connectExtension("zunia")`. The chain argument is ignored. */
  connectWithExtension: (chainId?: string) => Promise<void>;
  /** @deprecated Use `connectExtension("keplr")`. The chain argument is ignored. */
  connectWithKeplr: (chainId?: string) => Promise<void>;
  /** @deprecated Use `mobile.start()`. The chain argument is ignored. */
  connectWithNativeWs: (chainId?: string) => Promise<void>;
  /** @deprecated WalletConnect is hidden; always rejects. */
  connectWithWalletConnect: (chainId?: string) => Promise<void>;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}

export function accountLabel(account: ConnectedAccount): string {
  if (account.mode === "walletconnect" || account.mode === "native-ws") return account.peerName;
  return account.wallet === "keplr" ? account.name || "Keplr" : account.name;
}

export function walletKindLabel(kind: WalletKind): string {
  return kind === "zunia" ? "Zunia extension" : kind === "keplr" ? "Keplr" : "Zunia Mobile";
}
