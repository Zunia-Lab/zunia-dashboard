"use client";

/**
 * The route a quote takes, drawn as legs on a rail: where the funds leave
 * from, the swap on Osmosis (each split of the order with its share, the pools
 * it crosses and the token between them), and where the output lands.
 *
 * Every fact here is the quote's own: pool ids and fees from the router, the
 * channels and light-client status the server proved, the contract it
 * checked. Nothing is inferred for decoration.
 */

import { Icon, type IconName } from "@/components/icons";
import { AssetLogo, Badge, Tooltip, chainById } from "@/components/ui";
import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { formatPercent } from "@/lib/format";
import type { SwapQuotePrice } from "@/lib/data/swap";
import { shortDenom } from "@/lib/token/text";
import type { SplitView } from "./swap-view";

const VENUE = SWAP_VENUE_CHAIN_ID;

export interface VenueToken {
  ticker: string;
  logoUrl?: string;
}

export interface RouteDiagramProps {
  quote: Pick<SwapQuotePrice, "path" | "venueInputDenom" | "venueOutputDenom" | "contract" | "delivery" | "inbound">;
  splits: SplitView[];
  from: { chainId: string; chainName: string; ticker: string; iconUrl?: string };
  to: { chainId: string; chainName: string; ticker: string; iconUrl?: string };
  /** Names an Osmosis denom met along the route. */
  venueToken: (denom: string) => VenueToken | null;
}

interface Leg {
  key: string;
  icon: IconName;
  chainId: string;
  title: string;
  detail?: string;
  badge?: { text: string; tone: "success" | "warning" | "neutral" };
  splits?: boolean;
}

function clientBadge(status: "active" | "unconfirmed"): Leg["badge"] {
  return status === "active" ? { text: "Client active", tone: "success" } : { text: "Client unconfirmed", tone: "warning" };
}

