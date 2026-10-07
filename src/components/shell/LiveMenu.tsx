"use client";

/**
 * "Live": what is happening now, one click from anywhere.
 *
 * - Transfers this browser signed that have not settled (the pending-transfer
 *   store the Bridge, Send and Swap flows write), each with its compact
 *   hop-by-hop row; the button's badge counts the ones still moving.
 * - The latest transactions on every followed chain (the frame's activity
 *   read, refreshed every minute).
 * - The session this page holds: which wallet signs, and for Zunia Mobile how
 *   the phone link stands and when it ends.
 *
 * A popover from 768 px, a bottom sheet on phones. The phone bar has no room
 * for Live as a fixture (spec §2), so there the button shows only while a
 * transfer is unsettled, the one moment it is the only place outside Bridge
 * that says so. Without a wallet it is left out entirely unless such a
 * transfer exists (nothing of yours to follow).
 *
 * The badge must settle even when no list is on screen, so the store's
 * watcher (`PendingTransfersWatcher`) is mounted here, once for the frame,
 * while something is in flight. It pauses while the panel is open: its rows
 * follow the same transfers and write the same store, and two pollers per
 * transfer would double the chain reads behind each one (past the three rows
 * shown, a transfer waits for the panel to close for its next reading).
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon, type IconName } from "@/components/icons";
import { Button, ChainLogo, Dot, IconButton, InlineError, Popover, RelativeTime, Sheet, Skeleton, useMediaQuery, useNow } from "@/components/ui";
import type { ActivityItem, ActivityKind } from "@/lib/activity/types";
import { cn } from "@/lib/cn";
import { findChain } from "@/lib/chains";
import { maskAmounts } from "@/lib/notifications/text";
import { countInFlight, isSettled, pendingTransfers, usePendingTransfers, type PendingTransfer } from "@/lib/pending-transfers";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet, walletKindLabel } from "@/providers/WalletProvider";
import { CountBadge } from "./NotificationsMenu";
import { PHONE_FRAME_QUERY } from "./ScopeControl";
import { networksShared, phoneSessionLine } from "./session";
import { useShellData } from "./ShellData";

/** A transfer row's footprint while its code loads. */
function TransferRowSkeleton() {
  return (
    <div aria-hidden className="flex items-center gap-3 py-3">
      <Skeleton circle width={26} />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton height={10} width="55%" />
        <Skeleton height={8} width="75%" />
      </div>
    </div>
  );
}

// The tracker (hop walking, packet wording) loads only while a transfer is
// pending: most visits have none, and the frame ships with every page.
const PendingTransfersWatcher = dynamic(
  () => import("@/components/transfer/TransferTracker").then((mod) => mod.PendingTransfersWatcher),
  { ssr: false },
);
const PendingTransferRow = dynamic(
  () => import("@/components/transfer/TransferTracker").then((mod) => mod.PendingTransferRow),
  { ssr: false, loading: () => <TransferRowSkeleton /> },
);

const KIND_ICON: Record<ActivityKind, IconName> = {
  send: "send",
  receive: "receive",
  "ibc-out": "bridge",
  "ibc-in": "bridge",
  swap: "swap",
  delegate: "staking",
  undelegate: "staking",
  redelegate: "staking",
  claim: "sparkle",
  vote: "governance",
  contract: "apps",
  authz: "shield",
  other: "activity",
};

export function activityHref(item: Pick<ActivityItem, "hash" | "chainId">): string {
  return `/activity/${encodeURIComponent(item.hash)}?chainId=${encodeURIComponent(item.chainId)}`;
}

function ActivityRowLink({ item, masked, onNavigate }: { item: ActivityItem; masked: boolean; onNavigate: () => void }) {
  const chain = findChain(item.chainId);
  const summary = masked ? maskAmounts(item.summary, "transfer") : item.summary;
  return (
    <Link
      href={activityHref(item)}
      onClick={onNavigate}
      className="group flex items-start gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-[160ms] hover:bg-[var(--d-glass)]"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          item.success ? "bg-[var(--d-glass-2)] text-fg-muted" : "bg-[var(--z-danger-fill)] text-[var(--z-danger)]",
        )}
      >
        <Icon name={item.success ? KIND_ICON[item.kind] : "danger"} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] leading-snug text-fg">{summary}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-dim">
          <ChainLogo chainId={item.chainId} size={12} />
          <span className="truncate">{chain?.chainName ?? item.chainId}</span>
          <span aria-hidden>·</span>
          <RelativeTime at={Date.parse(item.time)} className="shrink-0" />
          {!item.success ? <span className="font-medium text-[var(--z-danger)]">· Failed</span> : null}
        </span>
      </span>
    </Link>
  );
}

