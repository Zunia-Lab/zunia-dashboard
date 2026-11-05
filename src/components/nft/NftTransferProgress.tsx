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

        {trace.loading && !trace.data ? (
          <div aria-busy="true">
            <span className="sr-only">Reading the transaction</span>
            <Skeleton className="h-16 w-full rounded-[var(--d-radius-inner)]" />
          </div>
        ) : null}
        {trace.status === "error" ? (
          <InlineError
            title="Status unavailable"
            message={`${trace.error?.message ?? "The read failed"}. The transaction itself was sent.`}
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
          Refresh token
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
        {trace.tx.rawLog || `Result code ${trace.tx.code ?? "unknown"}.`} The token is still yours.
      </Callout>
    );
  }
  if (trace.tx.state !== "success") {
    return (
      <Callout tone="neutral" title="Waiting for a block">
        Sent. This takes a few seconds.
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
      <Callout tone="warning" title="Transfer returned">
        The packet timed out. The token is back with you and no voucher was minted on {destination}.
      </Callout>
    );
  }
  if (packet.status === "failed" || packet.failure === "ack-error") {
    return (
      <Callout tone="danger" title="Rejected by the destination">
        {packet.error ?? "The receiving chain returned an error."}{" "}
        {packet.fundsRefunded ? "The token was released." : "Check that the token was released before signing anything else."}
      </Callout>
    );
  }
  if (packet.status === "acknowledged" || packet.status === "received") {
    return (
      <Callout tone="success" title={`A voucher was minted on ${destination}`}>
        Delivered{packet.receiveTxHash ? ` in ${packet.receiveTxHash.slice(0, 10)}…` : ""}. {who} holds the voucher; your token stays escrowed here until it is sent back.
      </Callout>
    );
  }
  return (
    <Callout tone="neutral" title="In flight">
      Escrowed here; packet {packet.sequence} left on {packet.sourceChannelId}.{" "}
      {trace.destinationQueried ? `${destination} hasn\u2019t acknowledged it yet.` : `${destination} couldn\u2019t be reached.`}
    </Callout>
  );
}
