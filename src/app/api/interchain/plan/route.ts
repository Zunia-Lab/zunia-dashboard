/**
 * Plan a route: unwind the denom if it is wrapped, discover and verify the
 * channels, and compose the memo.
 *
 * All of the thinking is `@zunialab/interchain`'s. What this handler does is the
 * four things the engine deliberately refuses to do, because they need host
 * knowledge it does not have:
 *
 * 1. **Discovery.** The engine takes a `ChannelDirectory`; somebody has to fill
 *    it. Only the pairs a candidate could use are discovered — source→dest,
 *    source→venue, venue→dest — because enumerating a 332-chain graph is not
 *    something a request should do.
 * 2. **Addresses.** `planRoute` never derives one. Without a real address for
 *    each intermediate chain it falls back to the literal string `"pfm"` and
 *    warns, and that placeholder is the single field in this whole flow where a
 *    wrong value loses funds. So the sender is re-encoded for every chain in
 *    the graph that shares its coin type and passed in.
 * 3. **The venue.** The crosschain-swaps contract is the one the swap
 *    engine's venue check verified on chain (`lib/server/swap/venue.ts`: label
 *    and reviewed code id). An unavailable venue means no swap candidate is
 *    offered at all, rather than one that cannot be signed.
 * 4. **The venue-side input denom.** The quote needs to know what the pool is
 *    being asked to sell — the input denom as denominated on Osmosis, not on
 *    the source chain. `recommendDenom` answers exactly that question, so it is
 *    asked rather than the trace being recomputed here.
 *
 * The response is inert JSON. The browser re-derives what the memo does from
 * the memo bytes before the user approves it (`lib/interchain/memo-summary.ts`);
 * nothing in this file is the security control.
 *
 * It is, though, the most expensive handler in the app — channel walks, client
 * and module probes, denom traces, all from this server's IP — so it is
 * guarded like every other fan-out route (`lib/server/interchain-request.ts`):
 * same origin only, a bounded `application/json` body, at most
 * `MAX_OVERRIDES` hand-typed channels naming catalog chains only, and a rate
 * limit that charges for each of them.
 */

import { NextRequest } from "next/server";
import {
  createChannelDirectory,
  isInterchainError,
  planRoute,
  routeDenomResolver,
  TRANSFER_PORT,
  type ChainCapabilities,
  type ChannelLink,
  type RoutePlanCandidate,
  type RouteRequest,
  type SwapVenue,
} from "@zunialab/interchain";
import { addressesForChains } from "@/lib/address";
import { SERVER_CHAINS as CHAINS, findServerChain as findChain } from "@/lib/server/chains";
import {
  capabilitiesFor,
  chainRegistry,
  denomResolver,
  describeError,
  discoverLinks,
  lcdFactory,
  type DiscoveryFailure,
} from "@/lib/server/interchain";
import { boundedBody, foreignOrigin, overLimit } from "@/lib/server/interchain-request";
import { readOverrides } from "@/lib/server/interchain-rules";
import { swapVenue } from "@/lib/server/swap/venue";

export const runtime = "nodejs";

interface PlanBody {
  sourceChainId?: unknown;
  destChainId?: unknown;
  inputDenom?: unknown;
  amount?: unknown;
  sender?: unknown;
  recipient?: unknown;
  /**
   * What the swap should buy, named the way a user picks it: a chain and that
   * chain's own denom. The venue-side denom is derived here, because it depends
   * on the channel the venue received that token over and only the engine can
   * name it.
   */
  outputAsset?: unknown;
  /** The venue-side denom directly, when a caller already has it. */
  outputDenom?: unknown;
  slippagePercent?: unknown;
  allowSwap?: unknown;
  maxHops?: unknown;
  recoveryAddress?: unknown;
  overrides?: unknown;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface OutputAsset {
  readonly originChainId: string;
  readonly baseDenom: string;
}

function readOutputAsset(value: unknown): OutputAsset | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const originChainId = str(row.originChainId);
  const baseDenom = str(row.baseDenom);
  if (!originChainId || !baseDenom) return null;
  return { originChainId, baseDenom };
}

function bad(message: string) {
  return Response.json({ ok: false, code: "bad-request", message }, { status: 400 });
}

/**
 * A plan body is a few short fields plus at most `MAX_OVERRIDES` channel rows;
 * 16 KB is several times the largest the UI sends.
 */
const MAX_BODY_BYTES = 16_384;

