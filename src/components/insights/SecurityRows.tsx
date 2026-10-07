"use client";

/**
 * The security review's rows: one per party that can act for the account
 * (authz grants) and per fee allowance, as table columns on wide screens and
 * as cards on phones, each with its expiry and the fix button.
 *
 * Kept apart from the review card (SecurityReview) so the card reads as the
 * page's layout and coverage, and this as what one finding looks like.
 */

import {
  AddressText,
  Badge,
  Button,
  ChainLogo,
  StatusBadge,
  Tooltip,
  type Column,
} from "@/components/ui";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { untilText, type Expiry, type FeeGrantGroup, type GrantGroup } from "./model";
import { revokeTypeUrl } from "./revoke";
import type { SecurityFix } from "./SecurityFixSheet";

const chainName = (chainId: string) => findChain(chainId)?.chainName ?? chainId;

function ExpiryText({ expiry, now }: { expiry: Expiry; now: number }) {
  if (expiry.kind === "never") {
    return (
      <Badge tone="warning" icon="warning">
        Never expires
      </Badge>
    );
  }
  if (expiry.kind === "unknown") return <span className="text-fg-dim">—</span>;
  if (expiry.past) {
    return <span className="text-fg-dim">Expired {formatDate(expiry.at, "short", { now })}</span>;
  }
  return (
    <span className="inline-flex flex-col items-start">
      <span className={cn("tabular-nums", expiry.soon ? "text-[var(--z-warning)]" : "text-fg")}>{formatDate(expiry.at, "short", { now })}</span>
      <span className="text-[12px] text-fg-dim">{untilText(expiry.at, now)}</span>
    </span>
  );
}

function RiskBadge({ movesFunds }: { movesFunds: boolean }) {
  return movesFunds ? (
    <StatusBadge tone="danger">Can move funds</StatusBadge>
  ) : (
    <StatusBadge tone="neutral">Acts for you</StatusBadge>
  );
}

function Permissions({ group }: { group: GrantGroup }) {
  return (
    <span className="flex flex-wrap gap-1">
      {group.permissions.map((permission) => (
        <Badge key={permission.label} tone={permission.movesFunds ? "danger" : "neutral"} title={permission.typeUrl ?? undefined}>
          {permission.label}
        </Badge>
      ))}
    </span>
  );
}

export function FixButton({ label, canSign, chain, onClick }: { label: string; canSign: boolean; chain: string; onClick: () => void }) {
  const button = (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={!canSign} className="shrink-0">
      {label}
    </Button>
  );
  if (canSign) return button;
  // A disabled button cannot show its own tooltip: the wrapper carries it.
  return (
    <Tooltip content={`Your wallet cannot sign on ${chainName(chain)} from this session.`}>
      <span tabIndex={0} className="inline-flex shrink-0 rounded-[var(--d-radius-control)]">
        {button}
      </span>
    </Tooltip>
  );
}

export function authzColumns(now: number, canSignOn: (chainId: string) => boolean, openFix: (fix: SecurityFix) => void): Column<GrantGroup>[] {
  return [
    {
      key: "grantee",
      header: "Party",
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <AddressText address={row.grantee} head={10} tail={6} />
          <span className="text-[12px] text-fg-dim">
            {row.grants.length} {row.grants.length === 1 ? "grant" : "grants"}
          </span>
        </span>
      ),
      minWidth: 190,
    },
    {
      key: "chain",
      header: "Network",
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ChainLogo chainId={row.chainId} size={18} />
          {chainName(row.chainId)}
        </span>
      ),
      hideBelow: "lg",
    },
    { key: "can", header: "Can", cell: (row) => <Permissions group={row} />, minWidth: 180 },
    {
      key: "limits",
      header: "Limits",
      cell: (row) => (row.limits.length > 0 ? <span className="text-[13px] text-fg-muted">{row.limits.join(" · ")}</span> : <span className="text-fg-dim">None set</span>),
      hideBelow: "xl",
    },
    { key: "expires", header: "Expires", cell: (row) => <ExpiryText expiry={row.expiry} now={now} /> },
    { key: "risk", header: "Risk", cell: (row) => <RiskBadge movesFunds={row.movesFunds} />, hideBelow: "md" },
    {
      key: "fix",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (row) =>
        row.grants.some((grant) => revokeTypeUrl(grant) !== null) ? (
          <FixButton label="Revoke" canSign={canSignOn(row.chainId)} chain={row.chainId} onClick={() => openFix({ kind: "authz", group: row })} />
        ) : (
          <span className="text-[12px] text-fg-dim">Revoke from the service</span>
        ),
    },
  ];
}

