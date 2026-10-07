/**
 * `@zunialab/interchain`, wired up once for the server.
 *
 * This module is the dashboard's only IBC implementation. `lib/server/
 * ibc-channels.ts` used to hold a second copy of channel discovery and
 * validation — one of three near-identical copies across the products, two of
 * which reported a channel still mid-handshake (`STATE_TRYOPEN`) as open,
 * because the state test was `includes("OPEN")`. That file is gone; everything
 * chain-facing now comes from the engine.
 *
 * Everything here runs server-side. The browser calls `/api/*`, the rule every
 * chain read in the dashboard follows: the catalog holds 332 chains' public
 * REST endpoints and a visitor's IP has no business being sent to all of them.
 *
 * The instances are module-level singletons on purpose. The channel service
 * memoises connection-to-chain-id resolution and module probes, and a discovery
 * pass over a hundred channels collapses to a handful of requests because of
 * that cache; building a service per request would throw it away every time.
 */

import "server-only";
import {
  createChainRegistry,
  createDenomResolver,
  createIbcChannelService,
  createLcdClientFactory,
  createLcdResolver,
  createRouteRegistry,
  DEFAULT_ROUTE_MAX_AGE_MS,
  isInterchainError,
  isRouteFresh,
  lcdEndpointsFromChain,
  SEED_CHANNEL_ROUTES,
  TRANSFER_PORT,
  type ChainCapabilities,
  type ChainInfoLike,
  type ModuleSupportOverride,
  type ChannelLink,
  type ChannelRoute,
  type IbcChannelCheck,
  type IbcChannelOption,
  type LcdClient,
} from "@zunialab/interchain";
import { findChain } from "@/lib/chains";
import { cached } from "@/lib/server/cache";
import { SERVER_CHAINS as CHAINS } from "@/lib/server/chains";
import { pinnedModuleSupport } from "@/lib/server/interchain-config";
import {
  clientUsable,
  createSeedIndex,
  HOST_VERIFIED_CHANNELS,
  seedAccepted,
  tableSeeds,
} from "@/lib/server/interchain-rules";
import { IBC_CHANNEL_ROWS } from "@/lib/token/ibc-channels.generated";

/**
 * The catalog, as the engine sees it.
 *
 * `ChainEntry` is a structural subset of `ChainInfoLike`, so the rows pass
 * straight through with no mapping. `features` is absent from this catalog,
 * which the engine reads as "nobody said" rather than "no" — see the note on
 * `chainHasFeature`.
 */
export const chainRegistry = createChainRegistry(CHAINS as readonly ChainInfoLike[]);

/**
 * One LCD factory for every chain.
 *
 * 9s is the same per-attempt timeout the deleted discovery code used. One retry
 * and a 30s read cache keep a busy plan (discovery for three chain pairs, a
 * denom trace, a contract check) inside a single request without hammering a
 * public endpoint.
 */
export const lcdFactory = createLcdClientFactory({
  timeoutMs: 9_000,
  retries: 1,
  cacheTtlMs: 30_000,
});

/** The read client for a chain, or `null` when the catalog has no REST endpoint. */
export function lcdFor(chain: ChainInfoLike | undefined): LcdClient | null {
  if (!chain || lcdEndpointsFromChain(chain).length === 0) return null;
  return lcdFactory(chain);
}

/** Chain id to LCD, for `trackRoute`. Unreadable chains resolve to `null`. */
export const lcdResolver = createLcdResolver(chainRegistry, lcdFactory);

/**
 * Channel discovery, validation and middleware probes.
 *
 * The user-facing copy (`"Open · osmosis-1"`, `"Channel is closed, not open"`)
 * comes from the engine's `DEFAULT_CHANNEL_MESSAGES`, which is deliberately the
 * same wording the deleted dashboard copy had, so nothing regressed for anyone
 * reading the field hint.
 */
export const channelService = createIbcChannelService({
  lcd: lcdFactory,
  registry: chainRegistry,
  // 200 x 5 rather than the default 100 x 3. Cosmos Hub carries ~1900 channels,
  // almost all of them interchain-accounts ports, and its listing does not
  // start at channel-0 — a walk of 300 rows finds no transfer channel at all.
  // Even 1000 rows does not reach channel-141, which is why `verifySeeds`
  // below exists: enumerating a chain's channels is the wrong way to find one
  // channel, and asking for it by id is the right one.
  pageLimit: 200,
  maxPages: 5,
  moduleSupport: buildModuleSupportOverrides(),
});

