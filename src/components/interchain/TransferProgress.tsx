"use client";

/**
 * Hop-by-hop status for a transfer the user has already signed.
 *
 * Everything shown is the engine's judgement, passed through: `hop.status` and
 * `hop.stalled` from `RouteHopTrace`, `failure` and `recovery` from
 * `RouteTrace`. No clock runs here — a swap hop and a forward hop do not take
 * the same time, and the engine already knows the per-hop-kind threshold.
 *
 * No explorer link is offered. The chain catalog carries no explorer URLs, so
 * every hash renders as selectable text with a copy control; a made-up explorer
 * domain would be worse than none.
 */

import { useCallback, useMemo, useState } from "react";
import { Button, Callout, PacketTracker, Skeleton } from "@zunialab/ui";
import { findChain } from "@/lib/chains";
import { useTrace } from "@/lib/interchain/hooks";
import type { RoutePlanWire, RouteTraceWire } from "@/lib/interchain/wire";

export interface TransferProgressProps {
  readonly plan: RoutePlanWire;
  readonly sourceTxHash: string;
  /** Base units, so a relayer batching several packets can be told apart. */
  readonly expectedAmount?: string;
  /** The `local_recovery_addr` the swap was built with, when there was one. */
  readonly recoveryAddress?: string;
  /**
   * Sign and broadcast `{"recover":{}}` on the venue chain.
   *
   * Omitted when this client cannot sign it — the control is then disabled with
   * `recoverDisabledReason`, never hidden. The funds are still recoverable;
   * they are just not recoverable from here.
   */
  readonly onRecover?: (recovery: NonNullable<RouteTraceWire["recovery"]>) => void;
  readonly recoverDisabledReason?: string | null;
  readonly recovering?: boolean;
  readonly recoverError?: string | null;
  readonly recoverTxHash?: string | null;
}

export function TransferProgress({
  plan,
  sourceTxHash,
  expectedAmount,
  recoveryAddress,
  onRecover,
  recoverDisabledReason,
  recovering = false,
  recoverError,
  recoverTxHash,
}: TransferProgressProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const trace = useTrace({
    plan,
    sourceTxHash,
    ...(expectedAmount ? { expectedAmount } : {}),
    ...(recoveryAddress ? { recoveryAddress } : {}),
  });

  const copy = useCallback((hash: string) => {
    void navigator.clipboard
      ?.writeText(hash)
      .then(() => setCopied(hash))
      .catch(() => setCopied(null));
  }, []);

  const hops = useMemo(() => {
    const rows = trace.data?.hops;
    if (rows && rows.length > 0) {
      return rows.map((hop) => ({
        chainId: hop.chainId,
        chainName: findChain(hop.chainId)?.chainName,
        chainIconUrl: findChain(hop.chainId)?.iconUrl,
        counterpartyChainId: hop.counterpartyChainId,
        counterpartyChainName: hop.counterpartyChainId
          ? findChain(hop.counterpartyChainId)?.chainName
          : undefined,
        channelId: hop.channelId,
        port: hop.port,
        sequence: hop.sequence,
        sendTxHash: hop.sendTxHash,
        receiveTxHash: hop.receiveTxHash,
        status: hop.status,
        error: hop.error,
        stalled: hop.stalled,
      }));
    }
    // Before the first read lands, the plan's own hops are shown as `pending`.
    // That is what they are: the transaction is broadcast and nothing has been
    // observed yet. It is not a claim about progress.
    return plan.hops.map((hop) => ({
      chainId: hop.chainId,
      chainName: findChain(hop.chainId)?.chainName,
      chainIconUrl: findChain(hop.chainId)?.iconUrl,
      counterpartyChainId: hop.counterpartyChainId,
      channelId: hop.channelId,
      port: hop.port,
      status: "pending" as const,
    }));
  }, [trace.data, plan.hops]);

  const recovery = trace.data?.recovery ?? null;
  const canRecover = Boolean(onRecover) && recovery?.ready === true;
  const disabledReason = (() => {
    if (recoverTxHash) return "Recovery already broadcast.";
    if (recovering) return null;
    if (!recovery) return null;
    if (!recovery.ready) return null; // PacketTracker's own copy covers this.
    if (!onRecover) {
      return (
        recoverDisabledReason ??
        "This wallet connection cannot sign a contract call, so the recovery has to be made from another Zunia client."
      );
    }
    return recoverDisabledReason ?? null;
  })();

  if (trace.status === "loading" && !trace.data) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Reading packet status</span>
        <Skeleton className="h-32 w-full rounded-[14px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PacketTracker
        hops={hops}
        sourceTxHash={sourceTxHash}
        sourceChainId={plan.sourceChainId}
        failure={trace.data?.failure ?? null}
        recoveryReady={recovery?.ready ?? false}
        {...(canRecover && recovery
          ? { onRecover: () => onRecover?.(recovery) }
          : {})}
        recoverLabel={recovering ? "Recovering…" : "Recover funds"}
        recoverDisabledReason={disabledReason}
        onCopyTxHash={copy}
        error={trace.status === "error" ? (trace.error?.message ?? null) : null}
        onRefresh={trace.reload}
        lastUpdatedAt={trace.data?.updatedAt ?? null}
        footer={
          <div className="flex flex-col gap-2">
            {copied ? (
              <p
                className="font-mono text-[length:var(--z-type-micro)] text-fg-dim"
                role="status"
              >
                Copied {copied.slice(0, 10)}…
              </p>
            ) : null}
            {trace.data?.notes.map((note) => (
              <p
                key={note}
                className="font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
              >
                {note}
              </p>
            ))}
          </div>
        }
      />

      {recoverError ? (
        <Callout tone="danger" title="Recovery failed">
          {recoverError}
        </Callout>
      ) : null}

      {recoverTxHash ? (
        <Callout tone="success" title="Recovery broadcast">
          <span className="font-mono break-all">{recoverTxHash}</span>
        </Callout>
      ) : null}

      {trace.status === "error" ? (
        <Button variant="secondary" size="sm" onClick={trace.reload}>
          Check again
        </Button>
      ) : null}
    </div>
  );
}
