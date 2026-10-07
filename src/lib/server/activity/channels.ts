/**
 * Which chain sits at the other end of a transfer channel.
 *
 * A channel's counterparty is fixed when the channel opens, so the answer is a
 * fact about the channel, never a guess about a packet. The canonical table
 * (cosmos/chain-registry `_IBC`, shipped in lib/token) answers the channels
 * most transfers use without a request; anything else is read once from the
 * chain (channel → connection → client state) and remembered for a day.
 */

import "server-only";
import { cached } from "@/lib/server/cache";
import { findServerChain } from "@/lib/server/chains";
import { channelService } from "@/lib/server/interchain";
import { IBC_CHANNEL_ROWS } from "@/lib/token/ibc-channels.generated";
import type { ChannelPeer } from "@/lib/activity/describe";

let canonical: Map<string, string> | null = null;

function canonicalTable(): Map<string, string> {
  if (!canonical) {
    canonical = new Map();
    for (const [source, channel, destination] of IBC_CHANNEL_ROWS) {
      canonical.set(`${source}|${channel}`, destination);
    }
  }
  return canonical;
}

function peer(chainId: string): ChannelPeer {
  const name = findServerChain(chainId)?.chainName;
  return name ? { chainId, chainName: name } : { chainId };
}

/** The canonical table's answer, synchronously; null when the channel is not in it. */
export function canonicalPeer(chainId: string, channel: string): ChannelPeer | null {
  const destination = canonicalTable().get(`${chainId}|${channel}`);
  return destination ? peer(destination) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 5_000;
/** New channels resolved per request; the rest wait for a later read (the day-long cache fills up). */
const MAX_LOOKUPS = 6;

async function lookup(chainId: string, channel: string): Promise<ChannelPeer | null> {
  return cached(`activity:channel:${chainId}:${channel}`, { ttlMs: DAY_MS, staleMs: DAY_MS, errorTtlMs: 5 * 60_000 }, async () => {
    const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    const check = await channelService.validateIbcChannel(chainId, channel, undefined, { portId: "transfer", signal });
    const destination = check.counterpartyChainId ?? null;
    return destination ? peer(destination) : null;
  });
}

/**
 * Peers for channels the canonical table does not know, read from the chain.
 * Failures are left unresolved (a missing chain name, never a wrong one).
 */
export async function resolvePeers(
  pairs: ReadonlyArray<{ chainId: string; channel: string }>,
): Promise<Map<string, ChannelPeer>> {
  const out = new Map<string, ChannelPeer>();
  const pending: Array<{ chainId: string; channel: string }> = [];
  const seen = new Set<string>();
  for (const { chainId, channel } of pairs) {
    const key = `${chainId}|${channel}`;
    if (seen.has(key) || !/^channel-\d{1,10}$/.test(channel)) continue;
    seen.add(key);
    const known = canonicalPeer(chainId, channel);
    if (known) out.set(key, known);
    else pending.push({ chainId, channel });
  }
  const results = await Promise.allSettled(
    pending.slice(0, MAX_LOOKUPS).map(async ({ chainId, channel }) => [`${chainId}|${channel}`, await lookup(chainId, channel)] as const),
  );
  for (const result of results) {
    if (result.status === "fulfilled" && result.value[1]) out.set(result.value[0], result.value[1]);
  }
  return out;
}
