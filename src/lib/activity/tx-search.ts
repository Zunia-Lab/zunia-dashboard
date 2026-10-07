/**
 * The rules of a public LCD transaction search, without the I/O: how a
 * request is spelled, how the next page is chosen and when a search is over.
 * The server (`lib/server/activity/search.ts`) does the reading.
 *
 * Spelling. `GET /cosmos/tx/v1beta1/txs` takes its condition as `query=`
 * (Cosmos SDK ≥ 0.50, one CometBFT query string) or `events=` (older SDKs,
 * one parameter per clause, joined with AND by the node). `order_by=2` is
 * `ORDER_BY_DESC` by number: every gateway accepts the number, while some
 * SDK 0.47 builds (Lava's) refuse the enum name with a 400
 * (`strconv.ParseInt: parsing "ORDER_BY_DESC"`). Paging uses `limit` and
 * `page`, never `pagination.limit`, which SDK ≥ 0.46 ignores (it then returns
 * 100 full transactions per call). Height bounds are plain clauses with
 * exactly one `=` each, which is what SDK 0.47's event validator demands.
 *
 * Paging. Within one search, every read after the first is keyed by height,
 * not by offset: the next read is `tx.height<=<lowest height seen>` from
 * page 1, so rows that landed meanwhile, a page cached a minute earlier than
 * the next one, or two load-balanced nodes indexing a few blocks apart can
 * never open a gap (they can only repeat rows, which the merge drops by hash).
 * Offsets are used only inside one fixed height, when a single block holds a
 * full page of the account's transactions.
 *
 * The address is interpolated into the query, which is safe only because
 * every caller passes a bech32 string validated against the chain's prefix:
 * no quote can reach the node.
 */

export type SearchCondition = "sender" | "recipient";
export type SearchStyle = "query" | "events";

/** Transactions per page. 50 full transactions is ~0.3–1.5 MB of JSON on busy chains. */
export const SEARCH_PAGE_SIZE = 50;

export interface SearchRead {
  /** `tx.height<=upper`; null reads from the tip. */
  upper: number | null;
  /** 1-based offset page within `upper`. */
  page: number;
}

export interface SearchParams extends SearchRead {
  /** Validated bech32 for the chain. */
  address: string;
  condition: SearchCondition;
  /** `tx.height>=lower`; null reads to the node's oldest. */
  lower: number | null;
}

export function searchClauses(params: SearchParams): string[] {
  const out = [
    params.condition === "sender" ? `message.sender='${params.address}'` : `transfer.recipient='${params.address}'`,
  ];
  if (params.upper !== null) out.push(`tx.height<=${params.upper}`);
  if (params.lower !== null) out.push(`tx.height>=${params.lower}`);
  return out;
}

/** The search URL under `rest` (the catalog's LCD base, no trailing slash). */
export function searchUrl(rest: string, params: SearchParams, style: SearchStyle): string {
  const clauses = searchClauses(params);
  const condition =
    style === "query"
      ? `query=${encodeURIComponent(clauses.join(" AND "))}`
      : clauses.map((clause) => `events=${encodeURIComponent(clause)}`).join("&");
  return `${rest}/cosmos/tx/v1beta1/txs?${condition}&order_by=2&limit=${SEARCH_PAGE_SIZE}&page=${params.page}`;
}

/**
 * The read after one that returned rows down to `lowestHeight`: keyset from
 * that height, or the next offset page when every row sat at the bound
 * already (a block holding a full page of the account's transactions).
 */
export function nextRead(read: SearchRead, lowestHeight: number): SearchRead {
  if (read.upper !== null && lowestHeight >= read.upper) return { upper: read.upper, page: read.page + 1 };
  return { upper: lowestHeight, page: 1 };
}

/**
 * Whether a read was the search's last. `total` is the node's count of
 * matching transactions within the bounds, when it said; it is trusted only
 * when it is consistent with what came back (some nodes answer `"0"` beside a
 * full page).
 */
export function readExhausted(count: number, total: number | null, page: number): boolean {
  if (count === 0) return true;
  if (total !== null && total >= count) return (page - 1) * SEARCH_PAGE_SIZE + count >= total;
  return count < SEARCH_PAGE_SIZE;
}
