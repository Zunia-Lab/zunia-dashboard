/**
 * Everything a swap transaction does that its review did not say, in the
 * words the confirm card shows. Any problem refuses the signature.
 *
 * Ported from zunia-extension entrypoints/popup/screens/SwapScreen.tsx
 * (`swapFeeProblem`, `poolDeliveryProblems`, `poolSwapTermsProblems`,
 * `PRICE_EXPIRED`) @ 1453e7a, pulled out of the screen into a pure module.
 * The checks read only what ./messages.ts `viewOf` proved the bytes say;
 * nothing is taken from the quote or the plan beside the messages without
 * being compared against them.
 *
 * The one-signature path (`contract`) is a transfer to Skip's entry point on
 * Osmosis whose memo swaps the tokens and delivers the output (./skip.ts).
 * Its check reads that memo strictly (any field the dashboard does not write
 * refuses it) and compares every part with the review: the entry point the
 * server verified, the channel the quote proved, the quoted pools, the
 * reviewed minimum, and the user's own addresses for the output and for a
 * failed delivery. No transfer may carry a block-height timeout, which Zunia
 * never sets (one could send the packet back, and the fee is not refunded
 * with it).
 */

import {
  SKIP_ENTRY_POINT,
  SKIP_SWAP_TIMEOUT_MINUTES,
  QUOTE_TTL_MS,
  SWAP_VENUE_CHAIN_ID,
} from "@/config/interchain";
import { sameDenom, shortAddress, shortDenom } from "@/lib/swap/denoms";
import {
  BANK_SEND_TYPE_URL,
  feeFromWire,
  sameSwapFee,
  swapFeeFor,
  swapFeeIssues,
  type SwapFee,
  type SwapFeeIssue,
  type SwapFeeRecipients,
} from "@/lib/swap/fee";
import { tickerAmount, type AmountLabel } from "@/lib/swap/format";
import {
  hasHeightTimeout,
  readDeliveryTransfer,
  readPoolSwapMsg,
  readTimeoutHeight,
  sameRoutes,
  TRANSFER_TYPE_URL,
  type DeliveryTransferFacts,
  type PoolRoute,
  type PoolSwapFacts,
  type TimeoutHeight,
} from "@/lib/swap/pool";
import type { ReviewSide, SwapReview } from "@/lib/swap/review";
import { readSkipSwapMemo, skipOperationsOf, type SkipSwapParams } from "@/lib/swap/skip";
import { hasExactly, hasOnly, isRecord, type MessageCoin, type MsgJson } from "@/lib/swap/types";
import type { SwapRouteSplit } from "@/lib/swap/wire";

const VENUE = SWAP_VENUE_CHAIN_ID;

/** Said, and signing refused, when the message cannot be read whole. */
export const UNREADABLE_SWAP = "Zunia could not read what this swap message does, so it will not ask you to sign it.";

/** Said, and signing refused, when the transaction carries more than the swap and its fee. */
export const EXTRA_MESSAGES =
  "This transaction carries more than the swap and the Zunia fee, so Zunia will not ask you to sign it.";

/** Said, and signing refused, when the transfer after the swap cannot be read whole. */
export const UNREADABLE_DELIVERY =
  "Zunia could not read the transfer that sends the swap's output on, so it will not ask you to sign it.";

/** Said, and signing refused, when a transfer would also expire at a block height. */
export const HEIGHT_TIMEOUT =
  "The transfer also expires at a block height this review does not show, so it could come back before it is delivered.";

/** Said when a price is too old to sign against. */
export const PRICE_EXPIRED = `This price is more than ${QUOTE_TTL_MS / 1000} seconds old. Refresh it, check it, then sign.`;

/** Whether a reviewed price is older than a quote lives, at `now`. */
export function priceExpired(quote: { readonly expiresAt: number }, now: number): boolean {
  return now >= quote.expiresAt;
}

function label(side: ReviewSide): AmountLabel {
  return { ticker: side.ticker, decimals: side.decimals };
}

