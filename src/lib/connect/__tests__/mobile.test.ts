/**
 * The Zunia Mobile state machine, driven by fake transports that emit what
 * `NativeWsTransport` emits, in the same order (verified against the real
 * relay with zunia-e2e's TestWallet during development), and that share its
 * one awkward property: while the relay session is still being created,
 * `disconnect()` has nothing to end and does nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  endReasonError,
  MAX_MOBILE_CHAINS,
  MobileConnect,
  mobileErrorFor,
  openAppLink,
  pairingChains,
  sessionIdOf,
  type MobileSnapshot,
  type MobileTransport,
} from "../mobile";

type Listener = (...args: never[]) => void;
type Account = ReturnType<MobileTransport["getAccounts"]>[number];

class FakeTransport {
  phase: "idle" | "creating" | "pairing" | "active" | "ended" = "idle";
  pairing: { uri: string; expiresAt?: number } | undefined;
  verificationCode: string | undefined;
  private listeners = new Map<string, Set<Listener>>();
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  accounts: Account[] = [];
  chains: string[] = [];
  /** Every disconnect() call, and the ones that actually ended a relay session. */
  disconnectCalls: string[] = [];
  ended: string[] = [];
  connects = 0;

  constructor(
    private readonly saved: { chains: string[]; accounts: Account[] } | null = null,
    /** Holds restore() until it settles: a relay that answers slowly. */
    private readonly restoreGate: Promise<void> | null = null,
  ) {}

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) (listener as (...a: unknown[]) => void)(...args);
  }
  getAccounts() {
    return this.accounts;
  }
  getChains() {
    return this.chains;
  }
  connect() {
    this.connects += 1;
    this.phase = "creating";
    this.emit("status", "connecting");
    return new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
  }
  async restore() {
    if (this.restoreGate) await this.restoreGate;
    if (!this.saved) return false;
    this.phase = "active";
    this.chains = this.saved.chains;
    this.accounts = this.saved.accounts;
    this.emit("status", "reconnecting");
    this.emit("accountsChanged", this.accounts);
    return true;
  }
  async disconnect(reason = "user") {
    this.disconnectCalls.push(reason);
    if (this.phase !== "pairing" && this.phase !== "active") return;
    const wasActive = this.phase === "active";
    this.phase = "ended";
    this.ended.push(reason);
    this.rejectConnect?.(Object.assign(new Error("closed"), { code: "DISCONNECTED" }));
    this.emit("status", "disconnected");
    if (wasActive) this.emit("disconnect", reason);
  }
  /** The relay answered POST /sessions: the code exists. */
  showPairing(uri = "zunia://connect?v=2&sid=x") {
    this.phase = "pairing";
    this.pairing = { uri, expiresAt: 1_000 };
    this.emit("pairing", this.pairing);
    this.emit("status", "awaiting_wallet");
  }
  phoneScanned(code: string) {
    this.verificationCode = code;
    this.emit("verification", code);
  }
  phoneApproves(chains: string[]) {
    this.phase = "active";
    this.chains = chains;
    this.accounts = chains.map((chainId) => ({ chainId, address: `${chainId}-addr`, algo: "secp256k1" as const, pubkey: new Uint8Array(33), name: "Phone" }));
    this.emit("accountsChanged", this.accounts);
    this.emit("status", "connected");
    this.resolveConnect?.();
  }
  phoneRejects() {
    this.phase = "ended";
    this.rejectConnect?.(Object.assign(new Error("declined"), { code: "USER_REJECTED" }));
    this.emit("status", "disconnected");
  }
  /** The phone (or the relay) ends an active session. */
  phoneEnds(reason: string) {
    this.phase = "ended";
    this.emit("status", "disconnected");
    this.emit("disconnect", reason);
  }
  signAmino = (() => Promise.reject(new Error("unused"))) as unknown as MobileTransport["signAmino"];
  signDirect = (() => Promise.reject(new Error("unused"))) as unknown as MobileTransport["signDirect"];
}