/** A chain id this build's catalog has. */
const inCatalog = (chainId: string) => findChain(chainId) !== undefined;

/** A stable identity for a candidate, so the UI can keep a selection across replans. */
function candidateId(candidate: RoutePlanCandidate): string {
  const channels = candidate.plan.hops
    .map((hop) => `${hop.chainId}:${hop.channelId || hop.kind}`)
    .join(">");
  return `${candidate.strategy}|${channels}`;
}

export async function POST(req: NextRequest) {
  const foreign = foreignOrigin(req);
  if (foreign) return foreign;
  const parsed = await boundedBody(req, MAX_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as PlanBody;

  // Hand-typed channels, checked and capped. Charged for before any work:
  // each one with chain ids is a discovery pair of its own.
  const overrides = readOverrides(body.overrides, inCatalog);
  const limited = overLimit(
    req,
    { scope: "interchain-plan", capacity: 30, refillPerSecond: 0.5, cost: 1 + overrides.length },
    "Too many route requests. Wait a moment and try again.",
  );
  if (limited) return limited;

  const sourceChainId = str(body.sourceChainId);
  const destChainId = str(body.destChainId);
  const inputDenom = str(body.inputDenom);
  const amount = str(body.amount);
  const sender = str(body.sender);
  const recipient = str(body.recipient);
  const requestedOutputDenom = str(body.outputDenom);
  const outputAsset = readOutputAsset(body.outputAsset);
  const allowSwap = body.allowSwap === true;

  if (!sourceChainId || !destChainId) return bad("Both chains are required.");
  if (!inputDenom) return bad("An input denom is required.");
  if (!/^\d+$/.test(amount) || amount === "0") {
    return bad("The amount must be a positive whole number of base units.");
  }
  if (!sender || !recipient) {
    return bad("A sender and a recipient address are required.");
  }

  const source = findChain(sourceChainId);
  const dest = findChain(destChainId);
  if (!source) return bad(`${sourceChainId} is not in this build's chain catalog.`);
  if (!dest) return bad(`${destChainId} is not in this build's chain catalog.`);

  // The verified crosschain-swaps contract (label and reviewed code id read
  // off Osmosis), or the reason there is none. Never consulted for a plain
  // transfer.
  const venue = allowSwap ? await swapVenue() : null;
  if (allowSwap && venue && !venue.address) {
    return Response.json({
      ok: false,
      code: "not-configured",
      message: venue.reason ?? "Cross-chain swap is not available right now.",
    });
  }
  const venueAddress = venue?.address ?? null;
  const venueChainId = venueAddress ? (venue?.chainId ?? null) : null;

  // Only the pairs a candidate could actually use. A user-supplied override is
  // added as an edge as well, so a route the wallet could not discover is still
  // searchable — discovery failing is the normal case on chains with slow or
  // incomplete public endpoints, and the user still knows their channel.
  const pairs: [string, string][] = [[sourceChainId, destChainId]];
  if (venueChainId && venueChainId !== sourceChainId) {
    pairs.push([sourceChainId, venueChainId]);
  }
  if (venueChainId && venueChainId !== destChainId) {
    pairs.push([venueChainId, destChainId]);
  }
  // The venue's link to the asset's own chain is what names the token the pool
  // sells, even when the user is being paid somewhere else.
  if (
    venueChainId &&
    outputAsset &&
    outputAsset.originChainId !== venueChainId
  ) {
    pairs.push([venueChainId, outputAsset.originChainId]);
  }
  // The typed channels themselves reach the planner through `manualLinks`
  // below, for this request only; nothing a request says is written to the
  // shared route registry.
  for (const override of overrides) {
    if (override.fromChainId && override.toChainId) {
      pairs.push([override.fromChainId, override.toChainId]);
    }
  }

  const discovery = await discoverLinks(pairs, { signal: req.signal });
  const manualLinks: ChannelLink[] = overrides
    .filter((override) => override.fromChainId && override.toChainId)
    .map((override) => ({
      sourceChainId: override.fromChainId as string,
      destChainId: override.toChainId as string,
      channelId: override.channelId,
      port: override.port ?? TRANSFER_PORT,
      ...(override.counterpartyChannelId
        ? { counterpartyChannelId: override.counterpartyChannelId }
        : {}),
      source: "manual" as const,
      state: "unknown" as const,
    }));
  const links = [...manualLinks, ...discovery.links];
  const directory = createChannelDirectory(links);

  // Chains a candidate can touch: everything the graph mentions. That is a
  // handful of ids, not the catalog, so probing them is bounded.
  const graphChainIds = new Set<string>([sourceChainId, destChainId]);
  if (venueChainId) graphChainIds.add(venueChainId);
  for (const link of links) {
    graphChainIds.add(link.sourceChainId);
    graphChainIds.add(link.destChainId);
  }

  const probed = await capabilitiesFor([...graphChainIds], {
    signal: req.signal,
  });

  /**
   * Probe results, with one correction the probe cannot make for itself.
   *
   * The engine's ibc-hooks probe has exactly one route to a `false`: the
   * module's params query is absent AND CosmWasm looks absent. Public gateways
   * routinely answer 501 for both — Keplr's Osmosis LCD answers 501 for
   * `/cosmwasm/wasm/v1/codes` while happily serving
   * `/cosmwasm/wasm/v1/contract/{addr}` — so the probe concludes "Osmosis does
   * not run ibc-hooks", and the plan then carries that as a warning on the one
   * chain where it is certainly false.
   *
   * The venue check has already read the crosschain-swaps contract off this
   * chain, which is direct evidence that CosmWasm is there. That contradicts
   * the only premise the negative rests on, so the negative is dropped back to
   * "unknown" — the engine then says support is *unconfirmed*, which is true,
   * instead of saying it is absent, which is not. A positive probe result is
   * kept; so is an operator's pinned answer, which arrives through the same
   * probe path.
   */
  const capabilities = (chainId: string): ChainCapabilities | undefined => {
    const base = probed(chainId);
    if (!venueAddress || chainId !== venueChainId) return base;
    return {
      ...(base?.pfm === undefined ? {} : { pfm: base.pfm }),
      ...(base?.ibcHooks === true ? { ibcHooks: true } : {}),
      cosmwasm: true,
    };
  };

  const intermediateReceivers = addressesForChains(
    sender,
    source,
    [...graphChainIds]
      .map((id) => findChain(id))
      .filter((chain): chain is (typeof CHAINS)[number] => chain !== undefined),
  );

  const outputDenomResult = await resolveOutputDenom({
    allowSwap,
    venueChainId,
    outputAsset,
    requestedOutputDenom,
    links,
    signal: req.signal,
  });
  const outputDenom = outputDenomResult.denom;

  const venues: SwapVenue[] =
    venueAddress && venueChainId
      ? [
          {
            chainId: venueChainId,
            contractAddress: venueAddress,
            label: findChain(venueChainId)?.chainName ?? venueChainId,
          },
        ]
      : [];

  const slippagePercent =
    typeof body.slippagePercent === "number" && Number.isFinite(body.slippagePercent)
      ? body.slippagePercent
      : undefined;
  const recoveryAddress = str(body.recoveryAddress) || undefined;

  const request: RouteRequest = {
    sourceChainId,
    destChainId,
    inputDenom,
    amount,
    sender,
    recipient,
    ...(outputDenom ? { outputDenom } : {}),
    ...(slippagePercent === undefined ? {} : { slippagePercent }),
    ...(typeof body.maxHops === "number" && Number.isInteger(body.maxHops)
      ? { maxHops: body.maxHops }
      : {}),
    allowSwap,
    allowPfm: true,
    // Never omitted for a swap: with `do_nothing`, funds stranded by a failed
    // final delivery are unrecoverable, and the engine falls back to exactly
    // that when this is absent.
    ...(recoveryAddress ? { recoveryAddress } : {}),
  };

  if (allowSwap && !outputDenom) {
    // A swap with no output denom is not a plan with a warning, it is not a
    // plan. Answering with an empty candidate list plus the reason lets the
    // page disable its control and say exactly what is missing.
    return Response.json({
      ok: true,
      candidates: [],
      warnings: [
        outputDenomResult.reason ??
          "The asset to buy could not be named on the swap venue.",
      ],
      denomStrategy: null,
      outputDenom: null,
      outputDenomReason: outputDenomResult.reason,
      discoveryFailures: discovery.failures satisfies readonly DiscoveryFailure[],
    });
  }

  try {
    const result = await planRoute(
      request,
      {
        registry: chainRegistry,
        channels: directory,
        lcd: lcdFactory,
        resolveDenom: routeDenomResolver(denomResolver),
        capabilities,
        venues,
      },
      {
        overrides,
        intermediateReceivers,
        lcdRequest: { signal: req.signal },
      },
    );

    const candidates = await Promise.all(
      result.candidates.map(async (candidate) => {
        const venueDenom = await venueInputDenomFor(candidate, {
          sourceChainId,
          inputDenom,
          signal: req.signal,
        });
        return {
          id: candidateId(candidate),
          strategy: candidate.strategy,
          score: candidate.score,
          receiver: candidate.receiver,
          requiresQuote: candidate.requiresQuote,
          unwindsDenom: candidate.unwindsDenom,
          unverifiedChannelCount: candidate.unverifiedChannelCount,
          packetHopCount: candidate.packetHopCount,
          venue: candidate.venue
            ? {
                chainId: candidate.venue.chainId,
                chainName:
                  candidate.venue.label ??
                  findChain(candidate.venue.chainId)?.chainName ??
                  candidate.venue.chainId,
                contractAddress: candidate.venue.contractAddress,
              }
            : null,
          venueInputDenom: venueDenom.denom,
          venueDenomReason: venueDenom.reason,
          links: candidate.links.map((link) => ({
            sourceChainId: link.sourceChainId,
            destChainId: link.destChainId,
            channelId: link.channelId,
            port: link.port ?? TRANSFER_PORT,
            counterpartyChannelId: link.counterpartyChannelId,
            counterpartyPortId: link.counterpartyPortId,
            source: link.source ?? "seed",
            state: link.state ?? "unknown",
          })),
          plan: candidate.plan,
        };
      }),
    );

    const denomStrategy = await describeDenomStrategy({
      sourceChainId,
      firstLegChainId: venueChainId && allowSwap ? venueChainId : destChainId,
      inputDenom,
      signal: req.signal,
    });

    return Response.json({
      ok: true,
      candidates,
      warnings: outputDenomResult.reason
        ? [...result.warnings, outputDenomResult.reason]
        : result.warnings,
      denomStrategy,
      outputDenom,
      outputDenomReason: outputDenomResult.reason,
      discoveryFailures: discovery.failures satisfies readonly DiscoveryFailure[],
    });
  } catch (error) {
    return Response.json({
      ok: false,
      code: isInterchainError(error) ? error.code : "server-error",
      message: describeError(error, "The route could not be planned."),
    });
  }
}

/**
 * The denom the swap buys, as denominated on the venue chain.
 *
 * The user picks an asset — "ATOM" — not a denom. On Osmosis that token is a
 * voucher whose hash depends on the channel it arrived over, so it can only be
 * named once that channel is known. `recommendDenom` answers exactly this
 * ("what does a transfer of X from chain A end up being called on chain B?"),
 * so it is asked rather than the hash being recomputed here.
 */
async function resolveOutputDenom(params: {
  readonly allowSwap: boolean;
  readonly venueChainId: string | null;
  readonly outputAsset: OutputAsset | null;
  readonly requestedOutputDenom: string;
  readonly links: readonly ChannelLink[];
  readonly signal?: AbortSignal;
}): Promise<{ denom: string; reason: string | null }> {
  if (params.requestedOutputDenom) {
    return { denom: params.requestedOutputDenom, reason: null };
  }
  if (!params.allowSwap || !params.venueChainId || !params.outputAsset) {
    return { denom: "", reason: null };
  }

  const { originChainId, baseDenom } = params.outputAsset;
  if (originChainId === params.venueChainId) {
    // Native to the venue: no wrapping, no channel to find.
    return { denom: baseDenom, reason: null };
  }

  const venueName = findChain(params.venueChainId)?.chainName ?? params.venueChainId;
  const originName = findChain(originChainId)?.chainName ?? originChainId;
  // The channel on the venue whose other end is the asset's chain: the token
  // arrived on the venue over exactly that end.
  const receiveChannel = params.links.find(
    (link) =>
      link.sourceChainId === params.venueChainId &&
      link.destChainId === originChainId,
  )?.channelId;
  if (!receiveChannel) {
    return {
      denom: "",
      reason: `No transfer channel from ${venueName} to ${originName} was found, so the ${originName} token cannot be named on ${venueName} and the swap cannot be built. Set that channel by hand to continue.`,
    };
  }

  try {
    const recommendation = await denomResolver.recommendDenom(
      originChainId,
      params.venueChainId,
      baseDenom,
      {
        destinationReceiveChannelId: receiveChannel,
        ...(params.signal ? { signal: params.signal } : {}),
      },
    );
    if (!recommendation.outputDenom) {
      return {
        denom: "",
        reason:
          recommendation.warnings[0] ??
          `The ${originName} token could not be named on ${venueName}.`,
      };
    }
    return { denom: recommendation.outputDenom, reason: null };
  } catch (error) {
    return {
      denom: "",
      reason: describeError(
        error,
        `The ${originName} token could not be named on ${venueName}.`,
      ),
    };
  }
}

/**
 * The input denom as it will be denominated on the venue chain.
 *
 * This is what the pool is actually being asked to sell, and neither
 * `RoutePlan` nor `RoutePlanCandidate` exposes it — the engine computes it
 * internally and keeps it. Rather than recompute the trace here, the same
 * question is put to `recommendDenom`, whose `outputDenom` is "the denom the
 * receiver ends up holding" for a transfer to that chain.
 *
 * It needs the channel the venue receives on, which is the counterparty of the
 * hop that lands there. When the route reaches the venue in more than one hop,
 * or when the counterparty is unknown, this returns `null` with a reason. The
 * candidate is then unquotable, which the UI renders as a disabled control
 * carrying that reason — never as a quote for a pair we guessed.
 */
async function venueInputDenomFor(
  candidate: RoutePlanCandidate,
  context: {
    readonly sourceChainId: string;
    readonly inputDenom: string;
    readonly signal?: AbortSignal;
  },
): Promise<{ denom: string | null; reason: string | null }> {
  if (!candidate.venue) return { denom: null, reason: null };

  const toVenue: ChannelLink[] = [];
  for (const link of candidate.links) {
    toVenue.push(link);
    if (link.destChainId === candidate.venue.chainId) break;
  }
  if (toVenue.length === 0) {
    return {
      denom: null,
      reason: "This route does not send a packet to the swap venue.",
    };
  }
  if (toVenue.length > 1) {
    return {
      denom: null,
      reason: `This route reaches ${candidate.venue.chainId} in ${toVenue.length} hops, and the denom arriving there cannot be named without each hop's counterparty channel. Pick a shorter route or set the channels by hand.`,
    };
  }
  const receiveChannel = toVenue[0]?.counterpartyChannelId;
  if (!receiveChannel) {
    return {
      denom: null,
      reason: `The channel ${candidate.venue.chainId} receives on is unknown, so the denom arriving there cannot be named. Enter the counterparty channel to continue.`,
    };
  }

  try {
    const recommendation = await denomResolver.recommendDenom(
      context.sourceChainId,
      candidate.venue.chainId,
      context.inputDenom,
      {
        destinationReceiveChannelId: receiveChannel,
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    if (!recommendation.outputDenom) {
      return {
        denom: null,
        reason:
          recommendation.warnings[0] ??
          "The denom arriving at the swap venue could not be computed.",
      };
    }
    return { denom: recommendation.outputDenom, reason: null };
  } catch (error) {
    return {
      denom: null,
      reason: describeError(
        error,
        "The denom arriving at the swap venue could not be computed.",
      ),
    };
  }
}

/**
 * Why the first leg goes where it goes.
 *
 * Purely explanatory: `planRoute` already handles unwinding itself, and this
 * asks the same engine function for the sentence to show the user. Sending a
 * wrapped token anywhere other than back along its own trace mints a
 * double-wrapped denom no UI can name, so when that is what is happening the
 * user should be told, in those words.
 */
async function describeDenomStrategy(params: {
  readonly sourceChainId: string;
  readonly firstLegChainId: string;
  readonly inputDenom: string;
  readonly signal?: AbortSignal;
}) {
  if (params.sourceChainId === params.firstLegChainId) return null;
  try {
    const recommendation = await denomResolver.recommendDenom(
      params.sourceChainId,
      params.firstLegChainId,
      params.inputDenom,
      params.signal ? { signal: params.signal } : {},
    );
    return {
      strategy: recommendation.strategy,
      inputDenom: recommendation.inputDenom,
      baseDenom: recommendation.baseDenom,
      originChainId: recommendation.originChainId,
      originChainName: recommendation.originChainId
        ? (findChain(recommendation.originChainId)?.chainName ?? null)
        : null,
      originProvenance: recommendation.originProvenance,
      unwindHopCount: recommendation.unwind.length,
      reason: recommendation.reason,
      warnings: recommendation.warnings,
    };
  } catch {
    // Explanatory only. A failed lookup drops the explanation; it never blocks
    // a plan the engine was able to produce.
    return null;
  }
}
