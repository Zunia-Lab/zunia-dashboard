"use client";

/**
 * One transaction in a list: when, what (kind glyph + the server's sentence),
 * where (chain), what moved for the account (signed, coloured by direction,
 * masked with privacy) and, on wide screens, the hash with copy and explorer.
 *
 * The whole row opens the transaction page. It is a link laid over the row
 * (not a wrapper) so the copy and explorer controls stay real buttons and
 * links of their own instead of nesting inside an <a>.
 *
 * Status: only a failure is marked. A list where every row says "Success"
 * buries the one that did not; a failed row gets the danger tint on its
 * glyph, a "Failed" pill and the fee it still cost.
 */

import Link from "next/link";
import { memo } from "react";
import { ChainLogo, CopyButton, IconButton, Money, StatusBadge, TokenAmount, chainById, isSafeExternalHref } from "@/components/ui";
import { KIND_LABELS, type PriceMap } from "@/lib/activity/analytics";
import type { ActivityItem } from "@/lib/activity/types";
import { cn } from "@/lib/cn";
import { MINUS, formatDate, formatRelativeTime, shortenAddress, shortenHash } from "@/lib/format";
import { usePrefs } from "@/providers/PrefsProvider";
import { KindIcon } from "./KindIcon";
import { isOwnTransfer, legsValue, privateText, rowLegs, txHref, type AmountLeg } from "./view";

export interface ActivityRowProps {
  item: ActivityItem;
  prices: PriceMap;
  /** Currency the prices are in (the prices response's, not the stored preference). */
  currency: string;
  /** Shared clock; the relative date shows only when it is known. */
  now?: number | null;
  /**
   * `day` (default): rows sit under a day heading, so the row shows the time.
   * `relative`: a short list without headings (Overview, Live), so the row
   * says "2 h ago".
   */
  timeStyle?: "day" | "relative";
  /** Hide the hash column even on wide screens (narrow cards). */
  compact?: boolean;
  /**
   * Key parts of the wallet's own addresses (`bech32Body`): a transfer
   * between two of them is marked "between your accounts".
   */
  ownBodies?: ReadonlySet<string>;
  className?: string;
}

const MAX_LEGS = 2;

function LegAmount({ leg }: { leg: AmountLeg }) {
  const incoming = leg.direction === "in";
  return (
    <span className={cn("inline-flex items-baseline justify-end whitespace-nowrap tabular-nums", incoming ? "text-[var(--d-pos)]" : "text-fg")}>
      <span aria-hidden>{incoming ? "+" : MINUS}</span>
      <span className="sr-only">{incoming ? "received " : "sent "}</span>
      <TokenAmount
        amount={leg.amount}
        decimals={leg.decimals}
        symbol={leg.ticker}
        maxFraction={leg.decimals !== null && leg.decimals > 4 ? 4 : undefined}
        // Full strength: faded, the light theme's green falls under 4.5:1.
        symbolClassName={incoming ? "text-[var(--d-pos)]" : undefined}
      />
    </span>
  );
}

function RowAmounts({ item, prices, currency }: Pick<ActivityRowProps, "item" | "prices" | "currency">) {
  const legs = rowLegs(item);
  if (!item.success) {
    // A failed transaction moved nothing but still paid its fee (when this
    // account was the one paying).
    return (
      <span className="flex flex-col items-end gap-1">
        <StatusBadge tone="danger" size="sm">
          Failed
        </StatusBadge>
        {item.feePaid && item.fee ? (
          <span className="text-[12px] text-fg-dim">
            Fee <TokenAmount amount={item.fee.amount} decimals={item.fee.decimals ?? null} symbol={item.fee.symbol ?? item.fee.denom} maxFraction={6} />
          </span>
        ) : null}
      </span>
    );
  }
  if (legs.length === 0) return null;
  const shown = legs.slice(0, MAX_LEGS);
  // Today's value only for a single amount: a swap's two legs netted would be
  // its slippage, which reads as a gain or a loss it was not.
  const value = legs.length === 1 ? legsValue(legs, prices) : null;
  return (
    <span className="flex min-w-0 flex-col items-end gap-0.5 text-[13.5px] font-medium leading-tight">
      {shown.map((leg) => (
        <LegAmount key={leg.key} leg={leg} />
      ))}
      {legs.length > shown.length ? <span className="text-[12px] font-normal text-fg-dim">+{legs.length - shown.length} more</span> : null}
      {value !== null ? (
        <span className="text-[12px] font-normal text-fg-dim" title="At today's price, not the price at the time">
          ≈ <Money value={Math.abs(value)} currency={currency} />
        </span>
      ) : null}
    </span>
  );
}

