"use client";

/**
 * Route & price: everything a quote says, laid out to decide with.
 *
 * - The rate both ways, against the market rate implied by the two tokens'
 *   own prices (an estimate, labelled with its source).
 * - Four figures: price impact (status colour + word), the minimum received
 *   (exact when it is a number in the signed message, an estimate when it is
 *   the contract's TWAP rule), the network fee (simulated when it could be),
 *   and the whole swap against market prices.
 * - The route (./RouteDiagram) and what the swap costs, line by line
 *   (./CostBreakdown): the 0.5% Zunia fee in the token sold, Osmosis's taker
 *   fee, the pools' spread, the price impact and the network fee, each as a
 *   share of what is paid and its value, adding up to one total.
 *
 * Before an amount is typed the page prices an indicative amount (about 100
 * in the user's currency, or the whole balance when it is worth less) so the
 * route and rate are there from the start; the header says so. Quotes for an
 * earlier form state stay on screen dimmed while the new one loads, with the
 * fee and the amount spent they were priced for (the page passes both), so
 * every figure on screen belongs to one quote.
 */

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  InfoTip,
  InlineError,
  Skeleton,
  SourceTag,
  StatusBadge,
  TokenAmount,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatAmount, formatFiat, formatPercent } from "@/lib/format";
import { minimumReceived, type SwapQuotePrice } from "@/lib/data/swap";
import type { AssetOption } from "@/lib/swap/assets";
import type { SwapFee } from "@/lib/swap/fee";
import { ratioText } from "@/lib/swap/format";
import { CostBreakdown } from "./CostBreakdown";
import { QuoteClock, type QuoteClockProps } from "./QuoteClock";
import { RouteDiagram, type VenueToken } from "./RouteDiagram";
import { allInCost, costBreakdown } from "./swap-analysis";
import { ageText, fractionDigits, impactView, marketRate, routeSpread, splitViews, versus } from "./swap-view";

export interface NetworkFeeView {
  state: "none" | "loading" | "ready" | "error";
  /** Display amount ("0.0042") and ticker. */
  amount?: string;
  symbol?: string;
  fiat?: number | null;
  /** Simulated on the chain (else a fixed estimate). */
  measured?: boolean;
  /** Why there is no figure. */
  reason?: string;
  stale?: boolean;
}

export interface RoutePanelProps {
  from: AssetOption | undefined;
  to: AssetOption | undefined;
  /** The answer on screen: signable, stale, or a refused pair's preview. */
  quote: SwapQuotePrice | null;
  /** Priced for an indicative amount, not the form's: what to call it. */
  indicative: string | null;
  /** An amount is typed and its own quote is on the way (the answer on screen is an earlier one). */
  pricingTyped?: boolean;
  stale: boolean;
  error: string | null;
  blocked: { message: string; title?: string } | null;
  /** A way forward next to a refusal (stake the coin, move it). */
  blockedAction?: ReactNode;
  onRetry: () => void;
  clock: Omit<QuoteClockProps, "className">;
  /** The Zunia fee on the amount `quote` was priced for (not the form's, while a new quote loads). */
  fee: SwapFee | null;
  /** Units spent in all (the fee included) for the amount `quote` was priced for. */
  spentUnits: bigint | null;
  prices: { from: number | null; to: number | null; currency: string; source: string | null; at: number | null };
  networkFee: NetworkFeeView;
  venueToken: (denom: string) => VenueToken | null;
  slippagePercent: number;
  /** Notices from the page (a light client unconfirmed, a link that did not resolve). */
  notices?: ReactNode;
  /** Balances or the venue's list are still loading: draw the skeleton, not "pick two tokens". */
  waiting?: boolean;
  /** Why there is no pair to price yet: nothing to sell, or the balances failed to load. */
  nothingToSell?: "empty" | "error" | null;
  /** The page's one-second clock, for the quote's age. */
  now: number;
}

const TONE_TEXT = {
  success: "text-[var(--d-pos)]",
  warning: "text-[var(--z-warning)]",
  danger: "text-[var(--d-neg)]",
  neutral: "text-fg",
} as const;

