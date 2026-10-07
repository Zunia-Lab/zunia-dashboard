"use client";

/**
 * What happened to an NFT transfer after it was signed.
 *
 * Two facts, kept apart, because collapsing them is how a UI reports success
 * for a token that is still in a bridge contract:
 *
 * - the transaction on the source chain: was the contract call accepted;
 * - for a cross-chain transfer, the ICS721 packet: did the destination
 *   receive it.
 *
 * A same-chain transfer has no packet and the transaction is the whole story.
 * A cross-chain transfer whose transaction succeeded is halfway: the token is
 * escrowed and the voucher not minted yet. Every state names where the token
 * is right now, including a timeout, where the bridge gives it back. Nothing
 * is announced before it is read: until the first answer, the transaction
 * was broadcast, which is all that is known.
 */

import { Button, Callout, Card, CardBody, CardHeader, CopyButton, ExternalLink, InlineError, Skeleton, StatusBadge } from "@/components/ui";
import { shortenAddress } from "@/lib/format";
import { useNftTrack } from "@/lib/nft/hooks";
import { fillTemplate } from "@/lib/nft/parse-config";
import type { NftTrackWire } from "@/lib/nft/wire";

export interface NftTransferProgressProps {
  chainId: string;
  chainName: string;
  txHash: string;
  destChainId: string | null;
  destChainName: string | null;
  bridgeContract: string | null;
  recipient: string;
  /** This chain's tx explorer template; null leaves the hash as text. */
  txExplorerTemplate: string | null;
  /** Re-reads the token from the chain (its owner). */
  onReread: () => void;
}

export function NftTransferProgress({
  chainId,
  chainName,
  txHash,
  destChainId,
  destChainName,
  bridgeContract,
  recipient,
  txExplorerTemplate,
  onReread,
}: NftTransferProgressProps) {
  const trace = useNftTrack({ chainId, hash: txHash, destChainId, bridgeContract });
  const explorerUrl = txExplorerTemplate ? fillTemplate(txExplorerTemplate, { hash: txHash, chainId }) : null;
  const state = trace.data ? stateOf(trace.data) : null;

  return (
    <Card as="section" aria-label="Transfer status">
      <CardHeader
        title="Transfer status"
        subtitle={`Transaction on ${chainName}`}
        icon="activity"
        refreshing={trace.loading && trace.data !== null}
        actions={state ? <StatusBadge tone={state.tone}>{state.label}</StatusBadge> : null}
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg" title={txHash}>
            {txHash}
          </span>
          <CopyButton value={txHash} label="transaction hash" />
          {explorerUrl ? (
            <ExternalLink href={explorerUrl} className="shrink-0 text-[12.5px]">
              Explorer
            </ExternalLink>
          ) : null}
        </div>
        {!explorerUrl ? <p className="text-[12px] text-fg-dim">No explorer is configured for {chainName}, so the hash is shown as text.</p> : null}

        {trace.loading && !trace.data ? (
          <div aria-busy="true">
            <span className="sr-only">Reading the transaction</span>
            <Skeleton className="h-16 w-full rounded-[var(--d-radius-inner)]" />
          </div>
        ) : null}
        {trace.status === "error" ? (
          <InlineError
            title="Status unavailable"
            message={`${trace.error?.message ?? "The read failed"}. The transaction was broadcast; this is the read that failed.`}
            onRetry={trace.reload}
          />
        ) : null}
        {trace.data ? <Outcome trace={trace.data} destination={destChainName ?? destChainId ?? "the destination chain"} recipient={recipient} /> : null}
        {trace.data?.notes.map((note) => (
          <p key={note} className="text-[12.5px] leading-snug text-fg-dim">
            {note}
          </p>
        ))}
        <Button size="sm" variant="secondary" iconLeft="refresh" className="self-start" onClick={onReread}>
          Re-read this token from the chain
        </Button>
      </CardBody>
    </Card>
  );
}

function stateOf(trace: NftTrackWire): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (trace.tx.state === "failed") return { label: "Rejected", tone: "danger" };
  if (trace.tx.state !== "success") return { label: "Waiting for a block", tone: "neutral" };
  const packet = trace.packet;
  if (!packet) return { label: "Transferred", tone: "success" };
  if (packet.fundsRefunded || packet.status === "timeout") return { label: "Returned", tone: "warning" };
  if (packet.status === "failed" || packet.failure === "ack-error") return { label: "Rejected there", tone: "danger" };
  if (packet.status === "acknowledged" || packet.status === "received") return { label: "Voucher minted", tone: "success" };
  return { label: "In flight", tone: "neutral" };
}

/** One callout per real state, each naming where the token is. */
function Outcome({ trace, destination, recipient }: { trace: NftTrackWire; destination: string; recipient: string }) {
  const who = shortenAddress(recipient, 12, 6);
  if (trace.tx.state === "failed") {
    return (
      <Callout tone="danger" title="Rejected by the chain">
        {trace.tx.rawLog || `Result code ${trace.tx.code ?? "unknown"}.`} Nothing moved: the token is still yours, in the same collection.
      </Callout>
    );
  }
  if (trace.tx.state !== "success") {
    return (
      <Callout tone="neutral" title="Waiting for a block">
        Broadcast accepted. The node has not indexed it yet, which is normal for the first few seconds.
      </Callout>
    );
  }
  const packet = trace.packet;
  if (packet === null) {
    return (
      <Callout tone="success" title="Transferred">
        In block {trace.tx.height ?? "—"}. {who} now owns this token.
      </Callout>
    );
  }
  if (packet.fundsRefunded || packet.status === "timeout") {
    return (
      <Callout tone="warning" title="The packet did not arrive; the token came back">
        Packet {packet.sequence} on {packet.sourceChannelId} timed out, so the bridge released the escrow. The token is yours again on this chain
        and no voucher was minted on {destination}.
      </Callout>
    );
  }
  if (packet.status === "failed" || packet.failure === "ack-error") {
    return (
      <Callout tone="danger" title="The destination rejected the packet">
        {packet.error ?? "The receiving chain returned an error acknowledgement."}{" "}
        {packet.fundsRefunded ? "The bridge has released the escrow." : "Check that the bridge released the escrow before signing anything else."}
      </Callout>
    );
  }
  if (packet.status === "acknowledged" || packet.status === "received") {
    return (
      <Callout tone="success" title={`A voucher was minted on ${destination}`}>
        Packet {packet.sequence} was delivered{packet.receiveTxHash ? ` in ${packet.receiveTxHash.slice(0, 10)}…` : ""}. {who} holds a voucher NFT backed by
        your token, which stays escrowed in the bridge contract here until the voucher is sent back.
      </Callout>
    );
  }
  return (
    <Callout tone="neutral" title="In flight">
      Your token is escrowed in the bridge contract on this chain. Packet {packet.sequence} left on {packet.sourceChannelId} ({packet.sourcePort}),
      and{" "}
      {trace.destinationQueried ? `${destination} has not acknowledged it yet.` : `${destination} could not be asked, so only this chain's side is known.`}
    </Callout>
  );
}
