/**
 * GET /governance/<id>?chain=<chainId> — the old proposal URL.
 *
 * Proposal ids are per chain, so the proposal page now lives at
 * /governance/<chainId>/<id>. Links in the wild (notifications, shared
 * links) still carry the old form: with `?chain=` (or `?chainId=`) naming a
 * known chain they get a real 308 to the new page, permanent like every
 * other moved URL (next.config.ts), so search engines and link checkers move
 * the old address over for good; anything else is a real 404. A route
 * handler rather than a page: it answers before anything renders, with no
 * app frame and no metadata to build for a URL that is only ever a redirect.
 *
 * The segment is named `[chainId]` only because sibling dynamic segments must
 * share one name with the detail route below it; here it holds the old id.
 */

import { notFound, permanentRedirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { findChain } from "@/lib/chains";

export async function GET(req: NextRequest, ctx: { params: Promise<{ chainId: string }> }) {
  const { chainId: segment } = await ctx.params;
  let id: string;
  try {
    id = decodeURIComponent(segment).trim();
  } catch {
    notFound();
  }
  const query = req.nextUrl.searchParams;
  const chain = (query.get("chain") ?? query.get("chainId") ?? "").trim();
  if (!/^\d{1,20}$/.test(id) || !chain || !findChain(chain)) notFound();
  permanentRedirect(`/governance/${encodeURIComponent(chain)}/${id}`);
}
