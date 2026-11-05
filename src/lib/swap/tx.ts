/**
 * The transaction a reviewed swap signs, and the check that runs on it right
 * before the wallet is asked.
 *
 * Ported from zunia-extension SwapScreen.tsx (`swapTxMsgs`, `poolSwapTxMsgs`)
 * @ 1453e7a, built from a frozen review (./review.ts) instead of a planner
 * object. Messages, in order (the extension's, exactly):
 *
 * | path                     | signs on    | msgs[0]                                              | msgs[1]          | msgs[2]             |
 * |--------------------------|-------------|------------------------------------------------------|------------------|---------------------|
 * | contract (funds elsewhere) | From chain | `MsgTransfer` to Skip's entry point, `swap_and_action` memo (./skip.ts) | fee `MsgSend` | — |
 * | pool                     | osmosis-1   | poolmanager swap (single or split route)             | fee `MsgSend`    | —                   |
 * | pool-deliver             | osmosis-1   | poolmanager swap                                     | fee `MsgSend`    | `MsgTransfer` of the floor home |
 *
 * The fee message is left out exactly when no fee is due (no treasury on the
 * signing chain, or an amount too small to carry one), so such a swap signs
 * the bytes it signed before the fee existed.
 *
 * `checkSwapTx` reads the built messages back through ./messages.ts `viewOf`
 * (bytes and amino document must agree) and runs the extension's term checks
 * on them (./checks.ts), plus the price's lifetime. Any problem refuses the
 * signature; run it at click time, not only when the button is drawn.
 */

import { bech32 } from "@scure/base";

import { PACKET_TIMEOUT_MINUTES, SKIP_ENTRY_POINT, SKIP_SWAP_TIMEOUT_MINUTES, SWAP_VENUE_CHAIN_ID } from "@/config/interchain";
import { findChain } from "@/lib/chains";
import type { TxMemoContext, TxMessage } from "@/lib/tx/types";
import {
  poolSwapTermsProblems,
  PRICE_EXPIRED,
  priceExpired,
  readSwapMessage,
  routesOfSplits,
  swapTermsProblems,
} from "@/lib/swap/checks";
import { buildSwapFeeMsg, feeFromWire, feeRateText, type SwapFee, type SwapFeeRecipients } from "@/lib/swap/fee";
import { tickerAmount } from "@/lib/swap/format";
import { shortAddress } from "@/lib/swap/denoms";
import { toTxMessage, viewOf } from "@/lib/swap/messages";
import { signingChainFor } from "@/lib/swap/path";
import { buildPoolSwapMsg, poolRouteText, readPoolSwapMsg, TRANSFER_TYPE_URL } from "@/lib/swap/pool";
import type { SwapReview } from "@/lib/swap/review";
import { buildSkipSwapMemo, skipOperationsOf, type SkipPostSwap } from "@/lib/swap/skip";
import type { MsgJson } from "@/lib/swap/types";

const VENUE = SWAP_VENUE_CHAIN_ID;
const ZERO = BigInt(0);

/** A swap that cannot be built from its review; the message is user-facing. */
export class SwapBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwapBuildError";
  }
}

/** What the wallet is asked to sign. */
export interface SwapTx {
  /** The chain whose account signs (`signingChainFor`). */
  readonly chainId: string;
  readonly messages: TxMessage[];
  /**
   * What names the swap in the transaction body memo, which the sign flow
   * writes (`@/lib/tx/memo`: `Swap OSMO to USDC.n - by Zunia-dashboard`);
   * never a packet memo. See {@link swapMemoContext}.
   */
  readonly memoContext: TxMemoContext;
}

/** Why `address` is not an account on `chainId` (prefix, checksum, length), or `null` when it is. */
export function addressProblem(chainId: string, address: string): string | null {
  const entry = findChain(chainId);
  if (!entry) return `${chainId} is not in this build's chain catalog.`;
  try {
    const decoded = bech32.decodeToBytes(address);
    if (address !== address.toLowerCase()) return `${shortAddress(address)} is not written in lowercase.`;
    if (decoded.prefix !== entry.bech32Prefix) return `${shortAddress(address)} is not an address on ${entry.chainName}.`;
    if (decoded.bytes.length !== 20 && decoded.bytes.length !== 32) return `${shortAddress(address)} is not an account address.`;
    return null;
  } catch {
    return `${shortAddress(address)} is not a valid address.`;
  }
}

/** Nanoseconds since the epoch, `minutes` after `now` (ms), as ICS20 wants a timeout. */
export function timeoutAfter(now: number, minutes: number = PACKET_TIMEOUT_MINUTES): string {
  return (BigInt(Math.floor(now)) * BigInt(1_000_000) + BigInt(minutes) * BigInt(60_000_000_000)).toString();
}

