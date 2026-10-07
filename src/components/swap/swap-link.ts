/**
 * The `/swap` link: `?from=<chainId>:<denom>&to=<chainId>:<denom>&amount=`.
 *
 * Its own module so the server page can read a link without loading the swap
 * engine. Pure.
 */

/** A row key as the engine spells it (`${chainId}:${denom}`); denoms may hold `/`, `:`, `.`, `_`, `-`. */
const ROW_KEY = /^[^:\s/]{1,64}:[A-Za-z0-9/:._-]{1,256}$/;
/** Display units, `.` or `,` as the separator. */
const LINK_AMOUNT = /^\d{1,30}(?:[.,]\d{0,30})?$/;

export interface SwapLink {
  /** A row key (`chainId:denom` of a holding) or an asset key (`TokenIdentity.key`). */
  readonly from: string | null;
  readonly to: string | null;
  /** Display units, `.` as the separator. */
  readonly amount: string | null;
}

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * What a `/swap` link asks for. Anything that is not a well-formed key or
 * amount is dropped (never half-applied): the page then opens on its own
 * defaults for that field.
 */
export function readSwapLink(params: SearchParams): SwapLink {
  const from = firstParam(params.from);
  const to = firstParam(params.to);
  const amount = firstParam(params.amount);
  return {
    from: ROW_KEY.test(from) ? from : null,
    to: ROW_KEY.test(to) ? to : null,
    amount: LINK_AMOUNT.test(amount) && /[1-9]/.test(amount) ? amount.replace(",", ".") : null,
  };
}

/** One string per link, for keying the page (a new link is a new form). */
export function swapLinkKey(link: SwapLink): string {
  return `${link.from ?? ""}|${link.to ?? ""}|${link.amount ?? ""}`;
}

/** The address bar for a pair (no amount: a shared or bookmarked link should not carry one). */
export function swapHref(fromKey: string | null, toKey: string | null): string {
  const query = new URLSearchParams();
  if (fromKey) query.set("from", fromKey);
  if (toKey) query.set("to", toKey);
  const text = query.toString();
  return text ? `/swap?${text}` : "/swap";
}
