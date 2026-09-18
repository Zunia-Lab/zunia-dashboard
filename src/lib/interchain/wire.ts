/**
 * The JSON contract between `/api/interchain/*` and the browser.
 *
 * Chain reads happen in the route handlers, never in the browser: the dashboard
 * talks to 332 chains' public REST endpoints and sending a visitor's IP to all
 * of them is the same privacy leak `lib/server/chain-reads.ts` was written to
 * avoid. So the engine (`@zunialab/interchain`) runs server-side and the browser
 * receives inert JSON.
 *
 * Two consequences shape this file:
 *
 * 1. Every type here is a structural mirror of an engine type, so a handler can
 *    hand an engine value straight back with no mapping layer to drift. Where a
 *    name differs from the engine's, that is a bug.
 * 2. The browser must not trust the shape it gets back, even from our own
 *    origin — a proxy, an offline service worker or a stale deploy can all put
 *    something else on the wire. Everything is narrowed by the readers below
 *    before a component sees it, and a row that does not narrow is dropped
 *    rather than rendered half-typed.
 *
 * The one thing the browser does NOT take on trust is the memo. `parseMemo()`
 * in `memo-summary.ts` re-derives what the memo does from the memo bytes with
 * the engine's own `validateMemo`, client-side, before the user approves it.
 * The server's prose is never the security control.
 */

import type { InterchainErrorCode, RouteHopKind } from "@zunialab/interchain";

/* -------------------------------------------------------------------------- *
 * Envelope
 * -------------------------------------------------------------------------- */

/**
 * Why a request could not be answered.
 *
 * `code` is the engine's own taxonomy plus three the transport adds. UI copy is
 * keyed off `code`; `message` is a detail line, never the only thing shown.
 */
export type InterchainFailureCode =
  | InterchainErrorCode
  | "bad-request"
  | "not-configured"
  | "server-error";

export interface InterchainFailure {
  readonly ok: false;
  readonly code: InterchainFailureCode;
  readonly message: string;
}

export type InterchainResult<T> = ({ readonly ok: true } & T) | InterchainFailure;

/* -------------------------------------------------------------------------- *
 * Channels
 * -------------------------------------------------------------------------- */

/** Mirrors the engine's `IbcChannelOption`. */
export interface ChannelOptionWire {
  readonly channelId: string;
  readonly portId: string;
  readonly counterpartyChannelId: string;
  readonly counterpartyPortId: string;
  readonly counterpartyChainId: string | null;
  readonly connectionId: string;
  readonly state: ChannelStateWire;
}

/** Mirrors the engine's `IbcChannelState`. */
export type ChannelStateWire =
  | "open"
  | "closed"
  | "init"
  | "tryopen"
  | "unknown";

/** Mirrors the engine's `IbcChannelValidation`. */
export interface ChannelCheckWire {
  readonly ok: boolean;
  readonly state: ChannelStateWire;
  readonly channelId: string;
  readonly portId: string;
  readonly counterpartyChannelId?: string;
  readonly counterpartyChainId?: string | null;
  readonly message: string;
  /** Present only when the destination side was queried too. */
  readonly counterparty?: {
    readonly status: string;
    readonly ok: boolean;
    readonly chainId: string | null;
    readonly channelId: string | null;
    readonly message: string;
  };
}

/** Mirrors the engine's `ChannelLink`. */
export interface ChannelLinkWire {
  readonly sourceChainId: string;
  readonly destChainId: string;
  readonly channelId: string;
  readonly port: string;
  readonly counterpartyChannelId?: string;
  readonly counterpartyPortId?: string;
  readonly source: "verified" | "seed" | "manual";
  readonly state: ChannelStateWire;
}

/* -------------------------------------------------------------------------- *
 * Swap availability
 * -------------------------------------------------------------------------- */

/**
 * Whether this deployment can build a crosschain swap at all.
 *
 * `available` is true only when the contract address is configured AND was
 * found on chain. Both halves matter: the crosschain-swaps address is
 * deployment data, never a constant, and an address that is merely well-formed
 * would send funds to a contract that cannot return them. `reason` is the
 * sentence a disabled control shows, so it names the missing thing.
 */
