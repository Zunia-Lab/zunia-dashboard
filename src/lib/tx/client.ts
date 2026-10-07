/**
 * The browser's calls to the wallet routes: account, simulate, broadcast, tx
 * status. Typed answers, one error type, no retries (the sign flow decides
 * what is worth retrying; a broadcast is never silently re-sent).
 *
 * Contracts (see each route's header for the full story):
 * - GET  /api/account?chainId&address        → AccountInfo
 * - GET  /api/account/chain-info?chainId     → SuggestChainInfo
 * - POST /api/tx/simulate {chainId, txBytes} → {gasUsed} | 422 SimulationRefused
 * - POST /api/broadcast   {chainId, txBytes, address?} → BroadcastAnswer (code ≠ 0 is an answer, not an error)
 * - GET  /api/tx/<hash>?chainId[&address]    → TxOutcome
 *
 * `address` (the signer) is optional on both: with it the server drops its
 * cached reads of that account once the transaction is accepted / included,
 * so the balances that refresh afterwards are the new ones.
 */

import type { SuggestChainInfo } from "@/lib/connect/suggest";
import type { TxErrorKind } from "./errors";
import type { TxOutcome } from "./types";

export interface AccountInfo {
  chainId: string;
  address: string;
  accountNumber: string;
  sequence: string;
  /** False for an address the chain has never seen (account 0 / sequence 0 then). */
  exists: boolean;
  /** The key the chain recorded for this account, once it has signed. */
  pubKey: { typeUrl: string; key: string } | null;
  /** The account's `@type` (BaseAccount, a vesting account, EthAccount…). */
  accountType: string | null;
  updatedAt: number;
}

export interface SimulationAnswer {
  chainId: string;
  gasUsed: string;
  /** Always null: a limit-free simulation has no meaningful gas_wanted (see the route). */
  gasWanted: null;
  updatedAt: number;
}

export interface BroadcastAnswer {
  chainId: string;
  txHash: string;
  code: number;
  codespace: string;
  rawLog: string;
  success: boolean;
  updatedAt: number;
}

export type TxOutcomeAnswer = TxOutcome & { chainId: string; txHash: string; updatedAt: number };

/** A route answered with an error body (`{error, message}`), or not at all. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
  }
}

/** The chain ran the simulated transaction and it would fail. */
export class SimulationRefused extends Error {
  readonly reason: TxErrorKind;
  readonly rawLog: string | null;

  constructor(message: string, reason: TxErrorKind, rawLog: string | null) {
    super(message);
    this.name = "SimulationRefused";
    this.reason = reason;
    this.rawLog = rawLog;
  }
}

async function read<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const record = (body ?? {}) as { error?: unknown; message?: unknown; reason?: unknown; rawLog?: unknown };
    const message =
      typeof record.message === "string" && record.message.length < 1_200
        ? record.message
        : `Request failed (HTTP ${response.status})`;
    if (response.status === 422 && record.error === "simulation_failed") {
      throw new SimulationRefused(
        message,
        (typeof record.reason === "string" ? record.reason : "unknown") as TxErrorKind,
        typeof record.rawLog === "string" ? record.rawLog : null,
      );
    }
    throw new ApiFailure(response.status, typeof record.error === "string" ? record.error : "http_error", message);
  }
  if (body === null || typeof body !== "object") throw new ApiFailure(response.status, "parse", "The answer was not JSON");
  return body as T;
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { ...init, headers: { accept: "application/json", ...init?.headers } });
  } catch {
    throw new ApiFailure(0, "network", "The dashboard's server could not be reached. Check your connection.");
  }
  return read<T>(response);
}

export function fetchAccountInfo(chainId: string, address: string, signal?: AbortSignal): Promise<AccountInfo> {
  const qs = new URLSearchParams({ chainId, address });
  return call<AccountInfo>(`/api/account?${qs}`, { signal, cache: "no-store" });
}

export function fetchChainInfo(chainId: string): Promise<SuggestChainInfo> {
  return call<SuggestChainInfo>(`/api/account/chain-info?${new URLSearchParams({ chainId })}`);
}

export function simulateTx(chainId: string, txBytes: string): Promise<SimulationAnswer> {
  return call<SimulationAnswer>("/api/tx/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId, txBytes }),
  });
}

export function broadcastTx(chainId: string, txBytes: string, address?: string): Promise<BroadcastAnswer> {
  return call<BroadcastAnswer>("/api/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(address ? { chainId, txBytes, address } : { chainId, txBytes }),
  });
}

export function fetchTxOutcome(
  chainId: string,
  hash: string,
  options: { signal?: AbortSignal; address?: string } = {},
): Promise<TxOutcomeAnswer> {
  const qs = new URLSearchParams({ chainId });
  if (options.address) qs.set("address", options.address);
  return call<TxOutcomeAnswer>(`/api/tx/${encodeURIComponent(hash)}?${qs}`, {
    signal: options.signal,
    cache: "no-store",
  });
}
