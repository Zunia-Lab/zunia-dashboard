/**
 * Zunia Mobile over Zunia Connect v2 (the native-ws relay), as one long-lived
 * object the UI subscribes to.
 *
 * Why not `connectWithZunia()`: that call creates the session inside itself
 * and only returns it after the phone approves, so the pairing URI, the
 * verification code and the status are emitted before anyone is listening —
 * which is exactly why the dashboard's QR never rendered. Here the transport
 * exists first, its events are wired first, and only then is `connect` called
 * (the SDK example dApp's `useZuniaSession` pattern).
 *
 * Why the transport directly, not `ZuniaSessionImpl`: the session class's
 * `restore()` walks every transport in turn when the saved one fails, and
 * would silently attach to the browser extension on a reload. The dashboard
 * restores the wallet the user chose, and nothing else.
 *
 * State machine:
 *   idle → creating → awaiting-scan → awaiting-approval → connected
 *                                                      ↘ reconnecting ↔ connected
 *   any → error (USER_REJECTED, TIMEOUT, SESSION_EXPIRED, DISCONNECTED, NETWORK, …)
 *   cancel() / disconnect() → idle, and the relay session is really ended
 *   (a `close` frame, or `DELETE /v1/connect/sessions/:id` when the socket is
 *   down), so the phone stops showing a dead session.
 *
 * One transport per attempt. `NativeWsTransport` is not built for two
 * `connect()` calls in flight (both would create relay sessions and the
 * second overwrites the first's keys and timer, whose 600 s timeout then
 * ends the session that did pair), and a session being created cannot be
 * ended yet (`disconnect()` is a no-op until the relay has answered). So
 * every pairing or restore gets a fresh transport; the previous one is
 * unwired and ended, and if its relay session only materialises after that
 * (a cancel during "creating"), it is ended the moment it does. A second
 * `start()` while one is pairing (React StrictMode's double effect, a double
 * click) joins the first instead of opening a second session.
 *
 * The SDK is loaded when a pairing or a restore first needs it, not with the
 * page: `WalletProvider` (on every route) holds a `MobileConnect`, and the
 * transport brings the relay's crypto (noble curves and ciphers) and its own
 * QR encoder — about 40 KB gzipped that most visitors, who never connect a
 * phone, would otherwise download on every page.
 */

import type { NativeWsTransport, ZuniaAccountInfo } from "@zunialab/sdk-web";

export type MobileStatus =
  | "idle"
  | "creating"
  | "awaiting-scan"
  | "awaiting-approval"
  | "connected"
  | "reconnecting"
  | "error";

export interface MobileError {
  code: string;
  message: string;
}

export interface MobileSnapshot {
  status: MobileStatus;
  /** Pairing URI (`zunia://connect?...`): the QR payload and the same-device deep link. */
  uri?: string;
  /** Epoch ms. While pairing: when the relay forgets the unpaired session. Connected: end of the 24 h session. */
  expiresAt?: number;
  /** Six digits the phone must also show, once it has scanned. */
  verificationCode?: string;
  error?: MobileError;
  /** Requested chains while pairing; the chains the phone approved once connected. */
  chains: string[];
  /** One account per approved chain, as the phone shared them. */
  accounts: ZuniaAccountInfo[];
  /** The phone's account name. */
  peerName?: string;
}

/** The transport surface used here; `NativeWsTransport` implements it, tests fake it. */
export interface MobileTransport {
  readonly pairing: { uri: string; expiresAt?: number } | undefined;
  readonly verificationCode: string | undefined;
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
  getAccounts(): ZuniaAccountInfo[];
  getChains(): string[];
  connect(options: {
    chains: string[];
    apiBase: string;
    metadata: { name: string; url: string; icons?: string[] };
    timeoutMs: number;
  }): Promise<void>;
  restore(options: { apiBase: string }): Promise<boolean>;
  disconnect(reason?: string): Promise<void>;
  signAmino: NativeWsTransport["signAmino"];
  signDirect: NativeWsTransport["signDirect"];
}