function ActivityRowView({ item, prices, currency, now = null, timeStyle = "day", compact, ownBodies, className }: ActivityRowProps) {
  const { hideAmounts } = usePrefs();
  const time = Date.parse(item.time);
  const chain = chainById(item.chainId);
  const chainName = chain?.chainName ?? item.chainId;
  const href = txHref(item.chainId, item.hash);
  const explorer = item.explorerUrl && isSafeExternalHref(item.explorerUrl) ? item.explorerUrl : null;
  const clock = formatDate(time, "time");
  const when = timeStyle === "relative" && now !== null ? formatRelativeTime(time, now) : clock;
  // The server's sentence names amounts ("Sent 12.5 OSMO…"): privacy mode
  // masks them here as it does the figures, in the text, its tooltip and the
  // link's accessible name alike.
  const summary = privateText(item.summary, hideAmounts, item.kind === "vote");
  const label = `${summary}. ${chainName}, ${formatDate(time, "datetime")}${item.success ? "" : ", failed"}`;
  // The memo is the signer's note. On a row this account did not sign, the
  // signer is the sender of a plain transfer (their memo matters: exchange
  // references) or a relayer / authz bot (whose "Relayed by …" is noise).
  const memo = item.memo && (item.signed || item.kind === "receive") ? item.memo : null;
  const internal = ownBodies !== undefined && isOwnTransfer(item, ownBodies);

  return (
    <li
      className={cn(
        "group/row relative grid min-h-[60px] items-center gap-x-3 px-[var(--d-pad)] py-2.5",
        "grid-cols-[32px_minmax(0,1fr)_auto]",
        timeStyle === "day" && "lg:grid-cols-[4.25rem_32px_minmax(0,1fr)_auto]",
        timeStyle === "day" && !compact && "xl:grid-cols-[4.25rem_32px_minmax(0,1fr)_minmax(8.5rem,auto)_11rem]",
        "transition-colors duration-[160ms] hover:bg-[var(--d-row-hover)]",
        className,
      )}
    >
      <Link
        href={href}
        aria-label={label}
        prefetch={false}
        className="absolute inset-0 z-0 rounded-[inherit] focus-visible:outline-offset-[-2px]"
      />
      {timeStyle === "day" ? (
        <time dateTime={item.time} className="hidden font-mono text-[12px] tabular-nums tracking-[-0.01em] text-fg-dim lg:block" suppressHydrationWarning>
          {clock}
        </time>
      ) : null}
      <KindIcon kind={item.kind} failed={!item.success} />
      <div className="min-w-0">
        {/* Phones wrap the sentence to two lines rather than cut it at the
            first address; wider rows keep one line. */}
        <p className="truncate text-[14px] leading-snug text-fg max-sm:line-clamp-2 max-sm:whitespace-normal" title={summary}>
          {summary}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] leading-snug text-fg-dim">
          <ChainLogo chainId={item.chainId} size={14} />
          <span className="shrink-0">{chainName}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{KIND_LABELS[item.kind]}</span>
          {internal ? (
            <span className="hidden shrink-0 sm:inline" title="Both addresses are this wallet's: not counted as sent or received">
              <span aria-hidden>· </span>between your accounts
            </span>
          ) : null}
          {/* Under a day heading the time has its own column from lg up. */}
          <span className={cn("shrink-0", timeStyle === "day" && "lg:hidden")} suppressHydrationWarning>
            <span aria-hidden>· </span>
            {when}
          </span>
          {item.via ? (
            <span className="hidden min-w-0 truncate sm:inline" title={`Run for you by ${item.via} with an authz grant`}>
              <span aria-hidden>· </span>via {shortenAddress(item.via)}
            </span>
          ) : null}
          {memo ? (
            <span className="hidden min-w-0 truncate md:inline" title={memo}>
              <span aria-hidden>· </span>“{memo}”
            </span>
          ) : null}
        </p>
      </div>
      <div className="min-w-0 text-right">
        <RowAmounts item={item} prices={prices} currency={currency} />
      </div>
      {timeStyle === "day" && !compact ? (
        <div className="relative z-[1] hidden items-center justify-end gap-0.5 xl:flex">
          <span className="mr-1 font-mono text-[12px] tracking-[-0.01em] text-fg-dim" title={item.hash}>
            {shortenHash(item.hash, 6, 4)}
          </span>
          <CopyButton value={item.hash} label="transaction hash" />
          {explorer ? (
            <IconButton label={`Open in ${chainName}'s explorer`} icon="arrowUpRight" size="sm" href={explorer} external className="size-6" />
          ) : (
            <span aria-hidden className="inline-block size-6" />
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Memoised: a day list re-renders on every filter keystroke, rows rarely change. */
export const ActivityRow = memo(ActivityRowView);