export interface SwapConfigWire {
  readonly available: boolean;
  readonly chainId: string;
  readonly chainName: string;
  /** Never null when `available`; null when nothing is configured. */
  readonly contractAddress: string | null;
  /** `configured` says the env var is set; `verified` says the chain has it. */
  readonly configured: boolean;
  readonly verified: boolean;
  /** Specific, user-facing, and present whenever `available` is false. */
  readonly reason: string | null;
  /** Where the address must be set, for the operator reading a disabled screen. */
  readonly configKey: string;
  /** True when a quoting router is configured; quotes are unavailable without it. */
  readonly routerConfigured: boolean;
  readonly defaultSlippagePercent: number;
}

/* -------------------------------------------------------------------------- *
 * Balances
 * -------------------------------------------------------------------------- */

/**
 * One spendable balance, with an `ibc/…` denom resolved as far as the chain
 * would tell us.
 *
 * `symbol` is `null` rather than the raw hash when the trace could not be read:
 * a picker showing `ibc/27394FB0…` is honest, one showing a guessed `ATOM` is
 * not.
 */
export interface BalanceWire {
  readonly denom: string;
  readonly amount: string;
  readonly baseDenom: string;
  readonly symbol: string | null;
  readonly decimals: number | null;
  readonly originChainId: string | null;
  readonly originChainName: string | null;
  readonly isIbc: boolean;
  /** Set when the trace lookup failed, so the row can say why it is unnamed. */
  readonly traceError: string | null;
}

/* -------------------------------------------------------------------------- *
 * Route plans
 * -------------------------------------------------------------------------- */

export interface RouteHopWire {
  readonly chainId: string;
  readonly channelId: string;
  readonly port: string;
  readonly counterpartyChainId: string | null;
  readonly kind: RouteHopKind;
}

/** Exactly the engine's `RoutePlan`, so it can be handed back to `trackRoute`. */
export interface RoutePlanWire {
  readonly sourceChainId: string;
  readonly destChainId: string;
  readonly inputDenom: string;
  readonly outputDenom: string;
  readonly hops: readonly RouteHopWire[];
  readonly memo: string;
  readonly warnings: readonly string[];
  readonly estimatedDurationSeconds: number;
  readonly requiresPfm: boolean;
  readonly requiresIbcHooks: boolean;
}

export interface SwapVenueWire {
  readonly chainId: string;
  readonly chainName: string;
  readonly contractAddress: string;
}

/** Mirrors the engine's `RoutePlanCandidate`, plus what the quote step needs. */
export interface PlanCandidateWire {
  /** Stable key for React lists and for "which candidate did the user pick". */
  readonly id: string;
  readonly strategy: string;
  readonly score: number;
  readonly receiver: string;
  readonly requiresQuote: boolean;
  readonly unwindsDenom: boolean;
  readonly unverifiedChannelCount: number;
  readonly packetHopCount: number;
  readonly venue: SwapVenueWire | null;
  /**
   * The input denom as it will be denominated on the venue chain — what the
   * pool is actually being asked to sell.
   *
   * `null` when it could not be derived, which makes the candidate unquotable
   * and therefore unsignable. `venueDenomReason` says why; the UI shows it on
   * the disabled control rather than quoting a pair it made up.
   */
  readonly venueInputDenom: string | null;
  readonly venueDenomReason: string | null;
  readonly links: readonly ChannelLinkWire[];
  readonly plan: RoutePlanWire;
}

/** Mirrors the engine's `DenomRecommendation`, minus the per-step detail. */
export interface DenomStrategyWire {
  readonly strategy: "direct" | "unwind" | "unwind-then-forward" | "unknown";
  readonly inputDenom: string;
  readonly baseDenom: string;
  readonly originChainId: string | null;
  readonly originChainName: string | null;
  readonly originProvenance: string;
  readonly unwindHopCount: number;
  readonly reason: string;
  readonly warnings: readonly string[];
}

export interface PlanResponseBody {
  readonly candidates: readonly PlanCandidateWire[];
  readonly warnings: readonly string[];
  readonly denomStrategy: DenomStrategyWire | null;
  /**
   * The denom the swap buys, as denominated on the venue chain. `null` when it
   * could not be named, which makes the swap unbuildable; `outputDenomReason`
   * then says why and the UI disables the control with it.
   */
  readonly outputDenom: string | null;
  readonly outputDenomReason: string | null;
  /** Chains whose channel discovery failed, so the UI can offer manual entry. */
  readonly discoveryFailures: readonly {
    readonly fromChainId: string;
    readonly toChainId: string;
    readonly message: string;
  }[];
}

