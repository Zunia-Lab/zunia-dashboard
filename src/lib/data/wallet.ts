"use client";

/**
 * Wallet data hooks: a transaction's fate, an account's signer state, and the
 * fee a transaction would cost before anyone signs it.
 *
 * - `useTxStatus(chainId, hash)` polls `/api/tx/<hash>` every 2 s while the
 *   transaction is pending and stops once it is included (success or
 *   failure) or after `timeoutMs` (default 2 min), where it reports
 *   `pending` with `stalled: true` — still not a failure. With
 *   `options.address` (the signer) the final answer also drops the server's
 *   cached reads of that account, so balances refreshed afterwards are fresh.
 * - `useAccountInfo(chainId, address)` reads `/api/account` (never cached
 *   server-side; 5 s client dedupe).
 * - `useTxPreview(request)` simulates through `/api/tx/simulate` and prices
 *   the gas at the three fee tiers, without any wallet prompt (it uses
 *   `addressFor` / `pubKeyFor`). The sign flow measures again when it runs.
 *   Debounced (an amount typed digit by digit is one simulation, not six —
 *   the route is rate limited), and the previous preview stays on screen,
 *   flagged `stale`, while the next one is measured.
 */

import { useEffect, useMemo, useState } from "react";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/lib/connect/context";
import { apiUrl, useApi, type ApiError } from "@/lib/useApi";
import { toHex } from "@/lib/tx/bytes";
import type { AccountInfo, TxOutcomeAnswer } from "@/lib/tx/client";
import { explainError, explainTxError, type ExplainedTxError } from "@/lib/tx/errors";
import { previewTx, type TxPreview } from "@/lib/tx/flow";
import { resolveTxMemo } from "@/lib/tx/memo";
import { DASHBOARD_TX_API } from "@/lib/tx/useSignAndBroadcast";
import type { SignRequest, TxOutcome } from "@/lib/tx/types";

/* ------------------------------------------------------------------ tx status */

export interface TxStatusState {
  /** `idle` without a hash; otherwise the last known outcome's status. */
  status: TxOutcome["status"] | "idle";
  outcome: TxOutcomeAnswer | null;
  /** The chain's failure, in plain words. */
  explained: ExplainedTxError | null;
  /** Polling stopped before inclusion (the transaction may still land). */
  stalled: boolean;
  error: ApiError | null;
  refetch: () => void;
}

function parseOutcome(raw: unknown): TxOutcomeAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const status = (raw as { status?: unknown }).status;
  return status === "pending" || status === "success" || status === "failed" || status === "unknown"
    ? (raw as TxOutcomeAnswer)
    : null;
}

export function useTxStatus(
  chainId: string | null | undefined,
  hash: string | null | undefined,
  options: { pollMs?: number; timeoutMs?: number; address?: string | null } = {},
): TxStatusState {
  const pollMs = options.pollMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const valid = Boolean(chainId && hash && /^[0-9A-Fa-f]{64}$/.test(hash));
  const url = valid ? apiUrl(`/api/tx/${hash!.toUpperCase()}`, { chainId, address: options.address }) : null;

  // The watch window closes on a timer (set in an effect, flipped in its
  // callback), keyed by the URL so a new hash gets a fresh window.
  const [expiredFor, setExpiredFor] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    const timer = setTimeout(() => setExpiredFor(url), timeoutMs);
    return () => clearTimeout(timer);
  }, [url, timeoutMs]);
  const expired = url !== null && expiredFor === url;

  // Polling stops once the outcome is final. Recorded with a guarded
  // render-time update (React's "information from previous renders"
  // pattern), because the outcome comes out of the same hook the polling
  // interval goes into.
  const [finalFor, setFinalFor] = useState<string | null>(null);
  const state = useApi<TxOutcomeAnswer>(url, {
    parse: parseOutcome,
    persist: false,
    dedupeMs: 1_000,
    ...((url !== null && finalFor === url) || expired ? {} : { refreshMs: pollMs }),
  });
  const final = state.data?.status === "success" || state.data?.status === "failed";
  if (final && url !== null && finalFor !== url) setFinalFor(url);

  const outcome = state.data;
  const explained = useMemo(
    () =>
      outcome?.status === "failed"
        ? explainTxError(outcome.rawLog || `Failed with code ${outcome.code ?? "?"}`, {
            code: outcome.code ?? null,
            codespace: outcome.codespace ?? null,
          })
        : null,
    [outcome],
  );
  return {
    status: url ? (outcome?.status ?? "pending") : "idle",
    outcome,
    explained,
    stalled: expired && !final,
    error: state.error,
    refetch: state.refetch,
  };
}

