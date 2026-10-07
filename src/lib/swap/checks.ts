/**
 * Everything a swap transaction does that its review did not say, in the
 * words the confirm card shows. Any problem refuses the signature.
 *
 * Ported from zunia-extension entrypoints/popup/screens/SwapScreen.tsx
 * (`readSwapMessage`, `swapFeeProblem`, `swapTermsProblems`,
 * `poolDeliveryProblems`, `poolSwapTermsProblems`, `PRICE_EXPIRED`) @ 1453e7a,
 * pulled out of the screen into a pure module. The checks read only what
 * ./messages.ts `viewOf` proved the bytes say; nothing is taken from the quote
 * or the plan beside the messages without being compared against them.
 * Additions over the extension, because the dashboard builds the transfer
 * itself rather than from a plan object: a contract-path transfer must leave
 * over the channel the quote proved, from the signer, with a timeout still in
 * the future; the contract-path memo must carry the reviewed tolerance; and no
 * transfer may carry a block-height timeout, which Zunia never sets (one could
 * send the packet back, and a contract path's fee is not refunded with it).
 */

import {
  isWasmHookReceiverValid,
  validateMemo,
  type ForwardHopInfo,
  type ForwardMemoInfo,
  type XcsSwapInfo,
} from "@zunialab/interchain";

import { QUOTE_TTL_MS, SWAP_VENUE_CHAIN_ID, TWAP_WINDOW_SECONDS } from "@/config/interchain";
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
import { EXECUTE_CONTRACT_TYPE_URL } from "@/lib/swap/messages";
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
 * What the signed contract-path message says
 * -------------------------------------------------------------------------- */

/**
 * The swap a contract-path message asks for, read from the message itself.
 * Every field is copied out of the message; nothing is looked up or taken
 * from the quote beside it.
 */
export interface SwapMessageFacts {
  /** `contract-call`: one `MsgExecuteContract` on Osmosis. `transfer`: an ICS20 transfer whose memo calls it. */
  readonly via: "contract-call" | "transfer";
  /** What leaves the wallet: the call's one `funds` coin, or the transfer's `token`. */
  readonly sold: MessageCoin;
  /** The account the message spends from: the call's `sender`, the transfer's `sender`. */
  readonly sender: string;
  /** The crosschain-swaps contract the swap runs in. */
  readonly contract: string;
  /** The transfer's ICS20 receiver; `null` for a contract call. */
  readonly transferReceiver: string | null;
  /** The transfer's port and channel; `null` for a contract call. */
  readonly transferChannel: { readonly port: string; readonly channelId: string } | null;
  /** The transfer's timeout, ns since the epoch; `null` for a contract call. */
  readonly timeoutTimestamp: string | null;
  /** The transfer's block-height timeout; `null` for a contract call. */
  readonly timeoutHeight: TimeoutHeight | null;
  /** Packet-forward hops before the swap, in order; a transfer's only. */
  readonly forwardsIn: readonly ForwardHopInfo[];
  /** The `osmosis_swap` fields: what it buys, whom it pays, its tolerance and its failure action. */
  readonly swap: XcsSwapInfo;
  /** Where `next_memo` forwards the output after the swap, when it does. */
  readonly forwardsOut: ForwardMemoInfo | null;
  /** What the engine's memo classifier flagged. */
  readonly warnings: readonly string[];
}

/**
 * The `osmosis_swap` fields the card reads and shows, and the ones a TWAP
 * tolerance has. Any other (a pinned pool `route`, a field a later contract
 * adds) could change what the contract does without being shown, so a
 * message carrying one is not read at all.
 */
const SWAP_FIELDS: ReadonlySet<string> = new Set(["output_denom", "slippage", "receiver", "on_failed_delivery", "next_memo"]);
const TWAP_FIELDS: ReadonlySet<string> = new Set(["slippage_percentage", "window_seconds"]);
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

function onlyFields(value: unknown, fields: ReadonlySet<string>): boolean {
  return isRecord(value) && Object.keys(value).every((key) => fields.has(key));
}