/** The relay forgets an unpaired session after 600 s; pairing waits exactly that long. */
export const PAIRING_TIMEOUT_MS = 600_000;
/** The relay's paired TTL: 24 h, never renewed. */
export const SESSION_TTL_MS = 86_400_000;
/** The phone accepts at most 32 chains per connect request. */
export const MAX_MOBILE_CHAINS = 32;

const PAIRED_AT_KEY = "zunia.dashboard.mobile.pairedAt";

let nativeWs: Promise<() => MobileTransport> | null = null;

/**
 * The real transport's constructor, loaded once. A failed load (offline, a
 * deploy replaced the chunk) is not remembered, so "Try again" retries it, and
 * it fails like an unreachable relay: as a `NETWORK` error with plain words.
 */
function loadNativeWs(): Promise<() => MobileTransport> {
  nativeWs ??= import("@zunialab/sdk-web").then(
    (sdk) => () => new sdk.NativeWsTransport() as unknown as MobileTransport,
    (cause: unknown) => {
      nativeWs = null;
      throw Object.assign(new Error("Zunia Mobile could not load. Check your connection and try again.", { cause }), {
        code: "NETWORK",
      });
    },
  );
  return nativeWs;
}

export function relayApiBase(): string {
  // Production pins https://api.zunialab.com at build time (zunia-infra
  // redeploy.sh). A local relay is opt-in through the same variable.
  return (process.env.NEXT_PUBLIC_ZUNIA_CONNECT_API_BASE || "https://api.zunialab.com").replace(/\/+$/, "");
}

/** Plain words for every way a pairing or a session ends badly. */
export function mobileErrorFor(code: string, fallback?: string): MobileError {
  switch (code) {
    case "USER_REJECTED":
      return { code, message: "The connection was declined on your phone." };
    case "TIMEOUT":
      return { code, message: "No phone approved the connection before the QR code expired." };
    case "SESSION_EXPIRED":
      return { code, message: "Your session with the phone ended (sessions last 24 hours)." };
    case "DISCONNECTED":
      return { code, message: fallback || "Your phone ended the session." };
    case "PAIRING_FAILED":
      return { code, message: "The phone and this page could not agree on keys. Try again with a new QR code." };
    case "UNKNOWN_CHAIN":
      return { code, message: "Your phone approved none of the requested networks." };
    case "UNSUPPORTED":
      return { code, message: "This browser cannot connect to a phone (no WebSocket support)." };
    case "NETWORK":
      return { code, message: fallback || "The Zunia relay could not be reached. Check your connection and try again." };
    default:
      return { code: code || "INTERNAL", message: fallback || "The connection failed. Try again." };
  }
}

/** Why an active session ended, from the transport's `disconnect` reason. */
export function endReasonError(reason: string): MobileError {
  if (reason === "expired") return mobileErrorFor("SESSION_EXPIRED");
  if (reason === "replaced") {
    return mobileErrorFor("DISCONNECTED", "The phone session moved to another tab of this site.");
  }
  return mobileErrorFor("DISCONNECTED");
}

/**
 * The chains to request at pairing: the home chain first, then the followed
 * chains, catalog-known, without Ethereum-key chains (the phone shares
 * secp256k1 Cosmos keys only and skips them), at most 32.
 */
export function pairingChains(
  homeChainId: string,
  followed: readonly string[],
  lookup: (chainId: string) => { coinType: number; features?: string[] } | undefined,
): string[] {
  const out: string[] = [];
  for (const chainId of [homeChainId, ...followed]) {
    if (out.includes(chainId)) continue;
    const chain = lookup(chainId);
    if (!chain) continue;
    if (chain.coinType === 60 || chain.features?.includes("eth-key-sign")) continue;
    out.push(chainId);
    if (out.length >= MAX_MOBILE_CHAINS) break;
  }
  return out;
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "INTERNAL";
}