function Tile({ label, info, about, value, sub, className }: { label: string; info?: ReactNode; about?: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-[var(--d-radius-inner)] bg-[var(--d-card-2)] px-3 py-2.5", className)}>
      <div className="flex min-w-0 items-center gap-1">
        <span className="truncate text-[12px] text-fg-dim">{label}</span>
        {info ? <InfoTip content={info} label={about ?? `About ${label}`} size={12} /> : null}
      </div>
      <div className="min-w-0 truncate text-[15px] font-semibold leading-tight tracking-[-0.02em] text-fg tabular-nums">{value}</div>
      {sub ? <div className="min-w-0 text-[11.5px] leading-snug text-fg-dim">{sub}</div> : null}
    </div>
  );
}

export function RoutePanel(props: RoutePanelProps) {
  const { from, to, quote, indicative, stale, error, blocked, onRetry, clock, prices } = props;
  const [inverted, setInverted] = useState(false);

  const subtitle = indicative
    ? `Indicative: priced for ${indicative}. ${props.pricingTyped ? "Pricing the amount you entered…" : "Enter an amount for your exact route."}`
    : quote
      ? "Live quote from the Osmosis router"
      : "Quotes come from the Osmosis router";

  let body: ReactNode;
  if ((!from || !to) && props.waiting) {
    body = <RouteSkeleton />;
  } else if (from && !to && blocked) {
    body = (
      <Callout tone="neutral" icon="info" title={blocked.title ?? "This pair can't be swapped"} action={props.blockedAction}>
        {blocked.message}
      </Callout>
    );
  } else if (!from && props.nothingToSell) {
    body = (
      <EmptyState
        icon="swap"
        title="Nothing to price yet"
        body={
          props.nothingToSell === "error"
            ? "Once your balances load, the route, price impact and every fee of a swap show up here."
            : "Once you hold a token Osmosis trades, its route, price impact and every fee show up here."
        }
        className="py-6"
      />
    );
  } else if (!from || !to) {
    body = <EmptyState icon="swap" title="Pick two tokens" body="The route, price impact and every fee show up here." className="py-6" />;
  } else if (error && !quote) {
    body = <InlineError title="No price right now" message={error} onRetry={onRetry} />;
  } else if (blocked && !quote) {
    body = (
      <Callout tone="neutral" icon="info" title={blocked.title ?? "This pair can't be swapped"} action={props.blockedAction}>
        {blocked.message}
      </Callout>
    );
  } else if (!quote) {
    body = <RouteSkeleton />;
  } else {
    body = <QuoteBody {...props} quote={quote} from={from} to={to} inverted={inverted} onInvert={() => setInverted((value) => !value)} />;
  }

  return (
    <Card as="section" pending={stale && Boolean(quote)} aria-labelledby="swap-route-title">
      {/* The clock is the header's progress indicator (it spins while a new
          price loads), so the header's own refresh spinner stays off. */}
      <CardHeader
        id="swap-route-title"
        title="Route & price"
        subtitle={subtitle}
        actions={clock.state === "idle" && !quote ? undefined : <QuoteClock {...clock} />}
      />
      {props.notices}
      {blocked && quote ? (
        <Callout tone="neutral" icon="info" title="Shown for reference only">
          {blocked.message}
        </Callout>
      ) : null}
      <CardBody className="@container flex flex-col gap-4">{body}</CardBody>
      {quote && from && to ? (
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <SourceTag source={`Osmosis router · quoted ${ageText(quote.quotedAt, props.now) ?? "now"}`} />
          {prices.source ? <SourceTag source={`Market: ${prices.source}${prices.at ? ` · ${ageText(prices.at, props.now)}` : ""}`} estimate /> : null}
        </div>
      ) : null}
    </Card>
  );
}

function RouteSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton width={220} height={22} />
          <Skeleton width={140} height={12} />
        </div>
        <Skeleton width={120} height={12} />
      </div>
      <div className="grid grid-cols-2 gap-2 @[560px]:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={66} className="block rounded-[var(--d-radius-inner)]" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton width="55%" height={14} />
        <Skeleton height={40} className="block rounded-[10px]" />
        <Skeleton width="45%" height={14} />
      </div>
    </div>
  );
}

