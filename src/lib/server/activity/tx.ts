/**
 * One transaction, read from the chain's public node and decoded in full
 * (lib/activity/decode `parseTxDetail`).
 *
 * An included transaction never changes, so a found one is cached for ten
 * minutes, within a byte budget (lib/activity/budget): raw transactions run
 * from 3 KB to a megabyte (a contract upload), and the hashes a visitor can
 * ask for are unbounded. "Not found" is not cached as a value (the node may
 * index it a block later): it is a short-lived error, so a page polling for a
 * just-broadcast hash sees it as soon as the node does.
 */

import "server-only";
import { cached, invalidate } from "@/lib/server/cache";
import { fetchJson, UpstreamError } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import { identifyDenom, identifyDenoms } from "@/lib/token/identity";
import type { TokenIdentity } from "@/lib/token/types";
import { KeyBudget } from "@/lib/activity/budget";
import { denomsOf, parseTxDetail } from "@/lib/activity/decode";
import type { TxDetail } from "@/lib/activity/types";
import { canonicalPeer, resolvePeers } from "./channels";

const TX_TIMEOUT_MS = 8_000;
const IDENTITY_TIMEOUT_MS = 4_000;
const TX_BUDGET_BYTES = 16 * 1024 * 1024;
const TX_BUDGET_KEYS = 1_000;
const BUDGET_KEY = "__zuniaActivityTxBudget";

interface CachedTx {
  raw: unknown;
  bytes: number;
}

function txBudget(): KeyBudget {
  const g = globalThis as unknown as Record<string, KeyBudget | undefined>;
  let budget = g[BUDGET_KEY];
  if (!budget) {
    budget = new KeyBudget(TX_BUDGET_BYTES, TX_BUDGET_KEYS);
    g[BUDGET_KEY] = budget;
  }
  return budget;
}

class TxNotFound extends Error {
  constructor() {
    super("not_found");
    this.name = "TxNotFound";
  }
}

async function fetchTx(chainId: string, hash: string): Promise<CachedTx> {
  const rest = restOf(chainId);
  if (!rest) throw new UpstreamError("network", chainId);
  try {
    const raw = await fetchJson<unknown>(`${rest}/cosmos/tx/v1beta1/txs/${hash}`, { timeoutMs: TX_TIMEOUT_MS, retries: 1 });
    return { raw, bytes: JSON.stringify(raw)?.length ?? 0 };
  } catch (error) {
    // gRPC NotFound. Some nodes answer 400 for a well-formed hash they do not have.
    if (error instanceof UpstreamError && error.kind === "http" && (error.status === 404 || error.status === 400)) {
      throw new TxNotFound();
    }
    throw error;
  }
}

/**
 * The decoded transaction, or null when the node does not have it (not
 * indexed yet, pruned, or never existed). With `address`, `forAddress` is that
 * account's activity row. Throws `UpstreamError` when the node cannot answer.
 */
export async function readTxDetail(chainId: string, hash: string, address?: string): Promise<TxDetail | null> {
  const key = `activity:txv2:${chainId}:${hash}`;
  let raw: unknown;
  try {
    const entry = await cached(key, { ttlMs: 10 * 60_000, staleMs: 10 * 60_000, errorTtlMs: 4_000 }, () => fetchTx(chainId, hash));
    for (const evicted of txBudget().touch(key, entry.bytes)) invalidate(evicted);
    raw = entry.raw;
  } catch (error) {
    if (error instanceof TxNotFound) return null;
    throw error;
  }

  const denoms = denomsOf(raw, address);
  let known = new Map<string, TokenIdentity>();
  try {
    known = await identifyDenoms(chainId, denoms, { signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
  } catch {
    // Bundled tables only.
  }
  const identify = (denom: string) => known.get(denom) ?? identifyDenom(chainId, denom);

  // Channels the canonical table does not know are read from the chain first,
  // so packets and summaries name the far chain when it can be proven.
  const firstPass = parseTxDetail(raw, { chainId, identify, channelPeer: (channel) => canonicalPeer(chainId, channel) }, address ? { address } : {});
  if (!firstPass) return null;
  const unknownChannels = firstPass.packets
    .filter((packet) => !packet.counterpartyChainId)
    .map((packet) => ({ chainId, channel: packet.stage === "receive" ? packet.destChannel : packet.sourceChannel }));
  if (unknownChannels.length === 0) return firstPass;
  const peers = await resolvePeers(unknownChannels);
  if (peers.size === 0) return firstPass;
  return parseTxDetail(
    raw,
    { chainId, identify, channelPeer: (channel) => canonicalPeer(chainId, channel) ?? peers.get(`${chainId}|${channel}`) ?? null },
    address ? { address } : {},
  );
}