/** The label an Osmosis denom reads with: the reviewed side when it is that side's name, else the bare denom. */
function labelForVenueDenom(denom: string, review: SwapReview): AmountLabel {
  if (review.to.osmosisDenom && sameDenom(review.to.osmosisDenom, denom)) return label(review.to);
  if (sameDenom(review.quote.venueOutputDenom, denom)) return label(review.to);
  return { ticker: shortDenom(denom), decimals: null };
}

/* -------------------------------------------------------------------------- *
 * What the signed one-signature message says
 * -------------------------------------------------------------------------- */

/**
 * The swap a one-signature message asks for, read from the message itself:
 * the transfer's fields, and its memo as ./skip.ts reads it. Nothing is
 * looked up or taken from the quote beside it.
 */
export interface SwapMessageFacts {
  /** The transfer's `token`: what leaves the wallet. */
  readonly sold: MessageCoin;
  /** The transfer's `sender`. */
  readonly sender: string;
  /** The transfer's ICS20 receiver. */
  readonly transferReceiver: string;
  /** The transfer's port and channel. */
  readonly transferChannel: { readonly port: string; readonly channelId: string };
  /** The transfer's timeout, ns since the epoch. */
  readonly timeoutTimestamp: string;
  /** The transfer's block-height timeout. */
  readonly timeoutHeight: TimeoutHeight;
  /** The memo: the contract it calls, the pools, the minimum, the deadline, where the output goes. */
  readonly swap: SkipSwapParams;
}

const TRANSFER_FIELDS: ReadonlySet<string> = new Set([
  "source_port",
  "source_channel",
  "token",
  "sender",
  "receiver",
  "timeout_height",
  "timeout_timestamp",
  "memo",
]);

function messageCoin(value: unknown): MessageCoin | null {
  if (!isRecord(value) || !hasExactly(value, ["denom", "amount"])) return null;
  const { denom, amount } = value;
  return typeof denom === "string" && denom !== "" && typeof amount === "string" && /^\d+$/.test(amount)
    ? { denom, amount }
    : null;
}

/**
 * Read what a one-signature message will do: an ICS20 transfer whose memo is
 * exactly a `swap_and_action` call (./skip.ts `readSkipSwapMemo`). `null` for
 * any other message (a contract call, a crosschain-swaps memo, a forward),
 * and for one any part of which cannot be read whole.
 */
export function readSwapMessage(msg: MsgJson | undefined): SwapMessageFacts | null {
  if (!msg || !isRecord(msg.value) || msg.typeUrl !== TRANSFER_TYPE_URL) return null;
  const value = msg.value;
  if (!hasOnly(value, TRANSFER_FIELDS)) return null;
  const sold = messageCoin(value.token);
  const { memo, receiver, sender, source_port: port, source_channel: channelId, timeout_timestamp: timeout } = value;
  if (!sold || typeof memo !== "string" || typeof receiver !== "string" || typeof sender !== "string") return null;
  if (typeof port !== "string" || typeof channelId !== "string" || typeof timeout !== "string" || !/^\d+$/.test(timeout)) {
    return null;
  }
  const timeoutHeight = readTimeoutHeight(value.timeout_height);
  if (!timeoutHeight) return null;
  const swap = readSkipSwapMemo(memo);
  if (!swap) return null;
  return {
    sold,
    sender,
    transferReceiver: receiver,
    transferChannel: { port, channelId },
    timeoutTimestamp: timeout,
    timeoutHeight,
    swap,
  };
}

/* -------------------------------------------------------------------------- *
 * The fee
 * -------------------------------------------------------------------------- */

function feeOf(review: SwapReview): SwapFee | null {
  return feeFromWire(review.fee);
}

