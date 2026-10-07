"use client";

/**
 * Every chain of the scope side by side: value and share, the 24 h move of
 * today's holdings, how much of it is staked and at what actual APR, pending
 * rewards and unbonding, asset count. Selecting a row puts the whole
 * dashboard on that chain (the rail's scope), so it doubles as the way in.
 */

import { Card, CardBody, CardHeader, ChainLogo, DataTable, Delta, InlineError, Money, Percent, ShareBar, StatusBadge, Tooltip, type Column } from "@/components/ui";
import type { ChainStatsState } from "@/lib/data/chains";
import type { PortfolioState } from "@/lib/data/portfolio";
import { usePrefs } from "@/providers/PrefsProvider";
import { chainRowReason, chainRows, type ChainRow } from "./model";

export interface ChainsBreakdownProps {
  portfolio: PortfolioState;
  stats: ChainStatsState;
  onSelect: (chainId: string) => void;
  /** Scoped chains the wallet has no address on (names). */
  skipped: string[];
}

export function ChainsBreakdown({ portfolio, stats, onSelect, skipped }: ChainsBreakdownProps) {
  const { hideAmounts } = usePrefs();
  const data = portfolio.data;
  const currency = data?.currency ?? "usd";
  const rows = data ? chainRows(data, stats.data?.chains) : [];
  // Zero rewards and zero unbonding are the common case: a quiet "0" keeps
  // the columns readable for the chains where there is something. Privacy
  // mode masks it like any amount. Holdings print in cents at most ("<$0.01"
  // for dust), never with a price's significant figures.
  const quietMoney = (value: number | null) =>
    value === 0 && !hideAmounts ? (
      <span className="text-fg-faint">0</span>
    ) : (
      <Money value={value} currency={currency} precision={2} className="text-fg-muted" />
    );

  const columns: Column<ChainRow>[] = [
    {
      key: "chain",
      header: "Chain",
      sticky: true,
      minWidth: 168,
      sortable: true,
      sortValue: (row) => row.chainName.toLowerCase(),
      sortDescFirst: false,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <ChainLogo chainId={row.chainId} chain={{ chainName: row.chainName, coinDenom: row.nativeSymbol, iconUrl: row.iconUrl }} size={24} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium text-fg">{row.chainName}</span>
            <span className="block font-mono text-[11px] uppercase tracking-[0.04em] text-fg-dim">{row.nativeSymbol}</span>
          </span>
          {row.status === "error" ? (
            <Tooltip content={row.error ?? "The chain did not answer"}>
              <span>
                <StatusBadge tone="warning">Unreachable</StatusBadge>
              </span>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      sortable: true,
      sortValue: (row) => row.value,
      cell: (row) => (
        <Money
          value={row.value}
          currency={currency}
          precision={2}
          className="font-medium text-fg"
          reason={row.status === "error" ? "Not read" : "Nothing held here has a price"}
        />
      ),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      sortable: true,
      sortValue: (row) => row.share,
      cell: (row) => <ShareBar value={row.share} width={48} reason={chainRowReason(row, "share")} />,
    },
    {
      key: "change",
      header: "24h",
      align: "right",
      sortable: true,
      sortValue: (row) => row.change24hPct,
      cell: (row) => <Delta value={row.change24hPct} reason={chainRowReason(row, "change")} />,
    },
    {
      key: "staked",
      header: "Staked",
      align: "right",
      sortable: true,
      sortValue: (row) => row.stakedShare,
      hideBelow: "md",
      cell: (row) => <Percent value={row.stakedShare} digits={0} reason={chainRowReason(row, "staked")} className="text-fg-muted" />,
    },
    {
      key: "apr",
      header: "APR",
      align: "right",
      sortable: true,
      sortValue: (row) => row.apr,
      cell: (row) => <Percent value={row.apr} digits={1} reason={row.aprReason} />,
    },
    {
      key: "rewards",
      header: "Rewards",
      align: "right",
      sortable: true,
      sortValue: (row) => row.rewards,
      hideBelow: "lg",
      cell: (row) => quietMoney(row.rewards),
    },
    {
      key: "unbonding",
      header: "Unbonding",
      align: "right",
      sortable: true,
      sortValue: (row) => row.unbonding,
      hideBelow: "xl",
      cell: (row) => quietMoney(row.unbonding),
    },
    {
      key: "assets",
      header: "Assets",
      align: "right",
      sortable: true,
      sortValue: (row) => row.assetCount,
      hideBelow: "lg",
      cell: (row) => <span className="text-fg-muted">{row.assetCount}</span>,
    },
  ];

  const footer = data ? (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>Select a chain to focus the whole dashboard on it.</span>
      {skipped.length > 0 ? (
        <span>
          · Not read: {skipped.join(", ")} (no address from this wallet)
        </span>
      ) : null}
    </span>
  ) : undefined;

  return (
    <Card pending={portfolio.stale || stats.stale} padding="default">
      <CardHeader
        title="Chains"
        subtitle={
          data
            ? `${data.totals.chainCount} of ${data.chains.length} hold assets · APR is the chain's actual rate before commission`
            : "Your value on each followed network"
        }
      />
      <CardBody flush>
        {portfolio.status === "error" && !data ? (
          // A failed read is not an empty table.
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">
            <InlineError message={portfolio.error?.message ?? "The portfolio read failed."} onRetry={portfolio.refetch} />
          </div>
        ) : (
          <DataTable<ChainRow>
            ariaLabel="Your value per chain"
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.chainId}
            loading={portfolio.loading}
            skeletonRows={4}
            initialSort={{ key: "value", dir: "desc" }}
            onRowClick={(row) => onSelect(row.chainId)}
            footer={footer}
            mobileCard={(row) => (
              <span className="flex items-center gap-3">
                <ChainLogo chainId={row.chainId} chain={{ chainName: row.chainName, coinDenom: row.nativeSymbol, iconUrl: row.iconUrl }} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-fg">{row.chainName}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-dim">
                    <Percent value={row.share} digits={1} reason={chainRowReason(row, "share")} />
                    <span aria-hidden>·</span>
                    <span>
                      APR <Percent value={row.apr} digits={1} reason={row.aprReason} />
                    </span>
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Money
                    value={row.value}
                    currency={currency}
                    precision={2}
                    reason={row.status === "error" ? "Not read" : "Nothing held here has a price"}
                    className="text-[14px] font-medium text-fg"
                  />
                  <Delta value={row.change24hPct} reason={chainRowReason(row, "change")} />
                </span>
              </span>
            )}
          />
        )}
      </CardBody>
    </Card>
  );
}
