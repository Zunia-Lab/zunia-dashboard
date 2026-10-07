"use client";

/**
 * The swap signed from this page, kept above the analysis after its review
 * closes: what was sent for what, whether the chain confirmed it, and, for a
 * swap that moves a packet (delivery, or the cross-chain contract), where the
 * funds are now (./SwapTracker). Links to the transaction in Activity and on
 * the chain's explorer.
 */

import Link from "next/link";
import { Card, CardHeader, ExternalLink, IconButton, RelativeTime, StatusBadge, TokenAmount } from "@/components/ui";
import { explorerTxUrl } from "@/lib/data/swap";
import type { SignedSwap } from "./ReviewDialog";
import { SwapTracker } from "./SwapTracker";
import { receiveView, trackingPlan } from "./swap-view";

export function LastSwapCard({ swap, onDismiss }: { swap: SignedSwap; onDismiss: () => void }) {
  const { review } = swap;
  const plan = trackingPlan(review);
  const explorer = explorerTxUrl(swap.chainId, swap.txHash);
  const received = receiveView(review.quote);
  return (
    <Card as="section" aria-labelledby="swap-last-title" variant="hero">
      <CardHeader
        id="swap-last-title"
        title="Your latest swap"
        subtitle={<RelativeTime at={swap.at} prefix="Signed" />}
        actions={
          <>
            <StatusBadge tone={swap.confirmed ? "success" : "warning"}>{swap.confirmed ? "Confirmed" : "Submitted"}</StatusBadge>
            <IconButton label="Dismiss" icon="close" size="sm" onClick={onDismiss} />
          </>
        }
      />
      <p className="text-[14px] text-fg">
        <TokenAmount amount={review.amountUnits} decimals={review.from.decimals} symbol={review.from.ticker} /> on {review.from.chainName}
        <span className="mx-1.5 text-fg-dim">→</span>
        {received.exact ? "" : "about "}
        <TokenAmount amount={received.amount} decimals={review.to.decimals} symbol={review.to.ticker} /> on {review.to.chainName}
      </p>
      {plan ? (
        <SwapTracker
          plan={plan}
          txHash={swap.txHash}
          expectedAmount={review.path === "pool-deliver" ? (review.quote.minOut ?? undefined) : review.fee.net}
          recoveryAddress={review.recoveryAddress}
          contractAddress={review.quote.contract?.address ?? null}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <Link href={`/activity/${swap.txHash}?chainId=${encodeURIComponent(swap.chainId)}`} className="text-[var(--d-accent-text)] underline-offset-[3px] hover:underline">
          Open in Activity
        </Link>
        {explorer ? <ExternalLink href={explorer}>View on explorer</ExternalLink> : null}
      </div>
    </Card>
  );
}
