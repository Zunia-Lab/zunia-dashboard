/**
 * IBC transfers this browser signed and is still following.
 *
 * A packet takes a minute or more to land, and the page that sent it is
 * usually gone by then: the user moved on to Swap, or reloaded. So every
 * signed transfer is written here (localStorage `zunia.dashboard.pendingTransfers`)
 * with the plan the tracker needs (`/api/interchain/track` walks the hops from
 * the source transaction), and any surface can keep following it: the Bridge
 * page's "In flight" list, and the top bar's Live popover through the small
 * store API below (`pendingTransfers.list / add / update / remove /
 * subscribe`, or the `usePendingTransfers()` hook).
 *
 * Bounded on purpose: at most 10 entries, none older than 24 hours. This is a
 * tracker of what is moving, not a history; Activity is the history, read from
 * the chains.
 *
 * Nothing here signs or holds a key. An entry holds addresses, a denom, an
 * amount and the route plan, all of which the chain already published.
 *
 * The storage is per browser, not per wallet, so the hooks only hand out
 * the connected wallet's own entries (`ownedBy`): after a Disconnect, the
 * next wallet on this browser does not see the previous one's transfers,
 * amounts and recipients, and the Live badge does not count them.
 *
 * Status is the tracker's last reading of the chains, folded into what the
 * user cares about: still moving, arrived, came back, or needs them. It is
 * written by whoever renders the live tracker (`TransferTracker`), from
 * `/api/interchain/track`, never guessed from a clock.
 */

import { useContext, useMemo, useSyncExternalStore } from "react";
import { WalletContext } from "@/lib/connect/context";
import { readRoutePlan, type RouteTraceWire, type RoutePlanWire } from "@/lib/interchain/wire";

export const PENDING_TRANSFERS_KEY = "zunia.dashboard.pendingTransfers";
export const MAX_PENDING_TRANSFERS = 10;
export const PENDING_TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * - `in-flight`: moving (or not observed yet).
 * - `stalled`: no relayer has moved it for a while. Funds sit in the channel
 *   escrow, still deliverable: in flight, but worth a look.
 * - `arrived`: the funds landed on the destination chain.
 * - `returned`: the packet timed out or was rejected; the escrow refunded the
 *   source chain.
 * - `failed`: the source transaction itself failed, so nothing left.
 * - `recoverable`: a crosschain swap ran and its payout failed; the output
 *   waits in the contract for the recovery address (the user must act).
 */
export type PendingTransferStatus = "in-flight" | "stalled" | "arrived" | "returned" | "failed" | "recoverable";

export type PendingTransferOrigin = "bridge" | "send" | "swap";

export interface PendingTransfer {
  /** The source transaction hash, upper-case hex. Also the entry's id. */
  id: string;
  sourceChainId: string;
  destChainId: string;
  /** The plan the transaction was built from; the tracker walks its hops. */
  plan: RoutePlanWire;
  /** Base units sent. */
  amount: string;
  /** Denom on the source chain. */
  denom: string;
  /** Ticker shown next to the amount ("ATOM", "USDC.n"). */
  symbol: string;
  /** Null when unknown: the amount is then shown in base units. */
  decimals: number | null;
  sender: string;
  recipient: string;
  origin: PendingTransferOrigin;
  status: PendingTransferStatus;
  /**
   * 0..1 across every hop's sent → received → acknowledged, as the tracker
   * last read it; absent until one has. Lets a row that does not poll (one
   * poller per transfer: the frame's watcher) still draw how far it got.
   */
  progress?: number;
  /** Epoch ms the transfer was signed. */
  createdAt: number;
  /** Epoch ms of the last status change. */
  updatedAt: number;
}

export type NewPendingTransfer = Omit<PendingTransfer, "status" | "progress" | "createdAt" | "updatedAt"> & {
  status?: PendingTransferStatus;
  createdAt?: number;
};

const STATUSES: ReadonlySet<string> = new Set<PendingTransferStatus>([
  "in-flight",
  "stalled",
  "arrived",
  "returned",
  "failed",
  "recoverable",
]);
const ORIGINS: ReadonlySet<string> = new Set<PendingTransferOrigin>(["bridge", "send", "swap"]);
const HASH = /^[0-9A-Fa-f]{64}$/;
const BASE_UNITS = /^\d{1,78}$/;

/** Statuses after which nothing will change by itself. */
export function isSettled(status: PendingTransferStatus): boolean {
  return status === "arrived" || status === "returned" || status === "failed";
}

/** Moving, or not yet observed: what the Live badge counts. */
export function isInFlight(status: PendingTransferStatus): boolean {
  return status === "in-flight" || status === "stalled";
}