export type PlanResponse = InterchainResult<PlanResponseBody>;

/* -------------------------------------------------------------------------- *
 * Quotes
 * -------------------------------------------------------------------------- */

/**
 * Mirrors the engine's `OsmosisSwapQuote`, narrowed to what a UI renders.
 *
 * `priceImpact` and `poolFee` are nullable on purpose: the venue does not
 * always report them, and a confident `0` for "we could not tell" is the exact
 * defect this codebase was audited for.
 */
export interface SwapQuoteWire {
  readonly inputDenom: string;
  readonly inputAmount: string;
  readonly outputDenom: string;
  readonly outputAmount: string;
  readonly minReceived: string;
  readonly slippagePercent: number;
  readonly priceImpact: number | null;
  readonly poolFee: number | null;
  readonly spotPrice: string | null;
  readonly source: string;
  readonly route: readonly { readonly poolId: string; readonly tokenOutDenom: string }[];
  readonly warnings: readonly string[];
  readonly fetchedAt: number;
}

export type QuoteResponse = InterchainResult<{ readonly quote: SwapQuoteWire }>;

/* -------------------------------------------------------------------------- *
 * Tracking
 * -------------------------------------------------------------------------- */

export type PacketStatusWire =
  | "pending"
  | "relayed"
  | "received"
  | "acknowledged"
  | "timeout"
  | "failed"
  | "unknown";

export type PacketFailureWire =
  | "timeout"
  | "ack-error"
  | "stalled"
  | "swap-delivery-failed";

/** Mirrors the engine's `RouteHopTrace`. */
export interface HopTraceWire {
  readonly index: number;
  readonly chainId: string;
  readonly channelId: string;
  readonly port: string;
  readonly counterpartyChainId: string | null;
  readonly kind: RouteHopKind;
  readonly sequence: string | null;
  readonly sendTxHash: string | null;
  readonly receiveTxHash: string | null;
  readonly status: PacketStatusWire;
  readonly error: string | null;
  readonly stalled: boolean;
  readonly fundsRefunded: boolean;
}

/** Mirrors the engine's `RouteTrace`. */
export interface RouteTraceWire {
  readonly sourceChainId: string;
  readonly destChainId: string;
  readonly sourceTxHash: string;
  readonly hops: readonly HopTraceWire[];
  readonly status: PacketStatusWire;
  readonly failure: PacketFailureWire | null;
  readonly stalled: boolean;
  readonly currentHopIndex: number;
  readonly elapsedSeconds: number | null;
  readonly estimatedDurationSeconds: number;
  readonly updatedAt: number;
  readonly notes: readonly string[];
  /**
   * Present only for `swap-delivery-failed`. `msg` being null means the
   * contract address is missing from host config, so the recover button must be
   * disabled with that reason rather than hidden.
   */
  readonly recovery: {
    readonly chainId: string;
    readonly contractAddress: string | null;
    readonly recoveryAddress: string | null;
    readonly ready: boolean;
    readonly executeMsgJson: string;
  } | null;
}

export type TrackResponse = InterchainResult<{ readonly trace: RouteTraceWire }>;

/* -------------------------------------------------------------------------- *
 * Readers
 * -------------------------------------------------------------------------- */

const FAILURE_CODES: ReadonlySet<string> = new Set<InterchainFailureCode>([
  "no-route",
  "invalid-request",
  "channel-closed",
  "lcd-unreachable",
  "unsupported-chain",
  "unsupported-environment",
  "invalid-memo",
  "slippage-exceeded",
  "packet-timeout",
  "contract-error",
  "tx-rejected",
  "malformed-response",
  "reads-disabled",
  "aborted",
  "bad-request",
  "not-configured",
  "server-error",
]);

const CHANNEL_STATES: ReadonlySet<string> = new Set<ChannelStateWire>([
  "open",
  "closed",
  "init",
  "tryopen",
  "unknown",
]);

