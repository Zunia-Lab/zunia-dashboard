"use client";

/**
 * /chains: every catalog mainnet side by side, on the figures that decide
 * where to stake — actual APR, real yield after inflation, bonded ratio,
 * unbonding, validator-set concentration, block time — with the user's own
 * value per chain when a wallet is connected.
 *
 * - Followed chains open the list (in the user's order), then the rest by
 *   market cap, so a first-time visitor sees live, priced chains first and
 *   catalog entries with dead endpoints sink.
 * - Prices come from the markets feed (one cached read for the whole list);
 *   staking stats load only for the rows on screen (`useLazyChainStats`).
 * - Leaders strip (`ChainLeaders`), then the analysis (`YieldMap`: real
 *   yield against staked share for the same rows), then the list
 *   (`ChainsTable`: columns from 640px, cards on phones).
 * - Ticking up to four rows opens a floating bar that compares them.
 * - Starring a row does not move it until the next search or filter, so the
 *   row under the cursor stays put.
 */

import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import { useConnectModal } from "@/components/connect/ConnectModal";
import { Page } from "@/components/shell/Page";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Chip,
  DataTable,
  Disclosure,
  EmptyState,
  FilterBar,
  InlineError,
  PartialDataBadge,
  SearchInput,
  Segmented,
  SourceTag,
  type SortState,
} from "@/components/ui";
import { CHAINS } from "@/lib/chains";
import { useMarkets, type MarketAsset } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { useChainScope } from "@/lib/useChainScope";
import { useWallet } from "@/providers/WalletProvider";
import { MAX_ENTITIES } from "@/components/compare/model";
import { ChainLeaders } from "./ChainLeaders";
import { ColumnGuide, PhoneList, chainColumns, type ChainRow } from "./ChainsTable";
import { CompareBar } from "./CompareBar";
import { matchesChain, nativeAssetKey, orderChains, type MarketHint } from "./model";
import { useFollow } from "./useFollow";
import { useLazyChainStats } from "./useLazyChainStats";
import { YieldMap } from "./YieldMap";

const PAGE_SIZE = 25;
type NetworkView = "mainnet" | "testnet";

// Tailwind's `sm` is 40rem, and a media query's rem is the browser's default
// font size: a px query (the kit's PHONE_QUERY) parts from the CSS when that
// is not 16px, and would mount the very layout the CSS hides.
const WIDE_QUERY = "(min-width: 40rem)";