function readPairedAt(): number | null {
  try {
    const value = Number(window.localStorage.getItem(PAIRED_AT_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writePairedAt(value: number | null): void {
  try {
    if (value === null) window.localStorage.removeItem(PAIRED_AT_KEY);
    else window.localStorage.setItem(PAIRED_AT_KEY, String(value));
  } catch {
    // Private mode: the expiry line is simply not shown after a reload.
  }
}

export class MobileConnect {
  private transport: MobileTransport | null = null;
  private snapshot: MobileSnapshot = { status: "idle", chains: [], accounts: [] };
  private readonly listeners = new Set<() => void>();
  /** Bumped by every start / cancel / disconnect / restore: an older attempt settling changes nothing. */
  private attempt = 0;
  private unwire: (() => void) | null = null;
  /** The pairing in flight, joined by a second `start()`. */
  private pairing: Promise<void> | null = null;

  constructor(
    private readonly options: {
      apiBase?: string;
      createTransport?: () => MobileTransport;
      /** Called when an active session ends on its own (phone, expiry, other tab) or is replaced by a new pairing. */
      onEnded?: (error: MobileError) => void;
      /** Called when the phone's accounts change (connect, restore, account switch). */
      onAccounts?: (accounts: ZuniaAccountInfo[]) => void;
    } = {},
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): MobileSnapshot => this.snapshot;

  private get apiBase(): string {
    return this.options.apiBase ?? relayApiBase();
  }

  private update(patch: Partial<MobileSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private get pairingNow(): boolean {
    const { status } = this.snapshot;
    return status === "creating" || status === "awaiting-scan" || status === "awaiting-approval";
  }

  /** A new transport for a new attempt, wired to this object; the previous one is retired. */
  private freshTransport(create: () => MobileTransport): MobileTransport {
    if (this.transport) void this.retire(this.transport, "replaced");
    const transport = create();
    this.wire(transport);
    this.transport = transport;
    return transport;
  }

  /**
   * How to make a transport: the injected one (tests) at once, else the SDK's,
   * loaded on first use. Injected stays synchronous on purpose, so a fake
   * transport exists the moment `start()` returns, as it always did.
   */
  private transportFactory(): (() => MobileTransport) | Promise<() => MobileTransport> {
    return this.options.createTransport ?? loadNativeWs();
  }

  /**
   * Stop listening to a transport and end the relay session it holds — or
   * will hold: a session still being created answers after this, and is
   * ended on its `pairing` event (its join token was never shown, so nobody
   * could have scanned it).
   */
  private retire(transport: MobileTransport, reason: string): Promise<void> {
    if (this.transport === transport) {
      this.unwire?.();
      this.unwire = null;
      this.transport = null;
    }
    const late = () => {
      transport.off("pairing", late as never);
      void transport.disconnect(reason).catch(() => undefined);
    };
    transport.on("pairing", late as never);
    return transport.disconnect(reason).catch(() => undefined);
  }

  private wire(transport: MobileTransport): void {
    const onPairing = (pairing: { uri: string; expiresAt?: number }) => {
      this.update({ status: "awaiting-scan", uri: pairing.uri, expiresAt: pairing.expiresAt, verificationCode: undefined });
    };
    const onVerification = (code: string) => {
      this.update({ status: "awaiting-approval", verificationCode: code });
    };
    const onStatus = (status: string) => {
      if (status === "connected") this.markConnected();
      else if (status === "reconnecting" && this.snapshot.status === "connected") this.update({ status: "reconnecting" });
      else if (status === "connecting" && this.snapshot.status !== "creating") this.update({ status: "creating" });
    };
    const onAccounts = (accounts: ZuniaAccountInfo[]) => {
      if (this.snapshot.status === "connected" || this.snapshot.status === "reconnecting") {
        this.update({ accounts: [...accounts], peerName: accounts[0]?.name ?? this.snapshot.peerName });
      }
      this.options.onAccounts?.([...accounts]);
    };
    const onDisconnect = (reason: string) => {
      // Only an active session emits this (a failed pairing settles
      // connect()), and only while this object still listens: the endings it
      // asks for itself (cancel, disconnect, a new pairing) unwire first.
      const error = endReasonError(reason);
      writePairedAt(null);
      this.update({ status: "error", error, uri: undefined, verificationCode: undefined, accounts: [], expiresAt: undefined });
      this.options.onEnded?.(error);
    };
    transport.on("pairing", onPairing as never);
    transport.on("verification", onVerification as never);
    transport.on("status", onStatus as never);
    transport.on("accountsChanged", onAccounts as never);
    transport.on("disconnect", onDisconnect as never);
    this.unwire = () => {
      transport.off("pairing", onPairing as never);
      transport.off("verification", onVerification as never);
      transport.off("status", onStatus as never);
      transport.off("accountsChanged", onAccounts as never);
      transport.off("disconnect", onDisconnect as never);
    };
  }

  private markConnected(): void {
    const transport = this.transport;
    if (!transport) return;
    const accounts = transport.getAccounts();
    // A fresh approval starts the relay's 24 h clock; a restored session keeps
    // the time recorded when it was approved (unknown → no expiry shown,
    // rather than a made-up one).
    const fresh = this.snapshot.status === "awaiting-approval" || this.snapshot.status === "awaiting-scan";
    let pairedAt = readPairedAt();
    if (fresh) {
      pairedAt = Date.now();
      writePairedAt(pairedAt);
    }
    this.update({
      status: "connected",
      uri: undefined,
      verificationCode: undefined,
      error: undefined,
      chains: transport.getChains(),
      accounts,
      peerName: accounts[0]?.name,
      expiresAt: pairedAt ? pairedAt + SESSION_TTL_MS : undefined,
    });
  }

  /**
   * Create a relay session and wait for a phone. Resolves when the phone
   * approves; rejects when the pairing fails (the reason is in the snapshot).
   * Resolves quietly when it was cancelled or replaced. A call while a
   * pairing is in flight joins it.
   */
  start(params: { chains: string[]; metadata: { name: string; url: string; icons?: string[] } }): Promise<void> {
    if (this.pairing && this.pairingNow) return this.pairing;
    const run: Promise<void> = this.pair(params).finally(() => {
      if (this.pairing === run) this.pairing = null;
    });
    this.pairing = run;
    return run;
  }

  private async pair(params: { chains: string[]; metadata: { name: string; url: string; icons?: string[] } }): Promise<void> {
    if (params.chains.length === 0) {
      this.update({ status: "error", error: mobileErrorFor("UNKNOWN_CHAIN", "No network can be shared with the phone.") });
      throw new Error("No network can be shared with the phone.");
    }
    const attempt = ++this.attempt;
    // Pairing again ends the session there was: the dashboard is not signed
    // in with the old phone session while the new code is on screen.
    const replacing = this.connected;
    writePairedAt(null);
    this.update({
      status: "creating",
      chains: params.chains.slice(0, MAX_MOBILE_CHAINS),
      uri: undefined,
      verificationCode: undefined,
      error: undefined,
      accounts: [],
      expiresAt: undefined,
    });
    // The old session ends now, before anything is awaited: the dashboard is
    // not signed in with it while the SDK loads.
    if (this.transport) void this.retire(this.transport, "replaced");
    if (replacing) this.options.onEnded?.(mobileErrorFor("DISCONNECTED", "The previous phone session was ended to connect again."));
    try {
      const factory = this.transportFactory();
      const create = typeof factory === "function" ? factory : await factory;
      // Cancelled or replaced while the SDK loaded: no relay session at all.
      if (attempt !== this.attempt) return;
      const transport = this.freshTransport(create);
      await transport.connect({
        chains: params.chains.slice(0, MAX_MOBILE_CHAINS),
        apiBase: this.apiBase,
        metadata: params.metadata,
        timeoutMs: PAIRING_TIMEOUT_MS,
      });
      if (attempt !== this.attempt) return;
      this.markConnected();
      this.options.onAccounts?.(transport.getAccounts());
    } catch (error) {
      // Cancelled, or replaced by a newer attempt: that one owns the snapshot.
      if (attempt !== this.attempt) return;
      const message = error instanceof Error ? error.message : undefined;
      this.update({
        status: "error",
        uri: undefined,
        verificationCode: undefined,
        error: mobileErrorFor(errorCode(error), message),
      });
      throw error;
    }
  }

  /** Stop pairing (or waiting for approval) and end the relay session. A connected session is left alone. */
  async cancel(): Promise<void> {
    if (!this.pairingNow && this.snapshot.status !== "error") return;
    this.attempt += 1;
    this.pairing = null;
    const transport = this.transport;
    this.update({ status: "idle", uri: undefined, verificationCode: undefined, error: undefined, expiresAt: undefined });
    if (transport) await this.retire(transport, "cancelled");
  }

  /** Reattach to a session saved by an earlier visit. Never prompts the phone. */
  async restore(): Promise<boolean> {
    if (this.transport && this.connected) return true;
    const attempt = ++this.attempt;
    let transport: MobileTransport | null = null;
    let ok = false;
    try {
      const factory = this.transportFactory();
      const create = typeof factory === "function" ? factory : await factory;
      // A pairing started while the SDK loaded owns the state now.
      if (attempt !== this.attempt) return false;
      transport = this.freshTransport(create);
      ok = await transport.restore({ apiBase: this.apiBase });
    } catch {
      ok = false;
    }
    // A pairing started meanwhile replaced this transport.
    if (attempt !== this.attempt) return false;
    if (!ok || !transport) {
      writePairedAt(null);
      if (transport) void this.retire(transport, "restore_failed");
      this.update({ status: "idle", error: undefined, accounts: [], chains: [] });
      return false;
    }
    const accounts = transport.getAccounts();
    const pairedAt = readPairedAt();
    this.update({
      status: this.snapshot.status === "connected" ? "connected" : "reconnecting",
      chains: transport.getChains(),
      accounts,
      peerName: accounts[0]?.name,
      ...(pairedAt ? { expiresAt: pairedAt + SESSION_TTL_MS } : {}),
    });
    return true;
  }

  /** End the session from this side; the phone is told. */
  async disconnect(): Promise<void> {
    this.attempt += 1;
    this.pairing = null;
    writePairedAt(null);
    const transport = this.transport;
    this.update({ status: "idle", uri: undefined, verificationCode: undefined, error: undefined, accounts: [], expiresAt: undefined });
    if (transport) await this.retire(transport, "user");
  }

  /** Clear a shown error without touching the relay. */
  dismissError(): void {
    if (this.snapshot.status === "error") this.update({ status: "idle", error: undefined });
  }

  get connected(): boolean {
    return this.snapshot.status === "connected" || this.snapshot.status === "reconnecting";
  }

  signAmino(...args: Parameters<NativeWsTransport["signAmino"]>): ReturnType<NativeWsTransport["signAmino"]> {
    if (!this.transport || !this.connected) return Promise.reject(new Error("Connect Zunia Mobile first."));
    return this.transport.signAmino(...args);
  }

  signDirect(...args: Parameters<NativeWsTransport["signDirect"]>): ReturnType<NativeWsTransport["signDirect"]> {
    if (!this.transport || !this.connected) return Promise.reject(new Error("Connect Zunia Mobile first."));
    return this.transport.signDirect(...args);
  }

  /** Detach listeners (provider unmount). The relay session is left as is, for restore. */
  dispose(): void {
    this.unwire?.();
    this.unwire = null;
    this.transport = null;
    this.pairing = null;
    this.listeners.clear();
  }
}
