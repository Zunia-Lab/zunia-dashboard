"use client";

/**
 * A signed IBC transfer, followed hop by hop until the funds land or come
 * back.
 *
 * Every judgement is the engine's (`/api/interchain/track` → `trackRoute`):
 * each hop's status and `stalled` flag, the route's failure. The words for
 * them are `@zunialab/ui`'s (`packetFundsSummary`, `packetStatusPresentation`),
 * the same sentences the extension shows, because the user's next action
 * differs in every outcome: wait, wait and check back, nothing (it arrived),
 * nothing (it came back), or claim it. Nothing here runs a clock to decide
 * that a packet is late.
 *
 * Two faces: the full tracker (the result card after signing) and a compact
 * row (`PendingTransferRow`, the Bridge's "In flight" list and the top bar's
 * Live popover), which reads one entry of the pending-transfer store and
 * writes its status back as the chains report it, or, with `poll={false}`,
 * only reads it while the frame's watcher (`PendingTransfersWatcher`) does
 * the polling: one poller per transfer, however many lists show it.
 */

import { useEffect, useMemo, useState } from "react";
import {
  packetFundsSummary,
  packetStatusPresentation,
  resolveHopStatus,
  type PacketFailureKind,
  type PacketHopStatus,
} from "@zunialab/ui";
import { Icon } from "@/components/icons";
import {
  Badge,
  Button,
  ChainLogo,
  CopyButton,
  ExternalLink,
  IconButton,
  RelativeTime,
  Skeleton,
  TokenAmount,
  useNow,
  type Tone,
} from "@/components/ui";
import { explorerTxUrl } from "@/config/interchain";
import { cn } from "@/lib/cn";
import { formatDuration, shortenHash } from "@/lib/format";
import { useTrace } from "@/lib/interchain/hooks";
import type { RoutePlanWire, RouteTraceWire } from "@/lib/interchain/wire";
import {
  isInFlight,
  isSettled,
  pendingTransfers,
  statusFromTrace,
  usePendingTransfers,
  type PendingTransfer,
  type PendingTransferStatus,
} from "@/lib/pending-transfers";
import { chainName as nameOfChain } from "./names";

const chainName = (chainId: string | null | undefined) => nameOfChain(chainId, "Unknown chain");

/** The engine's failure, including the one the wire format does not carry (see `statusFromTrace`). */
function failureOf(trace: RouteTraceWire | null): PacketFailureKind | null {
  if (!trace) return null;
  const first = trace.hops[0];
  if (first && first.status === "failed" && first.sequence === null) return "source-failed";
  return trace.failure;
}

/** 0 (not sent) … 3 (acknowledged) per hop; null for a failed hop. */
function hopStage(status: PacketHopStatus, sent: boolean): number | null {
  if (status === "failed" || status === "timeout") return null;
  if (status === "acknowledged") return 3;
  if (status === "received") return 2;
  return sent ? 1 : 0;
}

const STATUS_TONE: Record<PendingTransferStatus, Tone> = {
  "in-flight": "info",
  stalled: "warning",
  arrived: "success",
  returned: "warning",
  failed: "danger",
  recoverable: "warning",
};

const STATUS_LABEL: Record<PendingTransferStatus, string> = {
  "in-flight": "Moving",
  stalled: "Stuck, funds safe",
  arrived: "Arrived",
  returned: "Returned",
  failed: "Failed",
  recoverable: "Action needed",
};

