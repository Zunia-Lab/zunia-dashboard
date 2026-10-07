"use client";

/**
 * The wallet half of an asset page: your position in this asset (by chain
 * and by bucket, with its weight in your portfolio and the actions per
 * holding) and the transactions that moved it. Without a wallet the
 * position card says what connecting adds, in place.
 */

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { StackedBar, stableColorMap, type PartDatum } from "@/components/charts";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon, type IconName } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChainLogo,
  DataTable,
  Delta,
  EmptyState,
  InlineError,
  Money,
  PartialDataBadge,
  Percent,
  RelativeTime,
  Skeleton,
  TokenAmount,
  type Column,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { exactUnits } from "@/lib/activity/analytics";
import type { ActivityItem, ActivityKind } from "@/lib/data/activity";
import { usePortfolio } from "@/lib/data/portfolio";
import { MASK, formatAmount, formatDate } from "@/lib/format";
import { maskAmounts } from "@/lib/notifications/text";
import type { TokenIdentity } from "@/lib/token/types";
import type { PortfolioAsset } from "@/lib/token/wire";
import { useActivity } from "@/lib/useActivity";
import { useChainScope } from "@/lib/useChainScope";
import { usePrefs } from "@/providers/PrefsProvider";
import { BucketAmounts, HoldingActions, chainName } from "./AssetCells";
import { baseAmountDigits, rowBaseTotal } from "./holdings";
import { isStakingCoin, swapToHref, type BondDenomOf } from "./links";

/* ------------------------------------------------------------------ connect prompt */

/** "Connect to see your position": what a wallet adds here, and the two ways in. */
export function ConnectPrompt({ ticker, className }: { ticker: string; className?: string }) {
  const modal = useConnectModal();
  return (
    <Card variant="hero" className={className}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-[var(--d-accent-soft)] text-[var(--d-accent-text)]">
          <Icon name="wallet" size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Connect to see your position</h2>
          <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-fg-dim">
            Your {ticker} on every chain you follow (liquid, staked, rewards and unbonding), its weight in your portfolio and the
            transactions that moved it. Keys stay in your wallet.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2">
          <Button variant="primary" iconLeft="wallet" onClick={() => modal.open()}>
            Connect wallet
          </Button>
          <Button variant="secondary" iconLeft="mobile" onClick={() => modal.open("mobile")}>
            Zunia Mobile
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ position */

const BUCKETS = ["liquid", "staked", "rewards", "unbonding"] as const;
const BUCKET_LABEL = { liquid: "Liquid", staked: "Staked", rewards: "Rewards", unbonding: "Unbonding" } as const;

function sumBucket(rows: readonly PortfolioAsset[], bucket: (typeof BUCKETS)[number]): bigint {
  return rows.reduce((sum, row) => sum + (/^\d+$/.test(row.amounts[bucket]) ? BigInt(row.amounts[bucket]) : BigInt(0)), BigInt(0));
}

function wholeUnits(base: bigint, decimals: number | null): number | null {
  return decimals === null ? null : Number(exactUnits(base.toString(), decimals));
}

/** The total and the four buckets, then the composition bar, as they will land. */
function PositionBodySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-2.5" width={56} />
            <Skeleton className="h-4" width={88} />
          </div>
        ))}
      </div>
      <Skeleton className="h-3" width="100%" />
    </div>
  );
}

/**
 * The position card's place while a remembered wallet restores: its frame
 * and skeleton, so a returning user never sees "Connect" flash and flip to
 * their position (see `useWalletRestoring`).
 */
export function PositionSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className} aria-busy="true">
      <CardHeader title="Your position" />
      <CardBody className="flex flex-col gap-3">
        <span role="status" className="sr-only">
          Restoring your wallet…
        </span>
        <PositionBodySkeleton />
      </CardBody>
    </Card>
  );
}

export interface PositionCardProps {
  assetKey: string;
  identity: TokenIdentity;
  /** Osmosis trades the asset: the empty state offers a swap into it. */
  tradable: boolean;
  bondDenomOf: BondDenomOf;
  className?: string;
}

