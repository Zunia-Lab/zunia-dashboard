/**
 * The IBC route planner's pure rules: where its channel seeds come from, what
 * a seed check must prove before a seeded channel is offered, which light
 * client states are usable, and how a request's hand-typed channels are read.
 *
 * Kept free of I/O and of `server-only` so each rule is unit tested on its own
 * (`__tests__/interchain-rules.test.ts`); `interchain.ts` does the reading.
 */

import type { ChannelRoute, RouteHopOverride } from "@zunialab/interchain";
import type { IbcChannelRow } from "@/lib/token/ibc-channels.generated";

/* -------------------------------------------------------------------------- *
 * Seeds
 * -------------------------------------------------------------------------- */

/**
 * The chain-registry channel table as planner seeds.
 *
 * `IBC_CHANNEL_ROWS` (src/lib/token/ibc-channels.generated.ts) is the
 * registry's *preferred* transfer channel for 507 chain pairs, both
 * directions. It is exactly what discovery cannot find on the hub chains:
 * Cosmos Hub lists ~1,900 channels and Osmosis over 100,000, nearly all
 * interchain-account ports, so a five-page walk never reaches a transfer
 * channel and the planner answered "no route" for Hub→Celestia, Osmosis→Akash
 * and most other pairs leaving a hub. It is also the *canonical* channel: a
 * token sent over any other channel arrives as a different `ibc/…` voucher,
 * which no wallet, pool or explorer recognises as the real asset.
 *
 * A seed is a hint, never a route: every one is looked up on chain by id
 * (`seedAccepted` and `clientUsable` below) before it is offered. Rows whose
 * chains are not in this build's catalog are dropped, so a seed never names a
 * chain the planner cannot read.
 */
export function tableSeeds(
  rows: readonly IbcChannelRow[],
  known: (chainId: string) => boolean,
): ChannelRoute[] {
  const out: ChannelRoute[] = [];
  for (const [sourceChainId, channelId, destChainId, counterpartyChannelId] of rows) {
    if (sourceChainId === destChainId || !known(sourceChainId) || !known(destChainId)) continue;
    out.push({
      sourceChainId,
      destChainId,
      channelId,
      counterpartyChannelId,
      verifiedAt: 0,
      source: "seed",
    });
  }
  return out;
}

/**
 * Channels for catalog pairs the registry table does not name, read off both
 * chains on 2026-10-07 (open on the transfer port, each end's counterparty the
 * other, both light clients `Active`). Without them Hub→Akash found no route
 * (the Hub's listing never reaches a transfer channel) and Akash→Hub took a
 * 70-second walk that picked channel-0, whose clients are expired.
 *
 * Seeds like any other: each is checked by id on chain before it is offered,
 * so a channel that closes or whose client expires simply stops being used.
 * `[source, channel on source, destination, channel on destination]`.
 */
export const HOST_VERIFIED_CHANNELS: readonly IbcChannelRow[] = [
  ["cosmoshub-4", "channel-184", "akashnet-2", "channel-17"],
  ["akashnet-2", "channel-17", "cosmoshub-4", "channel-184"],
  ["cosmoshub-4", "channel-623", "archway-1", "channel-0"],
  ["archway-1", "channel-0", "cosmoshub-4", "channel-623"],
  ["osmosis-1", "channel-1429", "archway-1", "channel-1"],
  ["archway-1", "channel-1", "osmosis-1", "channel-1429"],
];

/** Seeds by direction. */
export interface SeedIndex {
  /** The seeds for one direction, in table order. */
  get(sourceChainId: string, destChainId: string): readonly ChannelRoute[];
  readonly size: number;
}

/**
 * Seeds indexed by direction, one row per source/dest/channel triple. When two
 * sources (the engine's own seed table and the registry table) name the same
 * channel, the row that knows the counterparty wins.
 */
export function createSeedIndex(routes: Iterable<ChannelRoute>): SeedIndex {
  const byTriple = new Map<string, ChannelRoute>();
  for (const route of routes) {
    if (!CHANNEL_ID.test(route.channelId) || route.sourceChainId === route.destChainId) continue;
    const key = `${route.sourceChainId}\u0000${route.destChainId}\u0000${route.channelId}`;
    const existing = byTriple.get(key);
    if (!existing || (!existing.counterpartyChannelId && route.counterpartyChannelId)) byTriple.set(key, route);
  }
  const byDirection = new Map<string, ChannelRoute[]>();
  for (const route of byTriple.values()) {
    const key = `${route.sourceChainId}\u0000${route.destChainId}`;
    const list = byDirection.get(key);
    if (list) list.push(route);
    else byDirection.set(key, [route]);
  }
  return {
    get: (sourceChainId, destChainId) => byDirection.get(`${sourceChainId}\u0000${destChainId}`) ?? [],
    size: byTriple.size,
  };
}

/** What the on-chain lookup of a seeded channel answered (the engine's `IbcChannelCheck`). */
export interface SeedCheck {
  readonly ok: boolean;
  readonly counterpartyChainId?: string | null;
  readonly counterpartyChannelId?: string;
}

