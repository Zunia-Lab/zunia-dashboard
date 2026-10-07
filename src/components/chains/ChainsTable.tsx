"use client";

/**
 * The Chains page's list, over one set of rows: the table's columns from
 * 640px (which drop out by width so 1280 and up never scroll sideways) and
 * the card list phones get instead, plus the "How to read this table" guide.
 *
 * Every figure waits for its row's stats (a skeleton), or says why it has
 * none ("—" with the reason). Prices come from the markets feed and are never
 * masked; "Your value" follows the privacy setting.
 */

import type { ReactNode } from "react";
import { Checkbox, Delta, EmptyState, Money, Percent, type Column } from "@/components/ui";
import type { ChainEntry } from "@/lib/chains";
import type { ChainStats } from "@/lib/chain/types";
import type { MarketAsset } from "@/lib/data/markets";
import { formatNumber } from "@/lib/format";
import { MAX_ENTITIES } from "@/components/compare/model";
import { AprText, CellSkeleton, ChainIdentity, Dash, RealYieldText, reasonOf } from "./cells";
import { FollowButton } from "./FollowButton";
import { formatDays, formatSeconds, toPct } from "./model";
import type { FollowApi } from "./useFollow";
import type { RowState } from "./useLazyChainStats";

export interface ChainRow {
  chain: ChainEntry;
  stats: ChainStats | null;
  state: RowState;
  market: MarketAsset | null;
  /** The user's value on this chain; undefined without a wallet. */
  value?: { amount: number | null; reason?: string; loading?: boolean };
}

/** Price, 24 h change and the currency they are in: the markets feed first, the stats' own price second. */
function priceOf(row: ChainRow, marketCurrency: string | null, statsCurrency: string | null) {
  if (row.market) {
    return { price: row.market.price, change: row.market.change24h, currency: marketCurrency, source: row.market.source };
  }
  const spot = row.stats?.price ?? null;
  if (spot) return { price: spot.price, change: spot.change24h, currency: statsCurrency, source: spot.label ?? spot.source };
  return null;
}

export interface ColumnDeps {
  connected: boolean;
  selected: string[];
  toggleSelect: (chainId: string) => void;
  follow: FollowApi;
  toggleFollow: (chainId: string) => void;
  marketCurrency: string | null;
  statsCurrency: string | null;
  portfolioCurrency: string | null;
}

/** Renders a stats figure once the row has stats, a skeleton while it loads, a reasoned dash when it failed. */
function statCell(row: ChainRow, render: (stats: ChainStats) => ReactNode, width = 40, align: "left" | "right" = "right"): ReactNode {
  if (row.stats) return render(row.stats);
  if (row.state.status === "loading") return <CellSkeleton width={width} align={align} />;
  return <Dash reason={row.state.reason} />;
}

/**
 * Columns shown from 1536px (the validator count; inflation from 1440, block
 * time from 1800): with the sidebar open, 1280–1439 fits the decision
 * columns and no more (bonded gives way to "Your value" there when a wallet
 * is connected). The kit's `hideBelow` stops at xl, hence classes on both
 * header and cells.
 */
const WIDE_ONLY = { className: "max-2xl:hidden", headerClassName: "max-2xl:hidden" } as const;

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function SelectBox({ row, deps }: { row: ChainRow; deps: ColumnDeps }) {
  const on = deps.selected.includes(row.chain.chainId);
  const full = deps.selected.length >= MAX_ENTITIES && !on;
  return (
    // The label widens the hit area to 44px on touch screens (d-hit).
    <label className="d-hit inline-flex cursor-pointer items-center" title={full ? `Compare up to ${MAX_ENTITIES} at once` : undefined}>
      <Checkbox
        checked={on}
        disabled={full}
        onCheckedChange={() => deps.toggleSelect(row.chain.chainId)}
        ariaLabel={`Compare ${row.chain.chainName}`}
      />
    </label>
  );
}

