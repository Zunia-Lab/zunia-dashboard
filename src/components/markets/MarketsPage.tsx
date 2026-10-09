"use client";

/**
 * /markets: the Cosmos assets Osmosis trades (Numia) plus SAF (Coinstore),
 * public and indexable.
 *
 * Strip (market cap, liquidity, volume, breadth, movers, SAF) → analysis
 * (how the market moved today, where liquidity sits) → the table with tabs,
 * search, watchlist and swap shortcuts. A wallet adds "You hold" badges; a
 * chain picked on the rail narrows the table to assets issued there (one
 * click to show all), while the figures above stay Cosmos-wide and say so.
 *
 * The page hands down the list it read on the server (`initial`), so the
 * first HTML has the prices and the links to each asset's page; a visitor
 * whose stored currency is not USD reads theirs as before.
 */

import { useMemo, useState } from "react";
import { chainName } from "@/components/assets/AssetCells";
import { useWalletRestoring } from "@/components/assets/wallet-restore";
import { Icon } from "@/components/icons";
import { Page } from "@/components/shell/Page";
import { Button, Callout, InlineError } from "@/components/ui";
import { useMarkets } from "@/lib/data/markets";
import { usePortfolio } from "@/lib/data/portfolio";
import { useChainScope } from "@/lib/useChainScope";
import type { ApiInitial } from "@/lib/useApi";
import { useWallet } from "@/providers/WalletProvider";
import { BreadthCard, DepthCard, MarketsStrip, sourcesDown } from "./MarketsOverview";
import { MarketsTable } from "./MarketsTable";
import { marketSummary } from "./markets";
import { useWatchlist } from "./watchlist";

export function MarketsPage({ initial = null }: { initial?: ApiInitial | null }) {
  return (
    <Page title="Markets" access="public">
      <MarketsBody initial={initial} />
    </Page>
  );
}

function MarketsBody({ initial }: { initial: ApiInitial | null }) {
  const markets = useMarkets(initial);
  // Every followed chain, whatever the rail shows: "You hold" is about the
  // wallet, not the scope. Idle (no request) without a wallet.
  const portfolio = usePortfolio({ scope: "followed" });
  const watchlist = useWatchlist();
  const { selectedChainId } = useChainScope();
  const { account } = useWallet();
  const restoring = useWalletRestoring();
  // The rail's chain narrows the table by default and can be dropped per
  // visit; picking another chain on the rail brings it back for that chain.
  // Kept here, not in the table, so the figures above can say whether they
  // are narrowed too (they never are).
  const [droppedScope, setDroppedScope] = useState<string | null>(null);
  const scopeChainId = selectedChainId && droppedScope !== selectedChainId ? selectedChainId : null;

  const data = markets.data;
  const osmosisDown = sourcesDown(data).osmosis;
  const summary = useMemo(() => (data ? marketSummary(data.assets) : null), [data]);
  const held = useMemo(() => new Set((portfolio.data?.assets ?? []).map((asset) => asset.identity.key)), [portfolio.data]);
  const scopedCount = useMemo(
    () => (data && scopeChainId ? data.assets.filter((asset) => asset.chainId === scopeChainId).length : null),
    [data, scopeChainId],
  );

  const loading = markets.loading;
  const pending = markets.stale;
  const refreshing = markets.refreshing && !markets.stale;
  // Nothing read at all: one error with Retry, not skeletons that would
  // never resolve. A failed refetch keeps the last answer on screen.
  if (markets.status === "error" && !data) {
    return (
      <InlineError
        title="Market data unavailable"
        message={markets.error?.message ?? "The price sources did not answer. Try again in a moment."}
        onRetry={markets.refetch}
        retrying={markets.refreshing}
      />
    );
  }

  return (
    <>
      {data?.currencyFallback ? (
        <Callout tone="warning" title="Prices in USD">
          {data.currencyFallback.reason}. Every figure on this page is in US dollars until the rate is back.
        </Callout>
      ) : null}
      {data && osmosisDown ? (
        // An outage, not a market: say why the list is short, and offer the retry.
        <Callout
          tone="warning"
          title="Osmosis market data unavailable"
          action={
            <Button size="sm" variant="secondary" iconLeft="refresh" loading={markets.refreshing} onClick={markets.refetch}>
              Retry
            </Button>
          }
        >
          Numia did not answer the last read, so this page shows only what Coinstore reports until it does.
        </Callout>
      ) : null}
      {data && scopeChainId && scopedCount !== null ? (
        // The rail narrows the table, not the market: one line says so
        // before "Osmosis liquidity" reads as the liquidity of Osmosis assets.
        <p className="-mb-1 flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-dim">
          <Icon name="info" size={14} className="mt-px shrink-0" />
          <span>
            Cosmos-wide figures: all {data.assets.length} listed assets.{" "}
            {scopedCount > 0
              ? `The table below starts on the ${scopedCount} issued on ${chainName(scopeChainId)}.`
              : `None of them is issued on ${chainName(scopeChainId)}.`}
          </span>
        </p>
      ) : null}
      <MarketsStrip data={data} summary={summary} loading={loading} stale={pending} />
      {/* Lite: how the market moved and where liquidity sits are analysis (CSS: this page renders on the server). */}
      <div className="grid gap-[var(--d-gap)] lg:grid-cols-12 lite:hidden">
        <BreadthCard data={data} summary={summary} loading={loading} pending={pending} wide={scopeChainId !== null} className="lg:col-span-7" />
        <DepthCard data={data} loading={loading} pending={pending} wide={scopeChainId !== null} className="lg:col-span-5" />
      </div>
      <MarketsTable
        data={data}
        loading={loading}
        pending={pending}
        refreshing={refreshing}
        watchlist={watchlist}
        held={held}
        scopeChainId={scopeChainId}
        onDropScope={() => setDroppedScope(scopeChainId)}
        connected={Boolean(account)}
        restoring={restoring}
      />
    </>
  );
}