/**
 * Whether a seed's on-chain check proves it is a channel to `toChainId`.
 *
 * Stricter than the check's own `ok`, which is also true when the channel's
 * client could not be resolved to a chain at all: a seed is offered as
 * verified, so "open, and its client is a client of the destination" has to be
 * shown, not assumed. A counterparty channel that disagrees with the one the
 * seed names is a different channel pair than the registry describes, and is
 * refused too. An unreadable counterparty is not a disagreement.
 */
export function seedAccepted(seed: ChannelRoute, check: SeedCheck, toChainId: string): boolean {
  if (!check.ok) return false;
  if (check.counterpartyChainId !== toChainId) return false;
  if (seed.counterpartyChannelId && check.counterpartyChannelId && check.counterpartyChannelId !== seed.counterpartyChannelId) {
    return false;
  }
  return true;
}

/**
 * Whether a light client's status leaves its channel usable.
 *
 * Only a status that was actually read and is not `Active` (`Expired`,
 * `Frozen`) disqualifies: a transfer over such a channel cannot be sent or is
 * only ever refunded. An unreadable status (`null`) passes, because many
 * public gateways do not serve `client_status`, and refusing every channel
 * behind them would refuse routes that work.
 */
export function clientUsable(status: string | null): boolean {
  return status === null || status === "Active";
}

/* -------------------------------------------------------------------------- *
 * Swap recovery
 * -------------------------------------------------------------------------- */

/**
 * The crosschain-swaps contract a tracked transfer's recovery message names,
 * or `null` when the trace must not offer one.
 *
 * Only for a plan that actually swaps on the venue chain, and only the
 * contract the venue check verified on chain (the swap engine's
 * `swapVenue()`: label and reviewed code id, `lib/swap/venue.ts`). The old
 * tracker read `ZUNIA_XCS_CONTRACT` directly, so a deployment that left the
 * variable unset (the swap engine no longer needs it) told a user whose swap
 * output was stuck that "no recovery address was configured", and one with a
 * stale value would have built a recovery against a contract nobody checked.
 */
export function recoveryContractFor(
  hops: readonly { readonly kind: string; readonly chainId: string }[],
  venue: { readonly chainId: string; readonly address: string | null } | null,
): string | null {
  if (!venue?.address) return null;
  return hops.some((hop) => hop.kind === "swap" && hop.chainId === venue.chainId) ? venue.address : null;
}

/* -------------------------------------------------------------------------- *
 * Hand-typed channels (plan overrides)
 * -------------------------------------------------------------------------- */

/**
 * At most this many overrides are read from one plan request. The UI sends at
 * most one per leg (about five). Each override with chain ids adds a discovery
 * pair, so an uncapped list let one request choose how many channel walks the
 * server makes.
 */
export const MAX_OVERRIDES = 8;

const CHANNEL_ID = /^channel-\d{1,10}$/;
/** ICS-24 port identifier: 2–128 characters from a small alphabet. */
const PORT_ID = /^[A-Za-z0-9._+\-#[\]<>]{2,128}$/;
/** A hop index the engine can mean: routes are a handful of hops. */
const MAX_HOP_INDEX = 8;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A typed channel id in canonical `channel-N` form, the way the engine's
 * `normalizeChannelId` reads one (the field takes "141" as well as
 * "channel-141"), or `""` when it is not a channel id at all.
 */
function channelIdOf(value: unknown): string {
  const raw = text(value).toLowerCase();
  const id = /^\d+$/.test(raw) ? `channel-${raw}` : raw;
  return CHANNEL_ID.test(id) ? id : "";
}

/**
 * The overrides of one plan request, checked: at most `MAX_OVERRIDES`, channel
 * ids in `channel-N` form, and every chain id named one this build's catalog
 * has. A row naming an unknown chain is skipped rather than passed on — it can
 * only be junk, and it must never become a discovery pair.
 *
 * Overrides stay scoped to the request that sent them. They are never written
 * to the process-wide route registry: one visitor's typed channel must not
 * become another visitor's route.
 */
export function readOverrides(value: unknown, known: (chainId: string) => boolean): RouteHopOverride[] {
  if (!Array.isArray(value)) return [];
  const out: RouteHopOverride[] = [];
  for (const entry of value.slice(0, MAX_OVERRIDES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const channelId = channelIdOf(row.channelId);
    if (!channelId) continue;
    const fromChainId = text(row.fromChainId);
    const toChainId = text(row.toChainId);
    if ((fromChainId && !known(fromChainId)) || (toChainId && !known(toChainId))) continue;
    const port = text(row.port);
    if (port && !PORT_ID.test(port)) continue;
    const counterpartyChannelId = channelIdOf(row.counterpartyChannelId);
    if (text(row.counterpartyChannelId) && !counterpartyChannelId) continue;
    const hopIndex =
      typeof row.hopIndex === "number" && Number.isInteger(row.hopIndex) && row.hopIndex >= 0 && row.hopIndex <= MAX_HOP_INDEX
        ? row.hopIndex
        : undefined;
    out.push({
      ...(hopIndex === undefined ? {} : { hopIndex }),
      ...(fromChainId ? { fromChainId } : {}),
      ...(toChainId ? { toChainId } : {}),
      channelId,
      ...(port ? { port } : {}),
      ...(counterpartyChannelId ? { counterpartyChannelId } : {}),
    });
  }
  return out;
}