/**
 * The session this page holds, in one card: the wallet that signs and the
 * networks it shared; for Zunia Mobile, the phone link's state and the time
 * left in its 24 h session instead. Nothing about phones otherwise.
 */
function Session({ onNavigate }: { onNavigate: () => void }) {
  const { account, walletKind, keys, mobile, restoring } = useWallet();
  const modal = useConnectModal();
  const now = useNow();
  const phone = walletKind === "zunia-mobile";
  const reconnecting = phone && mobile.status === "reconnecting";
  return (
    <div className="px-3 pb-3 max-md:px-0">
      <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-glass)] p-2.5">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--d-glass-2)] text-fg-muted">
          <Icon name={phone ? "mobile" : "wallet"} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          {account && walletKind ? (
            <>
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                <Dot tone={reconnecting ? "warning" : "success"} pulse={phone && mobile.status === "connected"} />
                <span className="truncate">{walletKindLabel(walletKind)}</span>
              </p>
              <p className="mt-0.5 truncate text-[11.5px] text-fg-dim">
                {phone ? phoneSessionLine(mobile.status, mobile.expiresAt, now) : networksShared(Object.keys(keys).length)}
              </p>
            </>
          ) : restoring ? (
            <p className="text-[13px] text-fg-muted">Restoring your wallet…</p>
          ) : (
            <>
              <p className="text-[13px] text-fg-muted">No wallet connected</p>
              <button
                type="button"
                onClick={() => {
                  onNavigate();
                  modal.open();
                }}
                className="d-hit mt-0.5 text-[11.5px] font-medium text-[var(--d-accent-text)] hover:underline"
              >
                Connect a wallet
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Transfers shown in the popover; the rest are one link away on the Bridge page. */
const TRANSFERS_SHOWN = 3;

/**
 * Unsettled transfers: still moving, stalled, or waiting for a recovery (the
 * one outcome that needs the user). Arrived and returned ones are history,
 * which Activity and the Bridge page keep.
 */
function Transfers({ transfers, onNavigate }: { transfers: readonly PendingTransfer[]; onNavigate: () => void }) {
  if (transfers.length === 0) return null;
  const more = transfers.length - TRANSFERS_SHOWN;
  return (
    <div className="border-t border-[var(--d-hairline)]">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 max-md:px-0">
        <h3 className="d-label text-[10.5px]">Transfers</h3>
        <Link
          href="/bridge"
          onClick={onNavigate}
          className="text-[11.5px] font-medium text-fg-dim transition-colors duration-[160ms] hover:text-fg"
        >
          {more > 0 ? `${more} more on Bridge` : "Bridge"}
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-[var(--d-hairline)] px-4 max-md:px-0">
        {transfers.slice(0, TRANSFERS_SHOWN).map((transfer) => (
          <li key={transfer.id}>
            <PendingTransferRow transfer={transfer} expandable={false} onRemove={() => pendingTransfers.remove(transfer.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LivePanel({ onNavigate }: { onNavigate: () => void }) {
  const { account } = useWallet();
  const { hideAmounts } = usePrefs();
  const { activity } = useShellData();
  const transfers = usePendingTransfers().filter((transfer) => !isSettled(transfer.status));
  // Rows kept from another wallet's read (a switch in progress) are not shown.
  const rows = activity.stale ? [] : activity.items.slice(0, 6);
  const loading = activity.loading || activity.stale;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* On phones the sheet's own title names the panel. */}
      <div className="flex items-center gap-2 px-4 pb-2.5 pt-3 max-md:hidden">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-fg">Live</h2>
        {account ? <Dot tone="success" pulse /> : null}
        <span className="flex-1" />
        {account ? (
          <span className="text-[11.5px] text-fg-dim">{activity.refreshing ? "Refreshing…" : "Refreshes every minute"}</span>
        ) : null}
      </div>
      <Session onNavigate={onNavigate} />
      <Transfers transfers={transfers} onNavigate={onNavigate} />
      <div className="border-t border-[var(--d-hairline)]">
        <h3 className="d-label px-4 pb-1 pt-3 text-[10.5px] max-md:px-0">Latest transactions</h3>
        {/* In the phone sheet the sheet scrolls, not this list (no scroll
            box inside a scroll box), and the rows' text meets the sheet's
            gutter while their hover wash runs into it. */}
        <div className="d-scroll max-h-[340px] overflow-y-auto px-1.5 pb-2 max-md:-mx-2.5 max-md:max-h-none max-md:overflow-visible max-md:px-0">
          {!account ? (
            <p className="px-2.5 py-3 text-[13px] text-fg-dim">Your transactions on every followed chain show up here once a wallet is connected.</p>
          ) : loading ? (
            <div className="flex flex-col gap-3 px-2.5 py-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3">
                  <Skeleton circle width={32} />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton height={10} width="85%" />
                    <Skeleton height={8} width="45%" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.error && rows.length === 0 ? (
            <InlineError className="mx-2.5 my-2" title="Activity unavailable" message="The chains did not answer. Try again in a moment." onRetry={activity.refetch} />
          ) : rows.length === 0 ? (
            <p className="px-2.5 py-3 text-[13px] text-fg-dim">No transactions found on your followed chains (public nodes keep a limited history).</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((item) => (
                <li key={`${item.chainId}:${item.hash}:${item.address}`}>
                  <ActivityRowLink item={item} masked={hideAmounts} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="border-t border-[var(--d-hairline)] p-2 max-md:px-0 max-md:pb-0">
        <Button href="/activity" variant="ghost" size="sm" fullWidth iconRight="arrowRight" onClick={onNavigate} className="max-md:h-11">
          Open activity
        </Button>
      </div>
    </div>
  );
}

export function LiveMenu() {
  const [open, setOpen] = useState(false);
  const phone = useMediaQuery(PHONE_FRAME_QUERY);
  const { account, restoring } = useWallet();
  const transfers = usePendingTransfers();
  const inFlight = countInFlight(transfers);
  // Moving, stalled or waiting for a recovery: what makes Live worth a place
  // on a phone's bar, or on a bar without a wallet.
  const unsettled = transfers.some((transfer) => !isSettled(transfer.status));
  if (!account && !restoring && !unsettled) return null;

  const label = `Live: ${inFlight > 0 ? `${inFlight} ${inFlight === 1 ? "transfer" : "transfers"} in flight, ` : ""}latest transactions and session`;
  const watcher = inFlight > 0 && !open ? <PendingTransfersWatcher /> : null;
  const trigger = (
    <IconButton
      label={label}
      tooltip={inFlight > 0 ? `Live · ${inFlight} in flight` : "Live"}
      tooltipSide="bottom"
      aria-haspopup="dialog"
      onClick={phone ? () => setOpen(true) : undefined}
      // Hidden on phones by CSS, not by the media query: the server render
      // (and the hydrating one) sees no transfers and no phone, so a JS-only
      // rule would flash the button on every phone load.
      className={cn(!unsettled && !open && "hidden md:inline-flex", open && "bg-[var(--d-glass-2)] text-fg")}
    >
      <Icon name="pulse" size={18} />
      <CountBadge count={inFlight} tone="progress" />
    </IconButton>
  );

  if (phone) {
    return (
      <>
        {watcher}
        {trigger}
        <Sheet open={open} onOpenChange={setOpen} title="Live" side="bottom" bodyClassName="flex flex-col pb-3">
          <LivePanel onNavigate={() => setOpen(false)} />
        </Sheet>
      </>
    );
  }
  return (
    <>
      {watcher}
      <Popover
        trigger={trigger}
        open={open}
        onOpenChange={setOpen}
        width={380}
        padded={false}
        align="end"
        sideOffset={10}
        ariaLabel="Live"
        className="flex max-h-[min(78vh,var(--radix-popover-content-available-height))] flex-col overflow-hidden"
      >
        <LivePanel onNavigate={() => setOpen(false)} />
      </Popover>
    </>
  );
}
