"use client";

/**
 * Security review: the Cosmos version of token approvals. Who can act for
 * your accounts (authz grants: what, with which limits, until when), whose
 * fees you pay (fee allowances), and where your staking rewards go when that
 * is not this account.
 *
 * Each finding says what it means and can be fixed from its row: revoke a
 * party's grants, revoke an allowance, or set the reward address back, each
 * signed in your wallet after a review (see SecurityFixSheet). How to do it
 * elsewhere is one fold away, with the module's own documentation.
 *
 * Coverage is part of the answer: "nothing found" is said only for networks
 * that were read in full; a partial or failed read is named as such, and a
 * network the wallet shared no address for was not asked at all.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  AddressText,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  DataTable,
  Disclosure,
  ExternalLink,
  InlineError,
  Skeleton,
  StatTile,
  StatusBadge,
} from "@/components/ui";
import { findChain } from "@/lib/chains";
import { cn } from "@/lib/cn";
import type { SecurityReviewState } from "@/lib/data/staking";
import { useWallet } from "@/providers/WalletProvider";
import { groupAuthz, groupFeeGrants, securityCoverage, type FeeGrantGroup, type GrantGroup, type SecurityCoverage } from "./model";
import { SecurityFixSheet, type SecurityFix } from "./SecurityFixSheet";
import { AuthzCard, FeeCard, FixButton, authzColumns, feeColumns } from "./SecurityRows";

const MODULE_DOCS = {
  authz: "https://github.com/cosmos/cosmos-sdk/tree/main/x/authz",
  feegrant: "https://github.com/cosmos/cosmos-sdk/tree/main/x/feegrant",
  distribution: "https://github.com/cosmos/cosmos-sdk/tree/main/x/distribution",
} as const;

const chainName = (chainId: string) => findChain(chainId)?.chainName ?? chainId;

function chainCoin(chainId: string) {
  const chain = findChain(chainId);
  return chain ? { coinMinimalDenom: chain.coinMinimalDenom, coinDenom: chain.coinDenom, coinDecimals: chain.coinDecimals } : null;
}

/** "A, B and 3 more". */
function namesText(chainIds: readonly string[], max = 3): string {
  const names = chainIds.map(chainName);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export interface SecurityReviewProps {
  state: SecurityReviewState;
  now: number | null;
}

export function SecurityReview({ state, now }: SecurityReviewProps) {
  const data = state.data;
  const { canSignOn } = useWallet();
  const [sheet, setSheet] = useState<{ fix: SecurityFix | null; open: boolean; key: number }>({ fix: null, open: false, key: 0 });
  const openFix = (fix: SecurityFix) => setSheet((prev) => ({ fix, open: true, key: prev.key + 1 }));

  const clock = now ?? data?.updatedAt ?? 0;
  const authz = useMemo(() => (data ? groupAuthz(data.authzGrants, clock, chainCoin) : []), [data, clock]);
  const feeGrants = useMemo(() => (data ? groupFeeGrants(data.feeGrants, clock, chainCoin) : []), [data, clock]);
  const coverage = useMemo(() => (data ? securityCoverage(data, state.skipped) : null), [data, state.skipped]);
  const granterOf = (chainId: string) => data?.checked.find((check) => check.chainId === chainId)?.address ?? null;
  const revokeAllowance = (row: FeeGrantGroup) => {
    // The granter is this account on that chain (the address the review read).
    const granter = granterOf(row.chainId) ?? row.grants[0]?.granter ?? null;
    if (granter) openFix({ kind: "feegrant", group: row, granter });
  };

  const movingParties = authz.filter((group) => group.movesFunds).length;
  const checkedCount = data?.checked.length ?? 0;
  const fullyRead = (coverage?.clean.length ?? 0) + (coverage?.flagged.length ?? 0);

  return (
    <Card as="section" id="security" aria-labelledby="security-title" pending={state.stale} className="scroll-mt-[calc(var(--d-sticky-top)+16px)]">
      <CardHeader
        id="security-title"
        icon="shield"
        title="Security review"
        subtitle="Who can act for your accounts, what they can do and until when"
        refreshing={state.refreshing && !state.stale}
        info={
          <span className="block max-w-[300px] text-[12.5px] leading-snug text-fg-muted">
            Read from each chain: authz grants your accounts gave (x/authz), fee allowances they issued (x/feegrant) and the reward withdraw
            address (x/distribution). Grants outlive the session that created them, so they are worth checking like token approvals.
          </span>
        }
        actions={coverage ? <CoverageBadge coverage={coverage} /> : null}
      />
      <CardBody className="flex flex-col gap-5">
        {state.loading && !data ? (
          <ReviewSkeleton />
        ) : state.status === "error" && !data ? (
          <InlineError title="Couldn't run the security review" message={state.error?.message ?? "The review could not be read."} onRetry={state.refetch} retrying={state.refreshing} />
        ) : !data || !coverage ? (
          <p className="text-[13px] text-fg-dim">No address to review on the networks in scope.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-[var(--d-gap)] @min-[600px]:grid-cols-4">
              <StatTile
                bare
                className={TILE}
                label="Can act for you"
                value={authz.length}
                tone={movingParties > 0 ? "negative" : authz.length > 0 ? "warning" : "default"}
                sub={authz.length === 0 ? "No authz grants" : movingParties > 0 ? `${movingParties} can move funds` : "None can move funds"}
              />
              <StatTile
                bare
                className={TILE}
                label="Reward redirects"
                value={data.withdrawAddressDiffers.length}
                tone={data.withdrawAddressDiffers.length > 0 ? "warning" : "default"}
                sub={data.withdrawAddressDiffers.length > 0 ? namesText(data.withdrawAddressDiffers.map((entry) => entry.chainId), 2) : "Paid to you"}
              />
              <StatTile
                bare
                className={TILE}
                label="Fee allowances"
                value={feeGrants.length}
                tone={feeGrants.some((group) => !group.limited) ? "warning" : "default"}
                sub={feeGrants.length === 0 ? "None issued" : `${feeGrants.filter((group) => !group.limited).length} without a limit`}
              />
              <StatTile
                bare
                className={TILE}
                label="Networks read"
                value={
                  <>
                    {fullyRead}
                    <span className="text-[0.7em] font-medium text-fg-dim">/{checkedCount + coverage.notAsked.length}</span>
                  </>
                }
                tone={coverage.failed.length > 0 || coverage.partial.length > 0 ? "warning" : "default"}
                sub={
                  coverage.failed.length + coverage.partial.length > 0
                    ? `${coverage.partial.length} partial · ${coverage.failed.length} failed`
                    : coverage.notAsked.length > 0
                      ? `${coverage.notAsked.length} not shared by the wallet`
                      : "All read in full"
                }
              />
            </div>

            {authz.length > 0 ? (
              <Block
                title="Who can act for you"
                subtitle="Authz grants your accounts signed. Each lasts until it expires or you revoke it."
                how={
                  <>
                    A grant ends at its expiry, or when the granting account signs a revoke (MsgRevoke) naming the grantee and the message type.
                    Revoke here, or from the service that asked for it (an auto-compounder such as REStake, a voting bot).{" "}
                    <ExternalLink href={MODULE_DOCS.authz}>How authz works</ExternalLink>
                  </>
                }
              >
                <div className="-mx-[var(--d-pad)] border-y border-[var(--d-hairline)]">
                  <DataTable<GrantGroup>
                    ariaLabel="Authz grants"
                    rows={authz}
                    getRowKey={(row) => row.key}
                    stickyHeader={false}
                    columns={authzColumns(clock, canSignOn, openFix)}
                    mobileCard={(row) => <AuthzCard row={row} now={clock} canSign={canSignOn(row.chainId)} onRevoke={() => openFix({ kind: "authz", group: row })} />}
                  />
                </div>
              </Block>
            ) : null}

            {data.withdrawAddressDiffers.length > 0 ? (
              <Block
                title="Rewards paid to another address"
                subtitle="Claimed staking rewards on these networks go to a different account."
                how={
                  <>
                    The withdraw address changes only with a transaction the account signs (MsgSetWithdrawAddress), or one a grantee signs for it.
                    Until it is set back, every claim pays the other address, including the automatic claim when you change a delegation.{" "}
                    <ExternalLink href={MODULE_DOCS.distribution}>How rewards are paid</ExternalLink>
                  </>
                }
              >
                <ul className="-mx-[var(--d-pad)] divide-y divide-[var(--d-hairline)] border-y border-[var(--d-hairline)]">
                  {data.withdrawAddressDiffers.map((entry) => (
                    <li key={entry.chainId} className="flex flex-col gap-3 px-[var(--d-pad)] py-3.5 sm:flex-row sm:items-center sm:gap-4">
                      <div className="flex min-w-0 items-center gap-2.5 sm:w-[180px] sm:shrink-0">
                        <ChainLogo chainId={entry.chainId} size={24} />
                        <span className="truncate text-[14px] font-medium text-fg">{chainName(entry.chainId)}</span>
                      </div>
                      <div className="min-w-0 flex-1 text-[13px] text-fg-muted">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                          Rewards go to <AddressText address={entry.withdrawAddress} head={12} tail={6} />
                        </div>
                        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] text-fg-dim">
                          instead of <AddressText address={entry.address} head={12} tail={6} copy={false} />
                        </div>
                      </div>
                      <FixButton
                        label="Set my address"
                        canSign={canSignOn(entry.chainId)}
                        chain={entry.chainId}
                        onClick={() => openFix({ kind: "withdraw", chainId: entry.chainId, address: entry.address, withdrawAddress: entry.withdrawAddress })}
                      />
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}

            {feeGrants.length > 0 ? (
              <Block
                title="Fees you pay for others"
                subtitle="Fee allowances let another account pay its transaction fees from yours."
                how={
                  <>
                    An allowance ends at its expiry or its spend limit, or when you sign a revoke (MsgRevokeAllowance) naming the grantee.{" "}
                    <ExternalLink href={MODULE_DOCS.feegrant}>How fee grants work</ExternalLink>
                  </>
                }
              >
                <div className="-mx-[var(--d-pad)] border-y border-[var(--d-hairline)]">
                  <DataTable<FeeGrantGroup>
                    ariaLabel="Fee allowances"
                    rows={feeGrants}
                    getRowKey={(row) => row.key}
                    stickyHeader={false}
                    columns={feeColumns(clock, canSignOn, revokeAllowance)}
                    mobileCard={(row) => <FeeCard row={row} now={clock} canSign={canSignOn(row.chainId)} onRevoke={() => revokeAllowance(row)} />}
                  />
                </div>
              </Block>
            ) : null}

            <CoverageLine coverage={coverage} />
          </>
        )}
      </CardBody>
      {sheet.fix ? (
        <SecurityFixSheet key={sheet.key} fix={sheet.fix} open={sheet.open} onOpenChange={(open) => setSheet((prev) => ({ ...prev, open }))} />
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ pieces */

/** The review's counters: kit tiles, inset in the card. */
const TILE = "rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3";

function Block({ title, subtitle, how, children }: { title: string; subtitle: string; how: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-medium tracking-[-0.01em] text-fg">{title}</h3>
          <p className="mt-0.5 text-[12.5px] text-fg-dim">{subtitle}</p>
        </div>
      </div>
      {children}
      <Disclosure summary="How to revoke without Zunia">
        <p className="max-w-[80ch] text-[12.5px] leading-[1.55] text-fg-muted">{how}</p>
      </Disclosure>
    </div>
  );
}

/** "5 of 5 read" (all in full) or how many were not, in the header. */
function CoverageBadge({ coverage }: { coverage: SecurityCoverage }) {
  const read = coverage.clean.length + coverage.flagged.length;
  const total = read + coverage.partial.length + coverage.failed.length;
  const short = coverage.partial.length + coverage.failed.length;
  if (total === 0) return null;
  return (
    <StatusBadge tone={short > 0 ? "warning" : "success"} dot={false} icon={short > 0 ? "warning" : "check"}>
      {short > 0 ? `${read} of ${total} read in full` : `${total} ${total === 1 ? "network" : "networks"} read in full`}
    </StatusBadge>
  );
}

/**
 * What the review covered, network by network. With no finding at all the
 * clean line is the answer itself, so it says it plainly, and it only claims
 * "nothing can act for you" when every network in scope was read in full.
 */
function CoverageLine({ coverage }: { coverage: SecurityCoverage }) {
  const allClear = coverage.findings === 0 && coverage.partial.length + coverage.failed.length + coverage.notAsked.length === 0;
  const lines: { key: string; icon: IconName; tone: string; text: ReactNode }[] = [];
  if (coverage.clean.length > 0) {
    lines.push({
      key: "clean",
      icon: "check",
      tone: "text-[var(--z-success)]",
      text: allClear ? (
        <>
          <span className="font-medium text-fg">Nothing can act for you</span> on {namesText(coverage.clean, 6)}.{" "}
          <span className="text-fg-dim">No authz grants, fee allowances or reward redirects: only your own signature moves these accounts.</span>
        </>
      ) : (
        <>
          <span className="font-medium text-fg">Nothing found on</span> {namesText(coverage.clean, 6)}
        </>
      ),
    });
  }
  const gaps: { key: string; icon: IconName; tone: string; label: string; chains: string[]; note: string }[] = [
    { key: "partial", icon: "warning", tone: "text-[var(--z-warning)]", label: "Partly checked", chains: coverage.partial, note: "one of the reads failed, so something may be missing" },
    { key: "failed", icon: "danger", tone: "text-[var(--z-danger)]", label: "Could not check", chains: coverage.failed, note: "the network did not answer" },
    { key: "not-asked", icon: "info", tone: "text-fg-dim", label: "Not asked", chains: coverage.notAsked, note: "the wallet shared no address there" },
  ];
  for (const gap of gaps) {
    if (gap.chains.length === 0) continue;
    lines.push({
      key: gap.key,
      icon: gap.icon,
      tone: gap.tone,
      text: (
        <>
          <span className="font-medium text-fg">{gap.label}</span> {namesText(gap.chains, 6)}
          <span className="text-fg-dim"> — {gap.note}</span>
        </>
      ),
    });
  }
  if (lines.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-1.5 text-[12.5px] leading-snug text-fg-muted", coverage.findings > 0 && "border-t border-[var(--d-hairline)] pt-3.5")}>
      {lines.map((line) => (
        <li key={line.key} className="flex items-start gap-2">
          <Icon name={line.icon} size={14} className={cn("mt-px shrink-0", line.tone)} />
          <span className="min-w-0">{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-[var(--d-gap)] @min-[600px]:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3.5 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full rounded-[10px]" />
        <Skeleton className="h-10 w-full rounded-[10px]" />
      </div>
    </div>
  );
}
