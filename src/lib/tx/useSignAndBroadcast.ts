"use client";

/**
 * `useSignAndBroadcast()`: the one way a page signs.
 *
 *   const tx = useSignAndBroadcast();
 *   const result = await tx.submit({ chainId, messages: [buildSend({...})], memo });
 *   tx.stage  // "preparing" → "awaiting-signature" → "broadcasting" → "confirming" → "success" | "submitted" | "failed"
 *   tx.error  // plain words ("There was not enough balance…"), tx.explained for title/detail/kind
 *
 * Two ways to start, one state:
 * - `submit(req)` never rejects: it resolves with the result, or `null` when
 *   the attempt failed (the reason is in `error` / `explained`). What an
 *   `onClick` wants: no try/catch, no unhandled rejection.
 * - `run(req)` rejects with a `TxError` (`.explained`, `.txHash`, `.onChain`)
 *   for flows that branch on the failure in code.
 *
 * Wraps `signAndBroadcast` (`./flow`) with the connected wallet's signer and
 * the dashboard's routes, and refreshes every cached `/api/*` read after a
 * transaction that changed balances (success, or an on-chain failure that
 * still charged the fee). The signer's address goes with the broadcast and
 * the status polls, so the server drops its cached reads of that account and
 * the refresh is not served the pre-transaction balances.
 */

import { useCallback, useRef, useState } from "react";
import { findChain } from "@/lib/chains";
import { useWallet } from "@/lib/connect/context";
import { revalidateApi } from "@/lib/useApi";
import { broadcastTx, fetchAccountInfo, fetchTxOutcome, simulateTx } from "./client";
import { explainError, TxError, type ExplainedTxError } from "./errors";
import { signAndBroadcast, type TxApi } from "./flow";
import type { SignRequest, SignResult, SignStage } from "./types";

/** The dashboard's routes as the flow's `TxApi`. */
export const DASHBOARD_TX_API: TxApi = {
  getAccount: (chainId, address) => fetchAccountInfo(chainId, address),
  simulate: simulateTx,
  broadcast: broadcastTx,
  getTx: (chainId, hash, address) => fetchTxOutcome(chainId, hash, address ? { address } : {}),
};

export interface UseSignAndBroadcast {
  /** Prepare, sign, broadcast, confirm. Rejects with `TxError` (`.explained`, `.onChain`) on failure. */
  run: (req: SignRequest) => Promise<SignResult>;
  /** As `run`, but never rejects: `null` on failure (read `error` / `explained`). */
  submit: (req: SignRequest) => Promise<SignResult | null>;
  stage: SignStage;
  /** Plain-words reason of the last failure. */
  error: string | null;
  /** Title / message / chain detail / kind of the last failure. */
  explained: ExplainedTxError | null;
  /**
   * The hash once the chain has the transaction (accepted into a mempool, or
   * included). Null for a transaction a node refused before any block: no
   * explorer would find it.
   */
  txHash: string | null;
  result: SignResult | null;
  /** A run is in progress (a second `run` is refused meanwhile). */
  busy: boolean;
  reset: () => void;
}

export function useSignAndBroadcast(): UseSignAndBroadcast {
  const { signer } = useWallet();
  const [stage, setStage] = useState<SignStage>("idle");
  const [explained, setExplained] = useState<ExplainedTxError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [result, setResult] = useState<SignResult | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (req: SignRequest): Promise<SignResult> => {
      if (running.current) {
        // Not recorded in the hook's state: the attempt already running owns it.
        throw new TxError(explainError(new Error("A transaction is already waiting for your wallet.")));
      }
      running.current = true;
      setExplained(null);
      setTxHash(null);
      setResult(null);
      setStage("preparing");
      try {
        if (!signer) throw new Error("Connect a wallet first.");
        const chain = findChain(req.chainId);
        if (!chain) throw new Error(`${req.chainId} is not a network Zunia knows.`);
        const outcome = await signAndBroadcast(req, {
          signer,
          api: DASHBOARD_TX_API,
          chain,
          onStage: (next, detail) => {
            setStage(next);
            if (detail?.txHash) setTxHash(detail.txHash);
          },
        });
        setResult(outcome);
        revalidateApi("/api/");
        return outcome;
      } catch (error) {
        const failure = error instanceof TxError ? error : new TxError(explainError(error));
        setExplained(failure.explained);
        setStage("failed");
        // Included but failed: the fee was charged, so balances moved.
        if (failure.onChain) revalidateApi("/api/");
        throw failure;
      } finally {
        running.current = false;
      }
    },
    [signer],
  );

  const submit = useCallback(
    async (req: SignRequest): Promise<SignResult | null> => {
      try {
        return await run(req);
      } catch {
        // The failure is in `error` / `explained` (or, for a second click
        // while one runs, the first attempt's state is left as it is).
        return null;
      }
    },
    [run],
  );

  const reset = useCallback(() => {
    if (running.current) return;
    setStage("idle");
    setExplained(null);
    setTxHash(null);
    setResult(null);
  }, []);

  const busy = stage === "preparing" || stage === "awaiting-signature" || stage === "broadcasting" || stage === "confirming";
  return { run, submit, stage, error: explained?.message ?? null, explained, txHash, result, busy, reset };
}