export function TransferStatusBadge({ status, className }: { status: PendingTransferStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot pulse={status === "in-flight"} className={className}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

interface TraceView {
  trace: RouteTraceWire | null;
  status: PendingTransferStatus;
  /** 0..1 across every hop's sent → received → acknowledged. */
  progress: number;
  hops: {
    chainId: string;
    counterpartyChainId: string | null;
    channelId: string;
    port: string;
    sequence: string | null;
    sendTxHash: string | null;
    receiveTxHash: string | null;
    status: PacketHopStatus;
    stage: number | null;
    error: string | null;
  }[];
  summary: ReturnType<typeof packetFundsSummary>;
}

function viewOf(plan: RoutePlanWire, trace: RouteTraceWire | null, fallback: PendingTransferStatus): TraceView {
  const rows =
    trace && trace.hops.length > 0
      ? trace.hops.map((hop) => {
          const status = resolveHopStatus(hop.status, hop.stalled);
          return {
            chainId: hop.chainId,
            counterpartyChainId: hop.counterpartyChainId,
            channelId: hop.channelId,
            port: hop.port,
            sequence: hop.sequence,
            sendTxHash: hop.sendTxHash,
            receiveTxHash: hop.receiveTxHash,
            status,
            stage: hopStage(status, Boolean(hop.sendTxHash || hop.sequence)),
            error: hop.error,
          };
        })
      : plan.hops.map((hop) => ({
          chainId: hop.chainId,
          counterpartyChainId: hop.counterpartyChainId,
          channelId: hop.channelId,
          port: hop.port,
          sequence: null,
          sendTxHash: null,
          receiveTxHash: null,
          status: "pending" as PacketHopStatus,
          stage: 0,
          error: null,
        }));
  const total = rows.length * 3;
  const done = rows.reduce((sum, row) => sum + (row.stage ?? 0), 0);
  const status = statusFromTrace(trace) ?? fallback;
  return {
    trace,
    status,
    progress: status === "arrived" ? 1 : total > 0 ? done / total : 0,
    hops: rows,
    summary: packetFundsSummary(rows, { failure: failureOf(trace), recoveryReady: trace?.recovery?.ready ?? false }),
  };
}

/** Follow one transfer; keeps the pending store's status in step when `id` is given. */
function useTracked(input: { plan: RoutePlanWire; sourceTxHash: string; expectedAmount?: string; recoveryAddress?: string; id?: string; fallback?: PendingTransferStatus }) {
  const { plan, sourceTxHash, expectedAmount, recoveryAddress, id, fallback = "in-flight" } = input;
  const trace = useTrace({
    plan,
    sourceTxHash,
    ...(expectedAmount ? { expectedAmount } : {}),
    ...(recoveryAddress ? { recoveryAddress } : {}),
  });
  const view = useMemo(() => viewOf(plan, trace.data, fallback), [plan, trace.data, fallback]);
  const reading = trace.data ? view.status : null;
  const progress = trace.data ? view.progress : undefined;
  useEffect(() => {
    if (id && reading) pendingTransfers.update(id, reading, progress);
  }, [id, reading, progress]);
  return { trace, view };
}

const PROGRESS_TONE: Record<PendingTransferStatus, string> = {
  "in-flight": "bg-[image:var(--z-accent-gradient)]",
  stalled: "bg-[var(--z-warning)]",
  arrived: "bg-[var(--z-success)]",
  returned: "bg-[var(--z-warning)]",
  failed: "bg-[var(--z-danger)]",
  recoverable: "bg-[var(--z-warning)]",
};

function ProgressLine({ status, progress, className }: { status: PendingTransferStatus; progress: number; className?: string }) {
  const settledBad = status === "returned" || status === "failed";
  return (
    <div
      role="progressbar"
      aria-label="Transfer progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className={cn("relative h-1.5 overflow-hidden rounded-full bg-[var(--d-glass-2)]", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-[450ms] ease-[var(--d-ease)]", PROGRESS_TONE[status])}
        style={{ width: `${Math.max(settledBad ? 100 : progress * 100, status === "in-flight" ? 6 : 0)}%` }}
      />
    </div>
  );
}

function HashRef({ label, chainId, hash }: { label: string; chainId: string; hash: string }) {
  const url = explorerTxUrl(chainId, hash);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="text-fg-dim">{label}</span>
      {url ? (
        <ExternalLink href={url} showIcon={false} className="font-mono text-[11.5px] text-fg-muted hover:text-fg">
          {shortenHash(hash, 6, 4)}
        </ExternalLink>
      ) : (
        <span className="font-mono text-[11.5px] text-fg-muted" title={hash}>
          {shortenHash(hash, 6, 4)}
        </span>
      )}
      <CopyButton value={hash} label={`${label.toLowerCase()} transaction hash`} />
    </span>
  );
}