function buildModuleSupportOverrides(): Record<string, ModuleSupportOverride> {
  const pinned = pinnedModuleSupport();
  const out: Record<string, ModuleSupportOverride> = {};
  for (const chainId of pinned.pfm) {
    out[chainId] = { ...out[chainId], packetForward: true };
  }
  for (const chainId of pinned.ibcHooks) {
    out[chainId] = { ...out[chainId], ibcHooks: true };
  }
  return out;
}

/**
 * Denom traces, with channel counterparties resolved through the same service.
 *
 * Without the counterparty lookup an `ibc/…` denom's origin chain cannot be
 * proven and the planner cannot tell "send it home" from "wrap it again", which
 * is the difference between arriving as ATOM and arriving as a double-wrapped
 * hash no UI can name.
 */
export const denomResolver = createDenomResolver({
  lcd: lcdFactory,
  registry: chainRegistry,
  counterparty: async (chainId, portId, channelId, options) => {
    const check = await channelService.validateIbcChannel(
      chainId,
      channelId,
      undefined,
      {
        portId,
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    );
    return check.counterpartyChainId ?? null;
  },
});

/**
 * Channel seeds: hints for the pairs a channel walk cannot find.
 *
 * The engine's own table (`SEED_CHANNEL_ROUTES`, Hub↔Osmosis), the
 * chain-registry table of preferred transfer channels the token engine already
 * ships (`IBC_CHANNEL_ROWS`, 507 pairs, both directions) and a few checked
 * channels for pairs that table misses (`HOST_VERIFIED_CHANNELS`), limited to
 * chains in this catalog. Kept apart from `routeRegistry` on purpose: a seed is a
 * permanent hint and a registry row is a 24-hour fact, and when the two shared
 * a store the first successful check overwrote the seed with a "discovered"
 * row — which, once it went stale a day later, was neither fresh nor a seed,
 * so Hub→Osmosis stopped planning until the next restart.
 */
const inCatalog = (chainId: string) => chainRegistry.get(chainId) !== undefined;
const SEEDS = createSeedIndex([
  ...SEED_CHANNEL_ROUTES,
  ...tableSeeds(IBC_CHANNEL_ROWS, inCatalog),
  ...tableSeeds(HOST_VERIFIED_CHANNELS, inCatalog),
]);

/**
 * Channel pairs this process has verified on chain: seed checks and channel
 * walks, each row trusted for `DEFAULT_ROUTE_MAX_AGE_MS` (a day).
 *
 * Production is one long-lived `next start` process, so this is shared by
 * every visitor. That is why nothing a request *says* is ever written here —
 * a channel typed into a plan's overrides stays in that request (it reaches
 * the planner through the request's own `manualLinks`). It used to be stored
 * as a `manual` row, the strongest rank the registry has and one it never
 * prunes: one visitor's typed channel then became every later visitor's route
 * for that pair ("entered by hand" on a channel nobody had typed), and an
 * anonymous client could grow the map without bound.
 *
 * Only catalog chain pairs are ever discovered, so the rows are bounded by the
 * catalog; `MAX_REGISTRY_ROWS` is a backstop, not a working limit.
 */
export const routeRegistry = createRouteRegistry();
const MAX_REGISTRY_ROWS = 5_000;

function remember(routes: readonly ChannelRoute[]): void {
  if (routes.length === 0) return;
  if (routeRegistry.size + routes.length > MAX_REGISTRY_ROWS) routeRegistry.prune(DEFAULT_ROUTE_MAX_AGE_MS);
  if (routeRegistry.size + routes.length > MAX_REGISTRY_ROWS) return;
  routeRegistry.putMany(routes);
}

export interface DiscoveredPair {
  readonly fromChainId: string;
  readonly toChainId: string;
  readonly options: readonly IbcChannelOption[];
}

export interface DiscoveryFailure {
  readonly fromChainId: string;
  readonly toChainId: string;
  readonly message: string;
}

export interface DiscoveryResult {
  readonly links: readonly ChannelLink[];
  readonly failures: readonly DiscoveryFailure[];
}

function optionToLink(
  fromChainId: string,
  toChainId: string,
  option: IbcChannelOption,
): ChannelLink {
  return {
    sourceChainId: fromChainId,
    destChainId: toChainId,
    channelId: option.channelId,
    port: option.portId || TRANSFER_PORT,
    ...(option.counterpartyChannelId
      ? { counterpartyChannelId: option.counterpartyChannelId }
      : {}),
    counterpartyPortId: option.counterpartyPortId || TRANSFER_PORT,
    // Discovery read the channel off the source chain and filtered to `open`,
    // so this is exactly what the engine means by `verified`.
    source: "verified",
    state: option.state,
  };
}

function routeToLink(route: ChannelRoute): ChannelLink {
  return {
    sourceChainId: route.sourceChainId,
    destChainId: route.destChainId,
    channelId: route.channelId,
    port: TRANSFER_PORT,
    ...(route.counterpartyChannelId
      ? { counterpartyChannelId: route.counterpartyChannelId }
      : {}),
    counterpartyPortId: TRANSFER_PORT,
    source: route.source === "manual" ? "manual" : route.source === "discovered" ? "verified" : "seed",
    // A cached row was open when it was written; nobody has looked since, and
    // saying `open` here would let a stale row render as verified-open.
    state: route.source === "discovered" ? "open" : "unknown",
  };
}

/** A verified pair as the registry row it becomes. */
function verifiedRoute(fromChainId: string, toChainId: string, channelId: string, counterpartyChannelId: string | undefined): ChannelRoute {
  return {
    sourceChainId: fromChainId,
    destChainId: toChainId,
    channelId,
    counterpartyChannelId: counterpartyChannelId ?? "",
    verifiedAt: Date.now(),
    source: "discovered",
  };
}

/**
 * How long one pair's answer is shared across requests. Found channels also go
 * into `routeRegistry` for a day; this memo is what stops a pair with *no*
 * channel (Hub→dYdX has none) from costing a five-page walk on every plan. A
 * failed or inconclusive check is remembered for a minute only, so an
 * endpoint blip does not read as "no route" for ten.
 */
const PAIR_MEMO_MS = 10 * 60_000;
const PAIR_ERROR_MEMO_MS = 60_000;

/**
 * How long one request waits for a pair's discovery. A cold walk of a big
 * channel list can take a minute or more (it resolves every listed
 * connection), and nginx gives up on the request at 60 s with an HTML 504 the
 * browser cannot read. So the request stops waiting first and says the check
 * is still running; the walk itself carries on (it is shared, see
 * `discoverLinks`) and fills the registry, so the next plan answers at once.
 */
const PAIR_WAIT_MS = 45_000;

/** One pair's discovery outcome. `failure` is shown to the user next to the leg. */
interface PairOutcome {
  readonly links: readonly ChannelLink[];
  readonly failure: string | null;
}

/** A seed check that could not run (endpoint down), as opposed to one that ran and said no. */
class Inconclusive extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Inconclusive";
  }
}

