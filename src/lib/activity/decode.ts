/**
 * A transaction as the activity list and the transaction detail show it.
 *
 * Input is what a public LCD returns: a `tx_responses[i]` row of a tx search,
 * or the `{tx, tx_response}` body of `GET /cosmos/tx/v1beta1/txs/{hash}`.
 * Output is the `ActivityItem` / `TxDetail` contract of ./types.
 *
 * Ported in part from zunia-extension lib/chain-queries.ts @ 1453e7a
 * (`fetchActivity`'s row assembly, `parseTxDetail`, `pickMessage`), with four
 * changes the dashboard needs:
 *
 * - amounts are what the chain moved for the account (`coin_spent` /
 *   `coin_received`), so an IBC receipt shows the voucher actually credited
 *   and a swap the output actually paid, after taker fees;
 * - the fee is attributed: `feePaid` is true only for the account that paid
 *   it, so "fees paid" never counts a sender's fee on a transfer you received;
 * - a row is chosen by rank across all messages the account is party to
 *   (./describe `RANK`), and a second meaningful message is mentioned
 *   ("…and sent 3.43 USDC to inj1… on Injective");
 * - an authz MsgExec someone else signed for the account (a compounding bot)
 *   is read per inner message, so the row says what was done for the account
 *   ("…acted for you: claimed 1,947 SAF in rewards and commission") and its
 *   kind is that action's (`claim`), not a generic "authz".
 *
 * Pure: identities, channel peers and the treasury table come in through the
 * context.
 */

import { explorerTxUrl } from "@/config/interchain";
import { shortenAddress } from "@/lib/format";
import type { TokenIdentity } from "@/lib/token/types";
import {
  RANK,
  coinsWords,
  continueSentence,
  execOf,
  ics20Data,
  isSwapTx,
  readMessage,
  typeUrlOf,
  type ChannelPeer,
  type MessageReading,
  type ReadContext,
} from "./describe";
import {
  allEvents,
  asRecord,
  attr,
  feePayerOf,
  flowsFor,
  inbound,
  listCoins,
  messageCoins,
  messageEvents,
  outbound,
  parseCoins,
  text,
  txOf,
  txResponseOf,
  unitKey,
  withoutFee,
  withoutPassThrough,
  type AddressFlows,
  type Coin,
  type EventSource,
  type Flows,
  type TxEvent,
} from "./events";
import { cleanText } from "./clean";
import { sanitizeJson } from "./sanitize";
import type {
  ActivityAmount,
  ActivityFee,
  ActivityIbc,
  ActivityItem,
  TxDetail,
  TxEventCount,
  TxMovement,
  TxPacket,
  TxPacketStage,
} from "./types";

export type { ChannelPeer };

export interface DecodeContext {
  chainId: string;
  identify: (denom: string) => TokenIdentity;
  /** Zunia treasuries by chain id; config/fees.ts unless a test passes its own. */
  feeRecipients?: Readonly<Record<string, string>>;
  /** Synchronous channel → chain lookup (the canonical channel table). */
  channelPeer?: (channel: string) => ChannelPeer | null;
}

const MEMO_MAX = 256;
const RAW_LOG_MAX = 400;
const MAX_MOVEMENTS = 100;
const MAX_PACKETS = 20;
const MAX_EVENT_TYPES = 60;
const MAX_DENOMS = 200;
/** Messages read per transaction; a batch of thousands is summarised, not walked. */
const MAX_MESSAGES = 100;

interface ParsedTx {
  response: Record<string, unknown>;
  hash: string;
  height: number;
  time: string;
  code: number;
  codespace: string;
  rawLog: string;
  messages: Record<string, unknown>[];
  /** All messages in the body, even past {@link MAX_MESSAGES}. */
  messageCount: number;
  memo: string;
  feeRecord: Record<string, unknown> | null;
  feeCoins: Coin[];
  gasUsed: number | null;
  gasWanted: number | null;
  /** Every event, ante handler included. */
  events: TxEvent[];
  /** What the messages emitted (./events `messageEvents`), and how that was told apart. */
  msgEvents: TxEvent[];
  eventSource: EventSource;
}

