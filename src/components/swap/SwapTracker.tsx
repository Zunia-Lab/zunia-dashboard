"use client";

/**
 * Where a cross-chain swap's funds are, after it was signed: each packet hop
 * read back from the chains (`/api/interchain/track`, polled until it
 * settles), in words that say what to do next.
 *
 * The four failures stay apart because the next step differs: a timeout or a
 * refused packet refunds by itself; a stalled packet only needs a relayer;
 * a delivery that failed after the swap leaves the output in the contract,
 * where only the recovery address (yours, on Osmosis) can pull it out, which
 * this card offers to sign.
 */

import { Icon } from "@/components/icons";
import { Badge, Button, Callout, ChainLogo, Spinner, type Tone } from "@/components/ui";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { cn } from "@/lib/cn";
import { findChain } from "@/lib/chains";
import { formatDuration } from "@/lib/format";
import { useTrace } from "@/lib/interchain/hooks";
import type { PacketStatusWire, RoutePlanWire } from "@/lib/interchain/wire";
import { buildExecuteContract } from "@/lib/tx/messages";
import { useSignAndBroadcast } from "@/lib/tx/useSignAndBroadcast";

const VENUE = SWAP_VENUE_CHAIN_ID;

const STATUS: Record<PacketStatusWire, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "neutral" },
  relayed: { label: "Relayed", tone: "info" },
  received: { label: "Received", tone: "info" },
  acknowledged: { label: "Done", tone: "success" },
  timeout: { label: "Timed out", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
};

function chainName(chainId: string | null): string {
  return chainId ? (findChain(chainId)?.chainName ?? chainId) : "the next chain";
}

export interface SwapTrackerProps {
  plan: RoutePlanWire;
  txHash: string;
  /** Base units of the first packet, to tell it apart in a busy transaction. */
  expectedAmount?: string;
  /** The contract path's recovery address (the user's Osmosis address). */
  recoveryAddress?: string | null;
  /** The contract the swap went through, for a recovery. */
  contractAddress?: string | null;
  className?: string;
}

export function SwapTracker({ plan, txHash, expectedAmount, recoveryAddress, contractAddress, className }: SwapTrackerProps) {
  const trace = useTrace({
    plan,
    sourceTxHash: txHash,
    ...(expectedAmount ? { expectedAmount } : {}),
    ...(recoveryAddress ? { recoveryAddress } : {}),
  });
  const recover = useSignAndBroadcast();
  const data = trace.data;
  const failure = data?.failure ?? null;
  const settled = data !== null && (data.status === "acknowledged" || data.status === "timeout" || data.status === "failed");
  const destination = chainName(plan.destChainId);

  let headline: string;
  let tone: Tone = "neutral";
  if (!data) {
    headline = trace.error ? "Can't read the transfer right now" : "Looking for your transaction…";
  } else if (failure === "swap-delivery-failed") {
    headline = "The swap ran, but the delivery failed";
    tone = "danger";
  } else if (failure === "timeout") {
    headline = "The transfer timed out and was refunded";
    tone = "warning";
  } else if (failure === "ack-error") {
    headline = "The destination refused the transfer; it was refunded";
    tone = "warning";
  } else if (data.status === "acknowledged") {
    headline = `Arrived on ${destination}`;
    tone = "success";
  } else if (failure === "stalled" || data.stalled) {
    headline = "Waiting for a relayer";
    tone = "warning";
  } else {
    const hop = data.hops[data.currentHopIndex];
    headline = hop ? `On its way: ${chainName(hop.chainId)} → ${chainName(hop.counterpartyChainId ?? (hop.kind === "swap" ? VENUE : null))}` : "On its way";
  }

  const canRecover = failure === "swap-delivery-failed" && Boolean(contractAddress) && Boolean(recoveryAddress);

  const runRecover = () => {
    if (!contractAddress || !recoveryAddress) return;
    void recover.submit({
      chainId: VENUE,
      messages: [
        buildExecuteContract({
          sender: recoveryAddress,
          contract: contractAddress,
          msg: { recover: {} },
          summary: "Recover your swap output from Zunia's swap contract",
        }),
      ],
      // No memo: the sign flow writes Zunia's default for this call,
      // "Recover swap - by Zunia-dashboard" (`@/lib/tx/memo`).
      // No forced mode: a contract call signs direct in Keplr and Zunia
      // Mobile, amino in the Zunia extension (`chooseSignMode`).
    });
  };

  return (
    <div className={cn("flex flex-col gap-3 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] p-3.5", className)} aria-live="polite">
      <div className="flex items-center gap-2.5">
        {settled || failure ? (
          <Icon
            name={tone === "success" ? "success" : tone === "danger" ? "danger" : "warning"}
            size={18}
            className={cn(tone === "success" ? "text-[var(--d-pos)]" : tone === "danger" ? "text-[var(--d-neg)]" : "text-[var(--z-warning)]")}
          />
        ) : (
          <Spinner size={16} className="text-fg-dim" />
        )}
        <p className="min-w-0 flex-1 text-[13.5px] font-medium text-fg">{headline}</p>
        {data?.elapsedSeconds !== null && data?.elapsedSeconds !== undefined ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-dim">{formatDuration(data.elapsedSeconds)}</span>
        ) : null}
      </div>

      {data && data.hops.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {data.hops.map((hop) => {
            const status = STATUS[hop.status];
            const target = hop.kind === "swap" ? null : hop.counterpartyChainId;
            return (
              <li key={hop.index} className="flex items-center gap-2 text-[12.5px]">
                <ChainLogo chainId={hop.chainId} size={18} />
                <span className="min-w-0 flex-1 truncate text-fg-muted">
                  {hop.kind === "swap"
                    ? `Swap on ${chainName(hop.chainId)}`
                    : `${chainName(hop.chainId)} → ${chainName(target)}${hop.channelId ? ` · ${hop.channelId}` : ""}`}
                </span>
                {hop.stalled ? (
                  <Badge tone="warning" size="sm">
                    Slow
                  </Badge>
                ) : null}
                <Badge tone={status.tone} size="sm" dot>
                  {status.label}
                </Badge>
              </li>
            );
          })}
        </ol>
      ) : null}

      {failure === "swap-delivery-failed" ? (
        <Callout
          tone="danger"
          title="Your output is safe in the swap contract"
          action={
            canRecover ? (
              <Button size="sm" variant="primary" loading={recover.busy} onClick={runRecover} disabled={recover.stage === "success"}>
                {recover.stage === "success" ? "Recovered" : "Recover on Osmosis"}
              </Button>
            ) : undefined
          }
        >
          Only your Osmosis address can pull it out. Recovering signs one contract call on Osmosis.
          {recover.error ? <span className="mt-1 block text-[var(--z-danger)]">{recover.error}</span> : null}
        </Callout>
      ) : failure === "stalled" || data?.stalled ? (
        <p className="text-[12.5px] leading-snug text-fg-dim">Nothing has failed: relayers sometimes take a few minutes. Funds stay safe either way.</p>
      ) : trace.error && !data ? (
        <p className="text-[12.5px] leading-snug text-fg-dim">{trace.error.message}</p>
      ) : null}
    </div>
  );
}
