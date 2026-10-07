"use client";

/**
 * The Markets table: every listed Cosmos asset with price, 24 h and 7 d
 * change, a 7-day sparkline, Osmosis liquidity, 24 h volume and market cap.
 * Tabs (All, Watchlist, Gainers, Losers), search, a watchlist star per row,
 * "You hold" when a wallet is connected, and a Swap shortcut for what
 * Osmosis trades. Rows link to the asset page; under 640px they are cards.
 *
 * Sorting is done here, before the "first 50" cut, so a sort by price ranks
 * all of them, not the first page.
 */

import { useId, useMemo, useState } from "react";
import { Sparkline } from "@/components/charts";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Icon } from "@/components/icons";
import {
  AssetLogo,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Chip,
  DataTable,
  Delta,
  EmptyState,
  FilterBar,
  IconButton,
  InfoTip,
  Money,
  PartialDataBadge,
  SearchInput,
  SourceTag,
  TabPanel,
  Tabs,
  useNow,
  type Column,
  type SortState,
} from "@/components/ui";
import { sortRows } from "@/components/ui/table-sort";
import { assetHref, swapToHref } from "@/components/assets/links";
import { RowControl, chainName } from "@/components/assets/AssetCells";
import { clampToNow } from "@/components/assets/read-at";
import { cn } from "@/lib/cn";
import { formatFiat } from "@/lib/format";
import type { MarketAsset, MarketsResponse } from "@/lib/token/wire";
import { liquidityRanks, marketCapReason, matchesMarketQuery, MOVER_FLOOR, tabRows, type MarketTab } from "./markets";
import type { Watchlist } from "./watchlist";

const PAGE = 50;

const DEFAULT_SORT: Record<MarketTab, SortState> = {
  all: { key: "Rank", dir: "asc" },
  watchlist: { key: "Rank", dir: "asc" },
  gainers: { key: "change24h", dir: "desc" },
  losers: { key: "change24h", dir: "asc" },
};

interface Row {
  asset: MarketAsset;
  rank: number | null;
}

export interface MarketsTableProps {
  data: MarketsResponse | null;
  loading: boolean;
  pending: boolean;
  refreshing: boolean;
  watchlist: Watchlist;
  /** Asset keys the connected wallet holds (empty without a wallet). */
  held: ReadonlySet<string>;
  /**
   * The rail's chain while the table is narrowed to it (the page drops it
   * for the visit when asked): the list shows only assets issued there.
   */
  scopeChainId: string | null;
  /** Show every asset again, not only those issued on `scopeChainId`. */
  onDropScope: () => void;
  /** A wallet is connected ("You hold" badges); without one the header offers to connect. */
  connected: boolean;
  /** A remembered wallet is being restored: hold the offer to connect, it would flash and go. */
  restoring?: boolean;
}