function integer(value: unknown): number | null {
  const raw = text(value);
  return /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

/** Parsed once per body: `denomsOf` and `decodeActivity` read the same search row back to back. */
const PARSED = new WeakMap<object, ParsedTx | null>();

function parseTx(raw: unknown): ParsedTx | null {
  if (typeof raw !== "object" || raw === null) return null;
  const known = PARSED.get(raw);
  if (known !== undefined) return known;
  const parsed = readTx(raw);
  PARSED.set(raw, parsed);
  return parsed;
}

function readTx(raw: object): ParsedTx | null {
  const response = txResponseOf(raw);
  const tx = txOf(raw);
  if (!response) return null;
  const hash = text(response.txhash).toUpperCase();
  const height = integer(response.height);
  const time = text(response.timestamp);
  if (!/^[0-9A-F]{64}$/.test(hash) || height === null || !Number.isFinite(Date.parse(time))) return null;
  const body = asRecord(tx?.body);
  const feeRecord = asRecord(asRecord(tx?.auth_info)?.fee);
  const code = typeof response.code === "number" ? response.code : (integer(response.code) ?? 0);
  const allMessages = Array.isArray(body?.messages) ? body.messages : [];
  const { events: msgEvents, source } = messageEvents(response);
  return {
    response,
    hash,
    height,
    time,
    code,
    codespace: text(response.codespace),
    rawLog: text(response.raw_log),
    messages: allMessages
      .slice(0, MAX_MESSAGES)
      .map(asRecord)
      .filter((message): message is Record<string, unknown> => message !== null),
    messageCount: allMessages.length,
    memo: text(body?.memo),
    feeRecord,
    feeCoins: messageCoins(feeRecord?.amount),
    gasUsed: integer(response.gas_used),
    gasWanted: integer(response.gas_wanted),
    events: allEvents(response),
    msgEvents,
    eventSource: source,
  };
}

function feeOf(coin: Coin | undefined, identify: (denom: string) => TokenIdentity): ActivityFee | null {
  if (!coin) return null;
  const identity = identify(coin.denom);
  return {
    amount: coin.amount,
    denom: coin.denom,
    symbol: identity.ticker,
    ...(identity.decimals !== null ? { decimals: identity.decimals } : {}),
    key: identity.key,
  };
}

/** Party fields of a message, for transactions whose events do not name a signer. */
const SIGNER_FIELDS = ["signer", "sender", "from_address", "delegator_address", "voter", "granter", "grantee", "proposer", "depositor"];

function guessSigner(messages: readonly Record<string, unknown>[]): string | null {
  const first = messages[0];
  if (!first) return null;
  for (const field of SIGNER_FIELDS) {
    const value = text(first[field]);
    if (value) return value;
  }
  return null;
}

function emptyFlows(): AddressFlows {
  return { total: new Map(), byMessage: new Map(), byUnit: new Map() };
}

/** What the messages moved for `address`; nothing for a failed transaction (it only paid its fee). */
function addressFlows(tx: ParsedTx, address: string, feePaid: boolean): AddressFlows {
  if (tx.code !== 0) return emptyFlows();
  const flows = flowsFor(tx.msgEvents, address);
  // Only a flat, unattributed event list still holds the fee transfer.
  if (tx.eventSource === "flat" && feePaid) withoutFee(flows.total, tx.feeCoins[0] ?? null);
  return flows;
}

function mergeFlows(parts: Array<Flows | undefined>): Flows {
  const out: Flows = new Map();
  for (const part of parts) {
    if (!part) continue;
    for (const [denom, flow] of part) {
      const current = out.get(denom) ?? { in: BigInt(0), out: BigInt(0) };
      out.set(denom, { in: current.in + flow.in, out: current.out + flow.out });
    }
  }
  return out;
}

/** A message reading plus which flows it read, so flows two readings share are counted once. */
interface Unit {
  reading: MessageReading;
  /** `"total"`, `"<msg>"` or `"<msg>:<inner>"` (./events `unitKey`). */
  flowKey: string;
}

/**
 * Every message read for `address`, an authz MsgExec someone else signed for
 * the account replaced by its inner messages (each with its own coins when
 * the node attributes them with `authz_msg_index`, else the MsgExec's).
 */
function unitsOf(tx: ParsedTx, address: string, base: ReadContext, flows: AddressFlows, signer: string | null): Unit[] {
  const attributed = tx.eventSource !== "flat";
  const units: Unit[] = [];
  tx.messages.forEach((message, index) => {
    const own = attributed ? flows.byMessage.get(index) : flows.total;
    const ownKey = attributed ? unitKey(index) : "total";
    const exec = execOf(message);
    if (exec && exec.grantee !== address) {
      const split =
        attributed && tx.msgEvents.some((event) => event.msgIndex === index && event.authzIndex !== null && event.authzIndex !== undefined);
      const inner = exec.msgs
        .map((msg, i): Unit => {
          const key = split ? unitKey(index, i) : ownKey;
          const reading = readMessage(msg, index, { ...base, attributed: split, execDepth: 1 }, split ? flows.byUnit.get(key) : own, signer);
          return { reading: { ...reading, via: exec.grantee }, flowKey: key };
        })
        .filter((unit) => unit.reading.involves);
      if (inner.length > 0) {
        units.push(...inner);
        return;
      }
    }
    units.push({ reading: readMessage(message, index, { ...base, attributed }, own, signer), flowKey: ownKey });
  });
  return units;
}

function flowsByKey(flows: AddressFlows, key: string): Flows | undefined {
  if (key === "total") return flows.total;
  return flows.byUnit.get(key) ?? (/^\d+$/.test(key) ? flows.byMessage.get(Number(key)) : undefined);
}

interface Perspective {
  readings: MessageReading[];
  principal: MessageReading;
  /** The account is a party to the transaction or saw coins move. */
  involved: boolean;
  flows: AddressFlows;
  feePaid: boolean;
  signed: boolean;
  summary: string;
}

function perspective(tx: ParsedTx, address: string, ctx: DecodeContext): Perspective {
  const { payer, signer: reportedSigner } = feePayerOf(tx.feeRecord, tx.events);
  const signer = reportedSigner ?? guessSigner(tx.messages);
  const feePaid = payer !== null ? payer === address : signer === address;
  const flows = addressFlows(tx, address, feePaid);
  const base: ReadContext = {
    chainId: ctx.chainId,
    address,
    identify: ctx.identify,
    swapTx: isSwapTx(tx.messages),
    ...(ctx.feeRecipients ? { feeRecipients: ctx.feeRecipients } : {}),
    ...(ctx.channelPeer ? { channelPeer: ctx.channelPeer } : {}),
  };
  const units = unitsOf(tx, address, base, flows, signer);
  const readings = units.map((unit) => unit.reading);
  const involvedUnits = units.filter((unit) => unit.reading.involves);
  let principal = involvedUnits.reduce<MessageReading | null>(
    (best, unit) => (best === null || unit.reading.rank < best.rank ? unit.reading : best),
    null,
  );
  const words = (coins: readonly Coin[]) => coinsWords(coins, ctx.identify);

  if (principal === null) {
    // The account shows up only through coin movements (a contract or a
    // module paid it inside someone else's transaction), or as the payer of
    // someone else's fee (a fee grant).
    const received = inbound(flows.total);
    const spent = outbound(flows.total);
    const first = readings[0];
    const index = first?.index ?? 0;
    const typeUrl = first?.typeUrl ?? "";
    const type = first?.type ?? "Unknown message";
    if (received.length > 0) {
      const from = transferSenderTo(tx.msgEvents, address);
      const tail = from ? ` from ${shortenAddress(from)}` : "";
      principal = {
        index, typeUrl, type,
        kind: "receive", involves: true, rank: RANK.receive,
        done: `Received ${words(received)}${tail}`, attempt: `receive ${words(received)}${tail}`,
        ...(from ? { counterparty: from } : {}),
      };
    } else if (spent.length > 0) {
      principal = {
        index, typeUrl, type,
        kind: "send", involves: true, rank: RANK.send,
        done: `Sent ${words(spent)}`, attempt: `send ${words(spent)}`,
      };
    } else if (payer === address && signer !== null && signer !== address) {
      const whose = `${shortenAddress(signer)}'s transaction`;
      principal = {
        index, typeUrl, type,
        kind: "other", involves: true, rank: RANK.other,
        done: `Paid the network fee for ${whose}`, attempt: `pay the network fee for ${whose}`,
        counterparty: signer,
      };
    } else {
      principal = first ?? {
        index: 0, typeUrl: "", type: "Unknown message",
        kind: "other", involves: false, rank: RANK.other,
        done: "Transaction", attempt: "run a transaction",
      };
    }
  }

  let done = principal.done;
  let attempt = principal.attempt;
  const main = principal;
  const others = involvedUnits
    .map((unit) => unit.reading)
    .filter((reading) => reading !== main && reading.rank < RANK.fee && !(main.kind === "claim" && reading.kind === "claim"));

  if (principal.kind === "claim") {
    const claims = involvedUnits.filter((unit) => unit.reading.kind === "claim");
    const validators = new Set(
      claims.filter((unit) => !unit.reading.commission && unit.reading.validator).map((unit) => unit.reading.validator as string),
    );
    const commission = claims.some((unit) => unit.reading.commission);
    const rewards = validators.size > 0;
    // Flows two claims share (an unattributed MsgExec) are counted once.
    const keys = [...new Set(claims.map((unit) => unit.flowKey))];
    const coins = inbound(mergeFlows(keys.map((key) => flowsByKey(flows, key))));
    const amount = coins.length > 0 ? words(coins) : null;
    const what = rewards && commission ? "rewards and commission" : commission ? "commission" : "rewards";
    const from =
      rewards && !commission
        ? validators.size === 1
          ? ` from ${shortenAddress([...validators][0])}`
          : ` from ${validators.size} validators`
        : "";
    done = amount ? `Claimed ${amount} in ${what}${from}` : `Claimed ${what}${from}`;
    attempt = `claim ${what}${from}`;
  }

  if (tx.code === 0 && others.length === 1) {
    done = `${done} and ${continueSentence(others[0].done)}`;
  } else if (tx.code === 0 && others.length > 1) {
    done = `${done} (+${others.length} more)`;
  }

  let summary = tx.code === 0 ? done : `Failed to ${attempt}`;
  if (principal.via) {
    const who = shortenAddress(principal.via);
    summary = tx.code === 0 ? `${who} acted for you: ${continueSentence(done)}` : `${who} failed to ${attempt} for you`;
  }

  return {
    readings,
    principal,
    involved: involvedUnits.length > 0 || flows.total.size > 0 || signer === address || payer === address,
    flows,
    feePaid,
    signed: signer === address,
    summary,
  };
}

/** The sender of the first `transfer` a message made to `address` (fee transfers never pay an account). */
function transferSenderTo(events: readonly TxEvent[], address: string): string | null {
  for (const event of events) {
    if (event.type !== "transfer") continue;
    let recipient: string | null = null;
    let sender: string | null = null;
    for (const attribute of event.attributes) {
      if (attribute.key === "recipient") recipient = attribute.value;
      else if (attribute.key === "sender") sender = attribute.value;
      if (recipient === address && sender) return sender;
    }
  }
  return null;
}

/**
 * Sequence and destination channel of the packet a MsgTransfer sent
 * (`send_packet`). Matched by message index where the node attributes
 * events; otherwise the k-th MsgTransfer on a channel is the k-th packet
 * sent on it (a batch of transfers must not all claim the first sequence).
 */
function sentPacketFacts(tx: ParsedTx, reading: MessageReading, ibc: ActivityIbc): ActivityIbc {
  if (ibc.sequence || !ibc.sourceChannel) return ibc;
  const channel = ibc.sourceChannel;
  const sends = tx.msgEvents.filter((event) => event.type === "send_packet" && attr(event, "packet_src_channel") === channel);
  let event: TxEvent | undefined;
  if (tx.eventSource !== "flat") {
    event = sends.find((candidate) => candidate.msgIndex === reading.index);
  } else {
    const ordinal = tx.messages
      .slice(0, reading.index)
      .filter((message) => typeUrlOf(message).endsWith(".MsgTransfer") && text(message.source_channel) === channel).length;
    event = sends[ordinal];
  }
  if (!event) return ibc;
  const sequence = attr(event, "packet_sequence");
  const destChannel = attr(event, "packet_dst_channel");
  return { ...ibc, ...(sequence ? { sequence } : {}), ...(destChannel ? { destChannel } : {}) };
}

/**
 * The row's amounts: each unit's movements (a message, or an authz MsgExec's
 * inner message) without its own pass-through denoms, then summed per denom
 * and direction. Netting per unit keeps a swap's intermediate hop out while a
 * claim-then-delegate of the same 8.67 OSMO still shows both legs.
 */
function amountsOf(flows: AddressFlows, identify: (denom: string) => TokenIdentity): ActivityAmount[] {
  const effective =
    flows.byUnit.size > 0 ? mergeFlows([...flows.byUnit.values()].map(withoutPassThrough)) : withoutPassThrough(flows.total);
  return [
    ...listCoins(effective, "out").map((coin) => ({ direction: "out" as const, denom: coin.denom, amount: coin.amount, identity: identify(coin.denom) })),
    ...listCoins(effective, "in").map((coin) => ({ direction: "in" as const, denom: coin.denom, amount: coin.amount, identity: identify(coin.denom) })),
  ];
}

function itemFor(tx: ParsedTx, address: string, ctx: DecodeContext, view: Perspective): ActivityItem {
  const { principal } = view;
  const withIbc = principal.ibc ? principal : view.readings.find((reading) => reading.involves && reading.ibc);
  const ibc = withIbc?.ibc ? sentPacketFacts(tx, withIbc, withIbc.ibc) : undefined;
  const memo = cleanText(tx.memo, MEMO_MAX);
  const explorerUrl = explorerTxUrl(ctx.chainId, tx.hash);
  return {
    chainId: ctx.chainId,
    address,
    hash: tx.hash,
    height: tx.height,
    time: tx.time,
    kind: principal.kind,
    success: tx.code === 0,
    summary: view.summary,
    fee: feeOf(tx.feeCoins[0], ctx.identify),
    feePaid: view.feePaid,
    signed: view.signed,
    amounts: amountsOf(view.flows, ctx.identify),
    ...(principal.counterparty ? { counterparty: principal.counterparty } : {}),
    ...(memo ? { memo } : {}),
    ...(ibc && Object.keys(ibc).length > 0 ? { ibc } : {}),
    messages: tx.messageCount,
    primaryType: principal.type,
    ...(principal.proposalId ? { proposalId: principal.proposalId } : {}),
    ...(principal.via ? { via: principal.via } : {}),
    ...(explorerUrl ? { explorerUrl } : {}),
  };
}

/**
 * One activity row for `address`, or null when the body is not a
 * transaction. Every row a search returns names the account somewhere, so a
 * row is always produced for a well-formed transaction; one the account is
 * not visibly party to reads neutrally (kind `other`).
 */
export function decodeActivity(raw: unknown, address: string, ctx: DecodeContext): ActivityItem | null {
  const tx = parseTx(raw);
  if (!tx) return null;
  return itemFor(tx, address, ctx, perspective(tx, address, ctx));
}

/**
 * Denoms worth identifying before decoding: the fee, coins in message bodies
 * (amounts, swap routes) and, with an address, every coin that account
 * received or spent; without one, every coin a `transfer` event moved.
 */
export function denomsOf(raw: unknown, address?: string): string[] {
  const tx = parseTx(raw);
  if (!tx) return [];
  const out = new Set<string>();
  for (const coin of tx.feeCoins) out.add(coin.denom);
  const budget = { nodes: MAX_DENOM_WALK };
  for (const message of tx.messages) collectMessageDenoms(message, out, 0, budget);
  if (address) {
    for (const denom of flowsFor(tx.events, address).total.keys()) out.add(denom);
  } else {
    for (const event of tx.events) {
      if (event.type !== "transfer") continue;
      for (const coin of parseCoins(attr(event, "amount"))) out.add(coin.denom);
      if (out.size >= MAX_DENOMS) break;
    }
  }
  return [...out].slice(0, MAX_DENOMS);
}

const DENOM_FIELDS = new Set(["denom", "token_out_denom", "token_in_denom"]);
/** Values visited per transaction looking for denoms; nested authz batches are not walked whole. */
const MAX_DENOM_WALK = 5_000;

function collectMessageDenoms(value: unknown, out: Set<string>, depth: number, budget: { nodes: number }) {
  budget.nodes -= 1;
  if (depth > 6 || out.size >= MAX_DENOMS || budget.nodes < 0) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectMessageDenoms(item, out, depth + 1, budget);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (DENOM_FIELDS.has(key) && typeof child === "string" && /^[a-zA-Z][a-zA-Z0-9/:._-]{1,127}$/.test(child)) {
      out.add(child);
    } else if (typeof child === "object" && child !== null && key !== "packet" && key !== "client_message" && key !== "header") {
      collectMessageDenoms(child, out, depth + 1, budget);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* One transaction, in full                                                    */
/* -------------------------------------------------------------------------- */

function eventCounts(events: readonly TxEvent[]): TxEventCount[] {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  return [...counts].slice(0, MAX_EVENT_TYPES).map(([type, count]) => ({ type, count }));
}

function movementsOf(events: readonly TxEvent[], identify: (denom: string) => TokenIdentity): TxMovement[] {
  const out: TxMovement[] = [];
  for (const event of events) {
    if (event.type !== "transfer") continue;
    let recipient = "";
    let sender = "";
    let amount: string | undefined;
    const flush = () => {
      if (!recipient || !sender || amount === undefined) return;
      for (const coin of parseCoins(amount)) {
        if (out.length >= MAX_MOVEMENTS) return;
        out.push({ msgIndex: event.msgIndex, from: sender, to: recipient, denom: coin.denom, amount: coin.amount, identity: identify(coin.denom) });
      }
      amount = undefined;
    };
    for (const attribute of event.attributes) {
      if (attribute.key === "recipient") recipient = attribute.value;
      else if (attribute.key === "sender") sender = attribute.value;
      else if (attribute.key === "amount") amount = attribute.value;
      if (recipient && sender && amount !== undefined) flush();
    }
    if (out.length >= MAX_MOVEMENTS) break;
  }
  return out;
}

function hexToUtf8(hex: string): string | null {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex) || hex.length > 200_000) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function packetJson(event: TxEvent): Record<string, unknown> | null {
  const plain = attr(event, "packet_data");
  const raw = plain || hexToUtf8(attr(event, "packet_data_hex") ?? "") || "";
  if (!raw.trim().startsWith("{") || raw.length > 100_000) return null;
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

const PACKET_STAGES: Readonly<Record<string, TxPacketStage>> = {
  send_packet: "send",
  recv_packet: "receive",
  acknowledge_packet: "acknowledge",
  timeout_packet: "timeout",
};

function packetsOf(tx: ParsedTx, ctx: DecodeContext): TxPacket[] {
  const out: TxPacket[] = [];
  const seen = new Set<string>();
  const events = tx.msgEvents;
  for (const event of events) {
    const stage = PACKET_STAGES[event.type];
    if (!stage) continue;
    const sequence = attr(event, "packet_sequence") ?? "";
    const sourceChannel = attr(event, "packet_src_channel") ?? "";
    const destChannel = attr(event, "packet_dst_channel") ?? "";
    if (!sequence || !sourceChannel) continue;
    const key = `${stage}|${sequence}|${sourceChannel}|${destChannel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const local = stage === "receive" ? destChannel : sourceChannel;
    const peer = local ? (ctx.channelPeer?.(local) ?? null) : null;
    const data = ics20Data(packetJson(event));
    let ack: TxPacket["ack"];
    if (stage === "receive") {
      const written = events.find(
        (candidate) =>
          candidate.type === "write_acknowledgement" &&
          attr(candidate, "packet_sequence") === sequence &&
          attr(candidate, "packet_dst_channel") === destChannel,
      );
      const result = written ? attr(written, "packet_ack") : undefined;
      if (result?.includes('"error"')) ack = "error";
      else if (result?.includes('"result"')) ack = "success";
    } else if (stage === "acknowledge" && event.msgIndex !== null) {
      // The ICS20 outcome of this acknowledgement is the `fungible_token_packet`
      // event of the same message. Without message attribution a relayer's
      // batch cannot be paired, so no outcome is claimed.
      const outcome = events.find(
        (candidate) =>
          candidate.type === "fungible_token_packet" &&
          candidate.msgIndex === event.msgIndex &&
          (attr(candidate, "error") !== undefined || attr(candidate, "success") !== undefined),
      );
      if (outcome) ack = attr(outcome, "error") !== undefined ? "error" : "success";
    }
    const timeoutTimestamp = attr(event, "packet_timeout_timestamp");
    out.push({
      stage,
      sequence,
      sourcePort: attr(event, "packet_src_port") ?? "transfer",
      sourceChannel,
      destPort: attr(event, "packet_dst_port") ?? "transfer",
      destChannel,
      ...(peer ? { counterpartyChainId: peer.chainId } : {}),
      ...(data?.denom ? { denom: data.denom } : {}),
      ...(data?.amount ? { amount: data.amount } : {}),
      ...(data?.sender ? { sender: data.sender } : {}),
      ...(data?.receiver ? { receiver: data.receiver } : {}),
      ...(data?.memo ? { memo: data.memo } : {}),
      ...(ack ? { ack } : {}),
      ...(timeoutTimestamp && timeoutTimestamp !== "0" ? { timeoutTimestamp } : {}),
    });
    if (out.length >= MAX_PACKETS) break;
  }
  return out;
}

/**
 * The full read of one transaction. Messages are read neutrally ("Sent 12.5
 * OSMO from osmo1… to osmo1…"); with `address`, `forAddress` is that
 * account's row (null when the account is not involved).
 */
export function parseTxDetail(
  raw: unknown,
  ctx: DecodeContext,
  options: { address?: string; now?: number } = {},
): TxDetail | null {
  const tx = parseTx(raw);
  if (!tx) return null;
  const { payer, granter, signer: reportedSigner } = feePayerOf(tx.feeRecord, tx.events);
  const signer = reportedSigner ?? guessSigner(tx.messages);
  const neutral: ReadContext = {
    chainId: ctx.chainId,
    address: null,
    identify: ctx.identify,
    swapTx: isSwapTx(tx.messages),
    ...(ctx.feeRecipients ? { feeRecipients: ctx.feeRecipients } : {}),
    ...(ctx.channelPeer ? { channelPeer: ctx.channelPeer } : {}),
  };
  const fees = tx.feeCoins.map((coin) => feeOf(coin, ctx.identify)).filter((fee): fee is ActivityFee => fee !== null);
  const explorerUrl = explorerTxUrl(ctx.chainId, tx.hash);

  let forAddress: ActivityItem | null | undefined;
  if (options.address) {
    const view = perspective(tx, options.address, ctx);
    forAddress = view.involved ? itemFor(tx, options.address, ctx, view) : null;
  }

  return {
    updatedAt: options.now ?? Date.now(),
    chainId: ctx.chainId,
    hash: tx.hash,
    height: tx.height,
    time: tx.time,
    success: tx.code === 0,
    ...(tx.code !== 0 ? { code: tx.code } : {}),
    ...(tx.code !== 0 && tx.codespace ? { codespace: tx.codespace } : {}),
    ...(tx.code !== 0
      ? { rawLog: cleanText(tx.rawLog || `The chain rejected it with code ${tx.code}.`, RAW_LOG_MAX, { keepNewlines: true }) }
      : {}),
    fee: fees[0] ?? null,
    fees,
    gasUsed: tx.gasUsed,
    gasWanted: tx.gasWanted,
    memo: cleanText(tx.memo, 1_000, { keepNewlines: true }),
    ...(signer ? { signer } : {}),
    ...(payer ? { feePayer: payer } : {}),
    ...(granter ? { feeGranter: granter } : {}),
    messages: tx.messages.map((message, index) => {
      const reading = readMessage(message, index, neutral, undefined, signer);
      return {
        index,
        typeUrl: typeUrlOf(message),
        type: reading.type,
        summary: tx.code === 0 ? reading.done : `Failed to ${reading.attempt}`,
        json: sanitizeJson(message),
      };
    }),
    ...(tx.messageCount > tx.messages.length ? { messagesOmitted: tx.messageCount - tx.messages.length } : {}),
    events: eventCounts(tx.events),
    movements: movementsOf(tx.events, ctx.identify),
    packets: tx.code === 0 ? packetsOf(tx, ctx) : [],
    ...(explorerUrl ? { explorerUrl } : {}),
    ...(forAddress !== undefined ? { forAddress } : {}),
  };
}