function text(value: unknown, max = 256): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function readEntry(value: unknown): PendingTransfer | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" && HASH.test(row.id) ? row.id.toUpperCase() : null;
  const sourceChainId = text(row.sourceChainId, 64);
  const destChainId = text(row.destChainId, 64);
  const plan = readRoutePlan(row.plan);
  const amount = typeof row.amount === "string" && BASE_UNITS.test(row.amount) ? row.amount : null;
  const denom = text(row.denom);
  const sender = text(row.sender, 128);
  const recipient = text(row.recipient, 128);
  const createdAt = typeof row.createdAt === "number" && Number.isFinite(row.createdAt) ? row.createdAt : null;
  if (!id || !sourceChainId || !destChainId || !plan || !amount || !denom || !sender || !recipient || createdAt === null) {
    return null;
  }
  const decimals =
    typeof row.decimals === "number" && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 30
      ? row.decimals
      : null;
  const updatedAt = typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : createdAt;
  const progress = typeof row.progress === "number" && row.progress >= 0 && row.progress <= 1 ? row.progress : null;
  return {
    id,
    sourceChainId,
    destChainId,
    plan,
    amount,
    denom,
    symbol: text(row.symbol, 32) ?? denom.slice(0, 32),
    decimals,
    sender,
    recipient,
    origin: typeof row.origin === "string" && ORIGINS.has(row.origin) ? (row.origin as PendingTransferOrigin) : "bridge",
    status: typeof row.status === "string" && STATUSES.has(row.status) ? (row.status as PendingTransferStatus) : "in-flight",
    ...(progress !== null ? { progress } : {}),
    createdAt,
    updatedAt,
  };
}

/**
 * Stored entries that are still worth showing, newest first.
 *
 * Whatever is in storage is read as untrusted: an entry that does not narrow
 * is dropped (a half-typed plan cannot be tracked), duplicates keep their
 * newest copy, anything older than a day is forgotten, and at most 10 stay.
 */
export function readPendingTransfers(raw: unknown, now: number): PendingTransfer[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, PendingTransfer>();
  for (const value of raw) {
    const entry = readEntry(value);
    if (!entry) continue;
    if (now - entry.createdAt > PENDING_TRANSFER_TTL_MS || entry.createdAt - now > 60_000) continue;
    const seen = byId.get(entry.id);
    if (!seen || seen.updatedAt < entry.updatedAt) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PENDING_TRANSFERS);
}

/** Add (or replace, by id) an entry; newest first, capped at 10. */
export function withTransfer(list: readonly PendingTransfer[], entry: NewPendingTransfer, now: number): PendingTransfer[] {
  const created = entry.createdAt ?? now;
  const next: PendingTransfer = {
    ...entry,
    id: entry.id.toUpperCase(),
    status: entry.status ?? "in-flight",
    createdAt: created,
    updatedAt: now,
  };
  const rest = list.filter((row) => row.id !== next.id);
  return [next, ...rest].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PENDING_TRANSFERS);
}

export function withoutTransfer(list: readonly PendingTransfer[], id: string): PendingTransfer[] {
  const key = id.toUpperCase();
  return list.filter((row) => row.id !== key);
}

/**
 * Set an entry's status (and the tracker's progress reading, when given).
 * Unchanged list (same reference) when nothing changes; `updatedAt` moves
 * with the status only.
 */
export function withStatus(
  list: readonly PendingTransfer[],
  id: string,
  status: PendingTransferStatus,
  now: number,
  progress?: number,
): readonly PendingTransfer[] {
  const key = id.toUpperCase();
  const current = list.find((row) => row.id === key);
  const reading = progress !== undefined && Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : undefined;
  if (!current || (current.status === status && (reading === undefined || current.progress === reading))) return list;
  return list.map((row) =>
    row.id === key
      ? { ...row, status, ...(reading !== undefined ? { progress: reading } : {}), updatedAt: row.status === status ? row.updatedAt : now }
      : row,
  );
}

/**
 * The entries the wallet on screen signed: the sender is its address on the
 * transfer's source chain. Another wallet's (an earlier session on this
 * browser) stay in storage and age out with the 24 h cap.
 */
export function ownedBy(list: readonly PendingTransfer[], addressFor: (chainId: string) => string | null): PendingTransfer[] {
  return list.filter((row) => {
    const own = addressFor(row.sourceChainId);
    return own !== null && own === row.sender;
  });
}

export function countInFlight(list: readonly PendingTransfer[]): number {
  return list.filter((row) => isInFlight(row.status)).length;
}