/**
 * The two tokens of a reviewed swap as its messages carry them, for the
 * default memo (`Swap OSMO to ATOM`): the From's denom on the chain that signs
 * (every path sells from there), and the To as the swap buys it on Osmosis,
 * `quote.venueOutputDenom` (delivered elsewhere afterwards, by a transfer or
 * by the contract). Each is named only when the review showed it proven;
 * a message whose denoms are not these names neither.
 */
export function swapMemoContext(review: Pick<SwapReview, "from" | "to" | "quote">): TxMemoContext {
  const { from, to } = review;
  return {
    tokens: [
      { chainId: from.chainId, denom: from.denom, ticker: from.ticker, proven: from.proven === true },
      { chainId: VENUE, denom: review.quote.venueOutputDenom, ticker: to.ticker, proven: to.proven === true },
    ],
  };
}

function feeOrThrow(review: SwapReview): SwapFee {
  const fee = feeFromWire(review.fee);
  if (!fee || fee.net <= ZERO) throw new SwapBuildError("The amount of this review cannot be read, so nothing is built.");
  if (!/^\d+$/.test(review.amountUnits) || fee.fee + fee.net !== BigInt(review.amountUnits)) {
    throw new SwapBuildError("The Zunia fee and the swap do not add up to the amount you reviewed, so nothing is built.");
  }
  return fee;
}

/** The fee's bank send, when one is due, with its card sentence. */
function feeMessage(review: SwapReview, fee: SwapFee): TxMessage | null {
  if (fee.fee <= ZERO || fee.recipient === null) return null;
  const msg = buildSwapFeeMsg({ sender: review.signer, recipient: fee.recipient, denom: review.from.denom, amount: fee.fee });
  return toTxMessage(
    msg,
    `Pay the ${feeRateText(fee.bps)} Zunia fee: ${tickerAmount(fee.fee, review.from)} to ${shortAddress(fee.recipient)}`,
  );
}

/**
 * The transaction a reviewed swap signs. Throws {@link SwapBuildError} with a
 * user-facing sentence when the review cannot make one (a missing address, a
 * quote without the facts its path needs); everything that *is* built is then
 * still checked by {@link checkSwapTx}.
 */