/* ------------------------------------------------------------- account info */

function parseAccount(raw: unknown): AccountInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<AccountInfo>;
  return typeof record.accountNumber === "string" && typeof record.sequence === "string" ? (raw as AccountInfo) : null;
}

export function useAccountInfo(chainId: string | null | undefined, address: string | null | undefined) {
  const url = chainId && address ? apiUrl("/api/account", { chainId, address }) : null;
  return useApi<AccountInfo>(url, { parse: parseAccount, persist: false, dedupeMs: 5_000 });
}

/* ---------------------------------------------------------------- tx preview */

export interface TxPreviewState {
  preview: TxPreview | null;
  /** A measurement for the current request is running (the previous preview may still be shown). */
  loading: boolean;
  /** `preview` was measured for an earlier version of the request (shown dimmed while the new one runs). */
  stale: boolean;
  /** Why no preview: no address on the chain, the chain refused the transaction, no gas price… */
  error: ExplainedTxError | null;
}

/**
 * A stable key for a request (messages are bytes, so they are compared as
 * hex). The memo is the one that will be signed, a default included: its
 * length is part of the gas.
 */
function requestKey(req: SignRequest): string {
  return JSON.stringify([
    req.chainId,
    resolveTxMemo(req),
    req.feeTier ?? "average",
    req.gasLimit ?? null,
    req.gasAdjustment ?? null,
    req.timeoutHeight ?? null,
    req.messages.map((m) => [m.typeUrl, toHex(m.value)]),
  ]);
}

/** Quiet time before a changed request is measured. */
const PREVIEW_DEBOUNCE_MS = 350;

export function useTxPreview(request: SignRequest | null): TxPreviewState {
  const { addressFor, pubKeyFor, status } = useWallet();
  const key = request ? requestKey(request) : null;
  const [state, setState] = useState<{
    key: string | null;
    chainId: string | null;
    preview: TxPreview | null;
    error: ExplainedTxError | null;
  }>({ key: null, chainId: null, preview: null, error: null });

  useEffect(() => {
    if (!request || !key || status !== "connected") return;
    let live = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const chain = findChain(request.chainId);
          if (!chain) throw new Error(`${request.chainId} is not a network Zunia knows.`);
          const address = addressFor(request.chainId);
          if (!address) throw new Error(`Your wallet has no address on ${chain.chainName} yet.`);
          const preview = await previewTx(request, {
            api: DASHBOARD_TX_API,
            chain,
            address,
            pubKey: pubKeyFor(request.chainId),
          });
          if (live) setState({ key, chainId: request.chainId, preview, error: null });
        } catch (error) {
          if (live) setState({ key, chainId: request.chainId, preview: null, error: explainError(error) });
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `request` is captured through `key`, which changes whenever it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, status, addressFor, pubKeyFor]);

  // Nothing to measure without a wallet: not "loading" forever.
  if (!request || key === null || status === "disconnected") return { preview: null, loading: false, stale: false, error: null };
  const current = state.key === key;
  // An earlier preview is worth keeping on screen only for the same chain: a
  // fee in another chain's token is not "roughly" this one.
  const kept = current || state.chainId === request.chainId ? state.preview : null;
  return {
    preview: kept,
    loading: !current,
    stale: !current && kept !== null,
    error: current ? state.error : null,
  };
}