function QuoteBody({
  quote,
  from,
  to,
  inverted,
  onInvert,
  indicative,
  fee,
  spentUnits,
  prices,
  networkFee,
  venueToken,
  slippagePercent,
}: RoutePanelProps & { quote: SwapQuotePrice; from: AssetOption; to: AssetOption; inverted: boolean; onInvert: () => void }) {
  const impact = impactView(quote.priceImpact);
  const minimum = minimumReceived(quote, { ticker: to.ticker, decimals: to.decimals });
  const market = marketRate(prices.from, prices.to);
  const quoteRate = quote.rate.toPerFrom ? Number(quote.rate.toPerFrom) : null;
  const vsMarket = versus(quoteRate, market);
  const cost =
    spentUnits !== null
      ? allInCost({
          spentUnits,
          fromDecimals: from.decimals,
          fromPrice: prices.from,
          receivedUnits: quote.amountOut,
          toDecimals: to.decimals,
          toPrice: prices.to,
        })
      : null;
  const splits = splitViews(quote.route, quote.amountIn, quote.amountOut);
  const spread = routeSpread(quote.route, quote.amountIn, quote.amountOut);
  const networkReady = networkFee.state === "ready";
  const breakdown =
    spentUnits !== null && fee
      ? costBreakdown({
          spentUnits,
          netUnits: quote.amountIn,
          feeUnits: fee.fee,
          fromDecimals: from.decimals,
          fromPrice: prices.from,
          takerPercent: quote.effectiveFee,
          spreadPercent: spread,
          impactPercent: quote.priceImpact,
          networkValue: networkReady ? (networkFee.fiat ?? null) : null,
          allInPercent: cost?.percent ?? null,
        })
      : null;
  const tolerance = formatPercent(slippagePercent, { digits: slippagePercent % 1 === 0 ? 0 : 2 });
  const minimumSub = indicative
    ? "For the indicative amount"
    : !minimum.exact
      ? `Estimate · TWAP rule, ${tolerance}`
      : quote.estimate
        ? "Estimate, for step 2"
        : `Exact · ${tolerance} slippage`;

  const rateMain = inverted
    ? quote.rate.fromPerTo
      ? `1 ${to.ticker} = ${quote.rate.fromPerTo} ${from.ticker}`
      : null
    : quote.rate.toPerFrom
      ? `1 ${from.ticker} = ${quote.rate.toPerFrom} ${to.ticker}`
      : null;
  const rateOther = inverted
    ? quote.rate.toPerFrom
      ? `1 ${from.ticker} = ${quote.rate.toPerFrom} ${to.ticker}`
      : null
    : quote.rate.fromPerTo
      ? `1 ${to.ticker} = ${quote.rate.fromPerTo} ${from.ticker}`
      : null;
  const marketText = market !== null ? ratioText(inverted ? 1 / market : market) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Rate, both ways, against the market: side by side on a wide card,
          stacked (and left-aligned, not ragged right) on a narrow one. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 @[520px]:grid-cols-[minmax(0,1fr)_auto] @[520px]:items-end">
        <div className="min-w-0">
          {rateMain ? (
            <button
              type="button"
              onClick={onInvert}
              className="d-hit group/rate inline-flex max-w-full items-center gap-2 rounded-[8px] text-left"
              aria-label={`${rateMain}. Show the inverse rate`}
            >
              <span className="truncate text-[20px] font-semibold tracking-[-0.025em] text-fg tabular-nums max-sm:text-[18px]">{rateMain}</span>
              <Icon name="swap" size={15} className="shrink-0 text-fg-dim transition-colors group-hover/rate:text-fg" />
            </button>
          ) : (
            <span className="text-[15px] text-fg-dim">Rate unavailable: a token&apos;s decimals are unknown</span>
          )}
          {rateOther ? <p className="mt-0.5 text-[12.5px] tabular-nums text-fg-dim">{rateOther}</p> : null}
        </div>
        <div className="@[520px]:text-right">
          <p className="text-[12.5px] text-fg-dim">
            Market{" "}
            <span className="tabular-nums text-fg-muted">
              {marketText ? `${marketText} ${inverted ? from.ticker : to.ticker}` : "—"}
            </span>
          </p>
          {vsMarket !== null ? (
            <p className={cn("text-[12.5px] font-medium tabular-nums", vsMarket <= -3 ? "text-[var(--z-warning)]" : "text-fg-muted")}>
              Quote {formatPercent(vsMarket, { signed: true, digits: 2 })} vs market
            </p>
          ) : (
            <p className="text-[12px] text-fg-dim">{market === null ? "No market price for one side" : ""}</p>
          )}
        </div>
      </div>

      {/* Four figures */}
      <div className="grid grid-cols-2 gap-2 @[560px]:grid-cols-4">
        <Tile
          label="Price impact"
          about="About the price impact"
          info="How much this order moves the pools' price, as the router computes it. Above 1% it is worth a look; above 5% a smaller amount usually does better."
          value={<span className={TONE_TEXT[impact.tone]}>{quote.priceImpact === null ? "—" : formatPercent(quote.priceImpact, { digits: 2 })}</span>}
          sub={
            <StatusBadge tone={impact.tone === "neutral" ? "neutral" : impact.tone} size="sm">
              {impact.label}
            </StatusBadge>
          }
        />
        <Tile
          label="Minimum"
          about="About the minimum received"
          info={
            minimum.exact
              ? "A number in the signed message: below it, Osmosis refuses the whole transaction."
              : (minimum.rule ?? "An estimate of the contract's rule at today's price.")
          }
          value={
            quote.minOut ? (
              <span title={minimum.amount ?? undefined}>
                <TokenAmount amount={quote.minOut} decimals={to.decimals} symbol={to.ticker} maxFraction={fractionDigits(quote.minOut, to.decimals)} masked={false} symbolClassName="text-[12.5px] font-medium" />
              </span>
            ) : (
              "—"
            )
          }
          sub={minimumSub}
        />
        <Tile
          label="Network fee"
          about="About the network fee"
          info="Paid to the chain's validators in its fee token, measured by simulating this transaction when possible."
          value={
            networkFee.state === "ready" ? (
              <span className={cn(networkFee.stale && "opacity-60")}>
                {formatAmount(networkFee.amount ?? null, { maxFraction: 5 })} <span className="text-[13px] font-medium text-fg-dim">{networkFee.symbol}</span>
              </span>
            ) : networkFee.state === "loading" ? (
              <Skeleton width={72} height={16} />
            ) : (
              "—"
            )
          }
          sub={
            networkFee.state === "ready"
              ? `${networkFee.fiat !== null && networkFee.fiat !== undefined ? `≈ ${formatFiat(networkFee.fiat, prices.currency)} · ` : ""}${networkFee.measured ? "simulated" : "estimate"}`
              : networkFee.reason ?? (networkFee.state === "loading" ? "Simulating…" : "")
          }
        />
        <Tile
          label="All-in vs market"
          about="About the all-in cost against market prices"
          info="What you receive against everything you pay, both valued at market prices: the costs listed below, plus any gap between the pools' price and the market price. The network fee is not included. An estimate."
          value={
            cost ? (
              <span className={cost.percent <= -3 ? "text-[var(--z-warning)]" : undefined}>{formatPercent(cost.percent, { signed: true, digits: 2 })}</span>
            ) : (
              "—"
            )
          }
          sub={cost ? `≈ ${formatFiat(cost.difference, prices.currency, { signed: true })} · est.` : "Needs both prices"}
        />
      </div>

      {/* Route */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="d-label">Route</h3>
          {quote.path === "move-first" ? (
            <Badge tone="warning" size="sm" icon="hourglass">
              Estimate
            </Badge>
          ) : null}
        </div>
        <RouteDiagram quote={quote} splits={splits} from={from} to={to} venueToken={venueToken} />
      </div>

      {/* What it costs, line by line */}
      {breakdown ? (
        <CostBreakdown
          breakdown={breakdown}
          currency={prices.currency}
          allInPercent={cost?.percent ?? null}
          subs={{
            ...(fee && fee.fee > BigInt(0)
              ? { zunia: <TokenAmount amount={fee.fee} decimals={from.decimals} symbol={from.ticker} masked={false} /> }
              : {}),
            ...(networkReady
              ? {
                  network: (
                    <span className={cn(networkFee.stale && "opacity-60")}>
                      {formatAmount(networkFee.amount ?? null, { maxFraction: 6 })} {networkFee.symbol} · {networkFee.measured ? "simulated" : "estimate"}
                    </span>
                  ),
                }
              : {}),
          }}
          reasons={{
            taker: "Not reported by the router",
            spread: "Not reported for every pool",
            impact: "Not reported by the router",
            network: networkFee.state === "loading" ? "Simulating…" : (networkFee.reason ?? "Not measured"),
          }}
        />
      ) : null}

      {quote.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {quote.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-[12.5px] leading-snug text-fg-muted">
              <Icon name="info" size={14} className="mt-px shrink-0 text-fg-dim" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