export function RouteDiagram({ quote, splits, from, to, venueToken }: RouteDiagramProps) {
  const venueName = chainById(VENUE)?.chainName ?? "Osmosis";
  const legs: Leg[] = [];
  const contract = quote.contract;

  if (quote.path === "move-first") {
    legs.push({
      key: "move",
      icon: "bridge",
      chainId: from.chainId,
      title: `Step 1 · Move ${from.ticker} to ${venueName}`,
      detail: `An IBC transfer from ${from.chainName}, signed on its own.`,
    });
  } else if (quote.path === "contract" && from.chainId !== VENUE && quote.inbound) {
    legs.push({
      key: "inbound",
      icon: "send",
      chainId: from.chainId,
      title: `Leave ${from.chainName} over ${quote.inbound.channelId}`,
      detail: `Arrives on ${venueName} over ${quote.inbound.venueChannelId}; the contract runs on arrival.`,
      badge: clientBadge(quote.inbound.clientStatus),
    });
  }

  legs.push({
    key: "swap",
    icon: "swap",
    chainId: VENUE,
    title:
      quote.path === "contract"
        ? `Swap by Zunia's contract on ${venueName}`
        : quote.path === "move-first"
          ? `Step 2 · Swap in ${venueName} pools`
          : `Swap in ${venueName} pools`,
    detail:
      quote.path === "contract" && contract
        ? `${contract.label ?? "Crosschain-swaps contract"}${contract.codeId ? ` · code ${contract.codeId}` : ""}`
        : splits.length > 1
          ? `Split across ${splits.length} routes by the Osmosis router`
          : "Best route from the Osmosis router",
    ...(quote.path === "contract" && contract ? { badge: contract.verified ? { text: "Verified", tone: "success" as const } : { text: "Unverified", tone: "warning" as const } } : {}),
    splits: true,
  });

  if (to.chainId === VENUE) {
    legs.push({ key: "land", icon: "wallet", chainId: VENUE, title: `Paid to your ${venueName} address`, detail: `As ${to.ticker}, in the same transaction as the swap.` });
  } else if (quote.delivery) {
    legs.push({
      key: "deliver",
      icon: "send",
      chainId: VENUE,
      title: `Send to ${to.chainName} over ${quote.delivery.channelId}`,
      detail:
        quote.path === "pool-deliver"
          ? `Exactly the guaranteed minimum, in the same transaction. Arrives as ${to.ticker}.`
          : `The whole output, sent by the contract. Arrives as ${to.ticker}.`,
      badge: clientBadge(quote.delivery.clientStatus),
    });
  } else {
    legs.push({ key: "land", icon: "wallet", chainId: to.chainId, title: `Delivered on ${to.chainName}`, detail: `As ${to.ticker}.` });
  }

  return (
    <ol className="relative flex flex-col" aria-label="Swap route">
      {legs.map((leg, index) => {
        const chain = chainById(leg.chainId);
        const last = index === legs.length - 1;
        return (
          <li key={leg.key} className="relative flex gap-3 pb-3.5 last:pb-0">
            {!last ? <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-[var(--d-hairline-strong)]" /> : null}
            <span className="relative z-[1] flex size-[27px] shrink-0 items-center justify-center rounded-full border border-[var(--d-hairline-strong)] bg-[var(--d-card)] text-fg-muted">
              <Icon name={leg.icon} size={14} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {chain?.iconUrl ? <AssetLogo src={chain.iconUrl} symbol={chain.coinDenom} size={16} /> : null}
                <p className="text-[13.5px] font-medium leading-snug text-fg">{leg.title}</p>
                {leg.badge ? (
                  <Badge tone={leg.badge.tone} size="sm" dot>
                    {leg.badge.text}
                  </Badge>
                ) : null}
              </div>
              {leg.detail ? <p className="mt-0.5 text-[12.5px] leading-snug text-fg-dim">{leg.detail}</p> : null}
              {leg.splits && splits.length > 0 ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  {splits.map((split, splitIndex) => (
                    <SplitRow key={splitIndex} split={split} inputDenom={quote.venueInputDenom} from={from} to={to} outputDenom={quote.venueOutputDenom} venueToken={venueToken} showShare={splits.length > 1} />
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TokenChip({ ticker, logoUrl }: { ticker: string; logoUrl?: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-[var(--d-glass-2)] pl-0.5 pr-2 text-[12px] font-medium text-fg">
      <AssetLogo src={logoUrl ?? null} symbol={ticker} size={20} />
      {ticker}
    </span>
  );
}

function SplitRow({
  split,
  inputDenom,
  outputDenom,
  from,
  to,
  venueToken,
  showShare,
}: {
  split: SplitView;
  inputDenom: string;
  outputDenom: string;
  from: RouteDiagramProps["from"];
  to: RouteDiagramProps["to"];
  venueToken: RouteDiagramProps["venueToken"];
  showShare: boolean;
}) {
  const name = (denom: string): VenueToken => {
    if (denom === inputDenom) return { ticker: from.ticker, ...(from.iconUrl ? { logoUrl: from.iconUrl } : {}) };
    if (denom === outputDenom) return { ticker: to.ticker, ...(to.iconUrl ? { logoUrl: to.iconUrl } : {}) };
    return venueToken(denom) ?? { ticker: shortDenom(denom) };
  };
  const shareText = formatPercent(split.share, { digits: split.share % 1 === 0 ? 0 : 1 });
  return (
    // Share in its own column, the path beside it; on a narrow card the share
    // sits above the path. Each hop (pool, then the token it pays) is one
    // unbreakable group, so a long path wraps between hops, never inside one.
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[10px] bg-[var(--d-card-2)] px-2.5 py-2 @[480px]:flex-row @[480px]:items-center @[480px]:gap-3">
      {showShare ? (
        <span className="inline-flex shrink-0 items-center gap-2 @[480px]:w-[5.5rem]" title={`${shareText} of the amount takes this route`}>
          <span aria-hidden className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--d-glass-2)]">
            <span className="block h-full rounded-full bg-[var(--viz-accent,var(--z-accent))]" style={{ width: `${Math.max(2, Math.min(100, split.share))}%` }} />
          </span>
          <span className="font-mono text-[11px] font-medium tabular-nums text-fg-muted">
            {shareText}
            <span className="sr-only"> of the amount:</span>
          </span>
        </span>
      ) : null}
      <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1.5">
        <TokenChip {...name(inputDenom)} />
        {split.pools.map((pool) => {
          const out = name(pool.tokenOutDenom);
          const fees = [
            typeof pool.spread === "number" ? `spread ${formatPercent(pool.spread, { digits: 2 })}` : null,
            typeof pool.takerFee === "number" ? `taker fee ${formatPercent(pool.takerFee, { digits: 2 })}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <span key={`${pool.id}-${pool.tokenOutDenom}`} className="inline-flex shrink-0 items-center gap-1">
              <Icon name="arrowRight" size={12} className="shrink-0 text-fg-faint" />
              <Tooltip content={`Pool ${pool.id}${fees ? ` · ${fees}` : ""}`}>
                <span tabIndex={0} className="inline-flex h-6 shrink-0 items-center rounded-[6px] border border-[var(--d-hairline-strong)] px-1.5 font-mono text-[11px] text-fg-muted">
                  <span className="sr-only">through pool </span>#{pool.id}
                  {/* The spread is in the tooltip and the cost lines; on a narrow card it would push the hop to a new line. */}
                  {typeof pool.spread === "number" ? (
                    <span className="ml-1 hidden text-fg-dim @[480px]:inline">
                      <span className="sr-only">, spread </span>
                      {formatPercent(pool.spread, { digits: 2 })}
                    </span>
                  ) : null}
                </span>
              </Tooltip>
              <Icon name="arrowRight" size={12} className="shrink-0 text-fg-faint" />
              <span className="sr-only">to </span>
              <TokenChip {...out} />
            </span>
          );
        })}
      </span>
    </div>
  );
}