/** One way the fee message is not the Zunia fee the review shows, in the card's words. */
export function swapFeeProblem(issue: SwapFeeIssue, review: Pick<SwapReview, "from">): string {
  const { from } = review;
  const amount = (units: string | bigint, denom: string) =>
    tickerAmount(units, denom === from.denom ? label(from) : { ticker: shortDenom(denom), decimals: null });
  switch (issue.kind) {
    case "unreadable":
      return "Zunia could not read the transaction's second message as its fee, so it will not ask you to sign it.";
    case "not-due":
      return `Zunia charges no fee on this swap, yet the transaction pays ${amount(issue.paid.amount, issue.paid.denom)} to ${shortAddress(issue.paid.to)}.`;
    case "missing":
      return `The transaction leaves out the ${amount(issue.due.fee, from.denom)} Zunia fee this review shows.`;
    case "sender":
      return `The Zunia fee would be paid from ${shortAddress(issue.paid.from)}, not from the account signing this swap.`;
    case "recipient":
      return `The Zunia fee would go to ${shortAddress(issue.paid.to)}, which is not Zunia's fee address on ${from.chainName}.`;
    case "denom":
      return `The Zunia fee is paid in ${shortDenom(issue.paid.denom)}, not in the ${from.ticker} you sell.`;
    case "amount":
      return `The Zunia fee is ${amount(issue.paid.amount, issue.paid.denom)}, not the ${amount(issue.due.fee, from.denom)} you reviewed.`;
  }
}

/** The fee half of every path's check: the review's fee is the one charged here, and the bank send pays exactly it. */
function feeProblems(
  review: SwapReview,
  feeMsg: MsgJson | undefined,
  signing: { readonly chainId: string; readonly signerAddress: string; readonly recipients?: SwapFeeRecipients },
): string[] {
  const reviewed = feeOf(review);
  const amountUnits = /^\d+$/.test(review.amountUnits) ? BigInt(review.amountUnits) : null;
  if (!reviewed || amountUnits === null) {
    return ["The Zunia fee in this review cannot be read, so Zunia will not ask you to sign it."];
  }
  const problems: string[] = [];
  // The fee the review shows must be the fee Zunia charges here, worked out
  // again from the configuration; the bank send must pay exactly it.
  const due = swapFeeFor(signing.chainId, amountUnits, signing.recipients);
  if (!sameSwapFee(reviewed, due)) {
    problems.push(
      `The Zunia fee in this review is not the one Zunia charges on ${review.from.chainName}, so Zunia will not ask you to sign it.`,
    );
  }
  const issues = swapFeeIssues(feeMsg, {
    chainId: signing.chainId,
    signer: signing.signerAddress,
    denom: review.from.denom,
    amountUnits,
    ...(signing.recipients ? { recipients: signing.recipients } : {}),
  });
  problems.push(...issues.map((issue) => swapFeeProblem(issue, review)));
  return problems;
}

/* -------------------------------------------------------------------------- *
 * The one-signature path
 * -------------------------------------------------------------------------- */

const NS_PER_MS = BigInt(1_000_000);

/**
 * Everything a one-signature transaction does that the review did not say.
 * Empty when it is exactly the swap transfer and, when a fee is due, the one
 * bank send that pays it:
 *
 * - the transfer spends the reviewed coin from the signer, the amount left
 *   after the fee, over the channel the quote proved, addressed to the entry
 *   point the server verified (ibc-hooks runs the call only then), timing
 *   out in the future and never at a block height;
 * - the memo calls that entry point, swaps along exactly the quoted pools
 *   from the denom the tokens land as, keeps at least the reviewed minimum
 *   of the token picked, stops swapping within the deadline Zunia sets, and
 *   pays the output to this wallet: on Osmosis, or over the delivery channel
 *   the quote proved with this wallet's Osmosis address for a failed hop;
 * - the fee is the one the review shows and the one Zunia charges on the
 *   signing chain;
 * - nothing else: a third message refuses the signature.
 */
