/**
 * The swap a user set out to make when its tokens first had to move to
 * Osmosis (./path.ts `move-first`).
 *
 * Ported from zunia-extension lib/swap-intent.ts @ 1453e7a, with
 * `sessionStorage` in place of `chrome.storage.session`.
 *
 * Swap sends the user to Send to move the tokens, and the Swap page is gone by
 * the time they come back. This keeps the pair, the Osmosis row the tokens
 * will arrive as and the To, so Swap opens on it again: the From picked as the
 * Osmosis balance (once that balance has been read), the To as it was. Only
 * two row keys are kept, nothing that signs; in this tab's session storage,
 * for an hour, and read once. Best effort throughout: without storage (a
 * private window, blocked site data) Swap just opens as usual.
 */

/** The two rows Swap opens on. */
export interface SwapIntent {
  /** `${chainId}:${denom}` of the From row once the tokens are on Osmosis. */
  readonly fromKey: string;
  /** `${chainId}:${denom}` of the To row. */
  readonly toKey: string;
}

/** Long enough for any transfer to Osmosis to arrive; older, the user has moved on. */
export const SWAP_INTENT_TTL_MS = 60 * 60_000;

/** The session-storage key. Versioned so a later shape never reads an older record. */
export const SWAP_INTENT_KEY = "zunia.dashboard.swapIntent.v1";

/** What the module needs from `sessionStorage`; tests pass a map-backed one. */
export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function sessionArea(): IntentStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const ROW_KEY = /^[^:\s]{1,64}:[A-Za-z0-9/:._-]{1,256}$/;

/** Remember the pair. Best effort. */
export function rememberSwapIntent(intent: SwapIntent, now: number = Date.now(), area: IntentStorage | null = sessionArea()): void {
  if (!area || !ROW_KEY.test(intent.fromKey) || !ROW_KEY.test(intent.toKey)) return;
  try {
    area.setItem(SWAP_INTENT_KEY, JSON.stringify({ fromKey: intent.fromKey, toKey: intent.toKey, at: now }));
  } catch {
    // Nothing to keep it in.
  }
}

/** The pair, once: reading it forgets it. `null` when there is none, or it is over an hour old. */
export function takeSwapIntent(now: number = Date.now(), area: IntentStorage | null = sessionArea()): SwapIntent | null {
  if (!area) return null;
  try {
    const raw = area.getItem(SWAP_INTENT_KEY);
    area.removeItem(SWAP_INTENT_KEY);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== "object" || stored === null) return null;
    const { fromKey, toKey, at } = stored as Record<string, unknown>;
    if (typeof fromKey !== "string" || typeof toKey !== "string" || typeof at !== "number") return null;
    if (!ROW_KEY.test(fromKey) || !ROW_KEY.test(toKey)) return null;
    if (now - at > SWAP_INTENT_TTL_MS || now < at) return null;
    return { fromKey, toKey };
  } catch {
    return null;
  }
}