export function buildSwapTx(review: SwapReview, options: { readonly now?: number } = {}): SwapTx {
  const now = options.now ?? Date.now();
  const { quote, from, to } = review;
  if (quote.path !== review.path) throw new SwapBuildError("This review's quote is for another path, so nothing is built.");
  const chainId = signingChainFor(review.path, from.chainId);
  for (const [chain, address] of [
    [chainId, review.signer],
    [to.chainId, review.recipient],
  ] as const) {
    const problem = addressProblem(chain, address);
    if (problem) throw new SwapBuildError(problem);
  }
  const fee = feeOrThrow(review);
  const feeMsg = feeMessage(review, fee);
  const memoContext = swapMemoContext(review);

  if (review.path === "pool" || review.path === "pool-deliver") {
    const routes = routesOfSplits(quote.route.splits);
    if (!quote.minOut) throw new SwapBuildError("This quote has no minimum to sign, so nothing is built.");
    const sold = routes.reduce((sum, route) => sum + BigInt(/^\d+$/.test(route.inAmount) ? route.inAmount : "0"), ZERO);
    if (sold !== fee.net) {
      throw new SwapBuildError("The quoted routes sell another amount than the one you reviewed, so nothing is built.");
    }
    let swap: MsgJson;
    try {
      swap = buildPoolSwapMsg({ sender: review.signer, denom: from.denom, routes, minOut: quote.minOut });
    } catch (error) {
      throw new SwapBuildError(error instanceof Error ? error.message : "The swap could not be built.");
    }
    const messages: TxMessage[] = [
      toTxMessage(
        swap,
        `Swap ${tickerAmount(fee.net, from)} for at least ${tickerAmount(quote.minOut, to)} on Osmosis (${poolRouteText(routes)})`,
      ),
    ];
    if (feeMsg) messages.push(feeMsg);
    if (review.path === "pool-deliver") {
      const delivery = quote.delivery;
      if (!delivery || delivery.destChainId !== to.chainId || delivery.arrivalDenom !== to.denom) {
        throw new SwapBuildError("This quote does not say how the output reaches your address, so nothing is built.");
      }
      const transfer: MsgJson = {
        typeUrl: TRANSFER_TYPE_URL,
        value: {
          source_port: delivery.port,
          source_channel: delivery.channelId,
          token: { denom: quote.venueOutputDenom, amount: quote.minOut },
          sender: review.signer,
          receiver: review.recipient,
          timeout_height: {},
          timeout_timestamp: timeoutAfter(now),
        },
      };
      messages.push(
        toTxMessage(
          transfer,
          `Send ${tickerAmount(quote.minOut, to)} to ${shortAddress(review.recipient)} on ${to.chainName} over ${delivery.channelId}`,
        ),
      );
    }
    return { chainId, messages, memoContext };
  }

  // The contract path: one transfer to Skip's entry point on Osmosis, whose
  // memo swaps along the quoted pools and delivers the output.
  const contract = quote.contract;
  if (!contract || !contract.verified || contract.address !== SKIP_ENTRY_POINT) {
    throw new SwapBuildError("Osmosis's swap contract is not verified for this quote, so nothing is built.");
  }
  if (from.chainId === VENUE) {
    throw new SwapBuildError("Tokens on Osmosis swap in its pools, not through this path, so nothing is built.");
  }
  const recoveryProblem = review.recoveryAddress ? addressProblem(VENUE, review.recoveryAddress) : "missing";
  if (recoveryProblem || !review.recoveryAddress) {
    throw new SwapBuildError("A one-signature swap needs your Osmosis address, where a failed delivery pays out, and this review has none.");
  }
  const inbound = quote.inbound;
  if (!inbound || inbound.sourceChainId !== from.chainId) {
    throw new SwapBuildError("This quote does not say how your tokens reach Osmosis, so nothing is built.");
  }
  if (!quote.minOut) throw new SwapBuildError("This quote has no minimum to sign, so nothing is built.");
  let postSwap: SkipPostSwap;
  if (to.chainId === VENUE) {
    postSwap = { kind: "transfer", toAddress: review.recipient };
  } else {
    const delivery = quote.delivery;
    if (!delivery || delivery.destChainId !== to.chainId || delivery.arrivalDenom !== to.denom || (delivery.port || "transfer") !== "transfer") {
      throw new SwapBuildError("This quote does not say how the output reaches your address, so nothing is built.");
    }
    postSwap = { kind: "ibc-transfer", channelId: delivery.channelId, receiver: review.recipient, recoverAddress: review.recoveryAddress };
  }
  const operations = skipOperationsOf(quote.venueInputDenom, quote.route.pools);
  let swapMsg: MsgJson;
  try {
    const memo = buildSkipSwapMemo({
      entryPoint: contract.address,
      operations,
      minOut: { denom: quote.venueOutputDenom, amount: quote.minOut },
      timeoutNs: timeoutAfter(now, SKIP_SWAP_TIMEOUT_MINUTES),
      postSwap,
    });
    swapMsg = {
      typeUrl: TRANSFER_TYPE_URL,
      value: {
        source_port: inbound.port,
        source_channel: inbound.channelId,
        token: { denom: from.denom, amount: fee.net.toString() },
        sender: review.signer,
        // ibc-hooks runs the call only for a packet addressed to the contract.
        receiver: contract.address,
        timeout_height: {},
        timeout_timestamp: timeoutAfter(now),
        memo,
      },
    };
  } catch (error) {
    throw new SwapBuildError(error instanceof Error && error.message ? error.message : "The swap message could not be built from this review.");
  }
  const where = to.chainId === VENUE ? `on Osmosis to ${shortAddress(review.recipient)}` : `to ${shortAddress(review.recipient)} on ${to.chainName}`;
  const summary = `Swap ${tickerAmount(fee.net, from)} for at least ${tickerAmount(quote.minOut, to)} on Osmosis (${poolRouteText(routesOfSplits(quote.route.splits))}), delivered ${where}`;
  const messages: TxMessage[] = [toTxMessage(swapMsg, summary)];
  if (feeMsg) messages.push(feeMsg);
  return { chainId, messages, memoContext };
}

/**
 * Every reason the transaction must not be signed, in the card's words;
 * empty when `messages` are exactly what the review says. Run right before
 * signing: it also refuses a price past its 20-second lifetime.
 */
export function checkSwapTx(
  review: SwapReview,
  messages: readonly TxMessage[],
  options: {
    readonly now?: number;
    /** The chain the wallet will sign on; must be the review's signing chain. */
    readonly chainId?: string;
    /** The fee treasuries; the compiled-in map unless a test passes its own. */
    readonly recipients?: SwapFeeRecipients;
  } = {},
): string[] {
  const now = options.now ?? Date.now();
  const expected = signingChainFor(review.path, review.from.chainId);
  const chainId = options.chainId ?? expected;
  const problems: string[] = [];
  if (priceExpired(review.quote, now)) problems.push(PRICE_EXPIRED);
  if (chainId !== expected) {
    problems.push(`This swap signs on ${expected}, not on ${chainId}.`);
  }
  if (review.quote.path !== review.path) problems.push("This review's quote is for another path.");
  const signerProblem = addressProblem(expected, review.signer);
  if (signerProblem) problems.push(signerProblem);
  if (messages.length === 0) return [...problems, "There is nothing to sign."];
  const views = messages.map((msg) => viewOf(msg));
  const signing = {
    chainId,
    signerAddress: review.signer,
    msgs: views,
    now,
    ...(options.recipients ? { recipients: options.recipients } : {}),
  };
  if (review.path === "pool" || review.path === "pool-deliver") {
    problems.push(...poolSwapTermsProblems(readPoolSwapMsg(views[0] ?? undefined), review, signing));
  } else {
    problems.push(...swapTermsProblems(readSwapMessage(views[0] ?? undefined), review, signing));
  }
  return problems;
}