function messageCoin(value: unknown): MessageCoin | null {
  if (!isRecord(value) || !hasExactly(value, ["denom", "amount"])) return null;
  const { denom, amount } = value;
  return typeof denom === "string" && denom !== "" && typeof amount === "string" && /^\d+$/.test(amount)
    ? { denom, amount }
    : null;
}

/**
 * The swap part of a memo, through the engine's own classifier
 * (`validateMemo`): the crosschain swap, the forwards before it, and the
 * forward `next_memo` asks for after it. `null` unless every part reads whole.
 */
function readXcs(
  memo: string,
  receiver?: string,
): Pick<SwapMessageFacts, "contract" | "forwardsIn" | "swap" | "forwardsOut" | "warnings"> | null {
  const inspection = validateMemo(memo, receiver === undefined ? {} : { receiver });
  const { xcs: swap, wasm } = inspection;
  if (inspection.kind !== "xcs" || !swap || !wasm) return null;
  const body = wasm.msg.osmosis_swap;
  if (!isRecord(body) || !onlyFields(body, SWAP_FIELDS)) return null;
  const twap = isRecord(body.slippage) ? body.slippage.twap : undefined;
  if (twap !== undefined && !onlyFields(twap, TWAP_FIELDS)) return null;
  const next = body.next_memo;
  const warnings = [...inspection.warnings];
  let forwardsOut: ForwardMemoInfo | null = null;
  if (next !== undefined && next !== null) {
    if (!isRecord(next)) return null;
    const after = validateMemo(JSON.stringify(next));
    if (after.kind !== "forward" || !after.forward || after.forward.hasNextMemo) return null;
    forwardsOut = after.forward;
    warnings.push(...after.warnings);
  }
  return { contract: swap.contract, forwardsIn: inspection.forward?.hops ?? [], swap, forwardsOut, warnings };
}

/** What `text` parses to, only when serializing that gives back `text` exactly (no duplicate keys, no stray whitespace). */
function canonicalJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return JSON.stringify(parsed) === text ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read what a contract-path message will do: a contract call's `msg` (funds
 * already on Osmosis), or a transfer's packet memo. `null` for any other
 * message, and for one any part of which cannot be read whole.
 */
