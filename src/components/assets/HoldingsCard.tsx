"use client";

/**
 * The Assets page's table: every holding of the scope, filtered (search,
 * type chips, "Hide < $1" at the viewer's floor, the unlisted fold) and
 * grouped either by asset (one row per asset, its chains expandable) or by
 * chain (a section per chain). Each row links to the asset page and carries
 * Send / Swap / Bridge / Stake for its holding; under 640px rows become
 * cards. Every count it prints is in the view's unit: assets by asset,
 * holdings by chain.
 *
 * The view choices are per-viewer conveniences kept in this browser.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Sparkline } from "@/components/charts";
import {
  AssetLogo,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChainLogo,
  ChipGroup,
  DataTable,
  Delta,
  EmptyState,
  FilterBar,
  InfoTip,
  Money,
  PartialDataBadge,
  SearchInput,
  Segmented,
  ShareBar,
  Switch,
  TokenAmount,
  csvFileName,
  downloadCsv,
  type Column,
  type SortState,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { groupAssets, type AssetGroup } from "@/lib/token/holdings";
import type { MarketAsset, PortfolioAsset, PortfolioResponse } from "@/lib/token/wire";
import { useStoredValue } from "@/lib/useStoredValue";
import { AssetName, BucketAmounts, HoldingActions, HoldingActionsMenu, NoPriceBadge, PriceCell, TrustBadge, chainIcon, chainName } from "./AssetCells";
import {
  ASSET_TYPE_LABELS,
  SMALL_VALUE,
  amountDigits,
  bondedShare,
  chainSections,
  filterRows,
  floorText,
  groupBaseTotal,
  groupChange24h,
  groupChange7d,
  hideSmallGroups,
  holdingsCsv,
  isSmall,
  nonZeroBuckets,
  typeCounts,
  type AssetTypeFilter,
  type CountUnit,
} from "./holdings";
import { assetHref, isStakingCoin, type BondDenomOf } from "./links";

type GroupBy = "asset" | "chain";

/**
 * A fixed table layout: columns take the widths their headers give, the
 * name column the rest. An auto layout sizes columns by what each table
 * holds, so two "By chain" sections would never line up (and the kit's
 * expander column collapses in a section where no row expands).
 */
const TABLE_LAYOUT = "[&_table]:table-fixed";

const VIEW_KEY = "zunia.dashboard.assets.view";

interface StoredView {
  groupBy?: GroupBy;
  hideSmall?: boolean;
  showUnlisted?: boolean;
}

const DEFAULT_VIEW: StoredView = {};

/**
 * Positions read in cents. The kit's three significant figures are for
 * prices: on a position they printed dust as "$0.00000001", a column of
 * zeros down half the table. At two decimals dust reads "<$0.01" (format.ts's
 * own dust rule) and a real holding still reads "$0.96".
 */
const CENTS = 2;

/** One table row: an asset (several chains) or a single chain holding. */
interface HoldingView {
  id: string;
  group: AssetGroup;
  /** The holding the row's actions act on: the one with the most liquid balance. */
  primary: PortfolioAsset;
}

function primaryRow(rows: readonly PortfolioAsset[]): PortfolioAsset {
  let best = rows[0] as PortfolioAsset;
  for (const row of rows) {
    if (BigInt(row.amounts.liquid || "0") > BigInt(best.amounts.liquid || "0")) best = row;
  }
  return best;
}

function singleGroup(row: PortfolioAsset): AssetGroup {
  return {
    key: row.identity.key,
    identity: row.identity,
    rows: [row],
    total: row.total,
    value: row.value,
    price: row.price,
    change24hAbs: row.change24hAbs,
    chainIds: [row.chainId],
    ...(row.unpriced ? { unpriced: row.unpriced } : {}),
  };
}

/** "asset" / "assets", "holding" / "holdings". */
function plural(unit: CountUnit, count: number): string {
  return count === 1 ? unit : `${unit}s`;
}

