import { NextRequest } from "next/server";
import { bech32 } from "bech32";
import { proxyIndexer } from "@/lib/api-proxy";
import { findChain, findChainsByPrefix, type ChainEntry } from "@/lib/chains";
import { reencodeAddress } from "@/lib/address";

/** One page of the rail is 12 chains; more than that is not a read, it is a fan-out. */
const MAX_CHAINS = 12;

type HistoryRow = {
  txHash?: string;
  hash?: string;
  summary?: string;
  timestamp?: string;
  success?: boolean;
  kind?: string;
};

type ActivityItem = {
  hash: string;
  summary: string;
  time: string;
  success: boolean;
  kind?: string;
  chainId?: string;
};

type ChainResult =
  | { chainId: string; items: ActivityItem[] }
  | { chainId: string; failed: true };

function normalize(raw: HistoryRow[]): ActivityItem[] {
  return raw.map((t) => ({
    hash: t.txHash ?? t.hash ?? "unknown",
    summary: t.summary ?? "Transaction",
    time: t.timestamp ?? "",
    success: t.success !== false,
    kind: t.kind,
  }));
}

/**
 * bech32 decode is the validation, not a regex: it enforces the charset, the
 * length and the checksum, so a value carrying a quote or a Tendermint query
 * operator cannot reach the indexer, which interpolates the address into
 * `transfer.recipient='…'` unescaped.
 */
function decodePrefix(address: string): string | null {
  try {
    return bech32.decode(address).prefix;
  } catch {
    return null;
  }
}

async function historyForChain(
  chainId: string,
  address: string,
): Promise<ChainResult> {
  const upstream = await proxyIndexer("/v1/wallets/history", {
    method: "POST",
    // This route is unauthenticated, so it must never enter a wallet into the
    // realtime registry: each entry costs the indexer two persistent CometBFT
    // websockets plus recurring LCD polls, charged to the dashboard's own API
    // key. The indexer must honour both markers and serve history read-only;
    // registration belongs on an authenticated /v1/wallets/subscribe.
    headers: { "x-zunia-read-only": "1" },
    body: JSON.stringify({ chainId, address, subscribe: false }),
  });
  if (!upstream.ok) return { chainId, failed: true };

  const body = (await upstream.json().catch(() => null)) as {
    items?: HistoryRow[];
    txs?: HistoryRow[];
  } | null;
  if (!body) return { chainId, failed: true };

  return { chainId, items: normalize(body.items ?? body.txs ?? []) };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const address = params.get("address");

  // The scope is which chains to read. It is NOT a claim about which chain the
  // address came from: the left rail scopes /activity to one chain while the
  // wallet stays connected elsewhere. Deriving the origin from `chainId` made
  // every rail selection answer 400 address_prefix_does_not_match_chain, which
  // the UI then rendered as "Indexer unreachable" — a false cause.
  const scopeParam = params.get("chains") ?? params.get("chainId") ?? "";
  const scope = scopeParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!address) {
    return Response.json({ error: "address_required" }, { status: 400 });
  }
  const prefix = decodePrefix(address);
  if (!prefix) {
    return Response.json({ error: "invalid_bech32_address" }, { status: 400 });
  }

  // The origin chain comes from the address itself. `sourceChainId` only picks
  // between catalog entries that share the prefix (mainnet vs its testnet).
  const sourceHint = params.get("sourceChainId") ?? params.get("chainId");
  const source = findChainsByPrefix(prefix, sourceHint)[0];
  if (!source) {
    return Response.json(
      { error: "unknown_address_prefix", prefix },
      { status: 400 },
    );
  }

  // The indexer keys history on (chainId, address), so the same bech32 string
  // sent to twelve chains reads nothing and registers eleven wallets that do
  // not exist. Re-derive the account's address per chain instead, and drop the
  // chains whose coin type makes that impossible.
  const seenChain = new Set<string>();
  const targets: Array<{ chain: ChainEntry; address: string }> = [];
  const skipped: string[] = [];
  // Chains past MAX_CHAINS. Naming them keeps `chains` from asserting a full
  // picture over a silently truncated read.
  const truncated: string[] = [];
  for (const id of scope.length > 0 ? scope : [source.chainId]) {
    if (seenChain.has(id)) continue;
    seenChain.add(id);
    const chain = findChain(id);
    if (!chain) {
      skipped.push(id);
      continue;
    }
    const derived =
      chain.chainId === source.chainId
        ? address
        : reencodeAddress(address, chain, source);
    if (!derived) {
      skipped.push(id);
      continue;
    }
    if (targets.length >= MAX_CHAINS) {
      truncated.push(id);
      continue;
    }
    targets.push({ chain, address: derived });
  }

  if (targets.length === 0) {
    return Response.json(
      {
        error: "no_readable_chains",
        address,
        sourceChainId: source.chainId,
        skipped,
        truncated,
      },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    targets.map((target) => historyForChain(target.chain.chainId, target.address)),
  );

  const failedChains = results
    .filter((result): result is { chainId: string; failed: true } => "failed" in result)
    .map((result) => result.chainId);

  if (failedChains.length === targets.length) {
    return Response.json(
      {
        error: "indexer_unreachable",
        items: [],
        address,
        sourceChainId: source.chainId,
        chains: targets.map((target) => target.chain.chainId),
        failedChains,
      },
      { status: 502 },
    );
  }

  const seenHash = new Set<string>();
  const items = results
    .flatMap((result) =>
      "items" in result
        ? result.items.map((tx) => ({ ...tx, chainId: result.chainId }))
        : [],
    )
    .filter((tx) => {
      if (seenHash.has(tx.hash)) return false;
      seenHash.add(tx.hash);
      return true;
    });

  // An empty list from a reachable indexer is a real answer. Chains that did
  // not respond, could not be derived, or fell past the cap are named so the
  // caller can say so rather than call the result complete.
  return Response.json({
    items,
    address,
    sourceChainId: source.chainId,
    chains: targets.map((target) => target.chain.chainId),
    failedChains,
    skipped,
    truncated,
    source: "indexer",
  });
}
