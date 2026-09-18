/**
 * Which CW721 collections does this address hold something in?
 *
 * CosmWasm has no chain-wide "tokens by owner" index. `tokens` is a per-
 * contract query, so a wallet can only ask about contracts it already knows
 * the address of. All three ways of getting such an address are wired up and
 * all three are reported:
 *
 * - `known`   — a list this deployment ships (`ZUNIA_NFT_CONTRACTS`)
 * - `indexer` — a real index, where one exists (`ZUNIA_NFT_INDEXER_URL`)
 * - `user`    — an address the person pasted in
 *
 * The response therefore carries `queriedContractCount` alongside the holdings.
 * A zero there means nothing was asked, which is a completely different answer
 * from "asked and found nothing" — the mobile app rendered the first as the
 * second and it was a top-20 defect. The browser is given both numbers and is
 * expected to say which one it is looking at.
 */

import { NextRequest } from "next/server";
import { findChain } from "@/lib/chains";
import { nftConfig } from "@/lib/server/nft-config";
import {
  describeNftError,
  LCD_CONCURRENCY,
  mapLimit,
  nftChainSupport,
  nftContext,
  readCollection,
  runNftDiscovery,
} from "@/lib/server/nft";

export const runtime = "nodejs";

/** Contracts a caller may add per request. A URL is not an unbounded work queue. */
const MAX_USER_CONTRACTS = 12;

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw.split(",")) {
    const value = entry.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_USER_CONTRACTS) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const chainId = params.get("chainId")?.trim() ?? "";
  const address = params.get("address")?.trim() ?? "";
  const userContracts = parseCsv(params.get("contracts"));

  if (!chainId || !address) {
    return Response.json(
      {
        ok: false,
        code: "bad-request",
        message: "A chain id and an owner address are required.",
      },
      { status: 400 },
    );
  }

  const config = nftConfig();
  const support = await nftChainSupport(chainId, {
    config,
    signal: req.signal,
  });

  // The gate answers first. Running a discovery pass against a chain that does
  // not run x/wasm produces a list of HTTP errors and an empty grid; saying so
  // up front produces a sentence.
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

  let outcome;
  try {
    outcome = await runNftDiscovery({
      ctx,
      support,
      owner: address,
      userContracts,
      config,
      signal: req.signal,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      code: "server-error",
      message: describeNftError(
        error,
        `Could not look for NFTs on ${support.chainName}.`,
      ),
    });
  }

  const { plan, result } = outcome;

  // Only collections with a holding are named. `getCollectionInfo` costs up to
  // three queries per contract (two spellings plus num_tokens), and naming a
  // contract that returned nothing would spend them for a row nobody sees.
  // Bounded rather than a `Promise.all`: twenty-five holdings would otherwise
  // put seventy-five wasm queries on a public endpoint in one breath.
  const collections = await mapLimit(
    result.holdings,
    LCD_CONCURRENCY,
    (holding) =>
      readCollection({
        ctx,
        support,
        contractAddress: holding.contractAddress,
        signal: req.signal,
      }),
  );
  const byAddress = new Map(collections.map((row) => [row.contractAddress, row]));

  // What was actually asked: the deduplicated union of every path's addresses,
  // capped the same way the engine caps it. This is the number that separates
  // "found nothing" from "looked at nothing".
  const queried = new Set<string>([
    ...plan.knownContracts,
    ...plan.userContracts,
  ]);
  for (const holding of result.holdings) queried.add(holding.contractAddress);
  for (const issue of result.issues) {
    if (issue.contractAddress) queried.add(issue.contractAddress);
  }

  return Response.json({
    ok: true,
    chainId,
    chainName: support.chainName,
    owner: address,
    holdings: result.holdings.map((holding) => ({
      contractAddress: holding.contractAddress,
      source: holding.source,
      tokenIds: holding.tokenIds,
      truncated: holding.truncated,
      collection: byAddress.get(holding.contractAddress) ?? null,
    })),
    sources: result.sources,
    complete: result.complete,
    limitation: result.limitation,
    issues: result.issues,
    plan: {
      knownContractCount: plan.knownContracts.length,
      userContracts: plan.userContracts,
      indexerName: plan.indexerName,
      indexerConfigKey: plan.indexerConfigKey,
    },
    queriedContractCount: queried.size,
  });
}
