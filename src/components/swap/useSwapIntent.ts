"use client";

/**
 * Step 2 of a two-step swap: the pair the user set out to swap when its tokens
 * first had to move to Osmosis (src/lib/swap/intent.ts keeps it in this tab's
 * session storage for an hour).
 *
 * Read without being forgotten, and forgotten only when it is done with: the
 * swap is signed, or the user picks another pair. Reading it once on mount
 * lost it whenever the page mounted again while the transfer was on its way
 * (a reload to check whether the tokens arrived, the wallet session
 * reconnecting), and the form then opened on an unrelated pair.
 */

import { useCallback, useState } from "react";
import { SWAP_INTENT_KEY, takeSwapIntent, type SwapIntent } from "@/lib/swap/intent";

function sessionArea(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The stored intent, checked for shape and age, left in place. */
function peekSwapIntent(): SwapIntent | null {
  const area = sessionArea();
  if (!area) return null;
  // `takeSwapIntent` validates; the storage handed to it forgets nothing.
  return takeSwapIntent(Date.now(), { getItem: (key) => area.getItem(key), setItem: () => {}, removeItem: () => {} });
}

export interface SwapIntentState {
  /** The pending step 2, or `null`. */
  readonly intent: SwapIntent | null;
  /** Done with it: forget it here and in storage. */
  readonly forget: () => void;
}

/**
 * The pending step 2 for a page opened with `link`. A link for another pair
 * wins (the intent stays stored for a later visit); a link for the intent's
 * own pair (the address bar this page writes) keeps it.
 */
export function useSwapIntent(link: { readonly from: string | null; readonly to: string | null }): SwapIntentState {
  const [intent, setIntent] = useState<SwapIntent | null>(() => {
    const stored = peekSwapIntent();
    if (!stored) return null;
    const sameFrom = link.from === null || link.from === stored.fromKey;
    const sameTo = link.to === null || link.to === stored.toKey;
    return sameFrom && sameTo ? stored : null;
  });
  const forget = useCallback(() => {
    try {
      sessionArea()?.removeItem(SWAP_INTENT_KEY);
    } catch {
      // Nothing stored to forget.
    }
    setIntent(null);
  }, []);
  return { intent, forget };
}
