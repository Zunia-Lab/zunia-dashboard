/**
 * One or more tokens from one CW721 contract, read from the chain.
 *
 * Used twice: the grid asks for the first page of ids it is about to render, so
 * cards can carry a real name instead of `#42`; the detail view asks for one id
 * and gets the owner, the description and the traits from the same call.
 *
 * `media=1` is the only thing that makes this route contact anything other than
 * the chain. Off, it reads `all_nft_info` and stops, so a token whose metadata
 * lives on a stranger's server still renders with whatever the contract stores
 * on chain and a placeholder. On, the metadata document is fetched **here**,
 * server-side — so the host learns this deployment's address and not the
 * visitor's. The artwork itself is still fetched by the browser from the URL
 * this route resolves, which does expose the visitor; the page says so where
 * the switch is.
 */

import { NextRequest } from "next/server";
import { findChain } from "@/lib/chains";
import { nftConfig } from "@/lib/server/nft-config";
import {
  LCD_CONCURRENCY,
  mapLimit,
  nftChainSupport,
  nftContext,
  readCollection,
  readToken,
  type TokenRow,
} from "@/lib/server/nft";

export const runtime = "nodejs";

/**
 * Token ids read per request.
 *
 * Each id is one `all_nft_info` query against a public LCD. 24 fills the first
 * screen of a grid at any width this app supports; the grid asks for the next
 * page when the user scrolls to it rather than pulling a whole collection.
 */
const MAX_IDS = 24;
function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw.split(",")) {
    const value = entry.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const chainId = params.get("chainId")?.trim() ?? "";
  const contract = params.get("contract")?.trim() ?? "";
  const ids = parseIds(params.get("ids"));
  const media = params.get("media") === "1";
  const wantCollection = params.get("collection") === "1";

  if (!chainId || !contract || ids.length === 0) {
    return Response.json(
      {
        ok: false,
        code: "bad-request",
        message: "A chain id, a contract address and at least one token id are required.",
      },
      { status: 400 },
    );
  }

  const config = nftConfig();
  const support = await nftChainSupport(chainId, { config, signal: req.signal });
  if (support.status !== "supported") {
    return Response.json({
      ok: false,
      code: support.status === "unsupported" ? "unsupported-chain" : "not-configured",
      message: support.reason ?? "NFTs are not available on this chain.",
    });
  }

  const chain = findChain(chainId);
  const ctx = chain ? nftContext(chain) : null;
  if (!chain || !ctx) {
    return Response.json({
      ok: false,
      code: "unsupported-chain",
      message: `${support.chainName} has no REST endpoint in this build's catalog, so its contracts cannot be queried.`,
    });
  }

  const [tokens, collection] = await Promise.all([
    mapLimit(ids, LCD_CONCURRENCY, (tokenId): Promise<TokenRow> =>
      readToken({
        ctx,
        support,
        contractAddress: contract,
        tokenId,
        media,
        config,
        signal: req.signal,
      }),
    ),
    wantCollection
      ? readCollection({ ctx, support, contractAddress: contract, signal: req.signal })
      : Promise.resolve(null),
  ]);

  return Response.json({
    ok: true,
    chainId,
    chainName: support.chainName,
    contractAddress: contract,
    // Echoed back so the browser can tell "media was off" from "media was on
    // and the host did not answer". They look identical on a card otherwise.
    mediaRequested: media,
    ipfsGatewayConfigured: config.ipfsGateways.length > 0,
    tokens,
    collection,
  });
}