const STAGES = ["Sent", "Received", "Acknowledged"];

/** The packet timeout (10 min) plus a margin. */
const OVERDUE_MS = 20 * 60_000;

export interface TransferTrackerProps {
  plan: RoutePlanWire;
  sourceTxHash: string;
  expectedAmount?: string;
  recoveryAddress?: string;
  /** Pending-store id: the tracker writes the status it reads back to the store. */
  pendingId?: string;
  /** Recovery for a crosschain swap whose payout failed (swap pages only). */
  onRecover?: (recovery: NonNullable<RouteTraceWire["recovery"]>) => void;
  recoverDisabledReason?: string | null;
  recovering?: boolean;
  className?: string;
}

/** The full tracker: outcome in words, progress, each hop with its hashes. */
export function TransferTracker({
  plan,
  sourceTxHash,
  expectedAmount,
  recoveryAddress,
  pendingId,
  onRecover,
  recoverDisabledReason,
  recovering,
  className,
}: TransferTrackerProps) {
  const { trace, view } = useTracked({ plan, sourceTxHash, expectedAmount, recoveryAddress, id: pendingId });
  const now = useNow();
  const elapsed = trace.data?.elapsedSeconds ?? null;
  const estimate = Math.max(plan.estimatedDurationSeconds, 30);
  const tone = view.summary.tone;
  const recovery = trace.data?.recovery ?? null;

  if (trace.status === "loading" && !trace.data) {
    return (
      <div className={cn("flex flex-col gap-3", className)} aria-busy="true">
        <span className="sr-only">Reading the transfer status</span>
        <Skeleton className="h-4" width="40%" />
        <Skeleton className="h-1.5" width="100%" />
        <Skeleton className="h-12 rounded-[var(--d-radius-inner)]" width="100%" />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3.5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-[15px] font-medium text-fg">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                tone === "success" && "bg-[var(--z-success)]",
                tone === "info" && "bg-[var(--z-info)] animate-pulse",
                tone === "warning" && "bg-[var(--z-warning)]",
                tone === "danger" && "bg-[var(--z-danger)]",
                tone === "neutral" && "bg-fg-dim",
              )}
            />
            {view.summary.title}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{view.summary.detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[12px] tabular-nums text-fg-dim">
          {/* The engine's per-hop estimate, not a measurement: said as such. */}
          {elapsed !== null ? (
            <span>
              {formatDuration(elapsed)} elapsed{isSettled(view.status) ? "" : ` · est. ~${formatDuration(estimate)}`}
            </span>
          ) : now !== null ? (
            <span>est. ~{formatDuration(estimate)}</span>
          ) : null}
          <IconButton label="Check again" icon="refresh" size="sm" loading={trace.loading && Boolean(trace.data)} onClick={trace.reload} />
        </div>
      </div>

      <ProgressLine status={view.status} progress={view.progress} />

      <ol className="flex flex-col gap-2" aria-label="Hops">
        {view.hops.map((hop, index) => {
          const presentation = packetStatusPresentation(hop.status);
          return (
            <li key={`${hop.chainId}-${hop.channelId}-${index}`} className="rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <span className="flex items-center gap-1.5">
                  <ChainLogo chainId={hop.chainId} size={20} />
                  <span className="text-[13px] font-medium text-fg">{chainName(hop.chainId)}</span>
                </span>
                <Icon name="arrowRight" size={13} className="text-fg-dim" />
                <span className="flex items-center gap-1.5">
                  <ChainLogo chainId={hop.counterpartyChainId ?? plan.destChainId} size={20} />
                  <span className="text-[13px] font-medium text-fg">{chainName(hop.counterpartyChainId ?? plan.destChainId)}</span>
                </span>
                <span className="font-mono text-[11px] text-fg-dim">{hop.channelId}</span>
                <Badge
                  tone={presentation.tone === "neutral" ? "neutral" : presentation.tone}
                  size="sm"
                  className="ml-auto"
                  title={presentation.detail}
                >
                  {presentation.label}
                </Badge>
              </div>
              <ol className="mt-2.5 grid grid-cols-3 gap-1.5" aria-label={`Hop ${index + 1} stages`}>
                {STAGES.map((stage, stageIndex) => {
                  const reached = hop.stage !== null && hop.stage > stageIndex;
                  const failedHere = hop.stage === null && stageIndex === 1;
                  return (
                    <li key={stage} className="flex min-w-0 flex-col gap-1">
                      <span
                        aria-hidden
                        className={cn(
                          "h-1 rounded-full",
                          reached ? "bg-[var(--z-success)]" : failedHere ? "bg-[var(--z-danger)]" : "bg-[var(--d-glass-2)]",
                        )}
                      />
                      <span className={cn("truncate text-[11.5px]", reached ? "text-fg-muted" : "text-fg-dim")}>
                        {stage}
                        <span className="sr-only">{reached ? ", done" : ", not yet"}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              {hop.sendTxHash || hop.receiveTxHash || hop.sequence ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                  {hop.sequence ? <span className="font-mono text-fg-dim">seq {hop.sequence}</span> : null}
                  {hop.sendTxHash ? <HashRef label="Sent" chainId={hop.chainId} hash={hop.sendTxHash} /> : null}
                  {hop.receiveTxHash ? (
                    <HashRef label="Received" chainId={hop.counterpartyChainId ?? plan.destChainId} hash={hop.receiveTxHash} />
                  ) : null}
                </div>
              ) : null}
              {hop.error ? <p className="mt-2 text-[12px] leading-snug text-[var(--z-danger)]">{hop.error}</p> : null}
            </li>
          );
        })}
      </ol>

      {trace.status === "error" ? (
        <p className="text-[12.5px] leading-snug text-fg-muted">
          The status could not be read ({trace.error?.message ?? "no answer"}). The transfer itself is unaffected; only this view of it
          is.
        </p>
      ) : null}
      {trace.data?.notes.length ? (
        <ul className="flex flex-col gap-0.5">
          {trace.data.notes.map((note) => (
            <li key={note} className="font-mono text-[11px] leading-relaxed text-fg-dim">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      {recovery ? (
        <div className="flex flex-col gap-2 rounded-[var(--d-radius-inner)] border border-[var(--z-warning-line)] bg-[var(--z-warning-fill)] px-3.5 py-3">
          <p className="text-[13px] leading-snug text-fg-muted">{view.summary.detail}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={recovering}
              disabled={!onRecover || !recovery.ready || Boolean(recoverDisabledReason)}
              onClick={() => onRecover?.(recovery)}
            >
              Recover funds
            </Button>
            {recoverDisabledReason || !onRecover ? (
              <span className="text-[12px] text-fg-dim">
                {recoverDisabledReason ?? "This connection cannot sign the recovery; use another Zunia client."}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One in-flight transfer as a compact row: who, how much, where, how far.
 * Reads and writes the pending store; polls only until it settles.
 */
export interface PendingTransferRowProps {
  transfer: PendingTransfer;
  /** Offer "Remove" once the transfer has settled. */
  onRemove?: () => void;
  /** Let the row open the full hop-by-hop tracker (default true; a narrow popover may turn it off). */
  expandable?: boolean;
  /**
   * Poll the chains for this transfer (default true). Off where the frame's
   * `PendingTransfersWatcher` already follows every in-flight transfer: the
   * row then draws the store, which the watcher keeps current. A transfer
   * waiting on the user ("Action needed"), which the watcher leaves alone,
   * is still read by the row.
   */
  poll?: boolean;
  className?: string;
}

export function PendingTransferRow({ transfer, onRemove, expandable = true, poll = true, className }: PendingTransferRowProps) {
  const [open, setOpen] = useState(false);
  const toggle = expandable ? () => setOpen((value) => !value) : undefined;
  // One tracker per transfer at a time: while the full tracker is open it is
  // the one polling (and writing the store), and the row reads the store.
  const live = !isSettled(transfer.status) && !open && (poll || !isInFlight(transfer.status));
  return (
    <div className={className}>
      {live ? (
        <LivePendingRow transfer={transfer} onRemove={onRemove} onToggle={toggle} open={open} />
      ) : (
        <PendingRowFace transfer={transfer} view={null} onRemove={onRemove} onToggle={toggle} open={open} />
      )}
      {open ? (
        <TransferTracker
          plan={transfer.plan}
          sourceTxHash={transfer.id}
          expectedAmount={transfer.amount}
          pendingId={transfer.id}
          className="pb-3"
        />
      ) : null}
    </div>
  );
}

interface RowActions {
  onRemove?: () => void;
  onToggle?: () => void;
  open: boolean;
}

function LivePendingRow({ transfer, ...actions }: { transfer: PendingTransfer } & RowActions) {
  const { view } = useTracked({
    plan: transfer.plan,
    sourceTxHash: transfer.id,
    expectedAmount: transfer.amount,
    id: transfer.id,
    fallback: transfer.status,
  });
  return <PendingRowFace transfer={transfer} view={view} {...actions} />;
}

function PendingRowFace({ transfer, view, onRemove, onToggle, open }: { transfer: PendingTransfer; view: TraceView | null } & RowActions) {
  const status = view?.status ?? transfer.status;
  // Without a reading of its own, the tracker's last one (from the store).
  const progress = view?.progress ?? (status === "arrived" ? 1 : (transfer.progress ?? 0));
  const hops = transfer.plan.hops.length;
  // Past its packet timeout and still not seen settling (a transaction the
  // chain never included stays "not indexed" forever): let the user stop
  // following it instead of leaving it in the count for a day.
  const now = useNow();
  const overdue = now !== null && now - transfer.createdAt > OVERDUE_MS;
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative flex shrink-0 items-center">
          <ChainLogo chainId={transfer.sourceChainId} size={26} />
          <span className="-ml-2 rounded-full shadow-[0_0_0_2px_var(--d-card)]">
            <ChainLogo chainId={transfer.destChainId} size={26} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-fg">
            <TokenAmount amount={transfer.amount} decimals={transfer.decimals} symbol={transfer.symbol} maxFraction={4} />
          </p>
          <p className="truncate text-[12px] text-fg-dim">
            {chainName(transfer.sourceChainId)} → {chainName(transfer.destChainId)}
            {hops > 1 ? ` · ${hops} hops` : ""} · <RelativeTime at={transfer.createdAt} />
          </p>
        </div>
        <TransferStatusBadge status={status} />
        {onToggle ? (
          <IconButton
            label={open ? "Hide the hops" : "Show the hops"}
            icon={open ? "chevronUp" : "chevronDown"}
            size="sm"
            aria-expanded={open}
            onClick={onToggle}
          />
        ) : null}
        {onRemove && (isSettled(status) || overdue) ? (
          <IconButton label={isSettled(status) ? "Remove from this list" : "Stop following this transfer"} icon="close" size="sm" onClick={onRemove} />
        ) : null}
      </div>
      <ProgressLine status={status} progress={progress} />
    </div>
  );
}

/**
 * Follows every in-flight transfer in the background and writes what the
 * chains report back to the pending store, so a count of what is moving (the
 * top bar's Live badge) settles even when no list of transfers is on screen.
 * Renders nothing; mount it once (the shell), not per list.
 */
export function PendingTransfersWatcher() {
  const pending = usePendingTransfers();
  // The store drops entries past 24 hours when it loads; a tab left open for
  // days never reloads it, so the watcher prunes on mount and every 10 minutes.
  useEffect(() => {
    pendingTransfers.prune();
    const timer = window.setInterval(() => pendingTransfers.prune(), 10 * 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <>
      {pending
        .filter((transfer) => isInFlight(transfer.status))
        .map((transfer) => (
          <WatchOne key={transfer.id} transfer={transfer} />
        ))}
    </>
  );
}

function WatchOne({ transfer }: { transfer: PendingTransfer }) {
  useTracked({ plan: transfer.plan, sourceTxHash: transfer.id, expectedAmount: transfer.amount, id: transfer.id, fallback: transfer.status });
  return null;
}
