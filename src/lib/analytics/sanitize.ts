/**
 * What Google Analytics is allowed to be told about a page view.
 *
 * The dashboard's URLs and titles can carry a wallet address, a transaction
 * hash or an asset key. None of that may leave the device, so nothing is sent
 * as-is: the location is rebuilt from a path that has been through here.
 * Pure functions, no DOM, so `node --test` covers them.
 */

/** bech32 (`cosmos1…`, `osmovaloper1…`): human part, separator `1`, data part. */
const BECH32 = /\b[a-z][a-z0-9]{0,19}1[02-9ac-hj-np-z]{38,90}\b/gi;
/** 32-byte hashes (tx hashes, EVM block/tx ids), with or without `0x`. */
const HASH = /\b(?:0x)?[0-9a-f]{64}\b/gi;
/** 20-byte EVM addresses (NFT contracts). */
const EVM_ADDRESS = /\b0x[0-9a-f]{40}\b/gi;

/**
 * Routes whose segments identify a holding, an account or a transaction, as
 * the route pattern to report instead. A match is by leading static segment
 * and segment count, so a new `/assets/anything` is covered without an entry.
 */
const DYNAMIC_ROUTES: ReadonlyArray<{ first: string; segments: number; pattern: string }> = [
  { first: "assets", segments: 2, pattern: "/assets/[key]" },
  { first: "validators", segments: 2, pattern: "/validators/[address]" },
  { first: "activity", segments: 2, pattern: "/activity/[hash]" },
  { first: "nfts", segments: 4, pattern: "/nfts/[chainId]/[contract]/[tokenId]" },
];

/** Scrubs free text (a title, a path segment) of addresses and hashes. */
export function scrubText(text: string): string {
  return text.replace(HASH, ":hash").replace(EVM_ADDRESS, ":address").replace(BECH32, ":address");
}

/** The route pattern for `path` when it is one of the identifying routes. */
export function routePattern(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  const hit = DYNAMIC_ROUTES.find((route) => route.first === parts[0] && route.segments === parts.length);
  return hit ? hit.pattern : null;
}

/** Pathname only: no query, no hash, no addresses, no identifying segments. */
export function sanitizePath(input: string): string {
  const raw = input.split("#")[0]!.split("?")[0]! || "/";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const pattern = routePattern(path);
  if (pattern) return pattern;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* keep it raw: the scrub below still runs */
  }
  return scrubText(decoded);
}

export interface PageView {
  page_location: string;
  page_path: string;
  page_title: string;
}

const TITLE_MAX = 120;

/**
 * The three fields a page_view carries. Titles of identifying routes are the
 * route pattern, because a title is built from the address or asset shown.
 */
export function sanitizePageView(origin: string, pathname: string, title: string): PageView {
  const page_path = sanitizePath(pathname);
  const patterned = routePattern(pathname.split("#")[0]!.split("?")[0]!) !== null;
  return {
    page_location: `${origin}${page_path}`,
    page_path,
    page_title: patterned ? page_path : scrubText(title).slice(0, TITLE_MAX),
  };
}