function subscribeWide(onChange: () => void) {
  const list = window.matchMedia(WIDE_QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * Which of the list's two layouts to mount. The table and the phone cards
 * each re-render on every stats chunk, markets answer, portfolio poll and
 * tap (and each is ~1.3k DOM nodes per 25 rows, ~12k after "Show all"),
 * while CSS only ever shows one. The server and the hydration render cannot
 * know the viewport, so both mount there and the breakpoint classes pick
 * (the first paint matches, nothing shifts); after that only the one on
 * screen, swapping when the width crosses 40rem.
 */
function useListLayout(): "both" | "table" | "cards" {
  return useSyncExternalStore(
    subscribeWide,
    () => (window.matchMedia(WIDE_QUERY).matches ? "table" : "cards"),
    () => "both",
  );
}

export function ChainsPage() {
  const follow = useFollow();
  const { selectedChainId } = useChainScope();
  const { account, restoring } = useWallet();
  const connect = useConnectModal();
  const markets = useMarkets();
  const portfolio = usePortfolio({ scope: "followed" });

  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState<NetworkView>("mainnet");
  const [followedOnly, setFollowedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<string[]>([]);
  // Held here, not in the table: the table remounts when the width crosses
  // 40rem (a phone or tablet rotating) and its sort must survive that.
  const [sort, setSort] = useState<SortState | null>(null);
  const layout = useListLayout();
  // The followed list as it was before the first star clicked here: rows
  // keep their place (and stay in the Followed view) until the next search
  // or filter, instead of jumping out from under the pointer.
  const [frozen, setFrozen] = useState<string[] | null>(null);

  const resetView = () => {
    setFrozen(null);
    setLimit(PAGE_SIZE);
  };

  const marketByKey = useMemo(() => {
    const map = new Map<string, MarketAsset>();
    for (const asset of markets.data?.assets ?? []) map.set(asset.key, asset);
    return map;
  }, [markets.data]);

  const universe = useMemo(() => CHAINS.filter((chain) => chain.network === network), [network]);
  const marketHints = useMemo(() => {
    const map = new Map<string, MarketHint>();
    for (const chain of universe) {
      const asset = marketByKey.get(nativeAssetKey(chain));
      if (asset) map.set(chain.chainId, { marketCap: asset.marketCap, volume24h: asset.volume24h });
    }
    return map;
  }, [universe, marketByKey]);

  const basis = frozen ?? follow.followed;
  const ordered = useMemo(() => orderChains(universe, basis, marketHints), [universe, basis, marketHints]);
  const basisSet = useMemo(() => new Set(basis), [basis]);
  const filtered = useMemo(
    () => ordered.filter((chain) => matchesChain(chain, query) && (!followedOnly || basisSet.has(chain.chainId))),
    [ordered, query, followedOnly, basisSet],
  );
  const shown = filtered.slice(0, limit);

  // Until the markets feed has answered, only followed rows are certain to
  // stay on screen (the rest re-sorts by market cap): ask for those first.
  const marketsSettled = markets.status !== "loading" || markets.data !== null;
  const wanted = (marketsSettled ? shown : shown.filter((chain) => basisSet.has(chain.chainId))).map((chain) => chain.chainId);
  const stats = useLazyChainStats(wanted);

  const valueOf = (chainId: string): ChainRow["value"] => {
    if (!account) return undefined;
    const held = portfolio.data?.chains.find((entry) => entry.chainId === chainId);
    if (held) {
      if (held.status === "error") return { amount: null, reason: held.error ?? "Your balance here could not be read" };
      if (held.value === null) return { amount: null, reason: held.assetCount > 0 ? "What you hold here has no price" : "Nothing held" };
      return { amount: held.value };
    }
    if (!follow.isFollowed(chainId)) return { amount: null, reason: "Follow this chain to read your balance on it" };
    if (portfolio.accounts.skipped.includes(chainId)) return { amount: null, reason: "Your wallet has no address on this chain" };
    if (portfolio.loading) return { amount: null, loading: true };
    return { amount: null, reason: "Not read yet" };
  };

  const rows: ChainRow[] = shown.map((chain) => ({
    chain,
    stats: stats.statsFor(chain.chainId),
    state: stats.rowState(chain.chainId),
    market: marketByKey.get(nativeAssetKey(chain)) ?? null,
    value: valueOf(chain.chainId),
  }));

  const toggleSelect = (chainId: string) =>
    setSelected((current) =>
      current.includes(chainId) ? current.filter((id) => id !== chainId) : current.length >= MAX_ENTITIES ? current : [...current, chainId],
    );
  const toggleFollow = (chainId: string) => {
    if (!frozen) setFrozen(follow.followed);
    follow.toggle(chainId, { notify: true });
  };

  const marketCurrency = markets.data?.currency ?? null;
  const columns = chainColumns({ connected: Boolean(account), selected, toggleSelect, follow, toggleFollow, marketCurrency, statsCurrency: stats.currency, portfolioCurrency: portfolio.data?.currency ?? null });

  // The live count (the frozen order only keeps rows in place).
  const followedInView = universe.filter((chain) => follow.isFollowed(chain.chainId)).length;
  const empty =
    query.trim() !== "" ? (
      <EmptyState
        icon="search"
        title={`No ${network === "mainnet" ? "mainnet" : "testnet"} matches "${query.trim()}"`}
        body="Search by name, chain id or ticker."
        action={
          <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
            Clear search
          </Button>
        }
      />
    ) : followedOnly ? (
      <EmptyState
        icon="star"
        title={`You follow no ${network === "mainnet" ? "mainnets" : "testnets"}`}
        body="Star a chain in the full list, or manage the list on Networks."
        action={
          <Button size="sm" variant="secondary" href="/networks">
            Manage networks
          </Button>
        }
      />
    ) : undefined;

  return (
    <Page title="Chains" subtitle="Staking economics and validator sets by chain" access="public">
      <ChainLeaders stats={stats} />
      {/* Analysis between the strip and the list: where each chain sits on
          real yield against staked share (testnet tokens earn nothing real,
          so their map would mean nothing). When no figure loaded at all, the
          table's own error says why and offers Retry: no second empty card. */}
      {network === "mainnet" && !(stats.failedChunks > 0 && stats.loaded.length === 0) ? (
        <YieldMap stats={stats.loaded} isFollowed={follow.isFollowed} loading={stats.initialLoading} refreshing={stats.busy && !stats.initialLoading} />
      ) : null}

      <Card className={selected.length > 0 ? "mb-20 md:mb-16" : undefined}>
        <CardHeader
          title={network === "mainnet" ? "Cosmos mainnets" : "Cosmos testnets"}
          subtitle={`${universe.length} networks in the Zunia catalog · followed first, then by market cap`}
          refreshing={stats.busy && !stats.initialLoading}
          actions={<PartialDataBadge errors={stats.errors.length > 0 ? stats.errors : null} />}
        />
        <FilterBar
          end={
            <>
              <Chip
                selected={followedOnly}
                onClick={() => {
                  setFollowedOnly((on) => !on);
                  resetView();
                }}
                icon="star"
                count={followedInView}
              >
                Followed
              </Chip>
              <Segmented<NetworkView>
                ariaLabel="Network type"
                value={network}
                onChange={(next) => {
                  setNetwork(next);
                  resetView();
                }}
                options={[
                  { value: "mainnet", label: "Mainnets" },
                  { value: "testnet", label: "Testnets" },
                ]}
              />
            </>
          }
        >
          <SearchInput
            value={query}
            onChange={(next) => {
              setQuery(next);
              resetView();
            }}
            placeholder="Search chain, id or ticker"
            className="w-full sm:max-w-[320px]"
          />
        </FilterBar>
        {/* Not while a remembered wallet restores: a returning user would be
            asked to connect, then see the table jump when the session lands. */}
        {!account && !restoring ? (
          <p className="-mt-0.5 text-[13px] leading-[1.5] text-fg-dim">
            <Icon name="wallet" size={15} className="mr-1.5 inline-block align-[-3px]" />
            Connect a wallet to see what you hold on each chain.{" "}
            <button
              type="button"
              onClick={() => connect.open()}
              className="d-hit rounded-[6px] font-medium text-[var(--d-accent-text)] underline-offset-[3px] hover:underline"
            >
              Connect
            </button>
          </p>
        ) : null}
        {stats.failedChunks > 0 && stats.loaded.length === 0 ? (
          <InlineError
            title="Chain figures did not load"
            message="The networks' public endpoints did not answer. Names and prices still show; figures appear when they respond."
            onRetry={stats.retryFailed}
          />
        ) : null}

        <CardBody flush>
          {/* A dense comparison: 10px cell gutters instead of 12 buy the
              room for two more columns at 1440 without a sideways scroll.
              The breakpoint classes stay: they pick the layout while both
              are mounted (server render and hydration). */}
          {layout !== "cards" ? (
            <div className="max-sm:hidden" style={{ "--d-cell-px": "10px" } as CSSProperties}>
              <DataTable
                ariaLabel={network === "mainnet" ? "Cosmos mainnets" : "Cosmos testnets"}
                columns={columns}
                rows={rows}
                getRowKey={(row) => row.chain.chainId}
                selectedRowKey={selectedChainId}
                empty={empty}
                sort={sort}
                onSortChange={setSort}
                stickyHeader
              />
            </div>
          ) : null}
          {layout !== "table" ? (
            <PhoneList rows={rows} selected={selected} toggleSelect={toggleSelect} follow={follow} toggleFollow={toggleFollow} empty={empty} marketCurrency={marketCurrency} statsCurrency={stats.currency} portfolioCurrency={portfolio.data?.currency ?? null} />
          ) : null}
        </CardBody>

        <CardFooter className="flex-col items-stretch gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="tabular-nums">
              Showing {Math.min(limit, filtered.length).toLocaleString("en-US")} of {filtered.length.toLocaleString("en-US")}
            </span>
            {filtered.length > limit ? (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, filtered.length - limit)} more
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLimit(filtered.length)}>
                  Show all {filtered.length}
                </Button>
              </span>
            ) : null}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:ml-auto">
              <SourceTag source="Chain LCDs" at={stats.updatedAt} />
              {markets.data?.sources
                .filter((source) => source.ok)
                .map((source) => <SourceTag key={source.id} source={source.label} />)}
            </span>
          </div>
          <Disclosure summary="How to read this table">
            <ColumnGuide />
          </Disclosure>
        </CardFooter>
      </Card>

      <CompareBar selected={selected} onClear={() => setSelected([])} />
    </Page>
  );
}