function setup(saved: { chains: string[]; accounts: Account[] } | null = null, restoreGate: Promise<void> | null = null) {
  const transports: FakeTransport[] = [];
  const ended: string[] = [];
  const shared: number[] = [];
  const mobile = new MobileConnect({
    apiBase: "https://relay.example",
    createTransport: () => {
      const transport = new FakeTransport(saved, restoreGate);
      transports.push(transport);
      return transport as unknown as MobileTransport;
    },
    onEnded: (error) => ended.push(error.code),
    onAccounts: (accounts) => shared.push(accounts.length),
  });
  const seen: MobileSnapshot["status"][] = [];
  mobile.subscribe(() => {
    const status = mobile.getSnapshot().status;
    if (seen.at(-1) !== status) seen.push(status);
  });
  const current = () => transports.at(-1)!;
  return { transports, current, mobile, ended, shared, seen };
}

const META = { name: "Zunia Dashboard", url: "https://wallet.zunialab.com" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function paired(chains = ["safrochain-1"]) {
  const harness = setup();
  const started = harness.mobile.start({ chains, metadata: META });
  harness.current().showPairing();
  harness.current().phoneApproves(chains);
  await started;
  return harness;
}

test("pairing: creating → awaiting-scan → awaiting-approval → connected", async () => {
  const { current, mobile, shared, seen } = setup();
  const started = mobile.start({ chains: ["safrochain-1", "cosmoshub-4"], metadata: META });
  current().showPairing();
  assert.equal(mobile.getSnapshot().uri, "zunia://connect?v=2&sid=x");
  current().phoneScanned("123456");
  assert.equal(mobile.getSnapshot().verificationCode, "123456");
  current().phoneApproves(["safrochain-1", "cosmoshub-4"]);
  await started;
  const snap = mobile.getSnapshot();
  assert.deepEqual(seen, ["creating", "awaiting-scan", "awaiting-approval", "connected"]);
  assert.equal(snap.uri, undefined);
  assert.equal(snap.verificationCode, undefined);
  assert.deepEqual(snap.chains, ["safrochain-1", "cosmoshub-4"]);
  assert.equal(snap.peerName, "Phone");
  assert.ok(shared.includes(2));
});

test("cancel ends the relay session and returns to idle without an error", async () => {
  const { current, mobile, ended } = setup();
  const started = mobile.start({ chains: ["safrochain-1"], metadata: META });
  current().showPairing();
  await mobile.cancel();
  await started;
  assert.deepEqual(current().ended, ["cancelled"]);
  assert.equal(mobile.getSnapshot().status, "idle");
  assert.equal(mobile.getSnapshot().error, undefined);
  assert.deepEqual(ended, [], "cancelling a pairing is not a session ending");
});

test("cancel while the relay session is still being created: the late session is ended, no code is shown", async () => {
  const { current, mobile } = setup();
  const started = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.equal(mobile.getSnapshot().status, "creating");
  await mobile.cancel();
  assert.deepEqual(current().ended, [], "nothing to end yet: the relay has not answered");
  // The relay answers POST /sessions after the cancel.
  current().showPairing();
  assert.deepEqual(current().ended, ["cancelled"]);
  assert.equal(mobile.getSnapshot().status, "idle");
  assert.equal(mobile.getSnapshot().uri, undefined);
  await started;
});

test("a second start while pairing joins the first (StrictMode's double effect, a double click)", async () => {
  const { transports, current, mobile } = setup();
  const first = mobile.start({ chains: ["safrochain-1"], metadata: META });
  const second = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.equal(first, second);
  assert.equal(transports.length, 1);
  assert.equal(current().connects, 1);
  current().showPairing();
  current().phoneApproves(["safrochain-1"]);
  await first;
  assert.equal(mobile.getSnapshot().status, "connected");
});

test("declined on the phone: an error with plain words, and Pair again works on a fresh transport", async () => {
  const { transports, current, mobile } = setup();
  const started = mobile.start({ chains: ["safrochain-1"], metadata: META });
  current().showPairing();
  current().phoneRejects();
  await assert.rejects(started);
  assert.equal(mobile.getSnapshot().status, "error");
  assert.equal(mobile.getSnapshot().error?.code, "USER_REJECTED");
  const again = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.equal(transports.length, 2);
  assert.equal(mobile.getSnapshot().status, "creating");
  assert.equal(mobile.getSnapshot().error, undefined);
  current().showPairing();
  current().phoneApproves(["safrochain-1"]);
  await again;
  assert.equal(mobile.getSnapshot().status, "connected");
});

test("pairing again while connected ends the old session once, and says so", async () => {
  const { transports, current, mobile, ended } = await paired();
  const old = current();
  const again = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.deepEqual(old.ended, ["replaced"]);
  assert.deepEqual(ended, ["DISCONNECTED"], "the provider is told the old session is gone");
  assert.notEqual(current(), old);
  // The old transport's own "disconnect" event is not heard (unwired first).
  assert.equal(mobile.getSnapshot().status, "creating");
  current().showPairing();
  current().phoneApproves(["safrochain-1", "osmosis-1"]);
  await again;
  assert.deepEqual(mobile.getSnapshot().chains, ["safrochain-1", "osmosis-1"]);
  assert.equal(transports.length, 2);
});

test("the phone ending an active session clears it and says why", async () => {
  const { current, mobile, ended } = await paired();
  current().phoneEnds("expired");
  assert.deepEqual(ended, ["SESSION_EXPIRED"]);
  assert.equal(mobile.getSnapshot().status, "error");
  assert.equal(mobile.getSnapshot().accounts.length, 0);
});

test("disconnect from this side ends the session without reporting it as ended by the phone", async () => {
  const { current, mobile, ended } = await paired();
  const transport = current();
  await mobile.disconnect();
  assert.deepEqual(transport.ended, ["user"]);
  assert.deepEqual(ended, []);
  assert.equal(mobile.getSnapshot().status, "idle");
  await assert.rejects(mobile.signAmino("safrochain-1", "a", {} as never), /Connect Zunia Mobile first/);
});

test("cancel leaves a connected session alone", async () => {
  const { current, mobile } = await paired();
  await mobile.cancel();
  assert.equal(mobile.getSnapshot().status, "connected");
  assert.deepEqual(current().ended, []);
});

test("restore: a saved session comes back as reconnecting, then connected on welcome", async () => {
  const account: Account = { chainId: "safrochain-1", address: "a", algo: "secp256k1", pubkey: new Uint8Array(33) };
  const { current, mobile, shared } = setup({ chains: ["safrochain-1"], accounts: [account] });
  assert.equal(await mobile.restore(), true);
  assert.equal(mobile.getSnapshot().status, "reconnecting");
  assert.ok(shared.length > 0);
  current().emit("status", "connected");
  assert.equal(mobile.getSnapshot().status, "connected");
  // No pairing time known for a restored session: no invented expiry.
  assert.equal(mobile.getSnapshot().expiresAt, undefined);
  assert.equal(await mobile.restore(), true, "a second restore keeps the live session");
  await tick();
});

test("restore without a saved session stays idle", async () => {
  const { mobile } = setup();
  assert.equal(await mobile.restore(), false);
  assert.equal(mobile.getSnapshot().status, "idle");
});

test("a QR code asked for while a saved session restores waits for it, then ends it once", async () => {
  const account: Account = { chainId: "safrochain-1", address: "a", algo: "secp256k1", pubkey: new Uint8Array(33) };
  let answer!: () => void;
  const slow = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const { transports, mobile, ended } = setup({ chains: ["safrochain-1"], accounts: [account] }, slow);
  const restoring = mobile.restore();
  const started = mobile.start({ chains: ["safrochain-1"], metadata: META });
  assert.equal(mobile.start({ chains: ["safrochain-1"], metadata: META }), started, "a second click joins the first");
  assert.equal(transports.length, 1, "no relay session is created while the restore runs");
  answer();
  assert.equal(await restoring, true);
  await tick();
  assert.equal(transports.length, 2);
  assert.deepEqual(transports[0]!.ended, ["replaced"], "the restored session is ended, not left open on the phone");
  assert.deepEqual(ended, ["DISCONNECTED"]);
  transports[1]!.showPairing();
  transports[1]!.phoneApproves(["safrochain-1"]);
  await started;
  assert.equal(mobile.getSnapshot().status, "connected");
});

test("a restore asked for while a QR code is showing leaves the pairing alone", async () => {
  const { transports, current, mobile } = setup({ chains: ["safrochain-1"], accounts: [] });
  const started = mobile.start({ chains: ["safrochain-1"], metadata: META });
  current().showPairing();
  assert.equal(await mobile.restore(), false);
  assert.equal(transports.length, 1);
  assert.equal(mobile.getSnapshot().status, "awaiting-scan");
  current().phoneApproves(["safrochain-1"]);
  await started;
  assert.equal(mobile.getSnapshot().status, "connected");
});

test("the session id comes from the pairing link, wakes the app, and survives a reload", async () => {
  const memory = new Map<string, string>();
  const scope = globalThis as { window?: unknown };
  scope.window = {
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    },
  };
  try {
    const sid = "0QGVxbcVdiyNwgE8M6Ammg";
    const first = setup();
    const started = first.mobile.start({ chains: ["safrochain-1"], metadata: META });
    first.current().showPairing(`zunia://connect?v=2&sid=${sid}&t=token&pk=key&r=wss%3A%2F%2Frelay.example`);
    assert.equal(first.mobile.getSnapshot().sessionId, sid);
    first.current().phoneApproves(["safrochain-1"]);
    await started;
    assert.equal(openAppLink(first.mobile.getSnapshot().sessionId), `zunia://connect/wake?sid=${sid}`);

    // The page reloads: the saved session comes back with its id.
    const account: Account = { chainId: "safrochain-1", address: "a", algo: "secp256k1", pubkey: new Uint8Array(33) };
    const reloaded = setup({ chains: ["safrochain-1"], accounts: [account] });
    assert.equal(await reloaded.mobile.restore(), true);
    assert.equal(reloaded.mobile.getSnapshot().sessionId, sid);
    await reloaded.mobile.disconnect();
    assert.equal(reloaded.mobile.getSnapshot().sessionId, undefined);
    assert.equal(memory.has("zunia.dashboard.mobile.sid"), false);
  } finally {
    delete scope.window;
  }
});