/** "45% staked", "all staked", or null when nothing is bonded. */
function stakedLabel(group: AssetGroup): string | null {
  const share = bondedShare(group.rows);
  if (share === null || share <= 0) return null;
  return share >= 99.95 ? "all staked" : `${formatPercent(share, { digits: share < 1 ? 2 : 0 })} staked`;
}

/** The position's total, exact when every chain shares one exponent. */
function Amount({ group, className }: { group: AssetGroup; className?: string }) {
  const exact = groupBaseTotal(group);
  const maxFraction = amountDigits(group.total);
  const compact = (group.total ?? 0) >= 10_000_000;
  return exact ? (
    <TokenAmount amount={exact.amount} decimals={exact.decimals} symbol={group.identity.ticker} maxFraction={maxFraction} compact={compact} className={className} />
  ) : (
    <TokenAmount
      amount={group.total}
      symbol={group.identity.ticker}
      maxFraction={maxFraction}
      compact={compact}
      reason="Amounts on these chains use different decimals"
      className={className}
    />
  );
}

function Balance({ group }: { group: AssetGroup }) {
  const staked = stakedLabel(group);
  return (
    <span className="flex min-w-0 flex-col items-end gap-0.5">
      {/* Fixed columns: an extreme amount is cut with an ellipsis, never spilt into the next cell. */}
      <Amount group={group} className="max-w-full truncate" />
      {staked ? <span className="text-[12px] leading-none text-fg-dim">{staked}</span> : null}
    </span>
  );
}

/**
 * The 7-day line and change. From 1440 px both; from 1280 px the line alone
 * (the change is in its label and in the sort), or the change when there is
 * no line to draw. Fixed widths, so every "By chain" section lines up.
 */
function TrendCell({ group, spark }: { group: AssetGroup; spark: number[] | null }) {
  const change = groupChange7d(group);
  const line = spark && spark.length > 1;
  return (
    <span className="flex items-center justify-end gap-2">
      {line ? (
        <Sparkline
          data={spark}
          width={56}
          height={24}
          tone="trend"
          label={`${group.identity.ticker}, 7 days${change !== null ? `: ${formatPercent(change, { signed: true })}` : ""}`}
        />
      ) : null}
      <Delta value={change} className={cn("min-w-[66px] justify-end", line && "max-[90rem]:hidden")} />
    </span>
  );
}

/** Where a holding came from, for the per-chain detail rows. */
function routeText(row: PortfolioAsset): string {
  const { identity } = row;
  if (identity.provenance === "unknown") return "Unknown origin";
  if (!identity.path || identity.originChainId === row.chainId) return identity.kind === "native" ? "Native" : "Issued here";
  const channels = identity.path.split("/").filter((part) => part.startsWith("channel-"));
  return channels.length > 1 ? `via ${channels.length} hops` : `via ${channels[0] ?? identity.path}`;
}

function GroupDetail({
  group,
  currency,
  swappable,
  bondDenomOf,
}: {
  group: AssetGroup;
  currency: string;
  swappable: SwappableOf;
  bondDenomOf: BondDenomOf;
}) {
  return (
    <div className="flex flex-col divide-y divide-[var(--d-hairline)]">
      {group.rows.map((row) => (
        <div
          key={`${row.chainId}:${row.identity.denom}`}
          className="grid items-center gap-x-5 gap-y-2 py-2.5 first:pt-0 last:pb-0 md:grid-cols-[minmax(160px,0.9fr)_minmax(0,2.2fr)_minmax(88px,auto)_auto]"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <ChainLogo chainId={row.chainId} size={22} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13.5px] font-medium">{row.identity.chainName ?? chainName(row.chainId)}</span>
              <span className="truncate font-mono text-[11px] text-fg-dim" title={row.identity.path ?? row.identity.denom}>
                {routeText(row)}
              </span>
            </span>
          </span>
          <BucketAmounts row={row} />
          <span className="text-right text-[13.5px] font-medium tabular-nums max-md:text-left">
            <Money value={row.value} currency={currency} precision={CENTS} reason="No price for this holding" />
          </span>
          <HoldingActions
            row={row}
            stakeable={isStakingCoin(row.identity, bondDenomOf)}
            swappable={swappable(row.identity.key)}
            className="max-md:justify-start"
          />
        </div>
      ))}
    </div>
  );
}

