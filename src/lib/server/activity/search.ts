/**
 * One page of a public LCD transaction search (the spelling and paging rules
 * are in lib/activity/tx-search, pure and tested).
 *
 * Which condition spelling a chain accepts, `query=` (SDK ≥ 0.50) or
 * `events=` (older), is learned from its first answer — the wrong one is a
 * 400 ("query cannot be empty" / "must declare at least one event") — and
 * remembered for six hours. Kava and Lava (SDK 0.47) need `events=`; the Hub,
 * Osmosis and Safrochain take `query=`.
 *
 * The address is interpolated into the query, which is safe only because
 * every caller passes a bech32 string validated against the chain's prefix
 * (lib/server/validate.ts `parseAddress`): no quote can reach the node.
 */

import "server-only";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { searchUrl, type SearchParams, type SearchStyle } from "@/lib/activity/tx-search";

export { SEARCH_PAGE_SIZE, type SearchCondition, type SearchParams } from "@/lib/activity/tx-search";

const SEARCH_TIMEOUT_MS = 8_000;
const STYLE_TTL_MS = 6 * 60 * 60_000;
const STYLES_KEY = "__zuniaActivitySearchStyles";

function styles(): Map<string, { style: SearchStyle; until: number }> {
  const g = globalThis as unknown as Record<string, Map<string, { style: SearchStyle; until: number }> | undefined>;
  let map = g[STYLES_KEY];
  if (!map) {
    map = new Map();
    g[STYLES_KEY] = map;
  }
  return map;
}

export interface RawSearchPage {
  txs: Record<string, unknown>[];
  /** Matching transactions in the node's index within the bounds, when it said. */
  total: number | null;
}

interface SearchBody {
  tx_responses?: unknown;
  total?: unknown;
  pagination?: { total?: unknown } | null;
}

function parse(body: SearchBody): RawSearchPage {
  const txs = (Array.isArray(body.tx_responses) ? body.tx_responses : []).filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null && !Array.isArray(row),
  );
  const rawTotal = body.total ?? body.pagination?.total;
  const total =
    typeof rawTotal === "string" && /^\d{1,15}$/.test(rawTotal)
      ? Number(rawTotal)
      : typeof rawTotal === "number" && Number.isSafeInteger(rawTotal) && rawTotal >= 0
        ? rawTotal
        : null;
  return { txs, total };
}

/** One page, newest first. Throws `UpstreamError` when the node cannot answer. */
export async function searchPage(chainId: string, params: SearchParams): Promise<RawSearchPage> {
  const rest = restOf(chainId);
  if (!rest) throw new UpstreamError("network", chainId);
  const memo = styles().get(chainId);
  const preferred: SearchStyle = memo && memo.until > Date.now() ? memo.style : "query";
  const order: SearchStyle[] = preferred === "query" ? ["query", "events"] : ["events", "query"];
  let lastError: unknown = null;
  for (const style of order) {
    try {
      const body = await fetchJson<SearchBody>(searchUrl(rest, params, style), { timeoutMs: SEARCH_TIMEOUT_MS, retries: 1 });
      styles().set(chainId, { style, until: Date.now() + STYLE_TTL_MS });
      return parse(body);
    } catch (error) {
      lastError = error;
      // Only a 400 says "wrong spelling"; anything else is the node's state.
      if (!(error instanceof UpstreamError && error.kind === "http" && error.status === 400)) throw error;
    }
  }
  throw lastError;
}