export function swapTermsProblems(
  facts: SwapMessageFacts | null,
  review: SwapReview,
  signing: {
    readonly chainId: string;
    readonly signerAddress: string;
    /** Every message the transaction signs, the swap first, as `viewOf` read them. */
    readonly msgs: readonly (MsgJson | null)[];
    readonly recipients?: SwapFeeRecipients;
    readonly now: number;
  },
): string[] {
  if (!facts) return [UNREADABLE_SWAP];
  if (signing.msgs.length > 2) return [EXTRA_MESSAGES];
  const { from, to, quote } = review;
  const fee = feeOf(review);
  const swap = facts.swap;
  const problems: string[] = [];
  if (from.chainId === VENUE) problems.push("Tokens on Osmosis swap in its pools, not through a transfer.");
  if (signing.chainId !== from.chainId || facts.sold.denom !== from.denom) {
    problems.push(`The message spends ${shortDenom(facts.sold.denom)}, not the ${from.ticker} on ${from.chainName} you reviewed.`);
  } else if (!fee || facts.sold.amount !== fee.net.toString()) {
    problems.push(
      `The message spends ${tickerAmount(facts.sold.amount, label(from))}, not the ${fee ? tickerAmount(fee.net, label(from)) : "amount"} you reviewed.`,
    );
  }
  if (facts.sender !== signing.signerAddress) {
    problems.push(`The swap would spend from ${shortAddress(facts.sender)}, not from the account signing it.`);
  }
  const contract = quote.contract;
  if (!contract || !contract.verified || contract.address !== SKIP_ENTRY_POINT || swap.entryPoint !== contract.address) {
    problems.push(`The message calls ${shortAddress(swap.entryPoint)}, not the swap contract Zunia verified on Osmosis.`);
  }
  if (facts.transferReceiver !== swap.entryPoint) {
    problems.push(
      "The transfer is not addressed to the swap contract, so the swap would not run and the tokens would land somewhere else.",
    );
  }
  const inbound = quote.inbound;
  const channel = facts.transferChannel;
  if (!inbound || inbound.sourceChainId !== from.chainId || channel.port !== inbound.port || channel.channelId !== inbound.channelId) {
    problems.push(`The transfer leaves over ${channel.channelId}, not over ${inbound?.channelId ?? "the channel"} Zunia checked.`);
  }
  const nowNs = BigInt(Math.floor(signing.now)) * NS_PER_MS;
  if (BigInt(facts.timeoutTimestamp) <= nowNs) {
    problems.push("The transfer's timeout has already passed, so it would only come back. Refresh the price.");
  }
  if (hasHeightTimeout(facts.timeoutHeight)) problems.push(HEIGHT_TIMEOUT);
  const deadline = BigInt(swap.timeoutNs);
  const latest = nowNs + BigInt(SKIP_SWAP_TIMEOUT_MINUTES + 1) * BigInt(60_000) * NS_PER_MS;
  if (deadline <= nowNs || deadline > latest) {
    problems.push("The swap's deadline is not the one Zunia sets, so Zunia will not ask you to sign it.");
  }
  const expectedOps = skipOperationsOf(quote.venueInputDenom, quote.route.pools);
  const sameOps =
    expectedOps.length === swap.operations.length &&
    expectedOps.every(
      (op, index) =>
        op.pool === swap.operations[index]?.pool &&
        op.denomIn === swap.operations[index]?.denomIn &&
        op.denomOut === swap.operations[index]?.denomOut,
    );
  if (!sameOps || expectedOps.length === 0) {
    problems.push("The swap would go through other pools than the route you reviewed.");
  }
  const expectedOut = to.osmosisDenom ?? quote.venueOutputDenom;
  if (!sameDenom(expectedOut, swap.minOut.denom) || !sameDenom(quote.venueOutputDenom, swap.minOut.denom)) {
    problems.push(`The swap would buy ${shortDenom(swap.minOut.denom)}, not the ${to.ticker} you picked.`);
  } else if (!quote.minOut || swap.minOut.amount !== quote.minOut) {
    const bought = labelForVenueDenom(swap.minOut.denom, review);
    problems.push(
      `The swap's minimum is ${tickerAmount(swap.minOut.amount, bought)}, not the ${tickerAmount(quote.minOut ?? "0", bought)} you reviewed.`,
    );
  }
  const post = swap.postSwap;
  if (to.chainId === VENUE) {
    if (post.kind !== "transfer" || post.toAddress !== review.recipient) {
      const payee = post.kind === "transfer" ? post.toAddress : post.receiver;
      problems.push(`The swap would pay ${shortAddress(payee)}, which is not your address on ${to.chainName}.`);
    }
  } else {
    const delivery = quote.delivery;
    if (post.kind !== "ibc-transfer") {
      problems.push(`The swap would keep the output on Osmosis, not deliver it to ${to.chainName}.`);
    } else {
      if (post.receiver !== review.recipient) {
        problems.push(`The swap would pay ${shortAddress(post.receiver)}, which is not your address on ${to.chainName}.`);
      }
      if (!delivery || delivery.destChainId !== to.chainId || delivery.arrivalDenom !== to.denom || post.channelId !== delivery.channelId) {
        problems.push(`The output would leave Osmosis over ${post.channelId}, not over ${delivery?.channelId ?? "the channel"} Zunia checked.`);
      }
      if (!review.recoveryAddress || post.recoverAddress !== review.recoveryAddress) {
        problems.push(`A failed delivery would pay ${shortAddress(post.recoverAddress)}, which is not your address on Osmosis.`);
      }
    }
  }
  const second = signing.msgs[1];
  if (signing.msgs.length === 2 && second === null) {
    problems.push("Zunia could not read the transaction's second message as its fee, so it will not ask you to sign it.");
  } else {
    problems.push(...feeProblems(review, second ?? undefined, signing));
  }
  return problems;
}