export function MarketsTable({
  data,
  loading,
  pending,
  refreshing,
  watchlist,
  held,
  scopeChainId,
  onDropScope,
  connected,
  restoring = false,
}: MarketsTableProps) {
  const connect = useConnectModal();
  const tabsId = useId();
  const [tab, setTab] = useState<MarketTab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT.all);
  const [showAll, setShowAll] = useState(false);

  const currency = data?.currency ?? "usd";
  const assets = useMemo(() => data?.assets ?? [], [data]);
  const ranks = useMemo(() => liquidityRanks(assets), [assets]);

  // The scope filter applies before the tabs, so their counts match the rows.
  const scoped = useMemo(() => (scopeChainId ? assets.filter((asset) => asset.chainId === scopeChainId) : assets), [assets, scopeChainId]);
  const counts = useMemo(
    () => ({
      all: scoped.length,
      watchlist: tabRows(scoped, "watchlist", watchlist.set).length,
      gainers: tabRows(scoped, "gainers", watchlist.set).length,
      losers: tabRows(scoped, "losers", watchlist.set).length,
    }),
    [scoped, watchlist.set],
  );

  const columns: Column<Row>[] = useMemo(
    () => [
      {
        // Capitalised: the phone sort menu names a column by its key when the
        // header is not plain text.
        key: "Rank",
        // The star sits in front of the rank so the two share one narrow column.
        header: <span className="pl-[30px]">#</span>,
        width: 68,
        cell: ({ asset, rank }) => {
          const on = watchlist.has(asset.key);
          return (
            <span className="-ml-1.5 flex items-center gap-0.5">
              <IconButton
                size="sm"
                label={on ? `Remove ${asset.symbol} from your watchlist` : `Add ${asset.symbol} to your watchlist`}
                tooltip={on ? "Watching" : "Watch"}
                pressed={on}
                onClick={() => watchlist.toggle(asset.key)}
              >
                <Icon name="star" size={16} fill={on ? "currentColor" : "none"} className={on ? "text-[var(--z-warning)]" : undefined} />
              </IconButton>
              {rank === null ? (
                <span className="w-6 text-right text-fg-faint" title="Not traded on Osmosis: no liquidity rank">
                  —
                </span>
              ) : (
                <span className="w-6 text-right font-mono text-[12px] text-fg-dim">{rank}</span>
              )}
            </span>
          );
        },
        sortable: true,
        sortValue: ({ rank }) => rank,
        sortDescFirst: false,
      },
      {
        key: "asset",
        header: "Asset",
        // Takes what the figures leave and truncates (see the holdings table).
        width: "100%",
        minWidth: 150,
        className: "max-w-0",
        cell: ({ asset }) => (
          <span className="flex min-w-0 items-center gap-3">
            <AssetLogo src={asset.logoUrl} symbol={asset.symbol} size={28} />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium tracking-[-0.01em]">{asset.symbol}</span>
                {held.has(asset.key) ? (
                  // Neutral, with the wallet glyph: red is what a loss looks like in this table.
                  <Badge tone="neutral" size="sm" icon={<Icon name="wallet" size={11} />} className="h-[18px] px-1.5 text-[10.5px]">
                    You hold
                  </Badge>
                ) : null}
                {!asset.verified ? (
                  <Badge tone="warning" variant="outline" size="sm" className="h-[18px] px-1 text-[10.5px]" title="Not in Zunia's verified token table: named by the source only">
                    Unverified
                  </Badge>
                ) : null}
              </span>
              <span className="truncate text-[12px] text-fg-dim">{asset.name}</span>
            </span>
          </span>
        ),
        sortable: true,
        sortValue: ({ asset }) => asset.symbol.toLowerCase(),
        sortDescFirst: false,
      },
      {
        key: "price",
        header: "Price",
        align: "right",
        cell: ({ asset }) => <Money masked={false} value={asset.price} currency={currency} className="font-medium" />,
        sortable: true,
        sortValue: ({ asset }) => asset.price,
      },
      {
        key: "change24h",
        header: "24h",
        align: "right",
        cell: ({ asset }) => <Delta value={asset.change24h} />,
        sortable: true,
        sortValue: ({ asset }) => asset.change24h,
      },
      {
        key: "change7d",
        header: "7d",
        align: "right",
        cell: ({ asset }) => <Delta value={asset.change7d} />,
        sortable: true,
        sortValue: ({ asset }) => asset.change7d,
        hideBelow: "xl",
      },
      {
        key: "spark",
        header: "7d chart",
        align: "right",
        cell: ({ asset }) =>
          asset.sparkline7d && asset.sparkline7d.length > 1 ? (
            <span className="inline-flex justify-end">
              <Sparkline data={asset.sparkline7d} width={72} height={24} tone="trend" label={`${asset.symbol}, 7 days`} />
            </span>
          ) : (
            <span className="text-[12px] text-fg-faint" title="7-day lines are drawn for the 40 most liquid assets">
              —
            </span>
          ),
        hideBelow: "md",
      },
      {
        key: "liquidity",
        header: "Liquidity",
        align: "right",
        cell: ({ asset }) => <Money masked={false} value={asset.liquidity} currency={currency} compact precision={0} reason="Not in an Osmosis pool" />,
        sortable: true,
        sortValue: ({ asset }) => asset.liquidity,
        hideBelow: "lg",
      },
      {
        key: "volume",
        header: "Volume 24h",
        align: "right",
        cell: ({ asset }) => <Money masked={false} value={asset.volume24h} currency={currency} compact precision={0} reason="No volume reported" />,
        sortable: true,
        sortValue: ({ asset }) => asset.volume24h,
        // A ninth figure column only fits from 1440 px with the full sidebar.
        className: "max-[90rem]:hidden",
        headerClassName: "max-[90rem]:hidden",
      },
      {
        key: "cap",
        header: "Market cap",
        align: "right",
        cell: ({ asset }) =>
          asset.marketCap !== null ? (
            <Money masked={false} value={asset.marketCap} currency={currency} compact precision={0} />
          ) : (
            <span className="inline-flex items-center gap-1 text-fg-dim">
              —
              <RowControl className="inline-flex">
                <InfoTip size={12} content={marketCapReason(asset)} label={`Why ${asset.symbol} has no market cap`} />
              </RowControl>
            </span>
          ),
        sortable: true,
        sortValue: ({ asset }) => asset.marketCap,
        hideBelow: "xl",
      },
      {
        key: "swap",
        header: <span className="sr-only">Swap</span>,
        align: "right",
        width: 40,
        cell: ({ asset }) =>
          asset.tradable ? (
            <IconButton size="sm" icon="swap" label={`Swap to ${asset.symbol}`} href={swapToHref(asset.key)} />
          ) : (
            <span className="inline-flex size-[var(--d-ctl-sm)] items-center justify-center text-fg-faint" title={`${asset.symbol} isn't traded on Osmosis`}>
              <Icon name="swap" size={16} aria-hidden />
            </span>
          ),
        hideBelow: "md",
      },
    ],
    [currency, held, watchlist],
  );

  const rows = useMemo(() => {
    let list = tabRows(scoped, tab, watchlist.set);
    if (query.trim()) list = list.filter((asset) => matchesMarketQuery(asset, query));
    const mapped = list.map<Row>((asset) => ({ asset, rank: ranks.get(asset.key) ?? null }));
    const column = columns.find((entry) => entry.key === sort.key);
    return column?.sortValue ? sortRows(mapped, column.sortValue, sort.dir) : mapped;
  }, [scoped, tab, watchlist.set, query, ranks, columns, sort]);

  const searching = query.trim().length > 0;
  const visible = showAll || searching ? rows : rows.slice(0, PAGE);

  const changeTab = (next: MarketTab) => {
    setTab(next);
    setSort(DEFAULT_SORT[next]);
  };

  const empty =
    tab === "watchlist" && counts.watchlist === 0 ? (
      <EmptyState
        icon="star"
        title="Your watchlist is empty"
        body="Star any asset to follow it here. The list stays in this browser; nothing is sent anywhere."
        action={
          <Button size="sm" variant="secondary" onClick={() => changeTab("all")}>
            Browse all assets
          </Button>
        }
      />
    ) : scopeChainId && !searching ? (
      <EmptyState
        icon="markets"
        title={`No listed asset is issued on ${chainName(scopeChainId)}`}
        body="Show every asset to browse the whole market."
        action={
          <Button size="sm" variant="secondary" onClick={onDropScope}>
            Show all assets
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon="search"
        title="No asset matches"
        body={searching ? `Nothing named "${query.trim()}" in this tab.` : "Nothing in this tab right now."}
        action={
          searching ? (
            <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
              Clear search
            </Button>
          ) : null
        }
      />
    );

  const sources = data?.sources ?? [];
  const now = useNow();

  return (
    <Card pending={pending}>
      <CardHeader
        title="Cosmos markets"
        subtitle={
          data ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {/* Narrowed to a chain, the count says so: "129 assets" over a tab reading "All 17" would not add up. */}
                {scopeChainId
                  ? `${scoped.length} of ${assets.length} assets, issued on ${chainName(scopeChainId)}`
                  : `${assets.length} ${assets.length === 1 ? "asset" : "assets"}`}{" "}
                · prices in {currency.toUpperCase()}
              </span>
              {sources.map((source) => (
                <span key={source.id} className="inline-flex items-center gap-1">
                  {source.ok ? null : (
                    <Badge tone="warning" size="sm" title="This source failed on the last read: its rows are missing">
                      down
                    </Badge>
                  )}
                  <SourceTag source={source.label} at={clampToNow(source.at, now)} />
                </span>
              ))}
            </span>
          ) : (
            "Prices, moves and liquidity"
          )
        }
        refreshing={refreshing}
        actions={
          <>
            <PartialDataBadge errors={data?.errors} />
            {connected || restoring ? null : (
              <Button size="sm" variant="ghost" iconLeft="wallet" onClick={() => connect.open()}>
                See what you hold
              </Button>
            )}
          </>
        }
      />
      {/* The lists, then search first and the scope beside it: the order of
          every filter row (Governance has tabs over it too; Assets and Chains
          start with search). Under 400 px the four tabs tighten (gap, label
          size, count padding) so "Losers" and its count stay on the card
          down to a 360 px phone. */}
      <Tabs
        id={tabsId}
        ariaLabel="Market lists"
        value={tab}
        onChange={changeTab}
        className="max-sm:gap-3.5 max-[25rem]:gap-2 max-[25rem]:[&>button]:text-[13px] max-[25rem]:[&>button>span]:px-1"
        items={[
          { value: "all", label: "All", count: data ? counts.all : undefined },
          { value: "watchlist", label: "Watchlist", count: counts.watchlist },
          { value: "gainers", label: "Gainers", count: data ? counts.gainers : undefined },
          { value: "losers", label: "Losers", count: data ? counts.losers : undefined },
        ]}
      />
      <FilterBar>
        <SearchInput value={query} onChange={setQuery} placeholder="Search assets" className="w-full sm:w-56" aria-label="Search markets" />
        {scopeChainId ? (
          <Chip onRemove={onDropScope} removeLabel={`Show assets from every chain, not only ${chainName(scopeChainId)}`}>
            Issued on {chainName(scopeChainId)}
          </Chip>
        ) : null}
      </FilterBar>
      <CardBody flush>
        <TabPanel tabsId={tabsId} value={tab} active>
          <DataTable
            ariaLabel={`Cosmos markets: ${tab}`}
            density="compact"
            columns={columns}
            rows={visible}
            getRowKey={(row) => row.asset.key}
            rowHref={(row) => assetHref(row.asset.key)}
            sort={sort}
            onSortChange={setSort}
            manualSort
            loading={loading}
            skeletonRows={10}
            empty={empty}
            mobileCard={(row) => (
              <span className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-center font-mono text-[11px] text-fg-dim">{row.rank ?? "—"}</span>
                <AssetLogo src={row.asset.logoUrl} symbol={row.asset.symbol} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  {/* Phones: "You hold" is the wallet glyph alone, beside the star, so
                      neither the ticker nor the name loses its room to a badge. */}
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{row.asset.symbol}</span>
                    {held.has(row.asset.key) ? <Icon name="wallet" size={12} className="shrink-0 text-fg-muted" title="You hold this" /> : null}
                    {watchlist.has(row.asset.key) ? <Icon name="star" size={13} fill="currentColor" className="shrink-0 text-[var(--z-warning)]" title="On your watchlist" /> : null}
                  </span>
                  <span className="truncate text-[12px] text-fg-dim">{row.asset.name}</span>
                </span>
                {/* Fixed slots, so the lines and prices form columns down the list. */}
                <span className="flex w-[56px] shrink-0 justify-center max-[360px]:hidden">
                  {row.asset.sparkline7d && row.asset.sparkline7d.length > 1 ? (
                    <Sparkline data={row.asset.sparkline7d} width={56} height={24} tone="trend" dot={false} label={`${row.asset.symbol}, 7 days`} />
                  ) : null}
                </span>
                <span className="flex w-[88px] shrink-0 flex-col items-end gap-1">
                  <Money masked={false} value={row.asset.price} currency={currency} className="max-w-full truncate text-[14px] font-medium" />
                  <Delta value={row.asset.change24h} />
                </span>
              </span>
            )}
          />
        </TabPanel>
      </CardBody>
      {data && !loading ? (
        <CardFooter className={cn("justify-between gap-y-2")}>
          <span>
            {tab === "gainers" || tab === "losers"
              ? `Assets with at least ${formatFiat(MOVER_FLOOR, currency, { compact: true })} of Osmosis liquidity (or 24 h volume off Osmosis), ranked by 24 h change.`
              : `Showing ${visible.length} of ${rows.length}${searching ? " matches" : ""} · ranked by Osmosis liquidity`}
          </span>
          {!showAll && !searching && rows.length > PAGE ? (
            <Button size="sm" variant="ghost" iconRight="chevronDown" onClick={() => setShowAll(true)}>
              Show all {rows.length}
            </Button>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
