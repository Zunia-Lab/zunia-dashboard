/**
 * What a token on another chain is called on Osmosis, and the one IBC hop
 * that carries it there or brings it back, proved on chain.
 *
 * A swap row is an exact denom on one chain. Osmosis trades vouchers whose
 * names depend on the channel they arrived over, so before a contract path
 * sends funds in, or a pool path sends the output on, the server proves the
 * pairing between `(chain C, denom D)` and `(Osmosis, denom V)`:
 *
 * - **D native on C** (`uatom`, `inj`, Injective's `erc20:0xa00C…`): V must be
 *   the voucher Osmosis minted for D over one channel whose other end is C.
 *   Proof: V's denom trace on Osmosis, hash-verified by the engine
 *   (`resolveDenom`), is exactly `transfer/channel-Y` + base D, and channel-Y
 *   is open with C's client behind it. Sending V back over channel-Y delivers
 *   exactly D (`unwind`); sending D over the other end lands as V (`wrap`).
 * - **D a voucher on C of an Osmosis token** (OSMO held on the Hub): D's trace
 *   on C must be one hop back to Osmosis; V is its base. Sending D back
 *   unwinds to V; sending V out over the channel lands exactly D.
 * - Anything else (a voucher on C of a third chain's token) needs a route
 *   through that chain, which Zunia does not sign behind a swap: refused with
 *   that reason.
 *
 * Where V comes from: the side's own Osmosis denom (a held Osmosis row), a
 * hint from the browser's identity rows, token identity's `osmosisDenom`, or
 * (case two) the trace. Whatever the source, the proof above runs before it
 * is used, so a hint can only ever be confirmed or refused.
 *
 * Both ends of the channel are checked (open, pointing at each other's
 * chain), and both light clients' status: `Active` passes, `Expired` or
 * `Frozen` refuses, unreadable passes as `unconfirmed` and is said.
 *
 * Proofs are cached five minutes (30 s when the check could not run).
 */

import "server-only";

import { isInterchainError, type IbcChannelCheck } from "@zunialab/interchain";

import { SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { cached } from "@/lib/server/cache";
import { findServerChain } from "@/lib/server/chains";
import { channelService, denomResolver } from "@/lib/server/interchain";
import { restLcd } from "@/lib/server/swap/lcd";
import { DENOM, ibcDenomOf, sameDenom } from "@/lib/swap/denoms";
import { notTradedReason } from "@/lib/swap/xcs";
import { isRecord } from "@/lib/swap/types";

const VENUE = SWAP_VENUE_CHAIN_ID;
const PORT = "transfer";
const PROOF_TTL_MS = 5 * 60_000;

/** A side of the swap that is not on Osmosis. */
export interface RemoteSide {
  readonly chainId: string;
  readonly denom: string;
  /** The ticker, for the sentences this module writes. */
  readonly ticker: string;
  /** Candidate Osmosis denom (hint or identity); proved before use. */
  readonly candidate?: string | null;
}

/** One IBC hop between Osmosis and another chain, proved on both ends. */
export interface ProvenHop {
  readonly remoteChainId: string;
  /** The remote chain's end. */
  readonly remoteChannelId: string;
  /** Osmosis's end. */
  readonly venueChannelId: string;
  readonly port: string;
  /** `active` when both light clients answered Active; `unconfirmed` when one could not be read. */
  readonly clientStatus: "active" | "unconfirmed";
}

/** The pairing between a remote denom and its Osmosis name. */
export interface Pairing {
  readonly venueDenom: string;
  /** `remote-native`: D is native on C and V its voucher. `venue-native`: D is a voucher on C of V. */
  readonly relation: "remote-native" | "venue-native";
  readonly hop: ProvenHop;
}

export type PairingResult =
  | { readonly ok: true; readonly pairing: Pairing }
  | {
      readonly ok: false;
      readonly code: "venue-denom-unknown" | "not-traded" | "variant-mismatch" | "unsupported-route" | "channel-refused" | "unchecked";
      readonly message: string;
    };

class ProofFailure extends Error {
  readonly result: Extract<PairingResult, { ok: false }>;
  constructor(result: Extract<PairingResult, { ok: false }>) {
    super(result.message);
    this.name = "ProofFailure";
    this.result = result;
  }
}

function fail(code: Extract<PairingResult, { ok: false }>["code"], message: string): never {
  throw new ProofFailure({ ok: false, code, message });
}

function chainName(chainId: string): string {
  return findServerChain(chainId)?.chainName ?? chainId;
}

const UNCHECKED = (what: string) =>
  `Zunia could not check ${what} right now, so the swap stays unsigned. Try again in a moment.`;

/** A transient read failure (timeout, 5xx), as opposed to the chain answering no. */
function transient(error: unknown): boolean {
  if (!isInterchainError(error)) return true;
  if (error.code === "aborted") return true;
  const status = error.httpStatus;
  return error.code === "lcd-unreachable" && (status === undefined || status >= 500 || status === 429);
}

/** The status of the light client behind `channelId` on `chainId`: `Active`, something else, or `null` when unreadable. */
async function clientStatusOf(chainId: string, channelId: string): Promise<string | null> {
  const lcd = restLcd(chainId, { timeoutMs: 6_000 });
  if (!lcd) return null;
  try {
    const state = await lcd.getJson(
      `/ibc/core/channel/v1/channels/${encodeURIComponent(channelId)}/ports/${PORT}/client_state`,
    );
    const identified = isRecord(state) && isRecord(state.identified_client_state) ? state.identified_client_state : null;
    const clientId = identified && typeof identified.client_id === "string" ? identified.client_id : null;
    if (!clientId || !/^[0-9a-z-]{3,64}$/.test(clientId)) return null;
    const status = await lcd.getJson(`/ibc/core/client/v1/client_status/${encodeURIComponent(clientId)}`);
    return isRecord(status) && typeof status.status === "string" ? status.status : null;
  } catch {
    return null;
  }
}

async function validated(source: string, channelId: string, dest: string): Promise<IbcChannelCheck> {
  try {
    return await channelService.validateIbcChannel(source, channelId, dest, { portId: PORT });
  } catch (error) {
    if (transient(error)) fail("unchecked", UNCHECKED(`${channelId} on ${chainName(source)}`));
    fail("channel-refused", `${channelId} on ${chainName(source)} could not be confirmed as an open channel to ${chainName(dest)}.`);
  }
}

/**
 * Prove the channel pair (`venueChannelId` on Osmosis, its counterparty on
 * `remoteChainId`): open on both ends, each pointing at the other chain and
 * at each other, and both light clients not expired or frozen.
 */
async function proveHop(remoteChainId: string, venueChannelId: string, remoteChannelHint?: string): Promise<ProvenHop> {
  const onVenue = await validated(VENUE, venueChannelId, remoteChainId);
  if (onVenue.state === "unknown" && !onVenue.ok) {
    fail("unchecked", UNCHECKED(`${venueChannelId} on Osmosis`));
  }
  if (!onVenue.ok || onVenue.counterpartyChainId !== remoteChainId || !onVenue.counterpartyChannelId) {
    fail(
      "channel-refused",
      `${venueChannelId} on Osmosis is not an open channel to ${chainName(remoteChainId)}, so Zunia will not send through it.`,
    );
  }
  const remoteChannelId = onVenue.counterpartyChannelId;
  if (remoteChannelHint && remoteChannelHint !== remoteChannelId) {
    fail(
      "channel-refused",
      `${chainName(remoteChainId)}'s ${remoteChannelHint} is not the other end of Osmosis's ${venueChannelId}, so Zunia will not send through it.`,
    );
  }
  const onRemote = await validated(remoteChainId, remoteChannelId, VENUE);
  if (onRemote.state === "unknown" && !onRemote.ok) {
    fail("unchecked", UNCHECKED(`${remoteChannelId} on ${chainName(remoteChainId)}`));
  }
  if (!onRemote.ok || onRemote.counterpartyChainId !== VENUE || onRemote.counterpartyChannelId !== venueChannelId) {
    fail(
      "channel-refused",
      `${remoteChannelId} on ${chainName(remoteChainId)} does not lead back to Osmosis's ${venueChannelId}, so Zunia will not send through it.`,
    );
  }
  const [venueClient, remoteClient] = await Promise.all([
    clientStatusOf(VENUE, venueChannelId),
    clientStatusOf(remoteChainId, remoteChannelId),
  ]);
  for (const [status, where] of [
    [venueClient, `Osmosis's light client of ${chainName(remoteChainId)}`],
    [remoteClient, `${chainName(remoteChainId)}'s light client of Osmosis`],
  ] as const) {
    if (status !== null && status !== "Active") {
      fail("channel-refused", `${where} is ${status.toLowerCase()}, so a transfer over this channel would only come back.`);
    }
  }
  return {
    remoteChainId,
    remoteChannelId,
    venueChannelId,
    port: PORT,
    clientStatus: venueClient === "Active" && remoteClient === "Active" ? "active" : "unconfirmed",
  };
}

/** Resolve a denom's trace through the engine (hash-verified), mapping failures to proof results. */
async function traceOf(chainId: string, denom: string, what: string) {
  try {
    return await denomResolver.resolveDenom(chainId, denom);
  } catch (error) {
    if (transient(error)) fail("unchecked", UNCHECKED(what));
    return null;
  }
}

async function prove(side: RemoteSide): Promise<Pairing> {
  const { chainId, denom, ticker } = side;
  const candidate = side.candidate && DENOM.test(side.candidate) ? side.candidate : null;

  if (denom.startsWith("ibc/")) {
    // Case two: a voucher on C. Only a voucher of an Osmosis token, one hop
    // back, has an Osmosis name Zunia can sign towards.
    const onRemote = await traceOf(chainId, denom, `what ${ticker} is on ${chainName(chainId)}`);
    if (!onRemote) fail("venue-denom-unknown", `Zunia cannot tell what ${ticker} on ${chainName(chainId)} is, so it will not swap it.`);
    const firstHopChain = onRemote.hopChainIds[0] ?? null;
    if (onRemote.hops.length !== 1 || firstHopChain !== VENUE) {
      fail(
        "unsupported-route",
        `${ticker} on ${chainName(chainId)} has to go back to the chain it came from before it can reach Osmosis. Send it there first, then swap.`,
      );
    }
    const venueDenom = onRemote.baseDenom;
    if (candidate && !sameDenom(candidate, venueDenom)) {
      fail("variant-mismatch", `Zunia would trade a different variant than the ${ticker} you picked, so the swap stays unsigned.`);
    }
    const remoteChannelId = onRemote.hops[0]?.channelId ?? "";
    const check = await validated(chainId, remoteChannelId, VENUE);
    if (!check.ok || !check.counterpartyChannelId) {
      fail("channel-refused", `${remoteChannelId} on ${chainName(chainId)} is not an open channel to Osmosis.`);
    }
    const hop = await proveHop(chainId, check.counterpartyChannelId, remoteChannelId);
    return { venueDenom, relation: "venue-native", hop };
  }

  // Case one: D native on C; its Osmosis voucher must be named first.
  if (!candidate) {
    fail("venue-denom-unknown", `Zunia cannot name ${ticker} on Osmosis yet, so it will not swap it.`);
  }
  if (!candidate.startsWith("ibc/")) {
    fail("variant-mismatch", `Zunia would trade a different variant than the ${ticker} you picked, so the swap stays unsigned.`);
  }
  const onVenue = await traceOf(VENUE, candidate, `what ${ticker} is called on Osmosis`);
  if (!onVenue) fail("not-traded", notTradedReason(ticker));
  // `resolveDenom` already refused a trace that does not hash back to the denom.
  const hopChain = onVenue.hopChainIds[0] ?? null;
  if (onVenue.hops.length !== 1 || hopChain !== chainId || onVenue.baseDenom !== denom) {
    fail("variant-mismatch", `Zunia would trade a different variant than the ${ticker} you picked, so the swap stays unsigned.`);
  }
  const venueChannelId = onVenue.hops[0]?.channelId ?? "";
  // Belt and braces: the name is exactly what that channel mints for D.
  if (!sameDenom(ibcDenomOf(`${PORT}/${venueChannelId}`, denom), candidate)) {
    fail("variant-mismatch", `Zunia would trade a different variant than the ${ticker} you picked, so the swap stays unsigned.`);
  }
  const hop = await proveHop(chainId, venueChannelId);
  return { venueDenom: candidate, relation: "remote-native", hop };
}

/**
 * The proved pairing between a remote side and its Osmosis name, or why
 * there is none. Never throws; cached per `(chain, denom, candidate)`.
 */
export async function pairRemoteSide(side: RemoteSide): Promise<PairingResult> {
  const key = `swap:pair:${side.chainId}:${side.denom}:${side.candidate ?? ""}`;
  try {
    const pairing = await cached(key, { ttlMs: PROOF_TTL_MS, staleMs: 0, errorTtlMs: 30_000 }, () => prove(side));
    return { ok: true, pairing };
  } catch (error) {
    if (error instanceof ProofFailure) return error.result;
    return { ok: false, code: "unchecked", message: UNCHECKED(`the route for ${side.ticker}`) };
  }
}