type SwappableOf = (key: string) => { ok: boolean; reason?: string } | undefined;

export interface HoldingsCardProps {
  data: PortfolioResponse | null;
  /** Market rows by asset key: 7-day sparklines and whether Osmosis trades the asset. */
  markets: ReadonlyMap<string, MarketAsset>;
  currency: string;
  loading: boolean;
  pending: boolean;
  refreshing: boolean;
  singleChain: boolean;
  /** "All chains (5 networks)" / "Osmosis": the CSV's scope line. */
  scopeLabel: string;
  /** Scoped chains the wallet gave no address for. */
  skipped: string[];
  /** Which coin each chain stakes (offers "Stake" on that holding). */
  bondDenomOf: BondDenomOf;
  /** "Hide small balances" folds priced positions under this value (the viewer's floor). */
  floor?: number;
}

export function HoldingsCard({
  data,
  markets,
  currency,
  loading,
  pending,
  refreshing,
  singleChain,
  scopeLabel,
  skipped,
  bondDenomOf,
  floor = SMALL_VALUE,
}: HoldingsCardProps) {
  const [stored, setStored] = useStoredValue<StoredView>(VIEW_KEY, DEFAULT_VIEW);
  const groupBy: GroupBy = singleChain ? "asset" : (stored.groupBy ?? "asset");
  const hideSmall = stored.hideSmall ?? false;
  const showUnlisted = stored.showUnlisted ?? false;
  const update = (patch: StoredView) => setStored((current) => ({ ...current, ...patch }));

  const [query, setQuery] = useState("");
  const [type, setType] = useState<AssetTypeFilter>("all");
  // One sort for every table: sorting a "By chain" section sorts them all.
  const [sort, setSort] = useState<SortState>({ key: "value", dir: "desc" });

  const allRows = useMemo(() => data?.assets ?? [], [data]);
  const pricedTotal = data?.totals.pricedValue ?? 0;
  // One unit per view, everywhere it is counted (subtitle, chips, footer):
  // assets "By asset", per-chain holdings "By chain". Before, one list read
  // "31 holdings", "All 28" and "Showing 28 assets" at once.
  const unit: CountUnit = groupBy === "chain" ? "holding" : "asset";
  const assetTotal = useMemo(() => groupAssets(allRows).length, [allRows]);
  const total = unit === "asset" ? assetTotal : allRows.length;
  const chainCount = useMemo(() => new Set(allRows.map((row) => row.chainId)).size, [allRows]);
  const floorLabel = floorText(floor, currency);

  const counts = useMemo(() => typeCounts(allRows, showUnlisted, unit), [allRows, showUnlisted, unit]);
  const filtered = useMemo(() => filterRows(allRows, { type, query, showUnlisted }), [allRows, type, query, showUnlisted]);
  const hiddenUnlisted = unit === "asset" ? filtered.hiddenUnlistedAssets : filtered.hiddenUnlisted;

  const assetViews = useMemo(() => {
    const { groups, hidden } = hideSmallGroups(groupAssets(filtered.rows), hideSmall, floor);
    return {
      hidden,
      views: groups.map<HoldingView>((group) => ({ id: group.key, group, primary: primaryRow(group.rows) })),
    };
  }, [filtered.rows, hideSmall, floor]);

  const sections = useMemo(() => {
    if (groupBy !== "chain") return { hidden: 0, list: [] as { id: string; name: string; value: number | null; views: HoldingView[] }[] };
    const rows = hideSmall ? filtered.rows.filter((row) => !isSmall(row.value, floor)) : filtered.rows;
    const list = chainSections(rows, data?.chains ?? []).map((section) => ({
      id: section.chainId,
      name: section.chainName,
      value: section.value,
      views: section.rows.map<HoldingView>((row) => ({ id: `${row.chainId}:${row.identity.denom}`, group: singleGroup(row), primary: row })),
    }));
    return { hidden: filtered.rows.length - rows.length, list };
  }, [groupBy, hideSmall, filtered.rows, data?.chains, floor]);

  const sparkOf = (key: string) => markets.get(key)?.sparkline7d ?? null;
  const swappable: SwappableOf = (key) => {
    const market = markets.get(key);
    if (!market) return undefined;
    return market.tradable ? { ok: true } : { ok: false, reason: `${market.symbol} isn't traded on Osmosis` };
  };

  // Figure columns have fixed widths and the name column takes the rest, in
  // a fixed-layout table (see TABLE_LAYOUT): the separate tables of "By
  // chain" then line up column for column, whatever each one holds.
  const columns: Column<HoldingView>[] = [
    {
      key: "asset",
      header: "Asset",
      cell: (view) => (
        <AssetName identity={view.group.identity} chainIds={groupBy === "chain" ? [view.primary.chainId] : view.group.chainIds} />
      ),
      sortable: true,
      sortValue: (view) => view.group.identity.ticker.toLowerCase(),
      sortDescFirst: false,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (view) => <PriceCell price={view.group.price?.price} unpriced={view.group.unpriced} currency={currency} />,
      width: 96,
      sortable: true,
      sortValue: (view) => view.group.price?.price ?? null,
      hideBelow: "lg",
    },
    {
      key: "change24h",
      header: "24h",
      align: "right",
      cell: (view) => <Delta value={groupChange24h(view.group)} />,
      width: 84,
      sortable: true,
      sortValue: (view) => groupChange24h(view.group),
    },
    {
      key: "trend",
      header: "7d",
      align: "right",
      cell: (view) => <TrendCell group={view.group} spark={sparkOf(view.group.key)} />,
      sortable: true,
      sortValue: (view) => groupChange7d(view.group),
      hideBelow: "xl",
      headerClassName: "w-[96px] min-[90rem]:w-[164px]",
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      cell: (view) => <Balance group={view.group} />,
      width: 164,
      hideBelow: "md",
    },
    {
      key: "value",
      header: "Value",
      align: "right",
      cell: (view) => {
        const share = view.group.value !== null && pricedTotal > 0 ? (view.group.value / pricedTotal) * 100 : null;
        return (
          <span className="flex flex-col items-end gap-1">
            <Money value={view.group.value} currency={currency} precision={CENTS} reason="No price, so no value" className="max-w-full truncate font-medium" />
            {share !== null ? <ShareBar value={share} width={36} className="[&>span:last-child]:min-w-0 [&>span:last-child]:text-[11.5px]" /> : null}
          </span>
        );
      },
      width: 124,
      sortable: true,
      sortValue: (view) => view.group.value,
    },
    {
      // Four icons from 1440 px; below that they cost the names their room.
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (view) => (
        <HoldingActions
          row={view.primary}
          stakeable={isStakingCoin(view.primary.identity, bondDenomOf)}
          swappable={swappable(view.group.key)}
          className="opacity-70 transition-opacity duration-[160ms] group-hover/row:opacity-100 focus-within:opacity-100"
        />
      ),
      width: 158,
      hideBelow: "xl",
      className: "max-[90rem]:hidden",
      headerClassName: "max-[90rem]:hidden",
    },
    {
      // The same actions behind "⋯" on tablets and laptops.
      key: "menu",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (view) => (
        <HoldingActionsMenu row={view.primary} stakeable={isStakingCoin(view.primary.identity, bondDenomOf)} swappable={swappable(view.group.key)} />
      ),
      width: 52,
      hideBelow: "md",
      className: "min-[90rem]:hidden",
      headerClassName: "min-[90rem]:hidden",
    },
  ];

  // Phones: two lines a row, the way wallets read: ticker over amount on the
  // left, value over its 24 h change on the right.
  const mobileCard = (view: HoldingView) => {
    const { group } = view;
    const staked = stakedLabel(group);
    const chains = groupBy === "chain" ? [view.primary.chainId] : group.chainIds;
    const multi = chains.length > 1;
    const holding = chains[0] ?? group.identity.chainId;
    return (
      <span className="flex items-center gap-3">
        <AssetLogo
          src={group.identity.logoUrl}
          symbol={group.identity.ticker}
          size={36}
          badgeSrc={multi ? undefined : chainIcon(holding)}
          badgeLabel={multi ? undefined : chainName(holding)}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium tracking-[-0.01em]">{group.identity.ticker}</span>
            <TrustBadge identity={group.identity} />
          </span>
          <span className="truncate text-[12.5px] leading-tight text-fg-dim">
            <Amount group={group} />
            {staked ? ` · ${staked}` : multi ? ` · ${chains.length} chains` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-right">
          {group.value !== null ? (
            <>
              <Money value={group.value} currency={currency} precision={CENTS} className="text-[14.5px] font-medium leading-tight" />
              <Delta value={groupChange24h(group)} />
            </>
          ) : (
            <NoPriceBadge reason={group.unpriced} />
          )}
        </span>
      </span>
    );
  };

  const expandable = (view: HoldingView) => view.group.rows.length > 1 || view.group.rows.some((row) => nonZeroBuckets(row) > 1);

  const emptyFilters = (
    <EmptyState
      icon="search"
      title="No assets match"
      body="Clear the search or pick another type."
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setQuery("");
            setType("all");
          }}
        >
          Clear filters
        </Button>
      }
    />
  );

  const table = (rows: HoldingView[], ariaLabel: string, emptyNode: ReactNode) => (
    <DataTable
      ariaLabel={ariaLabel}
      className={TABLE_LAYOUT}
      columns={columns}
      rows={rows}
      getRowKey={(view) => view.id}
      rowHref={(view) => assetHref(view.group.key)}
      rowClassName={() => "group/row"}
      loading={loading}
      skeletonRows={7}
      sort={sort}
      onSortChange={setSort}
      renderExpanded={(view) => <GroupDetail group={view.group} currency={currency} swappable={swappable} bondDenomOf={bondDenomOf} />}
      isExpandable={expandable}
      mobileCard={mobileCard}
      empty={emptyNode}
    />
  );

  const exportCsv = () => {
    if (!data) return;
    const at = Date.now();
    downloadCsv(csvFileName("zunia-holdings", at), holdingsCsv(data.assets, { at, currency: data.currency, scope: scopeLabel }));
  };

  const hiddenSmall = groupBy === "chain" ? sections.hidden : assetViews.hidden;
  const shownCount = groupBy === "chain" ? sections.list.reduce((sum, section) => sum + section.views.length, 0) : assetViews.views.length;

  const chipItems = (Object.keys(ASSET_TYPE_LABELS) as AssetTypeFilter[]).map((value) => ({
    value,
    label: ASSET_TYPE_LABELS[value],
    count: data ? counts[value] : undefined,
    disabled: value !== "all" && data !== null && counts[value] === 0,
  }));

  return (
    <Card pending={pending}>
      <CardHeader
        title="Holdings"
        subtitle={
          data ? (
            <>
              {total} {plural(unit, total)} on {chainCount} {chainCount === 1 ? "chain" : "chains"}
              {/* The fold is said where the count is, not only under the last row. */}
              {hiddenUnlisted > 0 ? (
                <>
                  {" "}
                  {/* One unit on a phone: the note wraps whole, never "Show" alone on a line. */}
                  <span className="whitespace-nowrap">
                    · {hiddenUnlisted} unlisted hidden ·{" "}
                    <button
                      type="button"
                      onClick={() => update({ showUnlisted: true })}
                      // Named in full: the footer has a "Show" of its own.
                      aria-label={`Show the ${hiddenUnlisted} unlisted ${hiddenUnlisted === 1 ? "token" : "tokens"}`}
                      className="d-hit rounded-[4px] font-medium text-fg-muted underline decoration-[var(--d-hairline-strong)] underline-offset-[3px] transition-colors duration-[160ms] hover:text-fg hover:decoration-current"
                    >
                      Show
                    </button>
                  </span>
                </>
              ) : null}
            </>
          ) : (
            "Every token in this scope"
          )
        }
        refreshing={refreshing}
        actions={
          <>
            <PartialDataBadge errors={data?.errors} />
            <Button size="sm" variant="ghost" iconLeft="download" onClick={exportCsv} disabled={!data || allRows.length === 0}>
              CSV
            </Button>
          </>
        }
      />
      <FilterBar
        end={
          <>
            <Switch
              checked={hideSmall}
              onCheckedChange={(checked) => update({ hideSmall: checked })}
              label={`Hide < ${floorLabel}`}
              size="sm"
            />
            {singleChain ? null : (
              <Segmented
                ariaLabel="Group holdings by"
                value={groupBy}
                onChange={(value) => update({ groupBy: value })}
                options={[
                  { value: "asset", label: "By asset" },
                  { value: "chain", label: "By chain" },
                ]}
              />
            )}
          </>
        }
      >
        <SearchInput value={query} onChange={setQuery} placeholder="Search assets or chains" className="w-full sm:w-56" aria-label="Search holdings" />
        <ChipGroup type="single" ariaLabel="Asset type" value={type} onChange={setType} items={chipItems} scroll />
      </FilterBar>
      <CardBody flush>
        {groupBy === "asset" || loading ? (
          table(assetViews.views, "Holdings by asset", emptyFilters)
        ) : sections.list.length === 0 ? (
          emptyFilters
        ) : (
          <div className="flex flex-col">
            {sections.list.map((section) => (
              <section key={section.id} aria-label={`Holdings on ${section.name}`} className="border-t border-[var(--d-hairline)] first:border-t-0">
                <div className="flex items-center gap-2.5 bg-[var(--d-card-2)] px-[var(--d-pad)] py-2.5">
                  <ChainLogo chainId={section.id} size={20} />
                  <h3 className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{section.name}</h3>
                  <span className="text-[12.5px] text-fg-dim">
                    {section.views.length} {section.views.length === 1 ? "asset" : "assets"}
                  </span>
                  <span className="ml-auto flex items-center gap-3 text-[13px] tabular-nums">
                    <Money value={section.value} currency={currency} precision={CENTS} reason="Nothing here has a price" className="font-medium" />
                    <ShareBar
                      value={section.value !== null && pricedTotal > 0 ? (section.value / pricedTotal) * 100 : null}
                      width={40}
                      className="max-sm:hidden"
                    />
                  </span>
                </div>
                {table(section.views, `Holdings on ${section.name}`, emptyFilters)}
              </section>
            ))}
          </div>
        )}
      </CardBody>
      {data && !loading ? (
        <CardFooter className="justify-between gap-x-4 gap-y-2">
          <span>
            {shownCount === total
              ? `Showing ${total === 1 ? "" : "all "}${total} ${plural(unit, total)}`
              : `Showing ${shownCount} of ${total} ${plural(unit, total)}`}
            {hiddenSmall > 0 ? ` · ${hiddenSmall} under ${floorLabel} hidden` : ""}
            {skipped.length > 0 ? (
              <span>
                {" "}
                · Not read: {skipped.map(chainName).join(", ")}
                <InfoTip size={13} className="ml-1 align-[-2px]" content="This wallet gave no address on these chains (another key type, or a phone session that did not share them), so they are not counted." />
              </span>
            ) : null}
          </span>
          {hiddenUnlisted > 0 || showUnlisted ? (
            <span className="flex items-center gap-1.5">
              {showUnlisted ? null : (
                <span>
                  {hiddenUnlisted} unlisted {hiddenUnlisted === 1 ? "token" : "tokens"} hidden
                </span>
              )}
              <InfoTip
                size={13}
                content="Tokens no registry lists: unknown IBC vouchers and unlisted local tokens. Often airdropped spam; never follow links in their names. They have no price and are never counted in totals."
              />
              <Button size="sm" variant="ghost" onClick={() => update({ showUnlisted: !showUnlisted })}>
                {showUnlisted ? "Hide unlisted" : "Show"}
              </Button>
            </span>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