/* -------------------------------------------------------------------------- *
 * Osmosis's own pools
 * -------------------------------------------------------------------------- */

/** The routes a quote's splits make, as poolmanager takes them. */
export function routesOfSplits(splits: readonly SwapRouteSplit[] | undefined): PoolRoute[] {
  return (splits ?? []).map((split) => ({
    hops: split.pools.map((pool) => ({ poolId: pool.id, tokenOutDenom: pool.tokenOutDenom })),
    inAmount: split.inAmount,
  }));
}

/**
 * Everything the transfer after a `pool-deliver` swap does that the review did
 * not say: it must leave the signer, pay this wallet's address on the To's
 * chain, send exactly the swap's floor of the token bought, over the port and
 * channel the quote proved, with no memo, and expire after now.
 */
export function poolDeliveryProblems(
  transfer: DeliveryTransferFacts | null,
  review: SwapReview,
  signing: { readonly signerAddress: string; readonly now: number },
): string[] {
  const delivery = review.quote.delivery;
  if (!transfer || !delivery) return [UNREADABLE_DELIVERY];
  const bought = labelForVenueDenom(review.quote.venueOutputDenom, review);
  const problems: string[] = [];
  if (transfer.sender !== signing.signerAddress) {
    problems.push(`The transfer would leave ${shortAddress(transfer.sender)}, not the account the swap pays.`);
  }
  if (transfer.receiver !== review.recipient) {
    problems.push(`The transfer would pay ${shortAddress(transfer.receiver)}, which is not your address on ${review.to.chainName}.`);
  }
  if (transfer.token.denom !== review.quote.venueOutputDenom) {
    problems.push(`The transfer sends ${shortDenom(transfer.token.denom)}, not the ${review.to.ticker} the swap buys.`);
  } else if (transfer.token.amount !== review.quote.minOut) {
    problems.push(
      `The transfer sends ${tickerAmount(transfer.token.amount, bought)}, not the swap's minimum of ${tickerAmount(review.quote.minOut ?? "0", bought)}.`,
    );
  }
  if (transfer.sourcePort !== (delivery.port || "transfer") || transfer.sourceChannel !== delivery.channelId) {
    problems.push(`The transfer leaves over ${transfer.sourceChannel}, not over ${delivery.channelId}, the channel Zunia checked.`);
  }
  if (delivery.destChainId !== review.to.chainId || delivery.arrivalDenom !== review.to.denom) {
    problems.push(`The transfer would deliver another variant of ${review.to.ticker} than the one you picked.`);
  }
  if (transfer.memo !== "") {
    problems.push("The transfer carries a memo, which a delivery to your own address never needs.");
  }
  if (BigInt(transfer.timeoutTimestamp) <= BigInt(Math.floor(signing.now)) * BigInt(1_000_000)) {
    problems.push("The transfer's timeout has already passed, so it would only come back. Refresh the price.");
  }
  if (hasHeightTimeout(transfer.timeoutHeight)) problems.push(HEIGHT_TIMEOUT);
  return problems;
}