export function PositionCard({ assetKey, identity, tradable, bondDenomOf, className }: PositionCardProps) {
  const portfolio = usePortfolio();
  const { selectedChainId, setSelectedChainId } = useChainScope();
  const data = portfolio.data;
  const currency = data?.currency ?? "usd";
  const rows = useMemo(() => (data?.assets ?? []).filter((row) => row.identity.key === assetKey), [data, assetKey]);
  const ticker = identity.ticker;
  // Same asset, one exponent; a mismatch (never seen) falls back to "—" amounts.
  const decimals = rows.every((row) => row.identity.decimals === rows[0]?.identity.decimals) ? (rows[0]?.identity.decimals ?? identity.decimals) : null;
  const price = rows.find((row) => row.price)?.price?.price ?? null;
  const value = rows.some((row) => row.value !== null) ? rows.reduce((sum, row) => sum + (row.value ?? 0), 0) : null;
  const share = value !== null && data && data.totals.pricedValue > 0 ? (value / data.totals.pricedValue) * 100 : null;
  // Today's amounts at yesterday's and today's prices, summed over the chains.
  const change24h = rows.some((row) => row.change24hAbs !== null) ? rows.reduce((sum, row) => sum + (row.change24hAbs ?? 0), 0) : null;
  const total = rows.reduce((sum, row) => sum + rowBaseTotal(row), BigInt(0));

  const composition = useMemo<{ parts: PartDatum[]; colors: Map<string, string>; by: string }>(() => {
    if (rows.length > 1) {
      const parts = rows
        .map((row) => ({ id: row.chainId, label: row.identity.chainName ?? chainName(row.chainId), value: wholeUnits(rowBaseTotal(row), decimals) ?? 0 }))
        .filter((part) => part.value > 0);
      return { parts, colors: stableColorMap(parts.map((part) => part.id)), by: "chain" };
    }
    const parts = BUCKETS.map((bucket) => ({ id: bucket, label: BUCKET_LABEL[bucket], value: wholeUnits(sumBucket(rows, bucket), decimals) ?? 0 })).filter(
      (part) => part.value > 0,
    );
    return { parts, colors: stableColorMap(BUCKETS), by: "bucket" };
  }, [rows, decimals]);

  // The legend prints amounts as text, outside the kit's masked figures: mask here.
  const { hideAmounts } = usePrefs();
  const formatUnits = useCallback((v: number) => `${hideAmounts ? MASK : formatAmount(v, { maxFraction: 4 })} ${ticker}`, [ticker, hideAmounts]);

  const scopeNote = selectedChainId ? (
    <span className="flex items-center gap-1.5">
      <Badge size="sm">{chainName(selectedChainId)} only</Badge>
      <Button size="sm" variant="ghost" onClick={() => setSelectedChainId(null)}>
        All chains
      </Button>
    </span>
  ) : null;

  const tableColumns: Column<PortfolioAsset>[] = [
    {
      key: "chain",
      header: "Chain",
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <ChainLogo chainId={row.chainId} size={22} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.identity.chainName ?? chainName(row.chainId)}</span>
            <span className="truncate font-mono text-[11px] text-fg-dim" title={row.identity.path ?? row.identity.denom}>
              {row.identity.originChainId === row.chainId ? "native" : (row.identity.path ?? "local")}
            </span>
          </span>
        </span>
      ),
      sortable: true,
      sortValue: (row) => row.identity.chainName ?? row.chainId,
      sortDescFirst: false,
    },
    ...BUCKETS.map<Column<PortfolioAsset>>((bucket) => ({
      key: bucket,
      header: BUCKET_LABEL[bucket],
      align: "right",
      hideBelow: bucket === "rewards" || bucket === "unbonding" ? "lg" : "md",
      cell: (row) =>
        /^0*$/.test(row.amounts[bucket]) ? (
          <span className="text-fg-faint">0</span>
        ) : (
          <TokenAmount amount={row.amounts[bucket]} decimals={row.identity.decimals} maxFraction={baseAmountDigits(row.amounts[bucket], row.identity.decimals, 4)} />
        ),
    })),
    {
      key: "value",
      header: "Value",
      align: "right",
      cell: (row) => <Money value={row.value} currency={currency} reason="No price" className="font-medium" />,
      sortable: true,
      sortValue: (row) => row.value,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (row) => <HoldingActions row={row} stakeable={isStakingCoin(row.identity, bondDenomOf)} />,
      hideBelow: "md",
    },
  ];

  let body;
  if (portfolio.status === "idle") {
    body = <EmptyState inline icon="networks" title="No address in this scope" body="This wallet shared no address on the chains in scope." />;
  } else if (portfolio.loading) {
    body = <PositionBodySkeleton />;
  } else if (portfolio.status === "error" && !data) {
    body = <InlineError message={portfolio.error?.message ?? "Your balances could not be read."} onRetry={portfolio.refetch} />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        inline
        icon="assets"
        // Phones: the button takes its own line under the text, which would
        // otherwise be squeezed into a narrow column beside it.
        className="max-sm:flex-wrap max-sm:[&>div:last-child]:w-full max-sm:[&>div:last-child]:pl-12"
        title={`You hold no ${ticker}${selectedChainId ? ` on ${chainName(selectedChainId)}` : " in this scope"}`}
        body={tradable ? `Swap into ${ticker} on Osmosis, or receive it from another wallet.` : `Receive ${ticker} from another wallet or an exchange.`}
        action={
          tradable ? (
            <Button size="sm" variant="primary" iconLeft="swap" href={swapToHref(assetKey)}>
              Swap to {ticker}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" iconLeft="receive" href="/receive">
              Receive
            </Button>
          )
        }
      />
    );
  } else {
    body = (
      <>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <span className="d-label">Total</span>
            <p className="mt-1 truncate text-[22px] font-semibold leading-tight tracking-[-0.03em]">
              <TokenAmount amount={total} decimals={decimals} symbol={ticker} maxFraction={baseAmountDigits(total, decimals, 4)} symbolClassName="text-[15px] font-medium" />
            </p>
            <p className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-fg-dim">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Money value={value} currency={currency} reason="No price for this asset" className="text-[13.5px] font-medium text-fg-muted" />
                {change24h !== null ? <Delta value={change24h} kind="abs" currency={currency} period="24h" /> : null}
              </span>
              {share !== null ? (
                <span>
                  <Percent value={share} digits={share < 1 ? 2 : 1} /> of your portfolio
                </span>
              ) : null}
            </p>
          </div>
          {BUCKETS.map((bucket) => {
            const base = sumBucket(rows, bucket);
            const units = wholeUnits(base, decimals);
            return (
              <div key={bucket} className="min-w-0">
                <span className="d-label">{BUCKET_LABEL[bucket]}</span>
                <p className={cn("mt-1 truncate text-[15px] font-medium tabular-nums", base === BigInt(0) && "text-fg-faint")}>
                  {base === BigInt(0) ? "0" : <TokenAmount amount={base} decimals={decimals} maxFraction={baseAmountDigits(base, decimals, 4)} />}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-fg-dim">
                  {base === BigInt(0) || price === null || units === null ? " " : <Money value={units * price} currency={currency} />}
                </p>
              </div>
            );
          })}
        </div>
        {composition.parts.length > 1 ? (
          <StackedBar
            data={composition.parts}
            colors={composition.colors}
            legend="inline"
            thickness={10}
            title={composition.by === "chain" ? `${ticker} by chain` : `${ticker} by state`}
            valueFormatter={formatUnits}
          />
        ) : null}
        {rows.length > 1 ? (
          <CardBody flush className="-mb-[var(--d-pad)] border-t border-[var(--d-hairline)]">
            <DataTable
              ariaLabel={`Your ${ticker} by chain`}
              columns={tableColumns}
              rows={rows}
              getRowKey={(row) => `${row.chainId}:${row.identity.denom}`}
              initialSort={{ key: "value", dir: "desc" }}
              mobileCard={(row) => (
                <span className="flex flex-col gap-2">
                  <span className="flex items-center gap-2.5">
                    <ChainLogo chainId={row.chainId} size={22} />
                    <span className="flex-1 truncate font-medium">{row.identity.chainName ?? chainName(row.chainId)}</span>
                    <Money value={row.value} currency={currency} reason="No price" className="font-medium" />
                  </span>
                  <BucketAmounts row={row} />
                </span>
              )}
            />
          </CardBody>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--d-hairline)] pt-3">
            <span className="text-[12.5px] text-fg-dim">
              On {rows[0]?.identity.chainName ?? chainName(rows[0]?.chainId ?? "")}
              {rows[0] && rows[0].identity.originChainId !== rows[0].chainId && rows[0].identity.path ? (
                <span className="font-mono text-[11.5px]"> · {rows[0].identity.path}</span>
              ) : null}
            </span>
            {rows[0] ? <HoldingActions row={rows[0]} stakeable={isStakingCoin(rows[0].identity, bondDenomOf)} /> : null}
          </div>
        )}
      </>
    );
  }

  return (
    <Card className={className} pending={portfolio.stale}>
      <CardHeader
        title="Your position"
        subtitle={rows.length > 1 ? `On ${rows.length} chains` : undefined}
        refreshing={portfolio.refreshing && !portfolio.stale}
        actions={
          <>
            <PartialDataBadge errors={data?.errors} />
            {scopeNote}
          </>
        }
      />
      <CardBody className="flex flex-col gap-3">{body}</CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ activity */

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
  contract: "layers",
  authz: "shield",
  other: "activity",
};

