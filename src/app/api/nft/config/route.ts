/**
 * Can this deployment show NFTs on this chain, and what is set up for it?
 *
 * The NFT page asks this first and disables everything with `reason` until the
 * answer is `supported`. That ordering is the same one `/api/interchain/config`
 * enforces for swap, and for the same reason: discovering at transfer time that
 * no ICS721 bridge was configured is the worst possible moment.
 *
 * Three statuses, three different screens:
 *
 * - `supported`   — the registry declares `cosmwasm` (or the operator's
 *                   override let us ask the chain and it answered).
 * - `unsupported` — the registry has a feature list and `cosmwasm` is not in
 *                   it. There are no CW721 contracts here to hold anything.
 * - `unverified`  — nobody has said either way: the chain's registry entry
 *                   lists no features (a few catalog chains), or the chain is
 *                   not in the catalog.
 *
 * Everything in the answer is for the page, which draws the person holding the
 * wallet, so none of it names a setting. The env keys behind each half
 * (`lib/server/nft-config.ts`) are operator documentation; the operator's
 * other channel is the server log, where a malformed entry is reported (once)
 * instead of being drawn on every visitor's screen. The ICS721 half is facts
 * only (bridge, destinations): the transfer sheet words "why not" itself.
 */

import { NextRequest } from "next/server";
import type { ConfigProblem } from "@/lib/nft/parse-config";
import { findServerChain as findChain } from "@/lib/server/chains";
import { ics721DestinationsFrom, nftConfig } from "@/lib/server/nft-config";
import { nftChainSupport } from "@/lib/server/nft";

export const runtime = "nodejs";

/** Problem sets already logged by this process (on `globalThis`, so dev HMR does not repeat them). */
const WARNED_KEY = "__zuniaNftConfigWarned";

/**
 * Logs malformed NFT settings for the operator, once per distinct set: this
 * route runs on every NFT page view, and a log line per visit would bury the
 * one that matters. Entries arrive already redacted by the parser (no query
 * strings, no credentials).
 */
function warnProblemsOnce(problems: readonly ConfigProblem[]): void {
  if (problems.length === 0) return;
  const text = problems.map((problem) => `${problem.key}: ${problem.reason} (${problem.entry})`).join("; ");
  const g = globalThis as unknown as Record<string, Set<string> | undefined>;
  const warned = (g[WARNED_KEY] ??= new Set<string>());
  if (warned.has(text)) return;
  warned.add(text);
  console.warn(`[nft] ignored ${problems.length} malformed NFT setting ${problems.length === 1 ? "entry" : "entries"}: ${text}`);
}

export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get("chainId")?.trim() ?? "";
  if (!chainId) {
    return Response.json(
      { ok: false, code: "bad-request", message: "A chain id is required." },
      { status: 400 },
    );
  }

  const config = nftConfig();
  warnProblemsOnce(config.problems);
  const support = await nftChainSupport(chainId, { config });
  const bridgeContract = config.bridges[chainId] ?? null;
  const destinations = ics721DestinationsFrom(config, chainId).map((link) => ({
    chainId: link.destChainId,
    chainName: findChain(link.destChainId)?.chainName ?? link.destChainId,
    channelId: link.channelId,
    /** A destination whose chain the catalog does not carry cannot be addressed. */
    inCatalog: Boolean(findChain(link.destChainId)),
  }));

  const knownContracts = config.knownContracts[chainId] ?? [];

  return Response.json({
    ok: true,
    config: {
      chainId,
      chainName: support.chainName,
      status: support.status,
      basis: support.basis,
      reason: support.reason,
      note: support.note,
      featuresDeclared: support.featuresDeclared,
      allowUnknownFeatures: support.allowUnknownFeatures,
      discovery: {
        knownContractCount: knownContracts.length,
        indexerConfigured: config.indexerUrl !== null,
        indexerName: config.indexerUrl !== null ? config.indexerName : null,
      },
      media: {
        ipfsGatewayCount: config.ipfsGateways.length,
        arweaveGatewayCount: config.arweaveGateways.length,
      },
      // Templates rather than URLs: the substitution happens in the browser, so
      // a token id is encoded into the path at render time. Null for a chain
      // with no template, and the detail view then shows the contract and id as
      // plain text — an invented explorer domain is a fabrication.
      explorer: {
        nftTemplate: config.nftExplorer[chainId] ?? null,
        txTemplate: config.txExplorer[chainId] ?? null,
      },
      // A bridge with no channel and a channel with no bridge are both
      // unbuildable; the sheet tells them apart from these two facts.
      ics721: {
        bridgeContract,
        destinations,
      },
    },
  });
}
