"use client";

/**
 * /activity/[hash]?chainId=: one transaction, read straight from its chain's
 * node and decoded server-side (`/api/activity/[hash]`).
 *
 * Wallet-agnostic: anyone with the link sees the same public facts. With a
 * wallet connected the read also asks for the connected account's side of it
 * (`forAddress`), which turns "Sent 12 OSMO from osmo1a… to osmo1b…" into
 * "you sent", with your balance change on top.
 *
 * Reading order: status (with the failure explained in words), the figures
 * (your change, fee, gas), then the IBC lifecycle when there is one, the
 * decoded messages, the coin movements, and the raw data for anyone who
 * wants to check our reading.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Page } from "@/components/shell/Page";
import {
  AddressText,
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  ChainLogo,
  CopyButton,
  DataTable,
  Disclosure,
  EmptyState,
  IconButton,
  InlineError,
  KeyValueList,
  Money,
  ProgressBar,
  RelativeTime,
  Skeleton,
  SkeletonText,
  StatusBadge,
  TokenAmount,
  chainById,
  isSafeExternalHref,
  toast,
  useMediaQuery,
  useNow,
  type Column,
} from "@/components/ui";
import { Icon } from "@/components/icons";
import { KIND_LABELS, priceMapFrom, type PriceMap } from "@/lib/activity/analytics";
import type { ActivityFee, TxDetail, TxMessageDetail, TxMovement } from "@/lib/activity/types";
import { useSpotPrices } from "@/lib/data/prices";
import { MINUS, formatDate, formatNumber, formatPercent, shortenAddress, shortenHash } from "@/lib/format";
import { useChainScope } from "@/lib/useChainScope";
import { useTx } from "@/lib/useActivity";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/providers/PrefsProvider";
import { useWallet } from "@/providers/WalletProvider";
import { KIND_ICONS } from "./KindIcon";
import { PacketLifecycle } from "./PacketLifecycle";
import { amountValue, explainOnChainFailure, gasRatio, isTxHash, legsValue, privateText, rowLegs, txHref } from "./view";

export interface TxDetailPageProps {
  /** Upper-case hex from the URL (validated again here). */
  hash: string;
  /** A catalog chain id, or null when the link named none (or an unknown one). */
  chainId: string | null;
  /** What the link asked for when it is not a known chain, to say so. */
  requestedChain: string | null;
}

export function TxDetailPage(props: TxDetailPageProps) {
  return (
    <Page
      title="Transaction"
      access="public"
      breadcrumbs={[{ label: "Activity", href: "/activity" }, { label: isTxHash(props.hash) ? shortenHash(props.hash, 6, 4) : "Transaction" }]}
    >
      <TxDetailView {...props} />
    </Page>
  );
}

/** How long a hash the node does not have yet keeps being asked for (just-broadcast transactions). */
const NOT_FOUND_POLL_MS = 6_000;
const NOT_FOUND_WINDOW_MS = 120_000;

function TxDetailView({ hash, chainId, requestedChain }: TxDetailPageProps) {
  if (!isTxHash(hash)) {
    return (
      <Card>
        <EmptyState
          icon="search"
          title="That isn't a transaction hash"
          body="A Cosmos transaction hash is 64 hexadecimal characters. Check the link, or find the transaction in your activity."
          action={
            <Button size="sm" href="/activity" iconLeft="activity">
              Open activity
            </Button>
          }
        />
      </Card>
    );
  }
  if (!chainId) return <ChainPicker hash={hash} requestedChain={requestedChain} />;
  return <TxLoaded hash={hash} chainId={chainId} />;
}

/* -------------------------------------------------------------------------- */
/* No (known) chain in the link                                                */
/* -------------------------------------------------------------------------- */

