import { RouteLoading } from "@/components/shell/RouteLoading";

/**
 * Shown inside the app frame while a wallet page loads (see RouteLoading).
 *
 * Why it lives in the `(wallet)` group and not on the whole `(app)` frame: a
 * loading boundary makes the response stream, and a streamed response has
 * committed its 200 before the page runs. Under it, a `notFound()` can only
 * swap in the not-found UI with a `noindex` (a "soft 404" to crawlers, link
 * checkers and monitoring). So the public pages (markets, chains, validators,
 * governance, assets, compare, …) sit outside this group: their detail pages
 * decide a 404 on the server (a proposal the chain does not have, an operator
 * address with no validator), and without a boundary above them they render
 * before the first byte, so the 404 is a real status. The wallet pages never
 * 404 (a transaction hash not found yet is a normal state right after a
 * broadcast), so they keep the instant skeleton.
 */
export default function Loading() {
  return <RouteLoading />;
}
