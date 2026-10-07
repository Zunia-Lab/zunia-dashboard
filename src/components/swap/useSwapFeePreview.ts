"use client";

/**
 * The network fee of the swap on the form, measured before anyone clicks.
 *
 * The swap is frozen the way the review would freeze it (at the quote's own
 * time, so its bytes are stable for that quote and one quote is simulated
 * once), built with the engine's builder, and simulated through
 * `useTxPreview`, which never opens a wallet prompt. While the review dialog
 * is open its own frozen review is measured instead, so the fee shown there
 * is the fee of exactly what it would sign.
 */

import { useMemo } from "react";
import { buildSwapTx, freezeReview, type AssetOption, type SwapQuoteOk, type SwapReview } from "@/lib/data/swap";
import { useTxPreview, type TxPreviewState } from "@/lib/data/wallet";
import type { SignRequest } from "@/lib/tx/types";

export interface SwapFeePreviewInput {
  /** The review dialog's frozen review, while it is open. */
  dialogReview: SwapReview | null;
  /** An amount is typed (an indicative price is never measured). */
  typed: boolean;
  /** The signable quote for the form. */
  quote: SwapQuoteOk | null;
  from: AssetOption | undefined;
  to: AssetOption | undefined;
  amountUnits: bigint | null;
  slippagePercent: number;
  /** This wallet's addresses on the signing chain, the To's chain and Osmosis. */
  signer: string | null;
  recipient: string | null;
  venue: string | null;
}

export interface SwapFeePreview {
  request: SignRequest | null;
  preview: TxPreviewState;
}

export function useSwapFeePreview({
  dialogReview,
  typed,
  quote,
  from,
  to,
  amountUnits,
  slippagePercent,
  signer,
  recipient,
  venue,
}: SwapFeePreviewInput): SwapFeePreview {
  const formReview = useMemo(() => {
    if (!typed || amountUnits === null || !quote || !from || !to || quote.estimate || quote.path === "move-first" || !signer || !recipient) {
      return null;
    }
    const frozen = freezeReview({
      id: 0,
      from,
      to,
      amountUnits,
      quote,
      slippagePercent,
      signer,
      recipient,
      recoveryAddress: quote.path === "contract" ? venue : null,
      now: quote.quotedAt,
    });
    return "review" in frozen ? frozen.review : null;
  }, [typed, amountUnits, quote, from, to, slippagePercent, signer, recipient, venue]);

  const measured = dialogReview ?? formReview;
  const request = useMemo<SignRequest | null>(() => {
    if (!measured) return null;
    try {
      const tx = buildSwapTx(measured, { now: measured.frozenAt });
      return { chainId: tx.chainId, messages: tx.messages, memo: tx.memo, signMode: "direct" };
    } catch {
      return null;
    }
  }, [measured]);

  const preview = useTxPreview(request);
  return { request, preview };
}
