/**
 * The swap as the user reviewed it, frozen when the confirm card opens.
 *
 * Ported from zunia-extension entrypoints/popup/screens/SwapScreen.tsx
 * (`ReviewedSwap`, `ReviewedPoolSwap`) @ 1453e7a, as one shape for every path
 * that signs (`contract`, `pool`, `pool-deliver`; `move-first` signs no swap,
 * it opens Send).
 *
 * Live state keeps moving underneath the card: balances refresh, the quote
 * requotes, the user edits the form. The card draws only from this record,
 * the messages are built only from it (./tx.ts `buildSwapTx`), and the checks
 * that run right before signing (./tx.ts `checkSwapTx`) compare the messages
 * against it, so what is signed is what was shown. JSON-safe (amounts are
 * decimal strings), so a page can keep it in state or sessionStorage.
 */

import type { SwapFeeWire } from "@/lib/swap/fee";
import type { SwapPath } from "@/lib/swap/path";
import type { SwapQuoteOk } from "@/lib/swap/wire";

/** One side of a reviewed swap: where it is, what it is, and how it reads. */
export interface ReviewSide {
  readonly chainId: string;
  readonly chainName: string;
  /** Exact bank denom on `chainId`. Signed as is. */
  readonly denom: string;
  /** Display only. */
  readonly ticker: string;
  /**
   * The ticker is the token's proven identity (`TokenIdentity.proven`). Only
   * a proven ticker is written into the default memo; absent reads as not.
   */
  readonly proven?: boolean;
  /** `null` when unknown: amounts then read in base units. */
  readonly decimals: number | null;
  /** The side's name on Osmosis as the review showed it, when it has one. */
  readonly osmosisDenom: string | null;
}

/** The paths that sign a swap now. */
export type SignedSwapPath = Exclude<SwapPath, "move-first">;

export interface SwapReview {
  /** Tells one review from the next, so a late answer never lands on another. */
  readonly id: number;
  readonly path: SignedSwapPath;
  readonly from: ReviewSide;
  readonly to: ReviewSide;
  /** Base units the user spends in all: the amount typed (or Max), the Zunia fee included. */
  readonly amountUnits: string;
  /**
   * The Zunia fee on `amountUnits` on the signing chain (src/lib/swap/fee.ts):
   * what the bank send pays, and `fee.net`, what the swap message sells and
   * the amount the quote was made for.
   */
  readonly fee: SwapFeeWire;
  /** The quote the messages are built from. Never replaced under a review: a new price is a new review. */
  readonly quote: SwapQuoteOk;
  readonly slippagePercent: number;
  /** This wallet's address on the signing chain: it signs, sells and pays the fee. */
  readonly signer: string;
  /** This wallet's address on the To's chain: where the output must end up. */
  readonly recipient: string;
  /** This wallet's address on Osmosis: the contract path's recovery address. Required there, ignored elsewhere. */
  readonly recoveryAddress: string | null;
  /** `Date.now()` when the review was frozen. */
  readonly frozenAt: number;
}