const HOP_KINDS: ReadonlySet<string> = new Set<RouteHopKind>([
  "transfer",
  "forward",
  "swap",
]);

const PACKET_STATUSES: ReadonlySet<string> = new Set<PacketStatusWire>([
  "pending",
  "relayed",
  "received",
  "acknowledged",
  "timeout",
  "failed",
  "unknown",
]);

const PACKET_FAILURES: ReadonlySet<string> = new Set<PacketFailureWire>([
  "timeout",
  "ack-error",
  "stalled",
  "swap-delivery-failed",
]);

const DENOM_STRATEGIES: ReadonlySet<string> = new Set([
  "direct",
  "unwind",
  "unwind-then-forward",
  "unknown",
]);

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

/** Base-unit integer, or `"0"`. Never a float and never a negative. */
function baseUnits(value: unknown): string {
  return typeof value === "string" && /^\d+$/.test(value) ? value : "0";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readList<T>(value: unknown, read: (row: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const row of value) {
    const parsed = read(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

function channelState(value: unknown): ChannelStateWire {
  return typeof value === "string" && CHANNEL_STATES.has(value)
    ? (value as ChannelStateWire)
    : "unknown";
}

/**
 * Read a failure envelope, or `null` when the body is not one.
 *
 * Exported because every client call funnels through it: a 500 from a proxy and
 * an `{ok:false}` from a handler must reach the UI as the same kind of thing.
 */
export function readFailure(value: unknown): InterchainFailure | null {
  const row = record(value);
  if (!row || row.ok !== false) return null;
  const code = str(row.code);
  return {
    ok: false,
    code: FAILURE_CODES.has(code) ? (code as InterchainFailureCode) : "server-error",
    message: str(row.message, "The request failed and the reason was not reported."),
  };
}

export function readChannelOption(value: unknown): ChannelOptionWire | null {
  const row = record(value);
  if (!row) return null;
  const channelId = optionalStr(row.channelId);
  if (!channelId) return null;
  return {
    channelId,
    portId: str(row.portId, "transfer"),
    counterpartyChannelId: str(row.counterpartyChannelId),
    counterpartyPortId: str(row.counterpartyPortId, "transfer"),
    counterpartyChainId: optionalStr(row.counterpartyChainId),
    connectionId: str(row.connectionId),
    state: channelState(row.state),
  };
}

export function readChannelCheck(value: unknown): ChannelCheckWire | null {
  const row = record(value);
  if (!row) return null;
  const message = optionalStr(row.message);
  if (message === null) return null;
  const counterparty = record(row.counterparty);
  return {
    ok: bool(row.ok),
    state: channelState(row.state),
    channelId: str(row.channelId),
    portId: str(row.portId, "transfer"),
    counterpartyChannelId: optionalStr(row.counterpartyChannelId) ?? undefined,
    counterpartyChainId: optionalStr(row.counterpartyChainId),
    message,
    ...(counterparty
      ? {
          counterparty: {
            status: str(counterparty.status, "skipped"),
            ok: bool(counterparty.ok),
            chainId: optionalStr(counterparty.chainId),
            channelId: optionalStr(counterparty.channelId),
            message: str(counterparty.message),
          },
        }
      : {}),
  };
}

export function readSwapConfig(value: unknown): SwapConfigWire | null {
  const row = record(value);
  if (!row) return null;
  const chainId = optionalStr(row.chainId);
  const configKey = optionalStr(row.configKey);
  if (!chainId || !configKey) return null;
  return {
    available: bool(row.available),
    chainId,
    chainName: str(row.chainName, chainId),
    contractAddress: optionalStr(row.contractAddress),
    configured: bool(row.configured),
    verified: bool(row.verified),
    reason: optionalStr(row.reason),
    configKey,
    routerConfigured: bool(row.routerConfigured),
    defaultSlippagePercent: num(row.defaultSlippagePercent, 1),
  };
}

export function readBalance(value: unknown): BalanceWire | null {
  const row = record(value);
  if (!row) return null;
  const denom = optionalStr(row.denom);
  if (!denom) return null;
  return {
    denom,
    amount: baseUnits(row.amount),
    baseDenom: str(row.baseDenom, denom),
    symbol: optionalStr(row.symbol),
    decimals: optionalNum(row.decimals),
    originChainId: optionalStr(row.originChainId),
    originChainName: optionalStr(row.originChainName),
    isIbc: bool(row.isIbc),
    traceError: optionalStr(row.traceError),
  };
}

function readHop(value: unknown): RouteHopWire | null {
  const row = record(value);
  if (!row) return null;
  const chainId = optionalStr(row.chainId);
  if (!chainId) return null;
  const kind = str(row.kind, "transfer");
  return {
    chainId,
    channelId: str(row.channelId),
    port: str(row.port, "transfer"),
    counterpartyChainId: optionalStr(row.counterpartyChainId),
    kind: HOP_KINDS.has(kind) ? (kind as RouteHopKind) : "transfer",
  };
}

export function readRoutePlan(value: unknown): RoutePlanWire | null {
  const row = record(value);
  if (!row) return null;
  const sourceChainId = optionalStr(row.sourceChainId);
  const destChainId = optionalStr(row.destChainId);
  if (!sourceChainId || !destChainId) return null;
  const hops = readList(row.hops, readHop);
  // A plan with no hops cannot be signed or tracked; treat it as unreadable
  // rather than passing an empty route into a confirm screen.
  if (hops.length === 0) return null;
  return {
    sourceChainId,
    destChainId,
    inputDenom: str(row.inputDenom),
    outputDenom: str(row.outputDenom),
    hops,
    memo: str(row.memo),
    warnings: stringList(row.warnings),
    estimatedDurationSeconds: num(row.estimatedDurationSeconds, 0),
    requiresPfm: bool(row.requiresPfm),
    requiresIbcHooks: bool(row.requiresIbcHooks),
  };
}

function readLink(value: unknown): ChannelLinkWire | null {
  const row = record(value);
  if (!row) return null;
  const sourceChainId = optionalStr(row.sourceChainId);
  const destChainId = optionalStr(row.destChainId);
  const channelId = optionalStr(row.channelId);
  if (!sourceChainId || !destChainId || !channelId) return null;
  const source = str(row.source, "seed");
  return {
    sourceChainId,
    destChainId,
    channelId,
    port: str(row.port, "transfer"),
    counterpartyChannelId: optionalStr(row.counterpartyChannelId) ?? undefined,
    counterpartyPortId: optionalStr(row.counterpartyPortId) ?? undefined,
    source:
      source === "verified" || source === "manual" ? source : "seed",
    state: channelState(row.state),
  };
}

export function readPlanCandidate(value: unknown): PlanCandidateWire | null {
  const row = record(value);
  if (!row) return null;
  const plan = readRoutePlan(row.plan);
  if (!plan) return null;
  const venueRow = record(row.venue);
  const venueChainId = venueRow ? optionalStr(venueRow.chainId) : null;
  const venueContract = venueRow ? optionalStr(venueRow.contractAddress) : null;
  return {
    id: str(row.id, plan.hops.map((hop) => hop.channelId).join(">")),
    strategy: str(row.strategy, "ibc-transfer"),
    score: num(row.score, 0),
    receiver: str(row.receiver),
    requiresQuote: bool(row.requiresQuote),
    unwindsDenom: bool(row.unwindsDenom),
    unverifiedChannelCount: num(row.unverifiedChannelCount, 0),
    packetHopCount: num(row.packetHopCount, plan.hops.length),
    venue:
      venueChainId && venueContract
        ? {
            chainId: venueChainId,
            chainName: str(venueRow?.chainName, venueChainId),
            contractAddress: venueContract,
          }
        : null,
    venueInputDenom: optionalStr(row.venueInputDenom),
    venueDenomReason: optionalStr(row.venueDenomReason),
    links: readList(row.links, readLink),
    plan,
  };
}

function readDenomStrategy(value: unknown): DenomStrategyWire | null {
  const row = record(value);
  if (!row) return null;
  const strategy = str(row.strategy);
  if (!DENOM_STRATEGIES.has(strategy)) return null;
  return {
    strategy: strategy as DenomStrategyWire["strategy"],
    inputDenom: str(row.inputDenom),
    baseDenom: str(row.baseDenom),
    originChainId: optionalStr(row.originChainId),
    originChainName: optionalStr(row.originChainName),
    originProvenance: str(row.originProvenance, "unknown"),
    unwindHopCount: num(row.unwindHopCount, 0),
    reason: str(row.reason),
    warnings: stringList(row.warnings),
  };
}

export function readPlanResponse(value: unknown): PlanResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  if (!row || row.ok !== true) {
    return {
      ok: false,
      code: "malformed-response",
      message: "The route planner answered with something this build cannot read.",
    };
  }
  return {
    ok: true,
    candidates: readList(row.candidates, readPlanCandidate),
    warnings: stringList(row.warnings),
    denomStrategy: readDenomStrategy(row.denomStrategy),
    outputDenom: optionalStr(row.outputDenom),
    outputDenomReason: optionalStr(row.outputDenomReason),
    discoveryFailures: readList(row.discoveryFailures, (entry) => {
      const failRow = record(entry);
      if (!failRow) return null;
      const fromChainId = optionalStr(failRow.fromChainId);
      const toChainId = optionalStr(failRow.toChainId);
      if (!fromChainId || !toChainId) return null;
      return { fromChainId, toChainId, message: str(failRow.message) };
    }),
  };
}

export function readQuote(value: unknown): SwapQuoteWire | null {
  const row = record(value);
  if (!row) return null;
  const outputAmount = optionalStr(row.outputAmount);
  if (outputAmount === null) return null;
  return {
    inputDenom: str(row.inputDenom),
    inputAmount: baseUnits(row.inputAmount),
    outputDenom: str(row.outputDenom),
    outputAmount: baseUnits(outputAmount),
    minReceived: baseUnits(row.minReceived),
    slippagePercent: num(row.slippagePercent, 0),
    priceImpact: optionalNum(row.priceImpact),
    poolFee: optionalNum(row.poolFee),
    spotPrice: optionalStr(row.spotPrice),
    source: str(row.source, "unknown"),
    route: readList(row.route, (entry) => {
      const leg = record(entry);
      const poolId = leg ? optionalStr(leg.poolId) : null;
      if (!poolId) return null;
      return { poolId, tokenOutDenom: str(leg?.tokenOutDenom) };
    }),
    warnings: stringList(row.warnings),
    fetchedAt: num(row.fetchedAt, 0),
  };
}

export function readQuoteResponse(value: unknown): QuoteResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  const quote = row && row.ok === true ? readQuote(row.quote) : null;
  if (!quote) {
    return {
      ok: false,
      code: "malformed-response",
      message: "The quote answered with something this build cannot read.",
    };
  }
  return { ok: true, quote };
}

function readHopTrace(value: unknown): HopTraceWire | null {
  const row = record(value);
  if (!row) return null;
  const chainId = optionalStr(row.chainId);
  if (!chainId) return null;
  const status = str(row.status, "unknown");
  const kind = str(row.kind, "transfer");
  return {
    index: num(row.index, 0),
    chainId,
    channelId: str(row.channelId),
    port: str(row.port, "transfer"),
    counterpartyChainId: optionalStr(row.counterpartyChainId),
    kind: HOP_KINDS.has(kind) ? (kind as RouteHopKind) : "transfer",
    sequence: optionalStr(row.sequence),
    sendTxHash: optionalStr(row.sendTxHash),
    receiveTxHash: optionalStr(row.receiveTxHash),
    status: PACKET_STATUSES.has(status) ? (status as PacketStatusWire) : "unknown",
    error: optionalStr(row.error),
    stalled: bool(row.stalled),
    fundsRefunded: bool(row.fundsRefunded),
  };
}

export function readTraceResponse(value: unknown): TrackResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  const traceRow = row && row.ok === true ? record(row.trace) : null;
  if (!traceRow) {
    return {
      ok: false,
      code: "malformed-response",
      message: "Packet tracking answered with something this build cannot read.",
    };
  }
  const status = str(traceRow.status, "unknown");
  const failureKind = str(traceRow.failure);
  const recoveryRow = record(traceRow.recovery);
  return {
    ok: true,
    trace: {
      sourceChainId: str(traceRow.sourceChainId),
      destChainId: str(traceRow.destChainId),
      sourceTxHash: str(traceRow.sourceTxHash),
      hops: readList(traceRow.hops, readHopTrace),
      status: PACKET_STATUSES.has(status)
        ? (status as PacketStatusWire)
        : "unknown",
      failure: PACKET_FAILURES.has(failureKind)
        ? (failureKind as PacketFailureWire)
        : null,
      stalled: bool(traceRow.stalled),
      currentHopIndex: num(traceRow.currentHopIndex, 0),
      elapsedSeconds: optionalNum(traceRow.elapsedSeconds),
      estimatedDurationSeconds: num(traceRow.estimatedDurationSeconds, 0),
      updatedAt: num(traceRow.updatedAt, 0),
      notes: stringList(traceRow.notes),
      recovery: recoveryRow
        ? {
            chainId: str(recoveryRow.chainId),
            contractAddress: optionalStr(recoveryRow.contractAddress),
            recoveryAddress: optionalStr(recoveryRow.recoveryAddress),
            ready: bool(recoveryRow.ready),
            executeMsgJson: str(recoveryRow.executeMsgJson, "{}"),
          }
        : null,
    },
  };
}

export type TxStatusStateWire = "pending" | "success" | "failed" | "not-found";

/** Mirrors the engine's `TxStatus`. */
export interface TxStatusWire {
  readonly txHash: string;
  readonly state: TxStatusStateWire;
  readonly code: number | null;
  readonly height: string | null;
  readonly rawLog: string | null;
  readonly timestamp: string | null;
}

export type TxStatusResponse = InterchainResult<{
  readonly status: TxStatusWire;
}>;

export function readTxStatusResponse(value: unknown): TxStatusResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  const statusRow = row && row.ok === true ? record(row.status) : null;
  const txHash = statusRow ? optionalStr(statusRow.txHash) : null;
  if (!statusRow || !txHash) {
    return {
      ok: false,
      code: "malformed-response",
      message: "The transaction status answered with something this build cannot read.",
    };
  }
  const state = str(statusRow.state, "not-found");
  return {
    ok: true,
    status: {
      txHash,
      state:
        state === "pending" || state === "success" || state === "failed"
          ? state
          : "not-found",
      code: optionalNum(statusRow.code),
      height: optionalStr(statusRow.height),
      rawLog: optionalStr(statusRow.rawLog),
      timestamp: optionalStr(statusRow.timestamp),
    },
  };
}

