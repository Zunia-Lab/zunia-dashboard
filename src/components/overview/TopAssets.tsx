"use client";

/**
 * The eight largest holdings of the scope, the same asset on several chains
 * counted once: logo, ticker and where it comes from, its 7-day price line,
 * price and 24 h move, value and share of net worth. Each row opens the
 * asset's page.
 *
 * Sparklines come from the markets list (hourly closes, one shared request)
 * and, for assets it does not carry, from that asset's own 7-day history.
 */

import Link from "next/link";
import { Sparkline } from "@/components/charts";
import {
  AssetLogo,
  Button,
  Card,
  CardBody,
  CardHeader,
  Delta,
  EmptyState,
  InlineError,
  LogoStack,
  Money,
  Skeleton,
  TokenAmount,
  chainById,
} from "@/components/ui";
import type { MarketsResponse } from "@/lib/data/markets";
import type { PortfolioState } from "@/lib/data/portfolio";
import { usePriceHistory } from "@/lib/data/prices";
import { formatFiat, formatPercent } from "@/lib/format";
import type { ApiState } from "@/lib/useApi";
import { groupAssets, type AssetGroup } from "@/lib/token/holdings";
import { tokenText } from "@/lib/token/text";
import { UNPRICED_TEXT } from "@/lib/token/wire";

const ROWS = 8;
const GRID =
  "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 @[440px]:grid-cols-[32px_minmax(0,1fr)_auto_auto] @[500px]:grid-cols-[32px_minmax(0,1fr)_72px_auto_auto]";