/**
 * Everything a pool swap's transaction does that the review did not say.
 * Empty when the transaction is exactly:
 *
 * - the swap, read from its first message: signed on Osmosis by the account
 *   it spends from, selling the reviewed token, the amount left after the
 *   fee, through the quoted routes, for the reviewed token and floor;
 * - when a fee is due, the one bank send that pays it;
 * - for `pool-deliver`, the one transfer {@link poolDeliveryProblems} accepts;
 *   for `pool`, no transfer, and a review that delivers to the signer itself,
 *   because poolmanager pays the account that signs;
 * - nothing else.
 */
export function poolSwapTermsProblems(
  facts: PoolSwapFacts | null,
  review: SwapReview,
  signing: {
    readonly chainId: string;
    readonly signerAddress: string;
    /** Every message the transaction signs, the swap first, as `viewOf` read them. */
    readonly msgs: readonly (MsgJson | null)[];
    readonly recipients?: SwapFeeRecipients;
    readonly now: number;
  },
): string[] {
  if (!facts) return [UNREADABLE_SWAP];
  // The swap, then the fee when there is a bank send, then the transfer when
  // delivering. Anything left over is a message nobody reviewed.
  const rest = signing.msgs.slice(1);
  if (rest.some((msg) => msg === null)) return [EXTRA_MESSAGES];
  const readable = rest as MsgJson[];
  const feeMsg = readable[0]?.typeUrl === BANK_SEND_TYPE_URL ? readable[0] : undefined;
  const afterFee = feeMsg ? readable.slice(1) : readable;
  const transferMsg = review.path === "pool-deliver" ? afterFee[0] : undefined;
  if (afterFee.length > (review.path === "pool-deliver" ? 1 : 0)) return [EXTRA_MESSAGES];

  const { from, to, quote } = review;
  const fee = feeOf(review);
  const problems: string[] = [];
  if (signing.chainId !== VENUE || from.chainId !== VENUE) {
    problems.push(`A swap in Osmosis's pools signs on Osmosis, and this one would sign on ${signing.chainId}.`);
  }
  if (facts.sender !== signing.signerAddress) {
    problems.push(`The swap would spend from ${shortAddress(facts.sender)}, not from the account signing it.`);
  }
  if (facts.sold.denom !== from.denom) {
    problems.push(`The message spends ${shortDenom(facts.sold.denom)}, not the ${from.ticker} on ${from.chainName} you reviewed.`);
  } else if (!fee || facts.sold.amount !== fee.net.toString()) {
    problems.push(
      `The message spends ${tickerAmount(facts.sold.amount, label(from))}, not the ${fee ? tickerAmount(fee.net, label(from)) : "amount"} you reviewed.`,
    );
  }
  const expected = to.osmosisDenom;
  if (facts.outputDenom !== quote.venueOutputDenom || (expected !== null && !sameDenom(expected, facts.outputDenom))) {
    problems.push(`The swap would buy ${shortDenom(facts.outputDenom)}, not the ${to.ticker} you picked.`);
  }
  const bought = labelForVenueDenom(facts.outputDenom, review);
  if (facts.minOut !== quote.minOut) {
    problems.push(
      `The swap's minimum is ${tickerAmount(facts.minOut, bought)}, not the ${tickerAmount(quote.minOut ?? "0", bought)} you reviewed.`,
    );
  }
  if (!sameRoutes(facts.routes, routesOfSplits(quote.route.splits))) {
    problems.push("The swap would go through other pools, or other amounts, than the route you reviewed.");
  }
  if (review.path === "pool") {
    if (review.recipient !== signing.signerAddress) {
      problems.push(
        `Osmosis pays a swap to the account that signs it, not to ${shortAddress(review.recipient)}, where this review delivers.`,
      );
    }
  } else {
    problems.push(...poolDeliveryProblems(readDeliveryTransfer(transferMsg), review, signing));
  }
  problems.push(...feeProblems(review, feeMsg, signing));
  return problems;
}

/** Re-export for the module that runs the right check per path. */
export { readPoolSwapMsg };