export type ChannelsResponse = InterchainResult<{
  readonly channels: readonly ChannelOptionWire[];
}>;

export type ChannelCheckResponse = InterchainResult<{
  readonly check: ChannelCheckWire;
}>;

export type SwapConfigResponse = InterchainResult<{
  readonly config: SwapConfigWire;
}>;

export type BalancesResponse = InterchainResult<{
  readonly balances: readonly BalanceWire[];
  /** Present when some rows could not be named; shown next to the picker. */
  readonly notes: readonly string[];
}>;

export function readChannelsResponse(value: unknown): ChannelsResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  if (!row || row.ok !== true) {
    return {
      ok: false,
      code: "malformed-response",
      message: "Channel discovery answered with something this build cannot read.",
    };
  }
  return { ok: true, channels: readList(row.channels, readChannelOption) };
}

export function readChannelCheckResponse(value: unknown): ChannelCheckResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  const check = row && row.ok === true ? readChannelCheck(row.check) : null;
  if (!check) {
    return {
      ok: false,
      code: "malformed-response",
      message: "The channel check answered with something this build cannot read.",
    };
  }
  return { ok: true, check };
}

export function readSwapConfigResponse(value: unknown): SwapConfigResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  const config = row && row.ok === true ? readSwapConfig(row.config) : null;
  if (!config) {
    return {
      ok: false,
      code: "malformed-response",
      message: "The swap configuration answered with something this build cannot read.",
    };
  }
  return { ok: true, config };
}

export function readBalancesResponse(value: unknown): BalancesResponse {
  const failure = readFailure(value);
  if (failure) return failure;
  const row = record(value);
  if (!row || row.ok !== true) {
    return {
      ok: false,
      code: "malformed-response",
      message: "The balance read answered with something this build cannot read.",
    };
  }
  return {
    ok: true,
    balances: readList(row.balances, readBalance),
    notes: stringList(row.notes),
  };
}
