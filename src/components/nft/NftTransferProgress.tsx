"use client";

/**
 * What happened to an NFT transfer after it was signed.
 *
 * Two facts, kept apart, because collapsing them is how a UI reports success
 * for a token that is still in a bridge contract:
 *
 * - the transaction on the source chain, which says whether the contract call
 *   was accepted at all;
 * - for a cross-chain transfer, the ICS721 packet, which says whether the
 *   destination actually received it.
 *
 * A same-chain transfer has no packet and the transaction is the whole story.
 * A cross-chain transfer whose transaction succeeded is at the halfway point:
 * the token is escrowed and the voucher has not been minted yet. Every state
 * below names what the user's token is doing right now, including `timeout`,
 * where the bridge gives it back.
 *
 * Nothing is announced before it is read. Before the first poll answers, this
 * says the transaction was broadcast — which is the only thing that is true.
 */

import { useCallback, useState } from "react";
import { Button, Callout, Pill, SectionLabel, Skeleton } from "@zunialab/ui";
import { fillTemplate } from "@/lib/nft/parse-config";
import { useNftTrack } from "@/lib/nft/hooks";
import type { NftTrackWire } from "@/lib/nft/wire";

export interface NftTransferProgressProps {
  readonly chainId: string;
  readonly chainName: string;
  readonly txHash: string;
  readonly destChainId: string | null;
  readonly destChainName: string | null;
  readonly bridgeContract: string | null;
  readonly recipient: string;
  /** `ZUNIA_EXPLORER_TX` for this chain. Null renders the hash as plain text. */
  readonly txExplorerTemplate: string | null;
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
}: NftTransferProgressProps) {
  const [copied, setCopied] = useState(false);
  const trace = useNftTrack({
    chainId,
    hash: txHash,
    destChainId,
    bridgeContract,
  });

  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(txHash)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }, [txHash]);

  const explorerUrl = txExplorerTemplate
    ? fillTemplate(txExplorerTemplate, { hash: txHash, chainId })
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SectionLabel>Transaction on {chainName}</SectionLabel>

      <p className="m-0 font-mono text-[length:var(--z-type-meta)] break-all text-fg">
        {txHash}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy hash"}
        </Button>
        {explorerUrl ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={explorerUrl} target="_blank" rel="noreferrer noopener">
              Open in explorer
            </a>
          </Button>
        ) : (
          <span className="self-center font-mono text-[length:var(--z-type-micro)] text-fg-dim">
            No explorer is configured for {chainName}.
          </span>
        )}
      </div>

      {trace.loading && !trace.data ? (
        <div aria-busy="true">
          <span className="sr-only">Reading the transaction</span>
          <Skeleton className="h-20 w-full rounded-[14px]" />
        </div>
      ) : null}

      {trace.status === "error" ? (
        <Callout tone="warning" title="Status unavailable">
          {trace.error?.message} The transaction was broadcast; this is the read
          that failed.{" "}
          <button
            type="button"
            onClick={trace.reload}
            className="underline underline-offset-2"
          >
            Check again
          </button>
        </Callout>
      ) : null}

      {trace.data ? (
        <Outcome
          trace={trace.data}
          destChainName={destChainName}
          destChainId={destChainId}
          recipient={recipient}
        />
      ) : null}

      {trace.data?.notes.map((note) => (
        <p
          key={note}
          className="m-0 font-mono text-[length:var(--z-type-micro)] leading-relaxed text-fg-dim"
        >
          {note}
        </p>
      ))}
    </div>
  );
}

/** One callout per real state, each naming where the token is. */
function Outcome({
  trace,
  destChainName,
  destChainId,
  recipient,
}: {
  readonly trace: NftTrackWire;
  readonly destChainName: string | null;
  readonly destChainId: string | null;
  readonly recipient: string;
}) {
  const destination = destChainName ?? destChainId ?? "the destination chain";

  if (trace.tx.state === "failed") {
    return (
      <Callout tone="danger" title="Rejected by the chain">
        {trace.tx.rawLog ||
          `Result code ${trace.tx.code ?? "unknown"}.`}{" "}
        Nothing moved: the token is still yours, in the same collection.
      </Callout>
    );
  }

  if (trace.tx.state !== "success") {
    return (
      <Callout tone="neutral" title="Waiting for a block">
        Broadcast accepted. The node has not indexed it yet, which is normal for
        the first few seconds.
      </Callout>
    );
  }

  if (trace.packet === null) {
    return (
      <Callout tone="success" title="Transferred">
        In block {trace.tx.height ?? "—"}. {recipient} now owns this token.
      </Callout>
    );
  }

  const packet = trace.packet;

  if (packet.fundsRefunded || packet.status === "timeout") {
    return (
      <Callout tone="warning" title="The packet did not arrive; you got the token back">
        Packet {packet.sequence} on {packet.sourceChannelId} timed out, so the
        bridge released the escrow. The token is yours again on this chain and
        no voucher was minted on {destination}.
      </Callout>
    );
  }

  if (packet.status === "failed" || packet.failure === "ack-error") {
    return (
      <Callout tone="danger" title="The destination rejected the packet">
        {packet.error ?? "The receiving chain returned an error acknowledgement."}{" "}
        {packet.fundsRefunded
          ? "The bridge has released the escrow."
          : "Check whether the bridge has released the escrow before signing anything else."}
      </Callout>
    );
  }

  if (packet.status === "acknowledged" || packet.status === "received") {
    return (
      <Callout tone="success" title={`A voucher was minted on ${destination}`}>
        Packet {packet.sequence} was delivered
        {packet.receiveTxHash ? ` in ${packet.receiveTxHash}` : ""}. {recipient}{" "}
        holds a voucher NFT backed by your token, which stays escrowed in the
        bridge contract on this chain until the voucher is sent back.
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Callout tone="neutral" title="In flight">
        Your token is escrowed in the bridge contract on this chain. Packet{" "}
        {packet.sequence} left on {packet.sourceChannelId} and{" "}
        {trace.destinationQueried
          ? `${destination} has not acknowledged it yet.`
          : `${destination} could not be queried, so only this chain's side is known.`}
      </Callout>
      <Pill tone="neutral">
        {packet.sourcePort} · packet {packet.sequence}
      </Pill>
    </div>
  );
}
