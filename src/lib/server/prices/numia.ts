/**
 * Numia's public Osmosis API: the primary source for prices, 24 h / 7 d
 * changes, volume, liquidity and history of everything traded on Osmosis.
 *
 * No key. `/tokens/v2/all` is ~1.2 MB and takes a couple of seconds, so it is
 * read at most once a minute for the whole process and served stale for up
 * to ten more minutes while it refreshes; one slow answer never holds a page.
 *
 * History is read by **denom** only (`/tokens/v2/historical/{denom}/chart`,
 * URL-encoded), which Numia accepts in place of the symbol. Symbols are not
 * unique (eight rows read "USDC"), so a symbol chart could be another asset's.
 */

import "server-only";

import { cached } from "@/lib/server/cache";
import { fetchJson } from "@/lib/server/http";
import { assetKeyOf, heldIdentity } from "@/lib/token/identity";
import type { PricePoint } from "@/lib/token/types";
import { parseNumiaChart, parseNumiaTokens, type NumiaToken } from "./parse";
import { indexNumia, type NumiaIndex } from "./rules";

const NUMIA = "https://public-osmosis-api.numia.xyz";

export const NUMIA_LABEL = "Numia · Osmosis";
export const NUMIA_URL = "https://www.numia.xyz";

export interface NumiaSnapshot {
  rows: readonly NumiaToken[];
  index: NumiaIndex;
  /** Epoch ms of the read. */
  at: number;
}

export function numiaTokens(): Promise<NumiaSnapshot> {
  return cached(
    "numia:tokens:v2:all",
    { ttlMs: 60_000, staleMs: 10 * 60_000, errorTtlMs: 15_000 },
    async () => {
      const body = await fetchJson(`${NUMIA}/tokens/v2/all`, { timeoutMs: 15_000, retries: 1, hostConcurrency: 8 });
      const rows = parseNumiaTokens(body);
      if (rows.length === 0) throw new Error("Numia returned no tokens");
      return { rows, index: indexNumia(rows, provenOsmosisAsset), at: Date.now() };
    },
  );
}

/**
 * The asset an Osmosis denom is proven to be, read when a symbol match needs
 * it (rarely), so the identity of all 2,900 rows is never computed up front.
 */
function provenOsmosisAsset(denom: string): string | null {
  const held = heldIdentity("osmosis-1", denom);
  return held.proven ? assetKeyOf(held) : null;
}

/** `tf=60` covers about 60 days hourly; `tf=1440` is the full daily history. */
export type NumiaTimeframe = 60 | 1440;

/**
 * Closes for one Osmosis denom, oldest first, each stamped at its candle's
 * close time (the bar still forming at the read time). Empty when Numia has
 * none.
 */
export function numiaChart(denom: string, tf: NumiaTimeframe): Promise<PricePoint[]> {
  const ttlMs = tf === 60 ? 30 * 60_000 : 6 * 60 * 60_000;
  return cached(`numia:chart:v2:${tf}:${denom}`, { ttlMs, staleMs: ttlMs, errorTtlMs: 60_000 }, async () => {
    const body = await fetchJson(
      `${NUMIA}/tokens/v2/historical/${encodeURIComponent(denom)}/chart?tf=${tf}`,
      { timeoutMs: 10_000, retries: 1, hostConcurrency: 8 },
    );
    return parseNumiaChart(body, tf * 60_000, Date.now());
  });
}