export function AuthzCard({ row, now, canSign, onRevoke }: { row: GrantGroup; now: number; canSign: boolean; onRevoke: () => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <ChainLogo chainId={row.chainId} size={20} />
          <span className="flex min-w-0 flex-col">
            <AddressText address={row.grantee} head={10} tail={6} />
            <span className="text-[12px] text-fg-dim">
              {chainName(row.chainId)} · {row.grants.length} {row.grants.length === 1 ? "grant" : "grants"}
            </span>
          </span>
        </span>
        <RiskBadge movesFunds={row.movesFunds} />
      </div>
      <Permissions group={row} />
      {row.limits.length > 0 ? <p className="text-[12.5px] text-fg-muted">{row.limits.join(" · ")}</p> : null}
      <div className="flex items-end justify-between gap-3 text-[13px]">
        <ExpiryText expiry={row.expiry} now={now} />
        {row.grants.some((grant) => revokeTypeUrl(grant) !== null) ? <FixButton label="Revoke" canSign={canSign} chain={row.chainId} onClick={onRevoke} /> : null}
      </div>
    </div>
  );
}

export function feeColumns(now: number, canSignOn: (chainId: string) => boolean, onRevoke: (row: FeeGrantGroup) => void): Column<FeeGrantGroup>[] {
  return [
    { key: "grantee", header: "Pays fees for", cell: (row) => <AddressText address={row.grantee} head={10} tail={6} />, minWidth: 180 },
    {
      key: "chain",
      header: "Network",
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <ChainLogo chainId={row.chainId} size={18} />
          {chainName(row.chainId)}
        </span>
      ),
      hideBelow: "md",
    },
    {
      key: "limit",
      header: "Limit",
      cell: (row) =>
        row.limited ? (
          <span className="text-[13px] text-fg-muted">{row.limits.join(" · ")}</span>
        ) : (
          <Badge tone="warning" icon="warning">
            No limit
          </Badge>
        ),
    },
    {
      key: "only",
      header: "Only for",
      cell: (row) => (row.allowedMessages.length > 0 ? <span className="text-[13px] text-fg-muted">{row.allowedMessages.join(", ")}</span> : <span className="text-fg-dim">Any message</span>),
      hideBelow: "lg",
    },
    { key: "expires", header: "Expires", cell: (row) => <ExpiryText expiry={row.expiry} now={now} /> },
    {
      key: "fix",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cell: (row) => <FixButton label="Revoke" canSign={canSignOn(row.chainId)} chain={row.chainId} onClick={() => onRevoke(row)} />,
    },
  ];
}

export function FeeCard({ row, now, canSign, onRevoke }: { row: FeeGrantGroup; now: number; canSign: boolean; onRevoke: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <ChainLogo chainId={row.chainId} size={20} />
          <AddressText address={row.grantee} head={10} tail={6} />
        </span>
        {row.limited ? null : (
          <Badge tone="warning" icon="warning">
            No limit
          </Badge>
        )}
      </div>
      <p className="text-[12.5px] text-fg-muted">
        {row.allowances.join(", ")}
        {row.limits.length > 0 ? ` · ${row.limits.join(" · ")}` : ""}
        {row.allowedMessages.length > 0 ? ` · only ${row.allowedMessages.join(", ")}` : ""}
      </p>
      <div className="flex items-end justify-between gap-3 text-[13px]">
        <ExpiryText expiry={row.expiry} now={now} />
        <FixButton label="Revoke" canSign={canSign} chain={row.chainId} onClick={onRevoke} />
      </div>
    </div>
  );
}