export function TopAssets({ portfolio, markets }: { portfolio: PortfolioState; markets: ApiState<MarketsResponse> }) {
  const data = portfolio.data;
  const currency = data?.currency ?? "usd";
  const groups = data ? groupAssets(data.assets) : [];
  const rows = groups.slice(0, ROWS);
  const total = data?.totals.pricedValue ?? 0;
  const sparks = new Map((markets.data?.assets ?? []).map((asset) => [asset.key, asset.sparkline7d]));

  return (
    <Card pending={portfolio.stale}>
      <CardHeader
        title="Top assets"
        subtitle={data ? `By value · ${groups.length} ${groups.length === 1 ? "asset" : "assets"} held` : "Your largest holdings"}
        actions={
          <Button size="sm" variant="ghost" href="/assets" iconRight="arrowRight">
            All assets
          </Button>
        }
      />
      <CardBody flush className="@container">
        {portfolio.status === "error" && !data ? (
          <div className="px-[var(--d-pad)] pb-[var(--d-pad)]">
            <InlineError message={portfolio.error?.message ?? "The portfolio read failed."} onRetry={portfolio.refetch} />
          </div>
        ) : portfolio.loading ? (
          <ul aria-busy="true" aria-label="Loading assets">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className={`${GRID} px-[var(--d-pad)] py-2.5`}>
                <Skeleton circle width={32} />
                <span className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-2.5 w-28" />
                </span>
                <Skeleton className="h-3 w-16 justify-self-end" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <div className="px-[var(--d-pad)] pb-2">
            <EmptyState
              inline
              icon="assets"
              title="No assets in this scope"
              body="Nothing is held on the chains selected."
              action={
                <Button size="sm" href="/receive">
                  Receive
                </Button>
              }
            />
          </div>
        ) : (
          <>
            <div aria-hidden className={`${GRID} border-b border-[var(--d-hairline)] px-[var(--d-pad)] pb-2 text-[11.5px] text-fg-dim`}>
              <span />
              <span>Asset</span>
              <span className="hidden text-center @[500px]:block">7d</span>
              <span className="hidden text-right @[440px]:block">Price · 24h</span>
              <span className="text-right">Value · share</span>
            </div>
            <ul className="divide-y divide-[var(--d-hairline)]">
              {rows.map((group) => (
                <AssetRow
                  key={group.key}
                  group={group}
                  total={total}
                  currency={currency}
                  spark={sparks.get(group.key) ?? null}
                  sparkCurrency={markets.data?.currency ?? currency}
                  marketsPending={markets.loading}
                />
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

interface AssetRowProps {
  group: AssetGroup;
  total: number;
  /** The portfolio answer's currency (values, prices). */
  currency: string;
  /** Hourly closes from the markets list, when it carries this asset. */
  spark: number[] | null;
  /** The markets answer's currency (it can differ under an FX fallback). */
  sparkCurrency: string;
  /** The markets list has not answered yet (it may still carry this asset's line). */
  marketsPending: boolean;
}

function AssetRow({ group, total, currency, spark, sparkCurrency, marketsPending }: AssetRowProps) {
  const identity = group.identity;
  // Only priced assets the markets list does not carry ask for their own
  // history (once that list has answered: most rows are in it), and only
  // from sources that keep one: CoinGecko's keyless tier answers 429 to
  // shared IPs, so a long tail of its assets would mostly fail and say so in
  // the console. Those rows show "—" (no 7-day history), honestly.
  const historySource = group.price && group.price.source !== "coingecko";
  const ownHistory = !spark && historySource && !marketsPending;
  const history = usePriceHistory(ownHistory ? group.key : null, "7D");
  const sparkPending = !spark && (marketsPending || (ownHistory && history.loading));
  const points = spark && spark.length > 1 ? spark : (history.data?.points ?? null);
  const pointsCurrency = spark && spark.length > 1 ? sparkCurrency : (history.data?.currency ?? currency);
  const multi = group.chainIds.length > 1;
  const chain = chainById(identity.chainId);
  const share = group.value !== null && total > 0 ? (group.value / total) * 100 : null;
  const origin = multi
    ? `${identity.name} · on ${group.chainIds.length} chains`
    : tokenText(identity, "row");

  return (
    <li>
      <Link
        href={`/assets/${encodeURIComponent(group.key)}`}
        className={`${GRID} px-[var(--d-pad)] py-2.5 transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)] focus-visible:outline-offset-[-2px]`}
      >
        <AssetLogo
          src={identity.logoUrl}
          symbol={identity.ticker}
          size={32}
          badgeSrc={multi ? undefined : (chain?.iconUrl ?? null)}
          badgeLabel={multi ? undefined : (identity.chainName ?? chain?.chainName)}
        />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium text-fg">{identity.ticker}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-fg-dim">
            {multi ? (
              <LogoStack
                size={14}
                max={3}
                items={group.chainIds.map((id) => ({ src: chainById(id)?.iconUrl, label: chainById(id)?.chainName ?? id }))}
                label={`On ${group.chainIds.length} chains`}
              />
            ) : null}
            <span className="truncate">{origin}</span>
          </span>
        </span>
        <span className="hidden h-7 items-center justify-center @[500px]:flex">
          {points && points.length > 1 ? (
            <Sparkline
              data={points}
              tone="trend"
              height={28}
              label={`${identity.ticker} price, 7 days`}
              valueFormatter={(value) => formatFiat(value, pointsCurrency)}
            />
          ) : sparkPending ? (
            <Skeleton className="h-4 w-full rounded-[6px]" />
          ) : (
            <span className="text-[12px] text-fg-faint" title={group.price ? "No 7-day price history" : "Unpriced"}>
              —
            </span>
          )}
        </span>
        <span className="hidden flex-col items-end gap-0.5 @[440px]:flex">
          <Money
            value={group.price?.price ?? null}
            currency={currency}
            masked={false}
            reason={group.unpriced ? UNPRICED_TEXT[group.unpriced] : "No price"}
            className="text-[13px] tabular-nums text-fg-muted"
          />
          <Delta value={group.price?.change24h ?? null} reason="No 24 h change" />
        </span>
        <span className="flex flex-col items-end gap-0.5">
          {group.value !== null ? (
            // A position, not a price: cents at most ("<$0.01", never
            // "$0.00000001"); the price column keeps its significant figures.
            <Money value={group.value} currency={currency} precision={2} className="text-[14px] font-medium tabular-nums text-fg" />
          ) : (
            <TokenAmount amount={group.total} symbol={identity.ticker} compact className="text-[13px] text-fg-muted" reason="Decimals unknown" />
          )}
          <span className="text-[12px] tabular-nums text-fg-dim">
            {share !== null ? formatPercent(share, { digits: share < 10 ? 1 : 0 }) : group.unpriced ? "unpriced" : "—"}
          </span>
        </span>
      </Link>
    </li>
  );
}
