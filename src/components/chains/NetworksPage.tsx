"use client";

/**
 * /networks: the followed list, managed. Two halves:
 *
 * - "Following": the list in its order (the rail's order, and the order the
 *   portfolio reads when trimming), with move up / down and unfollow (with
 *   Undo), the user's value per chain when a wallet is connected, and the
 *   32-network cap as a meter.
 * - "Catalog": every network the dashboard can read, searchable and filtered
 *   by Main / Test, each with a follow switch.
 *
 * Copy is honest about what following does (changes what the dashboard
 * reads, never touches keys) and about the catalog's edge: a chain outside
 * the Zunia registry cannot be added here.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Meter } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ChainLogo,
  EmptyState,
  FilterBar,
  IconButton,
  Money,
  SearchInput,
  Segmented,
  Switch,
  chainById,
} from "@/components/ui";
import { CHAINS, type ChainEntry } from "@/lib/chains";
import { useMarkets, type MarketAsset } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { formatFiat } from "@/lib/format";
import { useStoredValue } from "@/lib/useStoredValue";
import { useWallet } from "@/providers/WalletProvider";
import { cn } from "@/lib/cn";
import { MAX_FOLLOWED, PINNED_CHAINS, matchesChain, nativeAssetKey, orderChains, type MarketHint } from "./model";
import { useFollow } from "./useFollow";

const PAGE_SIZE = 24;
const FILTER_KEY = "zunia.dashboard.networksFilter";

type NetworkFilter = "mainnet" | "testnet" | "all";

const COUNTS = {
  mainnet: CHAINS.filter((chain) => chain.network === "mainnet").length,
  testnet: CHAINS.filter((chain) => chain.network === "testnet").length,
};

export function NetworksPage() {
  const follow = useFollow();
  const { account } = useWallet();
  const markets = useMarkets();
  const portfolio = usePortfolio({ scope: "followed" });
  const [filter, setFilter] = useStoredValue<NetworkFilter>(FILTER_KEY, "mainnet");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Keeps keyboard focus on the arrow that was pressed after its row moves.
  const focusAfterMove = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const key = focusAfterMove.current;
    if (!key) return;
    focusAfterMove.current = null;
    const target = buttons.current.get(key);
    // At an end the pressed arrow is disabled: hand focus to the other one.
    const fallback = buttons.current.get(key.endsWith(":up") ? key.replace(":up", ":down") : key.replace(":down", ":up"));
    (target && !target.disabled ? target : fallback)?.focus();
  }, [follow.followed]);

  const marketByKey = useMemo(() => {
    const map = new Map<string, MarketAsset>();
    for (const asset of markets.data?.assets ?? []) map.set(asset.key, asset);
    return map;
  }, [markets.data]);

  const hints = useMemo(() => {
    const map = new Map<string, MarketHint>();
    for (const chain of CHAINS) {
      const asset = marketByKey.get(nativeAssetKey(chain));
      if (asset) map.set(chain.chainId, { marketCap: asset.marketCap, volume24h: asset.volume24h });
    }
    return map;
  }, [marketByKey]);

  // The catalog leads with the home chain and its two pillars, then chains
  // with a market (largest first); following does not reorder it (the
  // Following card shows that list).
  const catalog = useMemo(() => {
    const scoped = CHAINS.filter((chain) => filter === "all" || chain.network === filter);
    return orderChains(scoped, PINNED_CHAINS, hints).filter((chain) => matchesChain(chain, query));
  }, [filter, hints, query]);
  const shown = catalog.slice(0, limit);

  const followedChains = follow.followed.map((id) => chainById(id)).filter((chain): chain is ChainEntry => Boolean(chain));
  const mainnets = followedChains.filter((chain) => chain.network === "mainnet").length;
  const valueOf = (chainId: string) => portfolio.data?.chains.find((entry) => entry.chainId === chainId) ?? null;

  const move = (chainId: string, delta: -1 | 1) => {
    focusAfterMove.current = `${chainId}:${delta < 0 ? "up" : "down"}`;
    follow.move(chainId, delta);
  };
  const register = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(key, node);
    else buttons.current.delete(key);
  };

  return (
    // The name the nav, the rail and the command palette use for this page.
    <Page title="Manage networks" subtitle="Choose the chains the dashboard follows" access="public">
      <div className="grid grid-cols-1 items-start gap-[var(--d-gap)] xl:grid-cols-12">
        <Card as="section" aria-labelledby="following-title" className="xl:sticky xl:top-[calc(var(--d-sticky-top,0px)+16px)] xl:col-span-5 xl:max-h-[calc(100dvh-var(--d-sticky-top,0px)-32px)]">
          <CardHeader
            id="following-title"
            title="Following"
            icon="star"
            subtitle={`${mainnets} mainnet${mainnets === 1 ? "" : "s"} · ${followedChains.length - mainnets} testnet${followedChains.length - mainnets === 1 ? "" : "s"} · in rail order`}
            actions={
              !follow.isDefault ? (
                <Button size="sm" variant="ghost" onClick={follow.reset}>
                  Reset to defaults
                </Button>
              ) : null
            }
          />
          {/* A count against a cap, not a status: the track is neutral
              (the kit tints it with the fill, and a crimson-tinted bar at
              5 of 32 read as a warning). The bands still turn the fill amber
              near the cap and red at it, with their words. The kit's chart
              CSS is unlayered, hence the important override. */}
          <Meter
            value={follow.count}
            min={0}
            max={MAX_FOLLOWED}
            label="Networks followed"
            valueLabel={`${follow.count} of ${MAX_FOLLOWED}`}
            thresholds={{ warning: MAX_FOLLOWED - 4, danger: MAX_FOLLOWED }}
            statusLabels={{ warning: "Near the limit", danger: "Limit reached" }}
            size="sm"
            className="[&_.viz-meter\_\_track]:bg-[var(--d-glass-2)]!"
          />
          {/* Sticky beside the catalog on wide screens, so a long list (up to
              32) scrolls inside the card instead of running off the screen. */}
          <ol className="d-scroll -mx-[var(--d-pad)] -mb-[var(--d-pad)] divide-y divide-[var(--d-hairline)] border-t border-[var(--d-hairline)] xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {followedChains.map((chain, index) => {
              const held = account ? valueOf(chain.chainId) : null;
              const first = index === 0;
              const last = index === followedChains.length - 1;
              return (
                <li key={chain.chainId} className="flex items-center gap-3 px-[var(--d-pad)] py-1.5">
                  <span className="w-5 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-fg-dim" aria-hidden>
                    {index + 1}
                  </span>
                  <ChainLogo chainId={chain.chainId} size={28} />
                  {/* The name and its id are one link, at least 44px tall: a
                      big enough target on a phone without covering the
                      arrows beside it. */}
                  <Link
                    href={`/chains/${encodeURIComponent(chain.chainId)}`}
                    className="group flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-[6px]"
                  >
                    <span className="block truncate text-[14px] font-medium text-fg group-hover:underline group-hover:underline-offset-[3px]">{chain.chainName}</span>
                    <span className="block truncate font-mono text-[11.5px] text-fg-dim">{chain.chainId}</span>
                  </Link>
                  {chain.network === "testnet" ? (
                    <Badge size="sm" tone="warning" variant="outline" className="max-sm:hidden">
                      Testnet
                    </Badge>
                  ) : null}
                  {/* The token in its own column, its value under it: on the
                      id line the value squeezed the ticker to "S…". Phones
                      keep the name whole instead of showing the value. */}
                  <span className="flex shrink-0 flex-col items-end text-right leading-tight">
                    <span className="font-mono text-[11.5px] text-fg-dim">{chain.coinDenom}</span>
                    {held && held.value !== null ? (
                      <Money value={held.value} currency={portfolio.data?.currency} compact className="mt-0.5 text-[13px] text-fg-muted tabular-nums max-sm:hidden" />
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center">
                    <IconButton
                      ref={register(`${chain.chainId}:up`)}
                      label={`Move ${chain.chainName} up`}
                      icon="arrowUp"
                      size="sm"
                      disabled={first}
                      onClick={() => move(chain.chainId, -1)}
                    />
                    <IconButton
                      ref={register(`${chain.chainId}:down`)}
                      label={`Move ${chain.chainName} down`}
                      icon="arrowDown"
                      size="sm"
                      disabled={last}
                      onClick={() => move(chain.chainId, 1)}
                    />
                    <IconButton
                      label={`Unfollow ${chain.chainName}`}
                      icon="close"
                      size="sm"
                      disabled={followedChains.length <= 1}
                      tooltip={followedChains.length <= 1 ? "Keep at least one network" : undefined}
                      onClick={() => follow.toggle(chain.chainId, { notify: true })}
                    />
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card as="section" aria-labelledby="catalog-title" className="xl:col-span-7">
          <CardHeader
            id="catalog-title"
            title="Catalog"
            icon="networks"
            subtitle={`${COUNTS.mainnet} mainnets and ${COUNTS.testnet} testnets in the Zunia chain registry`}
          />
          <FilterBar
            end={
              <Segmented<NetworkFilter>
                ariaLabel="Network type"
                value={filter}
                onChange={(next) => {
                  setFilter(next);
                  setLimit(PAGE_SIZE);
                }}
                // The words /chains uses, in the UI face: "MAIN / TEST" in
                // mono caps read as a different control.
                options={[
                  { value: "mainnet", label: "Mainnets" },
                  { value: "testnet", label: "Testnets" },
                  { value: "all", label: "All" },
                ]}
              />
            }
          >
            <SearchInput
              value={query}
              onChange={(next) => {
                setQuery(next);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Search chain, id or ticker"
              className="w-full sm:max-w-[340px]"
            />
          </FilterBar>
          {follow.atCap ? (
            <Callout tone="warning" title="Follow limit reached">
              You follow {MAX_FOLLOWED} networks, the most the dashboard reads at once (balances and phone pairing stop at {MAX_FOLLOWED}).
              Unfollow one to add another.
            </Callout>
          ) : null}

          {catalog.length === 0 ? (
            <EmptyState
              icon="search"
              title={`No network matches "${query.trim()}"`}
              body="Search by name, chain id or ticker. Only chains in the Zunia registry can be followed."
              action={
                <Button size="sm" variant="secondary" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              }
            />
          ) : (
            // As many columns as keep a card at 240px or more: two beside the
            // Following list from 1280, more on wide screens, one on phones.
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
              {shown.map((chain) => {
                const on = follow.isFollowed(chain.chainId);
                const market = marketByKey.get(nativeAssetKey(chain));
                return (
                  <li
                    key={chain.chainId}
                    // The switch carries the state; a followed card only gains
                    // a firmer edge (a grid of crimson tiles read as errors).
                    className={cn(
                      "flex items-center gap-3 rounded-[var(--d-radius-inner)] border bg-[var(--d-card-2)] px-3 py-2 transition-colors duration-[160ms]",
                      on ? "border-[var(--d-control-line)]" : "border-[var(--d-hairline)]",
                    )}
                  >
                    <ChainLogo chainId={chain.chainId} size={32} />
                    {/* The whole text block is the link (a name like "Akash"
                        alone was a 17px target). The chain id is the thing
                        being chosen here, so it wraps rather than truncates;
                        the token and its price take their own line instead
                        of squeezing it to "cosmosh…". */}
                    <Link href={`/chains/${encodeURIComponent(chain.chainId)}`} className="group flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-[6px]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-fg group-hover:underline group-hover:underline-offset-[3px]">{chain.chainName}</span>
                        {chain.inCosmosRegistry ? (
                          <span title="Listed in the official cosmos/chain-registry" className="shrink-0 text-fg-dim">
                            <Icon name="check" size={13} strokeWidth={2} />
                            <span className="sr-only">Listed in the Cosmos chain registry</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="font-mono text-[11.5px] leading-snug text-fg-dim [overflow-wrap:anywhere]">{chain.chainId}</span>
                      {chain.network === "testnet" ? (
                        <span className="text-[11.5px] leading-snug text-[var(--z-warning)]">Testnet</span>
                      ) : market ? (
                        <span className="text-[11.5px] leading-snug text-fg-dim tabular-nums">
                          {chain.coinDenom} <span className="text-fg-muted">{formatFiat(market.price, markets.data?.currency ?? "usd")}</span>
                        </span>
                      ) : null}
                    </Link>
                    <Switch
                      checked={on}
                      onCheckedChange={() => follow.toggle(chain.chainId)}
                      ariaLabel={on ? `Unfollow ${chain.chainName}` : `Follow ${chain.chainName}`}
                      disabled={(!on && follow.atCap) || (on && follow.count <= 1)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          {catalog.length > limit ? (
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-fg-dim">
              <Button size="sm" variant="secondary" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, catalog.length - limit)} more
              </Button>
              <span className="tabular-nums">
                {limit} of {catalog.length}
              </span>
            </div>
          ) : null}
        </Card>
      </div>

      <p className="flex max-w-[78ch] items-start gap-2 text-[12.5px] leading-[1.55] text-fg-dim">
        <Icon name="lock" size={15} className="mt-px shrink-0" />
        <span>
          Following a chain changes what this dashboard reads and shows: its balances, staking and proposals join every page and it
          appears in the rail. It never touches your keys; your wallet asks before it shares an address on a new chain. The list is
          saved in this browser. Chains outside the Zunia registry can&apos;t be followed here yet.
        </span>
      </p>
    </Page>
  );
}
