/**
 * Real 404s for detail URLs that cannot name anything.
 *
 * Every page under `(app)` streams: the frame's loading boundary commits a 200
 * before the page runs, so a `notFound()` inside it can only swap in the
 * not-found UI under a `noindex` — a "soft 404" that monitoring, link checkers
 * and crawlers read as a page. That is fine (and unavoidable) for a URL that
 * needs a chain read to judge, but most bad URLs are bad by their shape alone:
 * an unknown chain id, a proposal id that is not a number, a validator address
 * that decodes to no operator, an asset key no bundled table names. Those are
 * answered here, before rendering, by rewriting to a path that does not exist,
 * which Next answers with its not-found page and a 404 status.
 *
 * Each check is *exactly* the page's own synchronous rejection, run on the
 * value Next hands the page (the path segment decoded once), because a check
 * stricter than the page's turns a working public page into a 404:
 *
 * - `/chains/<id>`: `chainFrom()` in `(app)/chains/[chainId]/page.tsx` (decodes
 *   once more, then the client catalog, either spelling).
 * - `/governance/<chain>/<id>`: `resolve()` in the proposal page (both decoded
 *   once more, the id trimmed) and the first line of its `load.ts` (a server
 *   catalog chain and a 1–20 digit id).
 * - `/validators/<address>`: `locateOperator()`, the synchronous half of the
 *   validator page's lookup, with the page's `?chain=` / `?chainId=` choice.
 * - `/assets/<key>`: `decodeKey()` in the asset page, then `parseAssetKey()`,
 *   which is the only way its `resolveAssetKey()` returns null.
 *
 * What stays a soft 404 (200 + `noindex`, which Next documents as expected):
 * a well-formed proposal id the chain does not have, and a well-formed
 * operator address with no validator behind it. Both need an LCD read.
 *
 * Not matched, on purpose: `/activity/<hash>` (the transaction page never
 * 404s: a hash not found yet is a normal state right after a broadcast) and
 * anything not listed in `config.matcher`. A segment Next cannot decode is
 * left to Next, which answers 400 itself. Runs on the Node runtime (the
 * default for `proxy.ts`); the catalogs it reads are bundled data.
 */

import { NextResponse, type NextRequest } from "next/server";

import { findChain } from "@/lib/chains";
import { locateOperator } from "@/lib/server/chain/request";
import { findServerChain } from "@/lib/server/chains";
// Installs the bundled catalog `parseAssetKey` checks chain ids against.
import "@/lib/token/catalog-data";
import { parseAssetKey } from "@/lib/token/asset-key";

export const config = {
  matcher: ["/chains/:chainId", "/governance/:chainId/:id", "/validators/:address", "/assets/:key"],
};

/** `decodeURIComponent`, or the input when it is not decodable (the pages' tolerant decode). */
function lenient(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** `decodeURIComponent`, or `null` when it throws (the pages' strict decode). */
function strict(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** A query value the page would read as a string: exactly one occurrence. */
function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? (values[0] ?? null) : null;
}

/** Whether the page for these segments can name something, by its own synchronous rule. */
function nameable(section: string, first: string, second: string, query: URLSearchParams): boolean {
  switch (section) {
    case "chains":
      return Boolean(findChain(lenient(first)) ?? findChain(first));
    case "governance": {
      const chainId = strict(first);
      const id = strict(second)?.trim();
      return Boolean(chainId && id && findServerChain(chainId) && /^\d{1,20}$/.test(id));
    }
    case "validators":
      return locateOperator(first, single(query, "chain") ?? single(query, "chainId")) !== null;
    case "assets": {
      const key = first.includes("%") ? lenient(first).trim() : first.trim();
      return parseAssetKey(key) !== null;
    }
    default:
      return true;
  }
}

export function proxy(req: NextRequest) {
  // Split before decoding, so an encoded `/` (`%2F`) stays inside its segment
  // the way it does in the page's params.
  const raw = req.nextUrl.pathname.split("/");
  if (raw.some((segment) => strict(segment) === null)) return NextResponse.next();
  const [, section = "", first = "", second = ""] = raw.map((segment) => strict(segment) ?? segment);
  if (nameable(section, first, second, req.nextUrl.searchParams)) return NextResponse.next();
  return NextResponse.rewrite(new URL("/__not-found", req.url));
}
