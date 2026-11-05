/**
 * GET /api/interchain/channels?from=<chainId>&to=<chainId>
 *
 * Are the transfer channels from one network to another open and verified,
 * read from both chains? Asked as soon as a Send or Bridge page knows its two
 * networks, before any amount, so the route never opens as "not verified"
 * while the check simply has not run yet. The answer depends only on the pair
 * and is shared with the route planner: both go through `discoverLinks`,
 * which caches each pair for 10 minutes.
 *
 * Answers `{ ok, links, pending, failures }`. `pending` means the pair's first
 * check is still reading a chain's channel list (it can take a minute or two)
 * and the page should ask again shortly; `failures` are sentences for the user.
 */

import { NextRequest } from "next/server";

import { findServerChain as findChain } from "@/lib/server/chains";
import { discoverLinks } from "@/lib/server/interchain";
import { foreignOrigin, overLimit } from "@/lib/server/interchain-request";

export const runtime = "nodejs";

const CHAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function bad(message: string): Response {
  return Response.json({ ok: false, code: "bad-request", message }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const foreign = foreignOrigin(req);
  if (foreign) return foreign;
  const limited = overLimit(
    req,
    { scope: "interchain-channels", capacity: 40, refillPerSecond: 1 },
    "Too many channel checks. Wait a moment and try again.",
  );
  if (limited) return limited;

  const from = req.nextUrl.searchParams.get("from")?.trim() ?? "";
  const to = req.nextUrl.searchParams.get("to")?.trim() ?? "";
  if (!CHAIN_ID.test(from) || !CHAIN_ID.test(to)) return bad("Both chain ids are required.");
  if (from === to) return bad("The two networks must differ.");
  if (!findChain(from)) return bad(`${from} is not in this build's chain catalog.`);
  if (!findChain(to)) return bad(`${to} is not in this build's chain catalog.`);

  const discovery = await discoverLinks([[from, to]], { signal: req.signal });
  const links = discovery.links
    .filter((link) => link.sourceChainId === from && link.destChainId === to)
    .map((link) => ({
      sourceChainId: link.sourceChainId,
      destChainId: link.destChainId,
      channelId: link.channelId,
      port: link.port ?? "transfer",
      ...(link.counterpartyChannelId ? { counterpartyChannelId: link.counterpartyChannelId } : {}),
      ...(link.counterpartyPortId ? { counterpartyPortId: link.counterpartyPortId } : {}),
      source: link.source ?? "seed",
      state: link.state ?? "unknown",
    }));
  return Response.json(
    {
      ok: true,
      links,
      pending: discovery.failures.some((failure) => failure.pending === true),
      failures: discovery.failures.map((failure) => failure.message),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
