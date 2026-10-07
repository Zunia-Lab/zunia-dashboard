"use client";

/**
 * An IBC packet of the transaction, as the stages it goes through: sent on
 * the source chain, received on the destination, acknowledged back on the
 * source (or timed out and refunded).
 *
 * What this transaction proves is shown as done. For a packet this
 * transaction *sent*, the rest is followed live: the same tracker the Bridge
 * page uses (`/api/interchain/track`) is given a one-hop plan built from the
 * packet's own channel, reads the destination chain, and polls until the
 * packet lands or fails. It answers with the receiving transaction's hash, so
 * the page can link it and time the hop. Stages nothing here can see are
 * marked "not tracked from here", never assumed.
 */

import Link from "next/link";
import { useMemo } from "react";
import {
  AddressText,
  Badge,
  ChainLogo,
  KeyValueList,
  RelativeTime,
  Spinner,
  Stepper,
  StatusBadge,
  TokenAmount,
  chainById,
  type Step,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import type { TxDetail, TxPacket } from "@/lib/activity/types";
import { useTrace } from "@/lib/interchain/hooks";
import type { HopTraceWire, RouteTraceWire } from "@/lib/interchain/wire";
import { formatDate, formatDuration, shortenHash } from "@/lib/format";
import { useTx } from "@/lib/useActivity";
import { packetIdentity, packetTimeout, trackPlanFor, txHref } from "./view";

export interface PacketLifecycleProps {
  tx: TxDetail;
  packet: TxPacket;
  now: number | null;
}

function chainName(chainId: string | undefined | null): string {
  if (!chainId) return "the other chain";
  return chainById(chainId)?.chainName ?? chainId;
}

/** "18 s after it was sent", from the receiving transaction's own block time. */
function ReceiveTiming({ chainId, hash, sentAt }: { chainId: string; hash: string; sentAt: number }) {
  const received = useTx(chainId, hash);
  const at = received.tx ? Date.parse(received.tx.time) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  const seconds = Math.max(0, (at - sentAt) / 1000);
  return (
    <>
      {" · "}
      {formatDate(at, "datetime")}
      {" · "}
      <span className="text-fg-muted">{formatDuration(seconds)} after it was sent</span>
    </>
  );
}

function ReceivedLink({ chainId, hash }: { chainId: string; hash: string }) {
  return (
    <Link href={txHref(chainId, hash)} className="font-mono text-[12px] text-[var(--d-accent-text)] underline-offset-[3px] hover:underline">
      {shortenHash(hash, 6, 4)}
    </Link>
  );
}

interface Lifecycle {
  steps: Step[];
  badge: { tone: "success" | "danger" | "warning" | "neutral" | "info"; label: string; live?: boolean };
}

/** Steps for a packet this transaction sent, from the live trace (or the plan while it loads). */
function sentLifecycle(tx: TxDetail, packet: TxPacket, hop: HopTraceWire | null, trace: RouteTraceWire | null, loading: boolean, failedRead: boolean): Lifecycle {
  const dest = chainName(packet.counterpartyChainId);
  const source = chainName(tx.chainId);
  const sentAt = Date.parse(tx.time);
  const sent: Step = { label: `Sent from ${source}`, state: "done", description: `This transaction · ${formatDate(sentAt, "datetime")}` };
  const receiveLink =
    hop?.receiveTxHash && packet.counterpartyChainId ? (
      <>
        <ReceivedLink chainId={packet.counterpartyChainId} hash={hop.receiveTxHash} />
        <ReceiveTiming chainId={packet.counterpartyChainId} hash={hop.receiveTxHash} sentAt={sentAt} />
      </>
    ) : null;

  if (!trace || !hop) {
    return {
      steps: [
        sent,
        {
          label: `Received on ${dest}`,
          state: failedRead ? "todo" : "current",
          description: failedRead ? "The destination chain couldn't be read just now." : loading ? "Checking the destination chain…" : "Not observed yet",
        },
        { label: `Acknowledged on ${source}`, state: "todo" },
      ],
      badge: failedRead ? { tone: "neutral", label: "Status unknown" } : { tone: "info", label: "Checking", live: true },
    };
  }

  switch (hop.status) {
    case "acknowledged":
      return {
        steps: [
          sent,
          { label: `Received on ${dest}`, state: "done", description: receiveLink ?? "Delivered" },
          { label: `Acknowledged on ${source}`, state: "done", description: "The transfer is final on both chains" },
        ],
        badge: { tone: "success", label: "Delivered" },
      };
    case "received":
    case "relayed":
      return {
        steps: [
          sent,
          { label: `Received on ${dest}`, state: "done", description: receiveLink ?? "Delivered" },
          { label: `Acknowledged on ${source}`, state: "current", description: hop.stalled ? "Taking longer than usual; funds are safe" : "Waiting for a relayer to confirm back" },
        ],
        badge: { tone: "success", label: "Delivered", live: true },
      };
    case "timeout":
      return {
        steps: [
          sent,
          { label: `Not delivered to ${dest}`, state: "error", description: "The packet expired before a relayer delivered it" },
          { label: `Refunded on ${source}`, state: hop.fundsRefunded ? "done" : "current", description: hop.fundsRefunded ? "The tokens went back to the sender" : "The refund lands when a relayer reports the timeout" },
        ],
        badge: { tone: "warning", label: hop.fundsRefunded ? "Timed out · refunded" : "Timed out" },
      };
    case "failed":
      return {
        steps: [
          sent,
          { label: `Rejected by ${dest}`, state: "error", description: hop.error ? `“${hop.error}”` : "The destination refused the packet" },
          { label: `Refunded on ${source}`, state: hop.fundsRefunded ? "done" : "current", description: hop.fundsRefunded ? "The tokens went back to the sender" : "The refund lands with the acknowledgement" },
        ],
        badge: { tone: "danger", label: hop.fundsRefunded ? "Rejected · refunded" : "Rejected" },
      };
    case "pending":
      return {
        steps: [
          sent,
          { label: `Received on ${dest}`, state: "current", description: hop.stalled || trace.stalled ? "Taking longer than usual; funds are safe until it lands or times out" : "Waiting for a relayer" },
          { label: `Acknowledged on ${source}`, state: "todo" },
        ],
        badge: hop.stalled || trace.stalled ? { tone: "warning", label: "Delayed", live: true } : { tone: "info", label: "In flight", live: true },
      };
    case "unknown":
    default:
      return {
        steps: [sent, { label: `Received on ${dest}`, state: "todo", description: "Its status could not be determined" }, { label: `Acknowledged on ${source}`, state: "todo" }],
        badge: { tone: "neutral", label: "Status unknown" },
      };
  }
}

/** Steps for a packet event this transaction recorded without sending it (relayer transactions). */
function recordedLifecycle(tx: TxDetail, packet: TxPacket): Lifecycle {
  const here = chainName(tx.chainId);
  const other = chainName(packet.counterpartyChainId);
  const at = formatDate(Date.parse(tx.time), "datetime");
  switch (packet.stage) {
    case "receive":
      return packet.ack === "error"
        ? {
            steps: [
              { label: `Sent from ${other}`, state: "done" },
              { label: `Rejected on ${here}`, state: "error", description: `This transaction · ${at}` },
              { label: `Refunded on ${other}`, state: "todo", description: "Not tracked from here" },
            ],
            badge: { tone: "danger", label: "Rejected" },
          }
        : {
            steps: [
              { label: `Sent from ${other}`, state: "done" },
              { label: `Received on ${here}`, state: "done", description: `This transaction · ${at}` },
              { label: `Acknowledged on ${other}`, state: "todo", description: "Not tracked from here" },
            ],
            badge: { tone: "success", label: "Received" },
          };
    case "acknowledge":
      return {
        steps: [
          { label: `Sent from ${here}`, state: "done" },
          { label: `Received on ${other}`, state: packet.ack === "error" ? "error" : "done", description: packet.ack === "error" ? "The destination refused it" : undefined },
          {
            label: packet.ack === "error" ? `Refunded on ${here}` : `Acknowledged on ${here}`,
            state: "done",
            description: `This transaction · ${at}`,
          },
        ],
        badge: packet.ack === "error" ? { tone: "danger", label: "Rejected · refunded" } : { tone: "success", label: "Acknowledged" },
      };
    case "timeout":
      return {
        steps: [
          { label: `Sent from ${here}`, state: "done" },
          { label: `Not delivered to ${other}`, state: "error", description: "The packet expired first" },
          { label: `Refunded on ${here}`, state: "done", description: `This transaction · ${at}` },
        ],
        badge: { tone: "warning", label: "Timed out · refunded" },
      };
    case "send":
    default:
      return {
        steps: [
          { label: `Sent from ${here}`, state: tx.success ? "done" : "error", description: `This transaction · ${at}` },
          { label: `Received on ${other}`, state: "todo", description: tx.success ? "Not tracked from here" : "Nothing was sent: the transaction failed" },
          { label: `Acknowledged on ${here}`, state: "todo" },
        ],
        badge: tx.success ? { tone: "neutral", label: "Sent" } : { tone: "danger", label: "Not sent" },
      };
  }
}

export function PacketLifecycle({ tx, packet, now }: PacketLifecycleProps) {
  const plan = useMemo(() => trackPlanFor(tx, packet), [tx, packet]);
  const input = useMemo(
    () => (plan ? { plan, sourceTxHash: tx.hash, ...(packet.amount ? { expectedAmount: packet.amount } : {}) } : null),
    [plan, tx.hash, packet.amount],
  );
  const trace = useTrace(input);
  const hop = trace.data?.hops[0] ?? null;

  const lifecycle = plan
    ? sentLifecycle(tx, packet, hop, trace.data, trace.loading, trace.status === "error")
    : recordedLifecycle(tx, packet);

  const identity = packetIdentity(packet, tx.movements);
  const fromChain = packet.stage === "receive" ? packet.counterpartyChainId : tx.chainId;
  const toChain = packet.stage === "receive" ? tx.chainId : packet.counterpartyChainId;
  const timeout = now !== null ? packetTimeout(packet.timeoutTimestamp, now) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-fg">
          <ChainLogo chainId={fromChain ?? undefined} size={22} />
          <span className="truncate">{chainName(fromChain)}</span>
          <Icon name="arrowRight" size={16} className="shrink-0 text-fg-dim" />
          <ChainLogo chainId={toChain ?? undefined} size={22} />
          <span className="truncate">{chainName(toChain)}</span>
          <Badge size="sm" className="ml-1 font-mono">
            #{packet.sequence}
          </Badge>
        </div>
        <span className="flex items-center gap-2">
          {lifecycle.badge.live && trace.loading ? <Spinner size={12} className="text-fg-dim" label="Checking" /> : null}
          <StatusBadge tone={lifecycle.badge.tone} pulse={lifecycle.badge.live && lifecycle.badge.tone !== "success"}>
            {lifecycle.badge.label}
          </StatusBadge>
        </span>
      </div>

      <Stepper steps={lifecycle.steps} orientation="vertical" />

      <KeyValueList
        divided
        className="rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3"
        items={[
          {
            key: "amount",
            label: "Amount",
            value: packet.amount ? (
              identity ? (
                <TokenAmount amount={packet.amount} decimals={identity.decimals} symbol={identity.ticker} />
              ) : (
                <span>
                  <TokenAmount amount={packet.amount} decimals={null} />{" "}
                  <span className="break-all font-mono text-[12px] text-fg-dim">{packet.denom}</span>
                </span>
              )
            ) : (
              "—"
            ),
          },
          ...(packet.sender ? [{ key: "sender", label: "From", value: <AddressText address={packet.sender} /> }] : []),
          ...(packet.receiver ? [{ key: "receiver", label: "To", value: <AddressText address={packet.receiver} /> }] : []),
          {
            key: "channels",
            label: "Channels",
            value: (
              <span className="font-mono text-[12.5px]">
                {packet.sourceChannel} → {packet.destChannel}
              </span>
            ),
            info: "The channel on the sending chain, then its counterpart on the receiving chain.",
          },
          {
            key: "timeout",
            label: "Timeout",
            value: timeout !== null ? formatDate(timeout, "datetime") : packet.timeoutTimestamp && packet.timeoutTimestamp !== "0" ? "None in practice" : "Not set",
            info: "If no relayer delivers the packet before this time, it expires and the tokens are refunded.",
          },
          ...(packet.memo ? [{ key: "memo", label: "Packet memo", value: <span className="break-all font-mono text-[12px]">{packet.memo}</span> }] : []),
        ]}
      />
      {trace.data?.notes.length ? (
        <ul className="flex flex-col gap-1 text-[12px] text-fg-dim">
          {trace.data.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {plan && trace.data?.updatedAt ? (
        <p className="text-[12px] text-fg-dim">
          {/* The shared clock ticks every 30 s; a read newer than its last
              tick would otherwise say "in under a minute". */}
          Read from both chains · <RelativeTime at={now !== null ? Math.min(trace.data.updatedAt, now) : trace.data.updatedAt} prefix="checked" />
          {trace.data.elapsedSeconds !== null && hop?.status === "pending" ? ` · in flight for ${formatDuration(trace.data.elapsedSeconds)}` : null}
        </p>
      ) : null}
    </div>
  );
}
