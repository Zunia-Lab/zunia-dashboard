/**
 * The chains whose detail and validator pages ask to be indexed: the home
 * chain first, then established mainnets with live public data.
 *
 * One list, read by both sides of the same decision, so they cannot drift:
 *
 * - `src/app/sitemap.ts` advertises `/chains/<id>` and `/validators?chain=<id>`
 *   for exactly these;
 * - `src/components/chains/seo.ts` (`INDEXED_CHAINS`) marks exactly these chain
 *   pages `index` and every other one `noindex, follow`.
 *
 * A chain listed in the sitemap but `noindex` on its page (or the reverse)
 * tells crawlers two different things and wastes crawl budget either way.
 *
 * Deliberately short: the catalog's 222 mainnets include many with dead
 * endpoints, and a sitemap full of empty pages costs the whole site crawl
 * budget. Wound-down chains (Neutron, Stride, Noble) are not listed. Every id
 * must be a mainnet in the catalog; `src/app/__tests__/metadata-routes.test.ts`
 * checks that, so a catalog change fails CI instead of advertising a 404.
 *
 * No `server-only` import on purpose: this is a constant, and the chain pages'
 * metadata helper may be reached from a client module too.
 */
export const INDEXED_CHAIN_IDS = [
  "safrochain-1",
  "cosmoshub-4",
  "osmosis-1",
  "celestia",
  "akashnet-2",
  "injective-1",
  "dydx-mainnet-1",
  "juno-1",
  "kava_2222-10",
  "archway-1",
] as const;