/**
 * What a trace says about the funds, in the store's terms. `null` while there
 * is no reading yet (the status stays what it was).
 *
 * A source transaction that failed shows as the first hop `failed` with no
 * packet sequence: the packet was never sent, so nothing was escrowed. An
 * acknowledgement error has a sequence, and its escrow comes back.
 */
export function statusFromTrace(trace: RouteTraceWire | null): PendingTransferStatus | null {
  if (!trace) return null;
  if (trace.failure === "swap-delivery-failed") return "recoverable";
  const first = trace.hops[0];
  if (first && first.status === "failed" && first.sequence === null) return "failed";
  if (trace.failure === "timeout" || trace.failure === "ack-error") return "returned";
  if (trace.hops.some((hop) => hop.status === "timeout" || hop.status === "failed")) return "returned";
  // The engine pads hops it has not reached with `pending`, so every hop is
  // only received once the last one is. The last hop's receipt is the funds
  // landing; its acknowledgement only tells the chain before it, which the
  // user does not wait for.
  if (trace.hops.length > 0 && trace.hops.every((hop) => hop.status === "received" || hop.status === "acknowledged")) {
    return "arrived";
  }
  if (trace.failure === "stalled" || trace.stalled) return "stalled";
  return "in-flight";
}

/* -------------------------------------------------------------------------- *
 * Store (browser): one in-memory list per tab, mirrored to localStorage
 * -------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();
const EMPTY: readonly PendingTransfer[] = Object.freeze([]);
/** Loaded lazily; reset when another tab writes the key. */
let state: readonly PendingTransfer[] | null = null;

function area(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function load(): readonly PendingTransfer[] {
  if (typeof window === "undefined") return EMPTY;
  if (state !== null) return state;
  let parsed: unknown = [];
  try {
    const raw = area()?.getItem(PENDING_TRANSFERS_KEY);
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  state = readPendingTransfers(parsed, Date.now());
  return state;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function commit(next: readonly PendingTransfer[]): void {
  if (next === state) return;
  state = next;
  try {
    area()?.setItem(PENDING_TRANSFERS_KEY, JSON.stringify(next));
  } catch {
    // Private window or full storage: the list still lives in this tab.
  }
  emit();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== PENDING_TRANSFERS_KEY && event.key !== null) return;
  state = null;
  emit();
}

/**
 * The tiny store API (for the Live popover and anything else that wants to
 * show what is moving). Every method is safe on the server, where the list is
 * always empty.
 */
export const pendingTransfers = {
  /** Current entries, newest first. A stable reference until something changes. */
  list(): readonly PendingTransfer[] {
    return load();
  },
  add(entry: NewPendingTransfer): void {
    commit(withTransfer(load(), entry, Date.now()));
  },
  /** Record a new status, and how far the hops got (written by the live tracker). */
  update(id: string, status: PendingTransferStatus, progress?: number): void {
    commit(withStatus(load(), id, status, Date.now(), progress));
  },
  remove(id: string): void {
    commit(withoutTransfer(load(), id));
  },
  /**
   * Drop settled entries ("Clear finished"): those of `ids` when given (the
   * rows a list shows, so another wallet's entries on this browser are left
   * alone), else every one.
   */
  clearSettled(ids?: readonly string[]): void {
    const current = load();
    const only = ids ? new Set(ids.map((id) => id.toUpperCase())) : null;
    const next = current.filter((row) => !isSettled(row.status) || (only !== null && !only.has(row.id)));
    if (next.length !== current.length) commit(next);
  },
  /** Forget entries past their 24 hours (a tab left open for days). */
  prune(): void {
    const current = load();
    const next = readPendingTransfers(current, Date.now());
    if (next.length !== current.length) commit(next);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  },
};

const serverSnapshot = (): readonly PendingTransfer[] => EMPTY;

/**
 * The connected wallet's entries (`ownedBy`), re-rendering on every change
 * (this tab or another). None without a wallet.
 */
export function usePendingTransfers(): readonly PendingTransfer[] {
  const all = useSyncExternalStore(pendingTransfers.subscribe, pendingTransfers.list, serverSnapshot);
  // The context itself, not `useWallet()`: this module stays importable by
  // plain tests, and outside a provider there is simply no wallet.
  const wallet = useContext(WalletContext);
  const addressFor = wallet?.addressFor ?? null;
  return useMemo(() => (addressFor && all.length > 0 ? ownedBy(all, addressFor) : EMPTY), [all, addressFor]);
}

/** How many are still moving: the Live button's badge. */
export function useInFlightTransferCount(): number {
  return countInFlight(usePendingTransfers());
}
