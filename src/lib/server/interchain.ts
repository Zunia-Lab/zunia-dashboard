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
 * Everything here runs server-side. The browser calls `/api/*`, which is the
 * same rule `chain-reads.ts` follows: the catalog holds 332 chains' public REST
 * endpoints and a visitor's IP has no business being sent to all of them.
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
  type IbcChannelOption,
  type LcdClient,
} from "@zunialab/interchain";
import { CHAINS, findChain } from "@/lib/chains";
import { pinnedModuleSupport } from "@/lib/server/interchain-config";

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
  // Even 1000 rows does not reach channel-141, which is why `verifySeedRoutes`
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
 * The persistable cache of discovered channel pairs, seeded with the engine's
 * table.
 *
 * In-process only: a serverless instance is short-lived and a stale channel
 * written to a shared store would outlive the reason we trusted it. What it
 * buys is that two plan requests in the same instance do not each walk three
 * pages of the Hub's channel list.
 */
export const routeRegistry = createRouteRegistry();
routeRegistry.putMany(SEED_CHANNEL_ROUTES);

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

/**
 * Discover transfer channels for a set of chain pairs.
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

      const cached = routeRegistry
        .getAll(fromChainId, toChainId)
        .filter((route) => isRouteFresh(route, DEFAULT_ROUTE_MAX_AGE_MS));
      if (cached.length > 0) {
        links.push(...cached.map(routeToLink));
        return;
      }

      try {
        const found = await channelService.findIbcChannels(
          fromChainId,
          toChainId,
          options.signal ? { signal: options.signal } : {},
        );
        if (found.length === 0) {
          const verified = await verifySeedRoutes(
            fromChainId,
            toChainId,
            options.signal,
          );
          links.push(...verified.links);
          if (verified.links.length === 0) {
            failures.push({
              fromChainId,
              toChainId,
              message: `No open transfer channel from ${label(fromChainId)} to ${label(toChainId)} was found. This chain's endpoint lists its channels in an order that does not reach the transfer ports — enter a channel id if you know one.`,
            });
          }
          return;
        }
        const now = Date.now();
        routeRegistry.putMany(
          found.map((option) => ({
            sourceChainId: fromChainId,
            destChainId: toChainId,
            channelId: option.channelId,
            counterpartyChannelId: option.counterpartyChannelId,
            verifiedAt: now,
            source: "discovered" as const,
          })),
        );
        links.push(
          ...found.map((option) => optionToLink(fromChainId, toChainId, option)),
        );
      } catch (error) {
        // Listing is down. A seed row is still worth trying, and asking for one
        // channel by id is a different request from walking every channel, so
        // it often works when the listing does not.
        const verified = await verifySeedRoutes(
          fromChainId,
          toChainId,
          options.signal,
        );
        links.push(...verified.links);
        failures.push({
          fromChainId,
          toChainId,
          message: describeError(
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
 * Confirm the channels we already believe in, one lookup each.
 *
 * Enumerating a chain's channels is the wrong shape of question for "which
 * channel goes to Osmosis": Cosmos Hub answers with ~1900 rows starting at
 * channel-370, nearly all interchain-accounts ports, and the transfer channel
 * to Osmosis is not among the first thousand. Asking for `channel-141` by id
 * answers instantly and tells us its counterparty.
 *
 * So when discovery finds nothing, the seed table and anything the user has
 * typed before are checked directly. A channel that comes back open, on the
 * transfer port, with a client targeting the destination, is genuinely
 * verified — that is the same evidence discovery would have produced. One that
 * does not is dropped rather than offered as a maybe.
 */
async function verifySeedRoutes(
  fromChainId: string,
  toChainId: string,
  signal: AbortSignal | undefined,
): Promise<{ links: ChannelLink[] }> {
  const candidates = routeRegistry
    .getAll(fromChainId, toChainId)
    .filter((route) => route.source !== "discovered");
  if (candidates.length === 0) return { links: [] };

  const links: ChannelLink[] = [];
  const now = Date.now();
  for (const candidate of candidates) {
    try {
      const check = await channelService.validateIbcChannel(
        fromChainId,
        candidate.channelId,
        toChainId,
        signal ? { signal } : {},
      );
      if (!check.ok) continue;
      const counterparty =
        check.counterpartyChannelId ?? candidate.counterpartyChannelId;
      links.push({
        sourceChainId: fromChainId,
        destChainId: toChainId,
        channelId: check.channelId,
        port: check.portId || TRANSFER_PORT,
        ...(counterparty ? { counterpartyChannelId: counterparty } : {}),
        counterpartyPortId: TRANSFER_PORT,
        source: "verified",
        state: check.state,
      });
      routeRegistry.put({
        sourceChainId: fromChainId,
        destChainId: toChainId,
        channelId: check.channelId,
        counterpartyChannelId: counterparty ?? "",
        verifiedAt: now,
        source: "discovered",
      });
    } catch {
      // One unverifiable candidate must not lose the others, and it is not
      // offered: an unchecked seed presented as a route is how a closed channel
      // gets used.
    }
  }
  return { links };
}

/** Record a channel the user typed, so later plans in this instance can use it. */
export function rememberManualChannel(params: {
  readonly fromChainId: string;
  readonly toChainId: string;
  readonly channelId: string;
  readonly counterpartyChannelId?: string;
}): void {
  try {
    routeRegistry.put({
      sourceChainId: params.fromChainId,
      destChainId: params.toChainId,
      channelId: params.channelId,
      counterpartyChannelId: params.counterpartyChannelId ?? "",
      // Never verified by us; the registry keeps that distinction and the UI
      // renders a manual channel as unchecked.
      verifiedAt: 0,
      source: "manual",
    });
  } catch {
    // `put` rejects a malformed channel id. The caller already validated what
    // it could; a rejected cache write must not fail the request.
  }
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
 * line. An unrecognised throw becomes the caller's fallback text rather than a
 * stack trace, which is both a leak and useless to a user.
 */
export function describeError(error: unknown, fallback: string): string {
  if (isInterchainError(error)) return `${fallback} ${error.message}`;
  if (error instanceof Error && error.message) return `${fallback} ${error.message}`;
  return fallback;
}