test("open app link: the wake link for a session, the app's scheme without one", () => {
  assert.equal(openAppLink(undefined), "zunia://");
  assert.equal(sessionIdOf("zunia://connect?v=2&sid=x"), undefined, "too short to be a relay session");
  assert.equal(sessionIdOf("not a link"), undefined);
  assert.equal(sessionIdOf(undefined), undefined);
});

test("pairing chains: home first, followed, no Ethereum-key chains, unknown dropped, ≤ 32", () => {
  const lookup = (id: string) =>
    id.startsWith("evm") ? { coinType: 60 } : id === "unknown" ? undefined : { coinType: 118 };
  assert.deepEqual(pairingChains("safrochain-1", ["cosmoshub-4", "safrochain-1", "evmos", "unknown", "osmosis-1"], lookup), [
    "safrochain-1",
    "cosmoshub-4",
    "osmosis-1",
  ]);
  const many = Array.from({ length: 50 }, (_, i) => `chain-${i}`);
  assert.equal(pairingChains("safrochain-1", many, lookup).length, MAX_MOBILE_CHAINS);
});

test("every ending has words", () => {
  for (const code of ["USER_REJECTED", "TIMEOUT", "SESSION_EXPIRED", "DISCONNECTED", "PAIRING_FAILED", "UNKNOWN_CHAIN", "UNSUPPORTED", "NETWORK", "WHATEVER"]) {
    assert.ok(mobileErrorFor(code).message.length > 10, code);
  }
  assert.match(endReasonError("replaced").message, /another tab/);
  assert.equal(endReasonError("closed").code, "DISCONNECTED");
  assert.match(mobileErrorFor("NETWORK", "Too many pairing attempts. Try again in 30 seconds.").message, /30 seconds/);
});