function ChainPicker({ hash, requestedChain, exclude }: { hash: string; requestedChain: string | null; exclude?: string }) {
  const { followedAll } = useChainScope();
  const chains = followedAll.filter((id) => id !== exclude).slice(0, 12);
  return (
    <Card>
      <CardHeader
        title={exclude ? "Look on another network" : "Which network is this transaction on?"}
        subtitle={
          requestedChain && !exclude
            ? `“${requestedChain}” isn't a network this dashboard knows. Pick the chain the transaction was sent on.`
            : "A hash alone doesn't say which chain recorded it. Pick one of your networks; the page reads it straight from that chain."
        }
      />
      <CardBody>
        {chains.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {chains.map((id) => (
              <li key={id}>
                <Button size="sm" variant="secondary" href={txHref(id, hash)} iconLeft={<ChainLogo chainId={id} size={16} />}>
                  {chainById(id)?.chainName ?? id}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-fg-dim">Follow a network on the Networks page to look transactions up on it.</p>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading, missing, failed                                                    */
/* -------------------------------------------------------------------------- */

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-[var(--d-gap)]">
      <span className="sr-only">Reading the transaction</span>
      <Card variant="hero">
        <div className="flex items-start gap-4">
          <Skeleton circle width={48} />
          <div className="flex flex-1 flex-col gap-2.5">
            <Skeleton className="h-6 w-40 rounded-[8px]" />
            <Skeleton className="h-3.5" width="60%" />
            <Skeleton className="h-3" width="40%" />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-4 border-t border-[var(--d-hairline)] pt-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-5 w-24 rounded-[6px]" />
            </div>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-12 gap-[var(--d-gap)]">
        <Card className="col-span-12 lg:col-span-8">
          <SkeletonText lines={4} />
        </Card>
        <Card className="col-span-12 lg:col-span-4">
          <SkeletonText lines={6} />
        </Card>
      </div>
    </div>
  );
}

function NotFound({ hash, chainId, checking, onRetry }: { hash: string; chainId: string; checking: boolean; onRetry: () => void }) {
  const name = chainById(chainId)?.chainName ?? chainId;
  return (
    <div className="flex flex-col gap-[var(--d-gap)]">
      <Card>
        <EmptyState
          icon="search"
          title={`Not found on ${name}`}
          body={
            <>
              {name}&apos;s node has no transaction <span className="font-mono">{shortenHash(hash, 8, 6)}</span>. It may not be indexed yet (a
              transaction appears a few seconds after its block), it may be older than the history this node keeps, or it may be on another network.
              {checking ? " Checking again every few seconds." : null}
            </>
          }
          action={
            <Button size="sm" variant="secondary" iconLeft="refresh" onClick={onRetry} loading={checking}>
              {checking ? "Checking" : "Check again"}
            </Button>
          }
        />
      </Card>
      <ChainPicker hash={hash} requestedChain={null} exclude={chainId} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The transaction                                                             */
/* -------------------------------------------------------------------------- */

function TxLoaded({ hash, chainId }: { hash: string; chainId: string }) {
  const { account, addressFor } = useWallet();
  const address = account ? addressFor(chainId) : null;
  // A hash the node does not have yet is asked for again for two minutes:
  // a just-broadcast transaction lands a few seconds after its block. Polling
  // stops as soon as the transaction is there.
  const [keepChecking, setKeepChecking] = useState(true);
  const result = useTx(chainId, hash, { address, refreshMs: keepChecking ? NOT_FOUND_POLL_MS : undefined });
  const { tx, notFound } = result;

  useEffect(() => {
    if (!keepChecking) return;
    const timer = setTimeout(() => setKeepChecking(false), tx ? 0 : NOT_FOUND_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [keepChecking, tx]);

  if (tx) return <TxView tx={tx} address={address} />;
  if (notFound) {
    return (
      <NotFound
        hash={hash}
        chainId={chainId}
        checking={keepChecking}
        onRetry={() => {
          setKeepChecking(true);
          result.refetch();
        }}
      />
    );
  }
  if (result.error) {
    return (
      <InlineError
        title="Couldn't read this transaction"
        message={`${result.error.message}. The node may be busy; this is not the same as "not found".`}
        onRetry={result.refetch}
        retrying={result.refreshing}
      />
    );
  }
  return <DetailSkeleton />;
}

function priceKeysOfTx(tx: TxDetail): string[] {
  const keys = new Set<string>();
  for (const fee of tx.fees.length > 0 ? tx.fees : tx.fee ? [tx.fee] : []) if (fee.key) keys.add(fee.key);
  for (const movement of tx.movements) keys.add(movement.identity.key);
  for (const amount of tx.forAddress?.amounts ?? []) keys.add(amount.identity.key);
  return [...keys].sort();
}

function feeValue(fee: ActivityFee, prices: PriceMap): number | null {
  return fee.key ? amountValue(fee.amount, fee.decimals ?? null, prices.get(fee.key)) : null;
}

function StatusOrb({ success }: { success: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-full ring-1",
        success
          ? "bg-[var(--z-success-fill)] text-[var(--z-success)] ring-[var(--z-success-line)]"
          : "bg-[var(--z-danger-fill)] text-[var(--z-danger)] ring-[var(--z-danger-line)]",
      )}
    >
      <Icon name={success ? "check" : "close"} size={22} strokeWidth={2} />
    </span>
  );
}

function Figure({ label, children, sub, className }: { label: string; children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="d-label">{label}</span>
      <div className="min-w-0 text-[17px] font-semibold leading-snug tracking-[-0.02em] text-fg">{children}</div>
      {sub ? <div className="min-w-0 text-[12.5px] leading-snug text-fg-dim">{sub}</div> : null}
    </div>
  );
}

function copyPageLink() {
  void navigator.clipboard
    .writeText(window.location.href)
    .then(() => toast.success("Link copied"))
    .catch(() => toast.error("Couldn't copy the link"));
}

/** "Copy link" with its words from 640px up; an icon with a tooltip on a phone, so the hero's actions keep one row. */
function ShareLinkButton() {
  return (
    <>
      <Button size="sm" variant="secondary" iconLeft="link" onClick={copyPageLink} className="max-sm:hidden">
        Copy link
      </Button>
      <IconButton label="Copy link to this page" icon="link" size="sm" variant="secondary" onClick={copyPageLink} className="sm:hidden" />
    </>
  );
}

function TxView({ tx, address }: { tx: TxDetail; address: string | null }) {
  const now = useNow();
  // The details card is full width between 640 and 1023px: labels beside
  // values read better there; a phone or the narrow right column stacks them.
  const sideBySide = useMediaQuery("(min-width: 640px) and (max-width: 1023px)");
  const { currency: preferred, hideAmounts } = usePrefs();
  const keys = useMemo(() => priceKeysOfTx(tx), [tx]);
  const prices = useSpotPrices(keys);
  const priceMap = useMemo(() => priceMapFrom(prices.data?.prices), [prices.data]);
  const currency = prices.data?.currency ?? preferred;

  const chain = chainById(tx.chainId);
  const chainName = chain?.chainName ?? tx.chainId;
  const time = Date.parse(tx.time);
  const mine = tx.forAddress ?? null;
  const legs = mine ? rowLegs(mine) : [];
  const change = legsValue(legs, priceMap);
  const explained = tx.success ? null : explainOnChainFailure(tx.rawLog, tx.code, tx.codespace);
  const explorer = tx.explorerUrl && isSafeExternalHref(tx.explorerUrl) ? tx.explorerUrl : null;
  // The decoded sentence names amounts: privacy mode masks them like every
  // figure on the page (a vote's proposal number is not money and stays).
  const headline = privateText(
    mine?.summary ?? tx.messages[0]?.summary ?? "Transaction",
    hideAmounts,
    mine ? mine.kind === "vote" : isVoteMessage(tx.messages[0]),
  );
  const extraMessages = Math.max(0, tx.messages.length + (tx.messagesOmitted ?? 0) - 1);
  const fees = tx.fees.length > 0 ? tx.fees : tx.fee ? [tx.fee] : [];
  const fee = fees[0] ?? null;
  const feeTotal = fees.length > 0 ? fees.reduce<number | null>((sum, item) => {
    const value = feeValue(item, priceMap);
    return sum === null || value === null ? null : sum + value;
  }, 0) : null;
  // Without the viewer's side (not connected, or not their transaction), the
  // headline figure is what the messages moved: the first non-fee movement.
  const moved = mine ? [] : tx.movements.filter((movement) => movement.msgIndex !== null);
  const ratio = gasRatio(tx.gasUsed, tx.gasWanted);
  const outOfGas = explained?.kind === "out-of-gas";
  const payer = tx.feePayer ?? tx.signer ?? null;

  return (
    <div className="flex flex-col gap-[var(--d-gap)] xl:gap-5">
      <Card variant="hero" as="section" aria-labelledby="tx-status">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <StatusOrb success={tx.success} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="tx-status" className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-fg">
                  {tx.success ? "Succeeded" : "Failed"}
                </h2>
                {mine ? (
                  <Badge size="md" icon={KIND_ICONS[mine.kind]}>
                    {KIND_LABELS[mine.kind]}
                  </Badge>
                ) : null}
                {mine?.via ? <Badge size="md">Run for you via authz</Badge> : null}
              </div>
              <p className="mt-1.5 text-[15px] leading-snug text-fg-muted">
                {headline}
                {extraMessages > 0 ? <span className="text-fg-dim"> and {extraMessages} more {extraMessages === 1 ? "message" : "messages"}</span> : null}
              </p>
              <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12.5px] text-fg-dim">
                <span className="inline-flex items-center gap-1.5">
                  <ChainLogo chainId={tx.chainId} size={16} />
                  <span className="text-fg-muted">{chainName}</span>
                </span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">Block {formatNumber(tx.height)}</span>
                <span aria-hidden>·</span>
                <span suppressHydrationWarning>
                  {formatDate(time, "datetime")} (<RelativeTime at={time} />)
                </span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="inline-flex h-[var(--d-ctl-sm)] items-center gap-1 rounded-[var(--d-radius-control)] border border-[var(--d-control-line)] pl-2.5 pr-1 font-mono text-[12px] text-fg-muted">
              {shortenHash(tx.hash, 6, 4)}
              <CopyButton value={tx.hash} label="transaction hash" />
            </span>
            <ShareLinkButton />
            {explorer ? (
              <Button size="sm" variant="secondary" href={explorer} external iconRight="arrowUpRight">
                Explorer
              </Button>
            ) : null}
          </div>
        </div>

        {explained ? (
          <Callout tone="danger" title={explained.title} icon="danger">
            <p>{explained.message}</p>
            {explained.detail || tx.code !== undefined ? (
              <Disclosure summary="The chain's own error" className="mt-2">
                <p className="break-words font-mono text-[12px] leading-relaxed text-fg-muted">
                  {tx.codespace ? `${tx.codespace} ` : null}
                  {tx.code !== undefined ? `code ${tx.code}` : null}
                  {explained.detail ? `: ${explained.detail}` : tx.rawLog ? `: ${tx.rawLog}` : null}
                </p>
              </Disclosure>
            ) : null}
          </Callout>
        ) : null}

        <div className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[var(--d-hairline)] pt-4 md:grid-cols-4">
          {mine ? (
            <Figure
              label="Your balance change"
              sub={
                change !== null ? (
                  <>
                    ≈ <Money value={change} currency={currency} signed /> {legs.length > 1 ? "net " : ""}at today&apos;s prices
                  </>
                ) : legs.length === 0 ? (
                  tx.success ? "No tokens moved for you" : "Nothing moved: it failed"
                ) : (
                  "No price for this token"
                )
              }
            >
              {legs.length > 0 ? (
                <span className="flex flex-col">
                  {legs.slice(0, 3).map((leg) => (
                    <span key={leg.key} className={cn("whitespace-nowrap", leg.direction === "in" ? "text-[var(--d-pos)]" : "text-fg")}>
                      {leg.direction === "in" ? "+" : MINUS}
                      <TokenAmount amount={leg.amount} decimals={leg.decimals} symbol={leg.ticker} maxFraction={6} />
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-fg-dim">—</span>
              )}
            </Figure>
          ) : (
            <Figure
              label="Amount moved"
              sub={
                <>
                  {moved.length > 1 ? `+${moved.length - 1} more movement${moved.length > 2 ? "s" : ""} · ` : null}
                  {address ? "Doesn't involve your account" : "Connect to see your side"}
                </>
              }
            >
              {moved[0] ? (
                <TokenAmount amount={moved[0].amount} decimals={moved[0].identity.decimals} symbol={moved[0].identity.ticker} maxFraction={6} />
              ) : (
                <span className="text-fg-dim">None</span>
              )}
            </Figure>
          )}
          <Figure
            label="Network fee"
            sub={
              fee ? (
                <>
                  {feeTotal !== null ? (
                    <>
                      ≈ <Money value={feeTotal} currency={currency} />{" "}
                    </>
                  ) : null}
                  {tx.feeGranter
                    ? "· covered by a fee grant"
                    : payer && address && payer === address
                      ? "· paid by you"
                      : payer
                        ? (
                            <>
                              · paid by <span className="whitespace-nowrap">{shortenAddress(payer)}</span>
                            </>
                          )
                        : null}
                </>
              ) : (
                "No fee"
              )
            }
          >
            {fee ? <TokenAmount amount={fee.amount} decimals={fee.decimals ?? null} symbol={fee.symbol ?? fee.denom} maxFraction={6} /> : "—"}
          </Figure>
          <Figure
            label="Gas used"
            sub={
              ratio !== null ? (
                <span className="flex flex-col gap-1.5">
                  <ProgressBar value={Math.min(ratio, 1) * 100} tone={outOfGas ? "danger" : ratio > 0.95 ? "warning" : "neutral"} label="Gas used of the limit" className="max-w-[10rem]" />
                  <span>
                    {formatPercent(ratio * 100, { digits: 0 })} of the {formatNumber(tx.gasWanted)} limit
                  </span>
                </span>
              ) : (
                "Limit unknown"
              )
            }
          >
            <span className="tabular-nums">{tx.gasUsed !== null ? formatNumber(tx.gasUsed) : "—"}</span>
          </Figure>
          <Figure label="Messages" sub={tx.memo ? <span className="line-clamp-1" title={tx.memo}>Memo “{tx.memo}”</span> : "No memo"}>
            {formatNumber(tx.messages.length + (tx.messagesOmitted ?? 0))}
          </Figure>
        </div>
      </Card>

      {/* Two rows from 1024px: the main group, then the raw material, with
          Details spanning both. The second row is the flexible one, so a tall
          Details card stretches it rather than opening a gap under the first. */}
      <div className="grid grid-cols-12 items-start gap-[var(--d-gap)] lg:grid-rows-[auto_1fr]">
        <div className="col-span-12 flex min-w-0 flex-col gap-[var(--d-gap)] lg:col-span-8">
          {tx.packets.length > 0 ? (
            <Card as="section" aria-labelledby="tx-ibc">
              <CardHeader
                id="tx-ibc"
                title={tx.packets.length === 1 ? "IBC transfer" : `IBC packets (${tx.packets.length})`}
                subtitle="Where the tokens are on their way between chains"
                icon="bridge"
              />
              <CardBody className="flex flex-col gap-6">
                {tx.packets.map((packet, index) => (
                  <div key={`${packet.stage}-${packet.sourceChannel}-${packet.sequence}-${index}`} className={cn(index > 0 && "border-t border-[var(--d-hairline)] pt-5")}>
                    <PacketLifecycle tx={tx} packet={packet} now={now} />
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
          <MessagesCard messages={tx.messages} omitted={tx.messagesOmitted ?? 0} hideAmounts={hideAmounts} />
          <MovementsCard movements={tx.movements} address={address} prices={priceMap} currency={currency} />
        </div>

        {/* Beside both main groups from 1024px (it spans their two rows), so
            the page has no long empty column; on a phone it comes after the
            movements and before the raw material. */}
        <div className="col-span-12 flex min-w-0 flex-col gap-[var(--d-gap)] lg:col-span-4 lg:row-span-2">
          <Card as="section" aria-labelledby="tx-details">
            <CardHeader id="tx-details" title="Details" />
            <CardBody>
              <KeyValueList
                divided
                stacked={!sideBySide}
                items={[
                  {
                    key: "hash",
                    label: "Hash",
                    value: (
                      <span className="flex items-start gap-1">
                        <span className="min-w-0 break-all font-mono text-[12px] leading-relaxed">{tx.hash}</span>
                        <CopyButton value={tx.hash} label="transaction hash" />
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    label: "Status",
                    value: tx.success ? (
                      <StatusBadge tone="success">Succeeded</StatusBadge>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="danger">Failed</StatusBadge>
                        {tx.code !== undefined ? <span className="font-mono text-[12px] text-fg-dim">{tx.codespace ?? "sdk"} · code {tx.code}</span> : null}
                      </span>
                    ),
                  },
                  {
                    key: "network",
                    label: "Network",
                    value: (
                      <span className="flex items-center gap-1.5">
                        <ChainLogo chainId={tx.chainId} size={16} />
                        {chainName}
                        <span className="font-mono text-[12px] text-fg-dim">{tx.chainId}</span>
                      </span>
                    ),
                  },
                  { key: "block", label: "Block", value: <span className="tabular-nums">{formatNumber(tx.height)}</span> },
                  { key: "time", label: "Time", value: <span suppressHydrationWarning>{formatDate(time, "datetime")}</span> },
                  {
                    key: "fee",
                    label: fees.length > 1 ? "Fees" : "Fee",
                    value:
                      fees.length > 0 ? (
                        <span className="flex flex-col">
                          {fees.map((item) => (
                            <TokenAmount key={item.denom} amount={item.amount} decimals={item.decimals ?? null} symbol={item.symbol ?? item.denom} maxFraction={6} />
                          ))}
                        </span>
                      ) : (
                        "None"
                      ),
                    sub: feeTotal !== null ? <>≈ <Money value={feeTotal} currency={currency} /> at today&apos;s price</> : undefined,
                  },
                  {
                    key: "gas",
                    label: "Gas (used / limit)",
                    value: (
                      <span className="tabular-nums">
                        {tx.gasUsed !== null ? formatNumber(tx.gasUsed) : "—"} / {tx.gasWanted !== null ? formatNumber(tx.gasWanted) : "—"}
                      </span>
                    ),
                    info: "Cosmos chains charge the fee set when signing and don't refund unused gas, so a limit far above what was used is fee paid for nothing.",
                  },
                  { key: "memo", label: "Memo", value: tx.memo ? <span className="break-words">{tx.memo}</span> : <span className="text-fg-dim">None</span> },
                  ...(tx.signer ? [{ key: "signer", label: "Signer", value: <AddressText address={tx.signer} /> }] : []),
                  ...(tx.feePayer && tx.feePayer !== tx.signer ? [{ key: "payer", label: "Fee payer", value: <AddressText address={tx.feePayer} /> }] : []),
                  ...(tx.feeGranter ? [{ key: "granter", label: "Fee granter", value: <AddressText address={tx.feeGranter} />, info: "This account's fee grant paid the fee." }] : []),
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <div className="col-span-12 flex min-w-0 flex-col gap-[var(--d-gap)] lg:col-span-8">
          {tx.events.length > 0 ? (
            <Card as="section" aria-labelledby="tx-events">
              <CardHeader id="tx-events" title="Events" subtitle="What the chain emitted while executing it" />
              <CardBody>
                <ul className="flex flex-wrap gap-1.5">
                  {tx.events.map((event) => (
                    <li key={event.type}>
                      <Badge size="sm" variant="outline" className="font-mono">
                        {event.type}
                        {event.count > 1 ? <span className="ml-1 text-fg-dim">×{event.count}</span> : null}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <Card as="section" aria-labelledby="tx-raw">
            <CardHeader id="tx-raw" title="Raw data" subtitle="Our decoded reading of the node's answer, to check it against an explorer" />
            <CardBody>
              <Disclosure summary="Show JSON" variant="inset">
                <JsonBlock value={tx} />
              </Disclosure>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Messages and movements                                                      */
/* -------------------------------------------------------------------------- */

function JsonBlock({ value }: { value: unknown }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <div className="relative">
      <pre className="d-scroll max-h-[22rem] overflow-auto rounded-[var(--d-radius-inner)] bg-[var(--d-input-bg)] p-3 font-mono text-[11.5px] leading-relaxed text-fg-muted">
        {text}
      </pre>
      <span className="absolute right-2 top-2">
        <CopyButton value={text} label="JSON" size="sm" />
      </span>
    </div>
  );
}

/** A vote's sentence keeps its numbers in privacy mode: "#12" is a proposal, not money. */
function isVoteMessage(message: Pick<TxMessageDetail, "type"> | undefined): boolean {
  return message !== undefined && /vote/i.test(message.type);
}

function MessagesCard({ messages, omitted, hideAmounts }: { messages: readonly TxMessageDetail[]; omitted: number; hideAmounts: boolean }) {
  return (
    <Card as="section" aria-labelledby="tx-messages">
      <CardHeader
        id="tx-messages"
        title={`Messages (${formatNumber(messages.length + omitted)})`}
        subtitle="Each instruction the transaction carried, in words"
      />
      <CardBody>
        <ol className="flex flex-col divide-y divide-[var(--d-hairline)]">
          {messages.map((message) => (
            <li key={message.index} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--d-glass-2)] font-mono text-[11px] text-fg-muted">
                {message.index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" variant="outline" className="font-mono" title={message.typeUrl}>
                    {message.type}
                  </Badge>
                </div>
                <p className="mt-1.5 break-words text-[14px] leading-snug text-fg">{privateText(message.summary, hideAmounts, isVoteMessage(message))}</p>
                <Disclosure summary="Message JSON" className="mt-2">
                  <JsonBlock value={message.json} />
                </Disclosure>
              </div>
            </li>
          ))}
        </ol>
        {omitted > 0 ? (
          <p className="mt-3 text-[12.5px] text-fg-dim">
            {formatNumber(omitted)} more {omitted === 1 ? "message is" : "messages are"} not shown (the first 100 are). The explorer has them all.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function MovementsCard({ movements, address, prices, currency }: { movements: readonly TxMovement[]; address: string | null; prices: PriceMap; currency: string }) {
  const party = (value: string) =>
    address && value === address ? (
      <span className="inline-flex items-center gap-1.5">
        <AddressText address={value} copy={false} />
        <Badge size="sm" tone="accent">
          You
        </Badge>
      </span>
    ) : (
      <AddressText address={value} copy={false} />
    );

  const columns: Column<TxMovement>[] = [
    {
      key: "step",
      header: "Step",
      cell: (row) =>
        row.msgIndex === null ? <span className="text-fg-dim">Fee</span> : <span className="font-mono text-[12px] text-fg-muted">Msg {row.msgIndex + 1}</span>,
      width: 72,
    },
    { key: "from", header: "From", cell: (row) => party(row.from) },
    { key: "to", header: "To", cell: (row) => party(row.to) },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => <TokenAmount amount={row.amount} decimals={row.identity.decimals} symbol={row.identity.ticker} maxFraction={6} />,
    },
    {
      key: "value",
      header: "Value today",
      align: "right",
      hideBelow: "md",
      cell: (row) => (
        <Money value={amountValue(row.amount, row.identity.decimals, prices.get(row.identity.key))} currency={currency} reason="No price for this token" className="text-fg-muted" />
      ),
    },
  ];

  return (
    <Card as="section" aria-labelledby="tx-movements" padding="none">
      <div className="px-[var(--d-pad)] pt-[var(--d-pad)]">
        <CardHeader
          id="tx-movements"
          title="Token movements"
          subtitle={movements.length > 0 ? "Every coin the bank moved, the fee included" : undefined}
          info="Read from the chain's transfer events: what actually moved, not what a message asked for."
        />
      </div>
      <CardBody className="mt-3">
        <DataTable
          ariaLabel="Token movements"
          columns={columns}
          rows={[...movements]}
          getRowKey={(row, index) => `${row.msgIndex ?? "fee"}-${row.from}-${row.to}-${row.denom}-${index}`}
          density="compact"
          stickyHeader={false}
          empty={<EmptyState inline icon="inbox" title="No tokens moved" body="This transaction changed state without a bank transfer." />}
          mobileCard={(row) => (
            <div className="flex w-full flex-col gap-1.5 text-left">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-fg-dim">{row.msgIndex === null ? "Fee" : `Message ${row.msgIndex + 1}`}</span>
                <TokenAmount amount={row.amount} decimals={row.identity.decimals} symbol={row.identity.ticker} maxFraction={6} className="text-[14px] font-medium" />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px]">
                {party(row.from)}
                <Icon name="arrowRight" size={13} className="text-fg-dim" />
                {party(row.to)}
              </div>
            </div>
          )}
        />
      </CardBody>
    </Card>
  );
}