/** The request stopped waiting for a discovery that is still running. */
class StillDiscovering extends Error {
  constructor() {
    super("still discovering");
    this.name = "StillDiscovering";
  }
}

/**
 * Wait for `promise` for at most `waitMs`, or until `signal` aborts. The
 * promise itself keeps running either way: it is a discovery shared with other
 * requests, which one visitor changing an amount (or one slow walk) must not
 * cancel for everyone.
 */
function waitFor<T>(promise: Promise<T>, signal: AbortSignal | undefined, waitMs: number): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      reject(new StillDiscovering());
    }, waitMs);
    signal?.addEventListener("abort", stop, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}

/**
 * Discover transfer channels for a set of chain pairs.
 *
 * Per pair: a verified row from the last day answers at once; otherwise the
 * pair is discovered once for every request asking at the same time
 * (`discoverPair`, single-flight through the shared cache), so a stampede of
 * plans after a deploy, or a visitor typing an amount, costs one walk rather
 * than one per keystroke.
 *
 * Failures are collected rather than thrown. Discovery fails routinely — a
 * public LCD paginates badly, or has no client state for a connection — and the
 * user still knows their channel. The caller turns each failure into a visible
 * "we could not look this up, type it yourself" state instead of an error page.
 */
export async function discoverLinks(
  pairs: readonly (readonly [string, string])[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<DiscoveryResult> {
  const links: ChannelLink[] = [];
  const failures: DiscoveryFailure[] = [];
  const seen = new Set<string>();

  await Promise.all(
    pairs.map(async ([fromChainId, toChainId]) => {
      const key = `${fromChainId}>${toChainId}`;
      if (fromChainId === toChainId || seen.has(key)) return;
      seen.add(key);

      // Only catalog chains are ever discovered (the plan route refuses
      // anything else before it gets here); this keeps that true for any
      // future caller too.
      if (!chainRegistry.get(fromChainId) || !chainRegistry.get(toChainId)) {
        failures.push({
          fromChainId,
          toChainId,
          message: `${label(fromChainId)} → ${label(toChainId)} is not a pair of chains this build can read.`,
        });
        return;
      }

      const fresh = routeRegistry
        .getAll(fromChainId, toChainId)
        .filter((route) => isRouteFresh(route, DEFAULT_ROUTE_MAX_AGE_MS));
      if (fresh.length > 0) {
        links.push(...fresh.map(routeToLink));
        return;
      }

      try {
        const outcome = await waitFor(
          cached<PairOutcome>(
            `ibc:pair:${fromChainId}\u0000${toChainId}`,
            { ttlMs: PAIR_MEMO_MS, staleMs: 0, errorTtlMs: PAIR_ERROR_MEMO_MS },
            () => discoverPair(fromChainId, toChainId),
          ),
          options.signal,
          PAIR_WAIT_MS,
        );
        links.push(...outcome.links);
        if (outcome.failure) failures.push({ fromChainId, toChainId, message: outcome.failure });
      } catch (error) {
        // The visitor left; nobody reads this answer.
        if (options.signal?.aborted) return;
        failures.push({
          fromChainId,
          toChainId,
          message:
            error instanceof StillDiscovering
              ? `Zunia is still reading ${label(fromChainId)}'s channel list for a route to ${label(toChainId)}. The first check of a pair can take a minute or two; try again shortly and it will answer at once.`
              : error instanceof Inconclusive
              ? error.message
              : describeError(
                  error,
                  `Could not list channels from ${label(fromChainId)} to ${label(toChainId)}.`,
                ),
        });
      }
    }),
  );

  return { links, failures };
}

/**
 * Find the usable transfer channels for one direction.
 *
 * 1. **Seeds first.** When the chain registry (or the engine's table) names a
 *    channel for the pair, it is asked for by id (`verifySeeds`): one channel
 *    read, a connection lookup and two client-status reads, about a second.
 *    That is the only way to find a hub chain's channels at all — Cosmos Hub
 *    lists ~1,900 channels starting at channel-370 and Osmosis over 100,000,
 *    nearly all interchain-account ports, so the walk below reaches no
 *    transfer channel — and it is also the canonical channel, the one a
 *    token's well-known `ibc/…` name on the destination comes from. Pairs the
 *    walk does find took 35–100 s cold (Celestia, Akash, Juno to Osmosis),
 *    because the walk resolves every listed connection; a passing seed skips
 *    it.
 * 2. **Then the walk**, for pairs the table does not name (or whose seed did
 *    not check out): every open transfer channel the source lists toward the
 *    destination, minus those whose light client is known to be expired or
 *    frozen.
 *
 * Every link returned is verified on chain; nothing unchecked is offered.
 */
async function discoverPair(fromChainId: string, toChainId: string): Promise<PairOutcome> {
  const seeds = SEEDS.get(fromChainId, toChainId);
  let inconclusive = false;
  if (seeds.length > 0) {
    const verified = await verifySeeds(fromChainId, toChainId, seeds);
    if (verified.links.length > 0) return { links: verified.links, failure: null };
    inconclusive = verified.inconclusive;
  }

  const found = await channelService.findIbcChannels(fromChainId, toChainId, {});
  const live = await withLiveClients(fromChainId, toChainId, found);
  if (live.length > 0) {
    remember(live.map((option) => verifiedRoute(fromChainId, toChainId, option.channelId, option.counterpartyChannelId)));
    return { links: live.map((option) => optionToLink(fromChainId, toChainId, option)), failure: null };
  }

  if (inconclusive) {
    // The registry names a channel we could not check right now. Saying "no
    // route" would be wrong, and remembering it for ten minutes worse.
    throw new Inconclusive(
      `${label(fromChainId)} did not answer when its channel to ${label(toChainId)} was checked, so the route could not be confirmed. Try again in a moment, or enter a channel id if you know one.`,
    );
  }
  if (found.length > 0) {
    return {
      links: [],
      failure: `Every open transfer channel from ${label(fromChainId)} to ${label(toChainId)} has an expired or frozen light client, so a transfer over it would fail. Enter a channel id if you know a working one.`,
    };
  }
  return {
    links: [],
    failure: `No open transfer channel from ${label(fromChainId)} to ${label(toChainId)} was found. This chain's endpoint lists its channels in an order that does not reach the transfer ports — enter a channel id if you know one.`,
  };
}

/**
 * Confirm seeded channels, one lookup by id each.
 *
 * A seed is offered only when the chain shows all of it (`seedAccepted`): the
 * channel is open on the transfer port, its client is a client *of the
 * destination* (an unresolvable client is not good enough for a channel that
 * will be labelled verified), its counterparty is the channel the registry
 * names, and neither end's light client is known to be expired or frozen
 * (`clientUsable`). A seed that fails is dropped, never offered as a maybe:
 * an unchecked seed presented as a route is how a closed channel gets used.
 *
 * `inconclusive` reports a check that could not run at all, which the caller
 * treats as "try again" rather than "there is no channel".
 */
async function verifySeeds(
  fromChainId: string,
  toChainId: string,
  seeds: readonly ChannelRoute[],
): Promise<{ links: ChannelLink[]; inconclusive: boolean }> {
  let inconclusive = false;
  const checked = await Promise.all(
    seeds.map(async (seed): Promise<ChannelLink | null> => {
      let check: IbcChannelCheck;
      try {
        check = await channelService.validateIbcChannel(fromChainId, seed.channelId, toChainId, {});
      } catch {
        inconclusive = true;
        return null;
      }
      // `unknown` is "could not read it"; an `ok` with no counterparty chain is
      // "could not resolve its client". Neither is a no.
      if ((!check.ok && check.state === "unknown") || (check.ok && !check.counterpartyChainId)) {
        inconclusive = true;
        return null;
      }
      if (!seedAccepted(seed, check, toChainId)) return null;
      const counterparty = check.counterpartyChannelId || seed.counterpartyChannelId || undefined;
      if (!(await clientsLive(fromChainId, check.channelId, toChainId, counterparty))) return null;
      return {
        sourceChainId: fromChainId,
        destChainId: toChainId,
        channelId: check.channelId,
        port: check.portId || TRANSFER_PORT,
        ...(counterparty ? { counterpartyChannelId: counterparty } : {}),
        counterpartyPortId: TRANSFER_PORT,
        source: "verified",
        state: check.state,
      };
    }),
  );
  const links = checked.filter((link): link is ChannelLink => link !== null);
  remember(links.map((link) => verifiedRoute(fromChainId, toChainId, link.channelId, link.counterpartyChannelId)));
  return { links, inconclusive };
}

/** The walk's options whose light clients are not known to be dead, lowest channel number first. */
async function withLiveClients(
  fromChainId: string,
  toChainId: string,
  options: readonly IbcChannelOption[],
): Promise<IbcChannelOption[]> {
  const ordered = [...options]
    .sort((a, b) => a.channelId.localeCompare(b.channelId, undefined, { numeric: true }))
    // The planner keeps a few per pair; checking more only costs reads.
    .slice(0, 8);
  const live = await Promise.all(
    ordered.map((option) => clientsLive(fromChainId, option.channelId, toChainId, option.counterpartyChannelId || undefined)),
  );
  return ordered.filter((_, index) => live[index]);
}

/** Whether neither end of a channel has a light client known to be expired or frozen. */
async function clientsLive(
  fromChainId: string,
  channelId: string,
  toChainId: string,
  counterpartyChannelId: string | undefined,
): Promise<boolean> {
  const [here, there] = await Promise.all([
    clientStatus(fromChainId, channelId),
    counterpartyChannelId ? clientStatus(toChainId, counterpartyChannelId) : Promise.resolve(null),
  ]);
  return clientUsable(here) && clientUsable(there);
}

/**
 * The status of the light client behind a transfer channel (`Active`,
 * `Expired`, `Frozen`), or `null` when it cannot be read. Cached ten minutes:
 * a client's status changes on the scale of days.
 */
async function clientStatus(chainId: string, channelId: string): Promise<string | null> {
  const lcd = lcdFor(chainRegistry.get(chainId));
  if (!lcd) return null;
  try {
    return await cached<string | null>(
      `ibc:client-status:${chainId}\u0000${channelId}`,
      { ttlMs: 10 * 60_000, staleMs: 0, errorTtlMs: 60_000 },
      async () => {
        const state = await lcd.getJson(
          `/ibc/core/channel/v1/channels/${encodeURIComponent(channelId)}/ports/${TRANSFER_PORT}/client_state`,
          { timeoutMs: 6_000, retries: 0 },
        );
        const identified = record(record(state)?.identified_client_state);
        const clientId = typeof identified?.client_id === "string" ? identified.client_id : null;
        if (!clientId || !/^[0-9a-z-]{3,64}$/.test(clientId)) return null;
        const status = await lcd.getJson(`/ibc/core/client/v1/client_status/${encodeURIComponent(clientId)}`, {
          timeoutMs: 6_000,
          retries: 0,
        });
        const value = record(status)?.status;
        return typeof value === "string" ? value : null;
      },
    );
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Middleware support for a bounded set of chains, as a synchronous lookup.
 *
 * `planRoute`'s capability port is synchronous, so probing has to happen first.
 * Only the chains that can appear on a candidate path are probed — source,
 * destination, venue and whatever the discovered graph touches — which is a
 * handful, not the catalog.
 *
 * A probe answering `unknown` is left `undefined` rather than forced to
 * `false`: the engine reports "nobody checked" differently from "does not run
 * it", and `x/ibc-hooks` registers no query service on several releases, so
 * Osmosis itself probes as unknown.
 */
export async function capabilitiesFor(
  chainIds: readonly string[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<(chainId: string) => ChainCapabilities | undefined> {
  const unique = [...new Set(chainIds.filter((id) => id.length > 0))];
  const table = new Map<string, ChainCapabilities>();

  await Promise.all(
    unique.map(async (chainId) => {
      const chain = chainRegistry.get(chainId);
      if (!chain) return;
      const request = options.signal ? { signal: options.signal } : {};
      const [pfm, hooks] = await Promise.all([
        channelService
          .detectPfmSupport(chainId, request)
          .catch(() => null),
        channelService
          .detectIbcHooksSupport(chainId, request)
          .catch(() => null),
      ]);
      const capability: ChainCapabilities = {
        ...(pfm && pfm.status !== "unknown" ? { pfm: pfm.supported } : {}),
        ...(hooks && hooks.status !== "unknown" ? { ibcHooks: hooks.supported } : {}),
      };
      table.set(chainId, capability);
    }),
  );

  return (chainId: string) => table.get(chainId);
}

function label(chainId: string): string {
  return findChain(chainId)?.chainName ?? chainId;
}

/**
 * A message for the browser.
 *
 * Engine errors carry a `code` the UI branches on; the message is a detail
 * line. Transport failures are rebuilt from their structured fields, because
 * the engine's own text for them embeds the endpoint URL and, for an HTTP
 * error, the gateway's body verbatim — third-party text that would otherwise
 * appear inside the wallet's UI unchanged (a compromised community LCD could
 * put "re-verify your recovery phrase at …" there). The engine's own sentences
 * ("Osmosis router cannot price X -> Y") are kept. An unrecognised throw
 * becomes the caller's fallback text rather than a stack trace, which is both
 * a leak and useless to a user.
 */
export function describeError(error: unknown, fallback: string): string {
  if (!isInterchainError(error)) return fallback;
  if (error.endpoint !== undefined && error.message.includes(error.endpoint)) {
    const who = `${error.chainId ? label(error.chainId) : "The chain"}'s public endpoint`;
    if (error.code === "malformed-response") return `${fallback} ${who} sent an unreadable answer.`;
    if (error.httpStatus !== undefined) return `${fallback} ${who} answered HTTP ${error.httpStatus}.`;
    return `${fallback} ${who} did not answer.`;
  }
  return `${fallback} ${error.message}`;
}