function PriceCell({ row, deps }: { row: ChainRow; deps: ColumnDeps }) {
  const price = priceOf(row, deps.marketCurrency, deps.statsCurrency);
  if (!price) {
    if (row.state.status === "loading" && row.chain.network === "mainnet") return <CellSkeleton width={56} />;
    return <Dash reason={row.chain.network === "testnet" ? "Testnet token: no market" : reasonOf(row.stats, "price", "No market quotes this token")} />;
  }
  return (
    <span className="flex flex-col items-end leading-tight" title={price.source ? `Price: ${price.source}` : undefined}>
      {/* A market price says nothing about a position: never masked. */}
      <Money value={price.price} currency={price.currency ?? undefined} masked={false} className="text-fg" />
      <Delta value={price.change} className="mt-1 text-[11.5px]" />
    </span>
  );
}

export function chainColumns(deps: ColumnDeps): Column<ChainRow>[] {
  const columns: Column<ChainRow>[] = [
    {
      // The compare tick lives in the chain cell so the column can stay
      // pinned while the figures scroll sideways on narrower screens.
      key: "chain",
      header: "Chain",
      sortable: true,
      sortValue: (row) => row.chain.chainName.toLowerCase(),
      sortDescFirst: false,
      sticky: true,
      cell: (row) => (
        // 220px on tablets: the five columns left there fit a 640px card.
        <span className="flex max-w-[220px] items-center gap-3 xl:max-w-[248px]">
          <SelectBox row={row} deps={deps} />
          <ChainIdentity chain={row.chain} stats={row.stats} href={`/chains/${encodeURIComponent(row.chain.chainId)}`} meta={row.chain.coinDenom} className="min-w-0" />
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      sortable: true,
      sortValue: (row) => priceOf(row, deps.marketCurrency, deps.statsCurrency)?.price ?? null,
      cell: (row) => <PriceCell row={row} deps={deps} />,
    },
    {
      key: "apr",
      header: "APR",
      align: "right",
      sortable: true,
      sortValue: (row) => num(row.stats?.apr.actual),
      cell: (row) => statCell(row, (s) => <AprText stats={s} />),
    },
    {
      key: "real",
      header: "Real yield",
      align: "right",
      sortable: true,
      sortValue: (row) => num(row.stats?.realYield),
      cell: (row) => statCell(row, (s) => <RealYieldText value={s.realYield} reason={reasonOf(s, "realYield")} />),
    },
    {
      key: "inflation",
      header: "Inflation",
      align: "right",
      className: "max-[1439px]:hidden",
      headerClassName: "max-[1439px]:hidden",
      sortable: true,
      sortValue: (row) => num(row.stats?.inflation.actual),
      cell: (row) => statCell(row, (s) => <Percent value={toPct(s.inflation.actual)} reason={reasonOf(s, "inflation")} className="text-fg-muted" />),
    },
    {
      key: "bonded",
      header: "Bonded",
      align: "right",
      // With a wallet, "Your value" takes this column's room until 1440.
      ...(deps.connected ? { className: "max-[1439px]:hidden", headerClassName: "max-[1439px]:hidden" } : { hideBelow: "xl" as const }),
      sortable: true,
      sortValue: (row) => num(row.stats?.bondedRatio),
      cell: (row) => statCell(row, (s) => <Percent value={toPct(s.bondedRatio)} digits={1} reason={reasonOf(s, "bondedRatio")} className="text-fg-muted" />),
    },
    {
      key: "unbonding",
      header: "Unbonding",
      align: "right",
      hideBelow: "lg",
      sortable: true,
      sortValue: (row) => num(row.stats?.unbondingDays),
      sortDescFirst: false,
      cell: (row) =>
        statCell(row, (s) => {
          const text = formatDays(s.unbondingDays);
          return text ? <span className="text-fg-muted">{text}</span> : <Dash reason={reasonOf(s, "unbondingDays")} />;
        }),
    },
    {
      key: "validators",
      header: "Validators",
      align: "right",
      ...WIDE_ONLY,
      sortable: true,
      sortValue: (row) => num(row.stats?.activeValidators),
      cell: (row) =>
        statCell(row, (s) =>
          s.activeValidators === null ? (
            <Dash reason={reasonOf(s, "activeValidators")} />
          ) : (
            <span className="text-fg-muted">
              {formatNumber(s.activeValidators)}
              {s.maxValidators ? <span className="text-fg-dim"> / {formatNumber(s.maxValidators)}</span> : null}
            </span>
          ),
        ),
    },
    {
      key: "nakamoto",
      header: "Nakamoto",
      align: "right",
      hideBelow: "lg",
      sortable: true,
      sortValue: (row) => num(row.stats?.nakamoto),
      cell: (row) =>
        statCell(row, (s) => (s.nakamoto === null ? <Dash reason={reasonOf(s, "nakamoto")} /> : <span className="font-medium">{formatNumber(s.nakamoto)}</span>), 20),
    },
    {
      key: "block",
      header: "Block time",
      align: "right",
      className: "max-[1799px]:hidden",
      headerClassName: "max-[1799px]:hidden",
      sortable: true,
      sortValue: (row) => num(row.stats?.blockTimeSec),
      sortDescFirst: false,
      cell: (row) =>
        statCell(row, (s) => {
          const text = formatSeconds(s.blockTimeSec);
          return text ? <span className="text-fg-muted">{text}</span> : <Dash reason={reasonOf(s, "blockTimeSec")} />;
        }),
    },
  ];

  if (deps.connected) {
    columns.push({
      key: "value",
      header: "Your value",
      align: "right",
      hideBelow: "xl",
      sortable: true,
      sortValue: (row) => row.value?.amount ?? null,
      cell: (row) =>
        row.value?.loading ? (
          <CellSkeleton width={48} />
        ) : row.value?.amount !== null && row.value?.amount !== undefined ? (
          <Money value={row.value.amount} currency={deps.portfolioCurrency ?? undefined} compact className={row.value.amount === 0 ? "text-fg-dim" : "font-medium"} />
        ) : (
          <Dash reason={row.value?.reason} />
        ),
    });
  }

  columns.push({
    key: "follow",
    header: <span className="sr-only">Follow</span>,
    width: 48,
    align: "center",
    cell: (row) => (
      <FollowButton chainName={row.chain.chainName} followed={deps.follow.isFollowed(row.chain.chainId)} onToggle={() => deps.toggleFollow(row.chain.chainId)} />
    ),
    className: "!px-1",
  });

  return columns;
}

/* ------------------------------------------------------------------ phones */

interface PhoneListProps {
  rows: ChainRow[];
  selected: string[];
  toggleSelect: (chainId: string) => void;
  follow: FollowApi;
  toggleFollow: (chainId: string) => void;
  empty?: ReactNode;
  marketCurrency: string | null;
  statsCurrency: string | null;
  portfolioCurrency: string | null;
}

/**
 * Under 640px a 12-column table does not fit: each chain is a card whose
 * name is a stretched link to its page, with the compare tick and the star
 * lifted above the link so both stay tappable (44px targets).
 */
export function PhoneList({ rows, selected, toggleSelect, follow, toggleFollow, empty, marketCurrency, statsCurrency, portfolioCurrency }: PhoneListProps) {
  const deps: ColumnDeps = { connected: false, selected, toggleSelect, follow, toggleFollow, marketCurrency, statsCurrency, portfolioCurrency };
  if (rows.length === 0) return <div className="px-[var(--d-pad)] sm:hidden">{empty ?? <EmptyState title="Nothing to show" />}</div>;
  return (
    <ul className="divide-y divide-[var(--d-hairline)] border-t border-[var(--d-hairline)] sm:hidden" aria-label="Chains">
      {rows.map((row) => {
        const s = row.stats;
        return (
          <li key={row.chain.chainId} className="relative flex flex-col gap-2.5 px-[var(--d-pad)] py-3 transition-colors duration-[160ms] active:bg-[var(--d-row-hover)]">
            <div className="flex items-center gap-3">
              <span className="relative z-[1]">
                <SelectBox row={row} deps={deps} />
              </span>
              <ChainIdentity chain={row.chain} stats={s} href={`/chains/${encodeURIComponent(row.chain.chainId)}`} stretch meta={row.chain.coinDenom} className="flex-1" />
              <span className="shrink-0 text-[14px] tabular-nums">
                <PriceCell row={row} deps={deps} />
              </span>
            </div>
            <div className="flex items-center gap-3 pl-[29px]">
              <dl className="grid min-w-0 flex-1 grid-cols-4 gap-x-2 text-[12px] leading-tight">
                <PhoneFigure label="APR" row={row} render={(st) => <AprText stats={st} className="justify-start" />} />
                <PhoneFigure label="Real" row={row} render={(st) => <RealYieldText value={st.realYield} reason={reasonOf(st, "realYield")} />} />
                <PhoneFigure label="Unbond" row={row} render={(st) => formatDays(st.unbondingDays)?.replace(" days", " d").replace(" day", " d") ?? <Dash />} />
                <PhoneFigure label="Nakamoto" row={row} render={(st) => (st.nakamoto === null ? <Dash reason={reasonOf(st, "nakamoto")} /> : formatNumber(st.nakamoto))} />
              </dl>
              <span className="relative z-[1] -mr-1.5">
                <FollowButton chainName={row.chain.chainName} followed={follow.isFollowed(row.chain.chainId)} onToggle={() => toggleFollow(row.chain.chainId)} />
              </span>
            </div>
            {/* Only a real holding earns a line: "You hold —" on 200 cards
                (chains not followed, or nothing there) would be noise. */}
            {row.value && row.value.amount !== null && row.value.amount > 0 ? (
              <p className="pl-[29px] text-[12px] text-fg-dim">
                You hold <Money value={row.value.amount} currency={portfolioCurrency ?? undefined} compact className="font-medium text-fg" />
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PhoneFigure({ label, row, render }: { label: string; row: ChainRow; render: (stats: ChainStats) => ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-dim">{label}</dt>
      <dd className="mt-1 truncate tabular-nums text-fg-muted">{statCell(row, render, 28, "left")}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ guide */

export function ColumnGuide() {
  const items: Array<[string, string]> = [
    ["APR", "What delegators earn from issuance before validator commission, corrected for the chain's real block time (x/mint pays per block, so faster blocks pay more than the parameters say). Hover a figure for the naive one. Fees and MEV are not included. \"3P\" marks a third-party figure from cosmos.directory."],
    ["Real yield", "APR minus actual inflation: how much your share of the supply grows a year by staking. Negative means even stakers are diluted."],
    ["Inflation", "New tokens actually issued in a year ÷ total supply."],
    ["Bonded", "Share of the supply staked with validators."],
    ["Unbonding", "How long unstaked tokens stay locked."],
    ["Validators", "Active validators / slots in the active set."],
    ["Nakamoto", "Fewest validators holding more than a third of the stake: enough to halt the chain."],
    ["Block time", "Average time between blocks, observed over the latest blocks."],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2.5 pt-1 sm:grid-cols-2">
      {items.map(([term, text]) => (
        <div key={term} className="min-w-0">
          <dt className="text-[12.5px] font-medium text-fg">{term}</dt>
          <dd className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-dim">{text}</dd>
        </div>
      ))}
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-[12.5px] font-medium text-fg">Sources</dt>
        <dd className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-dim">
          Each chain&apos;s public LCD (mint, staking, distribution, slashing, governance), read by the dashboard server and cached
          for up to an hour. Prices: Numia (Osmosis markets) and Coinstore for SAF. Figures load for the rows on screen.
        </dd>
      </div>
    </dl>
  );
}
