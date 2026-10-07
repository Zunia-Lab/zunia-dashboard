/**
 * How much history a chain's public node keeps.
 *
 * Public nodes prune blocks: the Hub's keeps weeks, Osmosis's about three
 * months, Kava's exactly one million blocks; Safrochain's keeps everything
 * from genesis. The activity list must say which, because "no older
 * transactions" and "the node threw them away" look the same in a search.
 *
 * The probe asks for block 1. A node that has it keeps the chain from genesis;
 * one that does not answers "height 1 is not available, lowest height is N",
 * and block N's header gives the date the window starts. Only that number is
 * read from the error text, never echoed.
 *
 * Why not `fetchJson`: it deliberately discards error bodies (src/lib/server/
 * http.ts), and the lowest height is only in one. This is a few small GETs per
 * chain per half hour, with their own timeout and a bounded body read.
 *
 * One public endpoint is often several nodes behind a load balancer, keeping
 * different windows, and a single probe dates only the node it reached. So
 * the probe is asked {@link PROBES} times at once and the answers are merged
 * cautiously: "from genesis" only when every node that answered has block 1,
 * otherwise the *highest* lowest height (the window every node keeps), with
 * `mixed` set when the nodes clearly differ. A probe that reached an archive
 * node no longer vouches for a search that reached a pruned one.
 */

import "server-only";
import { cached } from "@/lib/server/cache";
import { fetchJson } from "@/lib/server/http";
import { restOf } from "@/lib/server/chains";
import type { RetentionFacts } from "@/lib/activity/window";

export interface NodeRetention extends RetentionFacts {
  /** Oldest height the node serves; null when unknown. */
  lowestHeight: number | null;
}

const PROBE_TIMEOUT_MS = 6_000;
const MAX_BODY_BYTES = 8_192;
const TTL_MS = 30 * 60_000;

const LOWEST = /lowest height is (\d{1,15})/;

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(size, MAX_BODY_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const room = bytes.length - offset;
    if (room <= 0) break;
    bytes.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.length, room);
  }
  return new TextDecoder().decode(bytes);
}

interface BlockBody {
  block?: { header?: { time?: string; height?: string } };
}

async function blockTime(rest: string, height: number): Promise<number | null> {
  const body = await fetchJson<BlockBody>(`${rest}/cosmos/base/tendermint/v1beta1/blocks/${height}`, {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const time = Date.parse(body.block?.header?.time ?? "");
  return Number.isFinite(time) ? time : null;
}

/** Probes per refresh; parallel requests are what reach different nodes behind one endpoint. */
const PROBES = 3;
/**
 * Lowest heights further apart than this are different nodes, not one node
 * pruning between two reads a moment apart.
 */
const SAME_NODE_BLOCKS = 1_000;

/** One probe: what the node it reached keeps. */
async function probeOnce(rest: string): Promise<NodeRetention> {
  const response = await fetch(`${rest}/cosmos/base/tendermint/v1beta1/blocks/1`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const body = await readCapped(response);
  if (response.ok) {
    let time: number | null = null;
    try {
      const parsed = JSON.parse(body) as BlockBody;
      const at = Date.parse(parsed.block?.header?.time ?? "");
      time = Number.isFinite(at) ? at : null;
    } catch {
      // A genesis block too large for the capped read: the fact that it exists is what matters.
    }
    return { fromGenesis: true, lowestHeight: 1, lowestTime: time };
  }
  const match = LOWEST.exec(body);
  if (!match) return { fromGenesis: null, lowestHeight: null, lowestTime: null };
  return { fromGenesis: false, lowestHeight: Number(match[1]), lowestTime: null };
}

async function probe(chainId: string): Promise<NodeRetention> {
  const rest = restOf(chainId);
  if (!rest) return { fromGenesis: null, lowestHeight: null, lowestTime: null };
  const settled = await Promise.allSettled(Array.from({ length: PROBES }, () => probeOnce(rest)));
  const answers = settled
    .filter((result): result is PromiseFulfilledResult<NodeRetention> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((answer) => answer.fromGenesis !== null);
  if (answers.length === 0) {
    // Every probe failed outright: let the cache retry soon rather than keep "unknown".
    if (settled.every((result) => result.status === "rejected")) throw new Error("retention probe failed");
    return { fromGenesis: null, lowestHeight: null, lowestTime: null };
  }
  const pruned = answers.filter((answer) => answer.fromGenesis === false && answer.lowestHeight !== null);
  if (pruned.length === 0) return answers[0] as NodeRetention;

  const heights = pruned.map((answer) => answer.lowestHeight as number);
  const lowestHeight = Math.max(...heights);
  const mixed =
    pruned.length < answers.length || lowestHeight - Math.min(...heights) > SAME_NODE_BLOCKS;
  // The very lowest block may be pruned by the time it is asked for; a few
  // hundred blocks above it dates the window just as well.
  const lowestTime = await blockTime(rest, lowestHeight + 200).catch(() => null);
  return { fromGenesis: false, lowestHeight, lowestTime, ...(mixed ? { mixed: true } : {}) };
}

/** The node's retention, cached for half an hour. Never throws: unknown facts are null. */
export async function nodeRetention(chainId: string): Promise<NodeRetention> {
  try {
    return await cached(`activity:retention:${chainId}`, { ttlMs: TTL_MS, staleMs: TTL_MS, errorTtlMs: 60_000 }, () => probe(chainId));
  } catch {
    return { fromGenesis: null, lowestHeight: null, lowestTime: null };
  }
}
