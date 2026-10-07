"use client";

/**
 * The security review's fixes, signed from the review itself: revoke what a
 * party can do for you (every authz grant it holds on that chain, in one
 * transaction), revoke a fee allowance, or pay staking rewards to this
 * account again.
 *
 * It runs through the same sheet as every staking transaction (review card
 * with the measured fee → wallet → progress → toast), so a revoke reads like
 * any other signature in the dashboard. The fee is measured by simulating
 * the exact transaction, which also catches a revoke the chain would refuse
 * (a grant that has already expired or been revoked elsewhere) before the
 * wallet opens.
 */

import { useMemo, type ReactNode } from "react";
import { TxSheet } from "@/components/staking/flows/TxSheet";
import { AddressText, Badge, Callout, ChainLogo, type KeyValueItem } from "@/components/ui";
import { findChain } from "@/lib/chains";
import { useChainStats } from "@/lib/data/chains";
import { shortenAddress } from "@/lib/format";
import type { SignRequest } from "@/lib/tx/types";
import { grantPermission, type FeeGrantGroup, type GrantGroup, type GrantPermission } from "./model";
import { buildRevokeAllowance, buildSetWithdrawAddress, revokeAllMessages } from "./revoke";

export type SecurityFix =
  | { kind: "authz"; group: GrantGroup }
  | { kind: "feegrant"; group: FeeGrantGroup; granter: string }
  | { kind: "withdraw"; chainId: string; address: string; withdrawAddress: string };

export interface SecurityFixSheetProps {
  fix: SecurityFix;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function chainOf(fix: SecurityFix): string {
  return fix.kind === "withdraw" ? fix.chainId : fix.group.chainId;
}

export function SecurityFixSheet({ fix, open, onOpenChange }: SecurityFixSheetProps) {
  const chainId = chainOf(fix);
  const chainName = findChain(chainId)?.chainName ?? chainId;
  const stats = useChainStats([chainId]);
  const row = stats.statsFor(chainId);

  const plan = useMemo(() => {
    if (fix.kind === "authz") {
      const { messages, unrevokable } = revokeAllMessages(fix.group.grants);
      return { messages, unrevokable };
    }
    if (fix.kind === "feegrant") {
      return { messages: [buildRevokeAllowance({ granter: fix.granter, grantee: fix.group.grantee })], unrevokable: [] };
    }
    return { messages: [buildSetWithdrawAddress({ delegator: fix.address, withdrawAddress: fix.address })], unrevokable: [] };
  }, [fix]);

  const request = useMemo<SignRequest | null>(
    () => (plan.messages.length > 0 ? { chainId, messages: plan.messages } : null),
    [chainId, plan.messages],
  );

  const network: KeyValueItem = {
    key: "network",
    label: "Network",
    value: (
      <span className="inline-flex items-center gap-1.5">
        <ChainLogo chainId={chainId} size={16} />
        {chainName}
      </span>
    ),
  };

  let title: string;
  let description: string;
  let items: KeyValueItem[];
  let notices: ReactNode;
  let confirmLabel: string;
  let successText: string;

  if (fix.kind === "authz") {
    const who = shortenAddress(fix.group.grantee, 10, 4);
    // What the revokes take away: the permissions of every grant that has a key.
    const revoked = new Map<string, GrantPermission>();
    for (const grant of fix.group.grants) {
      if (plan.unrevokable.includes(grant)) continue;
      const permission = grantPermission(grant);
      revoked.set(permission.label, permission);
    }
    title = "Revoke permissions";
    description = `${who} will no longer be able to act for your ${chainName} account.`;
    items = [
      network,
      { key: "grantee", label: "Party", value: <AddressText address={fix.group.grantee} head={12} tail={6} /> },
      {
        key: "what",
        label: "Revokes",
        value: (
          <span className="flex flex-wrap justify-end gap-1">
            {[...revoked.values()].map((permission) => (
              <Badge key={permission.label} tone={permission.movesFunds ? "danger" : "neutral"}>
                {permission.label}
              </Badge>
            ))}
          </span>
        ),
        sub: `${plan.messages.length} ${plan.messages.length === 1 ? "grant" : "grants"}, one transaction`,
      },
    ];
    notices = (
      <>
        {plan.unrevokable.length > 0 ? (
          <Callout tone="warning" title={`${plan.unrevokable.length} ${plan.unrevokable.length === 1 ? "grant stays" : "grants stay"}`}>
            The chain did not say which message {plan.unrevokable.length === 1 ? "it covers" : "they cover"}, so Zunia cannot name{" "}
            {plan.unrevokable.length === 1 ? "it" : "them"} in a revoke. Revoke {plan.unrevokable.length === 1 ? "it" : "them"} from the service
            that asked for {plan.unrevokable.length === 1 ? "it" : "them"}.
          </Callout>
        ) : null}
        <p className="text-[12.5px] leading-snug text-fg-dim">
          Anything that relied on these grants (an auto-compounder, a voting bot) stops working for this account. You can grant them again
          from that service later.
        </p>
      </>
    );
    confirmLabel = plan.messages.length === 1 ? "Revoke 1 grant" : `Revoke ${plan.messages.length} grants`;
    successText = `Revoked ${who}'s permissions on ${chainName}`;
  } else if (fix.kind === "feegrant") {
    const who = shortenAddress(fix.group.grantee, 10, 4);
    title = "Revoke fee allowance";
    description = `Stop paying ${who}'s transaction fees on ${chainName}.`;
    items = [
      network,
      { key: "grantee", label: "Pays fees for", value: <AddressText address={fix.group.grantee} head={12} tail={6} /> },
      { key: "allowance", label: "Allowance", value: fix.group.allowances.join(", "), sub: fix.group.limited ? fix.group.limits.join(" · ") : "No spend limit" },
    ];
    notices = null;
    confirmLabel = "Revoke allowance";
    successText = `Stopped paying fees for ${who} on ${chainName}`;
  } else {
    title = "Pay rewards to this account";
    description = `Staking rewards on ${chainName} go to another address today. This sets them back to your own.`;
    items = [
      network,
      { key: "now", label: "Paid to now", value: <AddressText address={fix.withdrawAddress} head={12} tail={6} /> },
      { key: "next", label: "From now on", value: <AddressText address={fix.address} head={12} tail={6} />, sub: "This account", emphasis: true },
    ];
    notices = (
      <p className="text-[12.5px] leading-snug text-fg-dim">
        Rewards already paid out stay where they went. If the other address is yours too, nothing needs fixing.
      </p>
    );
    confirmLabel = "Set my address";
    successText = `Rewards on ${chainName} now go to this account`;
  }

  return (
    <TxSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      chainId={chainId}
      request={request}
      reviewItems={items}
      notices={notices}
      fee={{ denom: row?.nativeDenom ?? null, price: row?.price?.price ?? null, currency: stats.data?.currency ?? "usd" }}
      confirmLabel={confirmLabel}
      successText={successText}
    />
  );
}
