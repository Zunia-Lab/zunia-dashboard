"use client";

/**
 * The page's figures: what this wallet can swap in the current scope, read
 * from its liquid balances and the venue's listing.
 *
 * - Swappable: balances whose token Osmosis trades, at market prices.
 * - Already on Osmosis: the part that swaps in one transaction.
 * - On other chains: the part that swaps from its own chain through Zunia's
 *   contract, or moves to Osmosis first (which one depends on the pair, so
 *   the tile does not guess).
 * - Not listed: balances outside Zunia's list of Osmosis tokens, named,
 *   because "why can't I swap SAF?" is the question this answers. Tokens
 *   with nothing on Osmosis cannot be swapped here; unlisted ones can still
 *   get a quote, so the two are counted apart and neither is called
 *   "swappable". The list keeps the Osmosis tokens Osmosis verifies and does
 *   not flag (src/lib/server/swap/assets.ts), so an unlisted token is either
 *   unverified or flagged, and the page cannot tell which: the words claim
 *   neither (allBTC is verified, and flagged).
 *
 * Same strip as Bridge's (one card, hairline-split tiles, two by two on
 * phones), so the trade pages read alike.
 */

import { memo } from "react";
import { Money } from "@/components/ui";
import { formatPercent } from "@/lib/format";
import type { AssetOption } from "@/lib/swap/assets";
import { Stat, StatStrip } from "@/components/transfer/StatStrip";
import { swappableSummary } from "./swap-analysis";

export interface SwapStripProps {
  /** The sell list: the scope's liquid balances. */
  sell: readonly AssetOption[];
  /** Osmosis denoms the venue lists; `null` while the listing loads. */
  listed: ReadonlySet<string> | null;
  /** Liquid value of a row in `currency`, when priced. */
  valueOf: (option: AssetOption) => number | null;
  currency: string;
  /** Balances or the listing still loading (first load). */
  loading: boolean;
  /** A refetch is in flight: keep the figures, dimmed. */
  pending: boolean;
  className?: string;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Memoised: its inputs are the page's memoised lists, not the per-second clock. */
export const SwapStrip = memo(function SwapStrip({ sell, listed, valueOf, currency, loading, pending, className }: SwapStripProps) {
  const summary = swappableSummary(sell, listed, valueOf);
  const { tradable, onVenue, elsewhere, notListed } = summary;
  const waiting = loading || listed === null;
  const unpriced = (count: number) => (count > 0 ? ` · ${count} unpriced` : "");
  const shareOf = (part: number | null) => {
    if (part === null || tradable.value === null || !(tradable.value > 0)) return null;
    const percent = (part / tradable.value) * 100;
    if (part === tradable.value) return "100%";
    return percent > 0 && percent < 0.1 ? "<0.1%" : formatPercent(percent, { digits: 1 });
  };
  const named = notListed.tickers.slice(0, 2).join(", ");
  const more = notListed.tickers.length - 2;
  // The largest named (short enough for a phone's half-width tile); how many
  // of each kind, and what each means, in the tile's info.
  const notListedSub = notListed.count === 0 ? "Everything here is listed" : `${named}${more > 0 ? ` +${more}` : ""}`;
  const kinds = [
    notListed.notTraded > 0
      ? `${plural(notListed.notTraded, "token")} with nothing on Osmosis cannot be swapped here (hold, send, bridge or stake ${notListed.notTraded === 1 ? "it" : "them"}).`
      : null,
    notListed.unlisted > 0
      ? `${plural(notListed.unlisted, "token")} trade${notListed.unlisted === 1 ? "s" : ""} on Osmosis outside Zunia's list (not verified by Osmosis, or flagged by it as unstable or disabled): still quotable, and the quote shows the price impact before you sign.`
      : null,
  ].filter(Boolean);

  return (
    <StatStrip pending={pending} className={className}>
      <Stat
        label="Swappable"
        value={<Money value={tradable.value} currency={currency} compact reason={tradable.count > 0 ? "None of them is priced" : "Nothing listed on Osmosis"} />}
        sub={tradable.count > 0 ? `${plural(tradable.count, "token")}${unpriced(tradable.unpriced)}` : "Nothing listed on Osmosis"}
        loading={waiting}
        info="Liquid balances in this scope whose token is on Zunia's list of Osmosis tokens, at market prices. Staked tokens have to be unstaked first."
      />
      <Stat
        label="Already on Osmosis"
        value={<Money value={onVenue.count > 0 ? onVenue.value : 0} currency={currency} compact reason="None of them is priced" />}
        sub={onVenue.count > 0 ? `${shareOf(onVenue.value) ? `${shareOf(onVenue.value)} · ` : ""}one transaction` : "Nothing there yet"}
        loading={waiting}
        info="Tokens already on Osmosis swap in one transaction there, with the smallest network fee."
      />
      <Stat
        label="On other chains"
        value={<Money value={elsewhere.count > 0 ? elsewhere.value : 0} currency={currency} compact reason="None of them is priced" />}
        sub={elsewhere.count > 0 ? `${plural(elsewhere.count, "token")} on ${plural(elsewhere.chains, "chain")}` : "Nothing elsewhere"}
        loading={waiting}
        info="Swapped from their own chain in one signature through Zunia's verified contract when a route exists for the pair; otherwise they move to Osmosis first. The form says which before you sign."
      />
      <Stat
        label="Not listed"
        value={
          <span>
            {notListed.count} <span className="text-[14px] font-medium text-fg-dim">{notListed.count === 1 ? "token" : "tokens"}</span>
          </span>
        }
        sub={notListedSub}
        loading={waiting}
        info={
          named
            ? `Outside Zunia's list of Osmosis tokens: ${notListed.tickers.slice(0, 6).join(", ")}${notListed.tickers.length > 6 ? "…" : ""}. ${kinds.join(" ")}`
            : "Tokens outside Zunia's list of Osmosis tokens show here."
        }
      />
    </StatStrip>
  );
});