/** Net base units of this asset in a transaction: in minus out. */
function netOf(item: ActivityItem, assetKey: string): bigint {
  let net = BigInt(0);
  for (const amount of item.amounts) {
    if (amount.identity.key !== assetKey || !/^\d+$/.test(amount.amount)) continue;
    net += amount.direction === "in" ? BigInt(amount.amount) : -BigInt(amount.amount);
  }
  return net;
}

export function AssetActivityCard({ assetKey, identity, className }: { assetKey: string; identity: TokenIdentity; className?: string }) {
  const activity = useActivity();
  const { hideAmounts } = usePrefs();
  const rows = useMemo(
    () => activity.items.filter((item) => item.amounts.some((amount) => amount.identity.key === assetKey)).slice(0, 10),
    [activity.items, assetKey],
  );
  const decimals = identity.decimals;
  const ticker = identity.ticker;
  // The Activity page's search box matches tickers today; `asset` narrows
  // to this very key once that page reads it (a lead request).
  const allHref = `/activity?asset=${encodeURIComponent(assetKey)}&q=${encodeURIComponent(ticker)}&range=all`;

  return (
    <Card className={className} pending={activity.stale}>
      <CardHeader
        title="Your activity"
        subtitle={`The last transactions that moved ${ticker}`}
        refreshing={activity.refreshing && !activity.stale}
        actions={
          <Button size="sm" variant="ghost" iconRight="arrowRight" href={allHref}>
            All {ticker} activity
          </Button>
        }
      />
      <CardBody>
        {activity.loading ? (
          <ul className="flex flex-col gap-3" aria-hidden>
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex items-center gap-3">
                <Skeleton circle width={30} />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3" width="60%" />
                  <Skeleton className="h-2.5" width="30%" />
                </span>
                <Skeleton className="h-3" width={64} />
              </li>
            ))}
          </ul>
        ) : activity.status === "error" && rows.length === 0 ? (
          <InlineError message={activity.error?.message ?? "Your history could not be read."} onRetry={activity.refetch} retrying={activity.refreshing} />
        ) : rows.length === 0 ? (
          <EmptyState
            inline
            icon="activity"
            title={`No ${ticker} transactions found`}
            body={
              activity.loadedUntil
                ? `None in the history loaded back to ${formatDate(Date.parse(activity.loadedUntil), "long")}.`
                : "None in the history the chains keep for this wallet."
            }
          />
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rows.map((item) => {
              const net = netOf(item, assetKey);
              const time = Date.parse(item.time);
              const at = Number.isFinite(time) ? time : null;
              return (
                <li key={`${item.chainId}:${item.hash}:${item.address}`}>
                  <Link
                    href={`/activity/${encodeURIComponent(item.hash)}?chainId=${encodeURIComponent(item.chainId)}`}
                    className="grid min-h-[52px] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2 py-2 transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)] md:grid-cols-[30px_minmax(0,1fr)_minmax(0,170px)_88px_minmax(110px,auto)]"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--d-glass-2)] text-fg-muted",
                        !item.success && "bg-[var(--z-danger-fill)] text-[var(--z-danger)]",
                      )}
                    >
                      <Icon name={item.success ? KIND_ICON[item.kind] : "danger"} size={15} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13.5px] text-fg">
                          {/* The sentence names amounts ("Sent 12.5 OSMO…"); a vote's number is a proposal id. */}
                          {hideAmounts ? maskAmounts(item.summary, item.kind === "vote" ? "vote" : "transfer") : item.summary}
                        </span>
                        {!item.success ? (
                          <Badge tone="danger" size="sm" className="shrink-0">
                            Failed
                          </Badge>
                        ) : null}
                      </span>
                      {/* Phones and tablets: chain and time under the sentence. */}
                      <span className="flex items-center gap-1.5 text-[12px] text-fg-dim md:hidden">
                        <ChainLogo chainId={item.chainId} size={14} />
                        <span className="truncate">{chainName(item.chainId)}</span>
                        <span aria-hidden>·</span>
                        <RelativeTime at={at} />
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-fg-muted max-md:hidden">
                      <ChainLogo chainId={item.chainId} size={16} />
                      <span className="truncate">{chainName(item.chainId)}</span>
                    </span>
                    <RelativeTime at={at} className="text-[12.5px] text-fg-dim max-md:hidden" />
                    <span className={cn("shrink-0 text-right text-[13.5px] font-medium tabular-nums", net > BigInt(0) ? "text-[var(--d-pos)]" : "text-fg")}>
                      {net === BigInt(0) ? (
                        <span className="text-fg-dim">±0</span>
                      ) : (
                        <TokenAmount amount={net} decimals={decimals} symbol={ticker} signed maxFraction={4} />
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {!activity.loading && activity.hasMore && rows.length > 0 ? (
        <CardFooter>
          <span>
            From your latest transactions{activity.loadedUntil ? ` back to ${formatDate(Date.parse(activity.loadedUntil), "long")}` : ""}; older ones are on the
            Activity page.
          </span>
        </CardFooter>
      ) : null}
    </Card>
  );
}