export function readSwapMessage(msg: MsgJson | undefined): SwapMessageFacts | null {
  if (!msg || !isRecord(msg.value)) return null;
  const value = msg.value;
  if (msg.typeUrl === EXECUTE_CONTRACT_TYPE_URL) {
    if (!hasExactly(value, ["sender", "contract", "msg", "funds"])) return null;
    const { sender, contract, funds, msg: body } = value;
    if (typeof sender !== "string" || sender === "" || typeof contract !== "string" || contract === "") return null;
    // The contract takes exactly one coin: that coin is what is sold.
    if (!Array.isArray(funds) || funds.length !== 1) return null;
    const sold = messageCoin(funds[0]);
    if (!sold || !isRecord(body)) return null;
    // Read as the `{wasm:{contract,msg}}` an inbound packet would carry, so one classifier reads both paths.
    const read = readXcs(JSON.stringify({ wasm: { contract, msg: body } }));
    return read
      ? {
          via: "contract-call",
          sold,
          sender,
          transferReceiver: null,
          transferChannel: null,
          timeoutTimestamp: null,
          timeoutHeight: null,
          ...read,
        }
      : null;
  }
  if (msg.typeUrl === TRANSFER_TYPE_URL) {
    if (!hasOnly(value, TRANSFER_FIELDS)) return null;
    const sold = messageCoin(value.token);
    const { memo, receiver, sender, source_port: port, source_channel: channelId, timeout_timestamp: timeout } = value;
    if (!sold || typeof memo !== "string" || typeof receiver !== "string" || typeof sender !== "string") return null;
    if (typeof port !== "string" || typeof channelId !== "string" || typeof timeout !== "string" || !/^\d+$/.test(timeout)) {
      return null;
    }
    const timeoutHeight = readTimeoutHeight(value.timeout_height);
    if (!timeoutHeight) return null;
    if (canonicalJson(memo) === undefined) return null;
    const read = readXcs(memo, receiver);
    return read
      ? {
          via: "transfer",
          sold,
          sender,
          transferReceiver: receiver,
          transferChannel: { port, channelId },
          timeoutTimestamp: timeout,
          timeoutHeight,
          ...read,
        }
      : null;
  }
  return null;
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
 * The contract path
 * -------------------------------------------------------------------------- */

/**
 * Everything a contract-path transaction does that the review did not say.
 * Empty when it is exactly the swap message and, when a fee is due, the one
 * bank send that pays it:
 *
 * - the swap spends the reviewed coin from the signer, and the amount left
 *   after the fee; calls the contract the venue check verified (a transfer
 *   addressed to it, over the channel the quote proved, timing out in the
 *   future); buys the reviewed token; pays this wallet's own address; and sets
 *   this wallet's recovery address;
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
  const problems: string[] = [];
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
  if (!contract || !contract.verified || facts.contract !== contract.address) {
    problems.push(`The message calls ${shortAddress(facts.contract)}, not the swap contract Zunia verified on Osmosis.`);
  }
  if (facts.via === "transfer") {
    // ibc-hooks runs the call only when the packet reaching Osmosis is
    // addressed to the contract; anything else just delivers the tokens there.
    const lands = facts.forwardsIn[facts.forwardsIn.length - 1]?.receiver ?? facts.transferReceiver ?? "";
    if (!isWasmHookReceiverValid(lands, facts.contract)) {
      problems.push(
        "The transfer is not addressed to the swap contract, so the swap would not run and the tokens would land somewhere else.",
      );
    }
    const inbound = quote.inbound;
    const channel = facts.transferChannel;
    if (!inbound || !channel || channel.port !== inbound.port || channel.channelId !== inbound.channelId || facts.forwardsIn.length > 0) {
      problems.push(
        `The transfer leaves over ${channel?.channelId ?? "another channel"}, not over ${inbound?.channelId ?? "the channel"} Zunia checked.`,
      );
    }
    if (!facts.timeoutTimestamp || BigInt(facts.timeoutTimestamp) <= BigInt(Math.floor(signing.now)) * BigInt(1_000_000)) {
      problems.push("The transfer's timeout has already passed, so it would only come back. Refresh the price.");
    }
    if (!facts.timeoutHeight || hasHeightTimeout(facts.timeoutHeight)) problems.push(HEIGHT_TIMEOUT);
  } else if (from.chainId !== VENUE) {
    problems.push("A contract call spends funds on Osmosis, and these are on another chain.");
  }
  const expected = to.osmosisDenom ?? quote.venueOutputDenom;
  if (!sameDenom(expected, facts.swap.outputDenom) || !sameDenom(quote.venueOutputDenom, facts.swap.outputDenom)) {
    problems.push(`The contract would buy ${shortDenom(facts.swap.outputDenom)}, not the ${to.ticker} you picked.`);
  }
  const payee = facts.forwardsOut?.finalReceiver ?? facts.swap.receiver;
  if (payee !== review.recipient) {
    problems.push(`The swap would pay ${shortAddress(payee)}, which is not your address on ${to.chainName}.`);
  } else if (facts.forwardsOut) {
    // The dashboard never builds a forward after the swap: the delivery is
    // the contract's own one hop. A forward here is something nobody reviewed.
    problems.push(`On the way, the swap would pay ${shortAddress(facts.swap.receiver)} and forward from there, which this review does not show.`);
  }
  // The tolerance is part of what was reviewed: the dashboard always signs the
  // TWAP rule at the reviewed percentage over the standard window.
  const slippage = facts.swap.slippage;
  if (
    slippage.kind !== "twap" ||
    Number(slippage.slippagePercentage) !== review.slippagePercent ||
    slippage.windowSeconds !== TWAP_WINDOW_SECONDS
  ) {
    problems.push(`The swap's price protection is not the ${review.slippagePercent}% tolerance you reviewed.`);
  }
  const failed = facts.swap.onFailedDelivery;
  if (failed.kind !== "local_recovery_addr") {
    problems.push("The swap sets no recovery address, so output stranded by a failed delivery could never be claimed back.");
  } else if (!review.recoveryAddress || failed.address !== review.recoveryAddress) {
    problems.push(`The recovery address ${shortAddress(failed.address)} is not your address on Osmosis.`);
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
