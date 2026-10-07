/**
 * One message into words, for one account.
 *
 * Ported from zunia-extension lib/chain-queries.ts @ 1453e7a (`describeMessage`,
 * `pickMessage`, `isSwapTx`, `memoCallsSwap`, `executeMsgOf`, the Zunia fee
 * reading) and reworked for the dashboard:
 *
 * - kinds are relative to the account (`send` for the sender, `receive` for
 *   the recipient of the same MsgSend) and finer than the extension's
 *   (`ibc-out` / `ibc-in`, `delegate` / `undelegate` / `redelegate`, `vote`,
 *   `contract`, `authz`);
 * - amounts in sentences come from what the chain actually moved for the
 *   account in that message (`coin_received` / `coin_spent`, see ./events)
 *   whenever the transaction succeeded, and from the message body otherwise —
 *   a failed swap has no output to report, only what was offered;
 * - every coin is named through the identity the caller supplies, so a row's
 *   sentence and its amounts always use the same ticker ("USDC.n",
 *   "IBC·498A"), and a coin with unknown decimals reads in base units.
 *
 * Pure: identities, the Zunia treasury table and channel → chain lookups are
 * passed in, so node:test can run every case against recorded transactions.
 */

import { SWAP_FEE_RECIPIENTS } from "@/config/fees";
import { formatTokenAmount, shortenAddress } from "@/lib/format";
import type { TokenIdentity } from "@/lib/token/types";
import { asRecord, inbound, listCoins, messageCoins, outbound, text, type Coin, type Flows } from "./events";
import { cleanText } from "./clean";
import type { ActivityIbc, ActivityKind } from "./types";

/** The chain at the other end of one of this chain's channels. */
export interface ChannelPeer {
  chainId: string;
  chainName?: string;
}

export interface ReadContext {
  chainId: string;
  /** Whose activity this is; null reads the message neutrally (transaction detail). */
  address: string | null;
  identify: (denom: string) => TokenIdentity;
  /** The transaction is a swap the way Zunia signs one ({@link isSwapTx}). */
  swapTx: boolean;
  /** Zunia treasuries by chain id; the shipped table (config/fees.ts) unless a test passes its own. */
  feeRecipients?: Readonly<Record<string, string>>;
  /** Canonical channel table lookup, synchronous; null when the channel is not in it. */
  channelPeer?: (channel: string) => ChannelPeer | null;
  /**
   * The `flows` handed to {@link readMessage} are this message's own (the node
   * attributes events to messages). False when they are the whole
   * transaction's (an old node's flat event list, or an authz MsgExec whose
   * inner messages the node does not tell apart): a reading must then not
   * pin a coin on one message, e.g. call a claim's payout a delegation's
   * auto-withdrawn rewards.
   */
  attributed?: boolean;
  /** How many authz MsgExec this reading is nested in (bounded, see `MAX_EXEC_DEPTH`). */
  execDepth?: number;
}

/** MsgExec inside MsgExec is legal; reading deeper than this only counts the actions. */
const MAX_EXEC_DEPTH = 2;

export interface MessageReading {
  index: number;
  typeUrl: string;
  /** "MsgSend" */
  type: string;
  kind: ActivityKind;
  /** The account is a party to this message (signer, recipient, delegator, voter…). */
  involves: boolean;
  /** Lower is what the row is about when several messages involve the account. */
  rank: number;
  /** Past tense, for a transaction that went through: "Sent 12.5 OSMO to osmo1…". */
  done: string;
  /** What was attempted, after "Failed to ": "send 12.5 OSMO to osmo1…". */
  attempt: string;
  counterparty?: string;
  ibc?: ActivityIbc;
  proposalId?: string;
  /** Rewards claims: the validator, for "from 3 validators". */
  validator?: string;
  /** Validator commission rather than delegation rewards. */
  commission?: boolean;
  /** Run for the account by this authz grantee (a MsgExec it signed), not by the account. */
  via?: string;
}

/**
 * Which message a row is about when a transaction holds several. A swap
 * signed with its Zunia fee and its IBC delivery is a swap; a claim followed
 * by a delegation is a delegation; relayer upkeep around a packet delivered to
 * the account never wins.
 */
export const RANK = {
  swap: 1,
  ibcOut: 2,
  ibcIn: 3,
  send: 4,
  receive: 5,
  redelegate: 6,
  undelegate: 7,
  delegate: 8,
  claim: 9,
  vote: 10,
  contract: 11,
  authz: 12,
  other: 13,
  fee: 14,
  relayer: 15,
} as const;

export function typeUrlOf(message: Record<string, unknown>): string {
  return text(message["@type"]);
}

/** `MsgSend` from `/cosmos.bank.v1beta1.MsgSend`. */
export function shortTypeName(typeUrl: string): string {
  return typeUrl.split(".").pop() || typeUrl || "Unknown message";
}

/** `Swap Exact Amount In` from `MsgSwapExactAmountIn`. */
export function humanType(typeUrl: string): string {
  return shortTypeName(typeUrl)
    .replace(/^Msg/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
}

function short(address: string): string {
  return shortenAddress(address);
}

const TEN = BigInt(10);

/**
 * "12.5 OSMO", "0.000123 ATOM", "1,234.56 SAF", "760 base units of IBC·1E18".
 * Cut, never rounded up (lib/format), with fewer decimals as the amount grows.
 */
export function coinWords(coin: Coin, identify: (denom: string) => TokenIdentity): string {
  const identity = identify(coin.denom);
  const decimals = identity.decimals;
  if (decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 77) {
    return `${formatTokenAmount(coin.amount, null)} of ${identity.ticker}`;
  }
  const units = BigInt(coin.amount);
  const one = TEN ** BigInt(decimals);
  const maxFraction = units >= one * BigInt(1000) ? 2 : units >= one ? 4 : 6;
  return `${formatTokenAmount(coin.amount, decimals, { maxFraction })} ${identity.ticker}`;
}

/** The largest coin, plus how many others moved with it. */
export function coinsWords(coins: readonly Coin[], identify: (denom: string) => TokenIdentity): string {
  if (coins.length === 0) return "";
  const first = coinWords(coins[0], identify);
  const others = coins.length - 1;
  return others > 0 ? `${first} and ${others} more token${others === 1 ? "" : "s"}` : first;
}

function sumCoins(coins: readonly Coin[]): Coin[] {
  const totals = new Map<string, bigint>();
  for (const coin of coins) totals.set(coin.denom, (totals.get(coin.denom) ?? BigInt(0)) + BigInt(coin.amount));
  return [...totals]
    .filter(([, amount]) => amount > BigInt(0))
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1))
    .map(([denom, amount]) => ({ denom, amount: amount.toString() }));
}

/** Base64 JSON (a packet's `data`, a contract call as some nodes return it), or null. */
export function decodeBase64Json(raw: string): Record<string, unknown> | null {
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return asRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
  } catch {
    return null;
  }
}

/** ICS20 packet data: v1 (`denom`, `amount`) or v2 (`tokens[0]`). */
export interface Ics20Data {
  denom: string;
  amount: string;
  sender: string;
  receiver: string;
  memo: string;
}

export function ics20Data(json: Record<string, unknown> | null): Ics20Data | null {
  if (!json) return null;
  let denom = text(json.denom);
  let amount = text(json.amount);
  const tokens = Array.isArray(json.tokens) ? json.tokens : [];
  if (!denom && tokens.length > 0) {
    const token = asRecord(tokens[0]);
    const tokenDenom = asRecord(token?.denom);
    denom = text(tokenDenom?.base) || text(token?.denom);
    amount = text(token?.amount);
  }
  // Every field is written by the sending chain: shown cleaned and bounded.
  const data = {
    denom: cleanText(denom, 256),
    amount: /^\d{1,80}$/.test(amount) ? amount : "",
    sender: cleanText(text(json.sender), 128),
    receiver: cleanText(text(json.receiver), 128),
    memo: cleanText(text(json.memo), 1_000, { keepNewlines: true }),
  };
  return data.sender || data.receiver ? data : null;
}

/** `transfer/channel-122/erc20:0xa00C…` → `erc20:0xa00C…`, for a coin nothing names. */
function packetDenomWords(denom: string): string {
  const clean = cleanText(denom, 256);
  const parts = clean.split("/");
  const base = parts[parts.length - 1] || clean;
  return base.length > 24 ? `${base.slice(0, 12)}…${base.slice(-6)}` : base;
}

/** How deep a packet-forward memo's `next` is followed: further than any route Swap signs. */
const MAX_FORWARD_DEPTH = 4;

/** Whether a packet memo, or a forward it nests, calls `osmosis_swap` through ibc-hooks. */
export function memoCallsSwap(memo: unknown, depth = 0): boolean {
  if (depth > MAX_FORWARD_DEPTH) return false;
  let parsed: Record<string, unknown> | null;
  if (typeof memo === "string") {
    if (!memo.trim().startsWith("{")) return false;
    try {
      parsed = asRecord(JSON.parse(memo) as unknown);
    } catch {
      return false;
    }
  } else {
    parsed = asRecord(memo);
  }
  if (!parsed) return false;
  const call = asRecord(asRecord(parsed.wasm)?.msg);
  if (call && Object.hasOwn(call, "osmosis_swap")) return true;
  return memoCallsSwap(asRecord(parsed.forward)?.next, depth + 1);
}

/** A contract call's ExecuteMsg as a node returns it: JSON, or base64 of JSON. */
export function executeMsgOf(raw: unknown): Record<string, unknown> | null {
  const json = asRecord(raw);
  if (json) return json;
  if (typeof raw !== "string" || raw === "") return null;
  return decodeBase64Json(raw);
}

const POOL_SWAP = /\.(MsgSwapExactAmountIn|MsgSwapExactAmountOut|MsgSplitRouteSwapExactAmountIn|MsgSplitRouteSwapExactAmountOut)$/;

/**
 * Whether a transaction is a swap the way Zunia signs one: a contract call to
 * `osmosis_swap` (funds already on Osmosis), an ICS20 transfer whose memo
 * calls it on arrival (funds on another chain), or Osmosis's own pool swap
 * messages.
 */
export function isSwapTx(messages: readonly Record<string, unknown>[]): boolean {
  return messages.some((message) => {
    const type = typeUrlOf(message);
    if (POOL_SWAP.test(type)) return true;
    if (type.endsWith(".MsgExecuteContract")) {
      const call = executeMsgOf(message.msg);
      return call !== null && Object.hasOwn(call, "osmosis_swap");
    }
    return type.endsWith(".MsgTransfer") && memoCallsSwap(message.memo);
  });
}

const VOTE_WORDS: Readonly<Record<string, string>> = {
  VOTE_OPTION_YES: "Yes",
  VOTE_OPTION_ABSTAIN: "Abstain",
  VOTE_OPTION_NO: "No",
  VOTE_OPTION_NO_WITH_VETO: "No with veto",
  "1": "Yes",
  "2": "Abstain",
  "3": "No",
  "4": "No with veto",
};

/** The protobuf type an authz grant or revoke is about, in words. */
function grantWords(authorization: Record<string, unknown> | null, typeUrl: string): string {
  const generic = cleanText(text(authorization?.msg) || typeUrl, 120);
  if (generic) return cleanText(humanType(generic).toLowerCase(), 60);
  const kind = shortTypeName(text(authorization?.["@type"]));
  if (kind.endsWith("SendAuthorization")) return "send tokens";
  if (kind.endsWith("StakeAuthorization")) return "stake";
  if (kind.endsWith("TransferAuthorization")) return "send tokens over IBC";
  return "act";
}

/** Bech32 payload without prefix and checksum: the same account on `osmo1…` and `osmovaloper1…`. */
function sameAccount(a: string, b: string): boolean {
  const ai = a.lastIndexOf("1");
  const bi = b.lastIndexOf("1");
  if (ai <= 0 || bi <= 0) return false;
  const pa = a.slice(ai + 1, -6);
  const pb = b.slice(bi + 1, -6);
  return pa.length >= 32 && pa === pb;
}

function feeRecipientOf(ctx: ReadContext): string | null {
  const table = ctx.feeRecipients ?? SWAP_FEE_RECIPIENTS;
  return Object.hasOwn(table, ctx.chainId) ? (table[ctx.chainId] ?? null) : null;
}

/** What the reading needs to say about one message. */
type Reading = Omit<MessageReading, "index" | "typeUrl" | "type">;

function reading(kind: ActivityKind, rank: number, involves: boolean, done: string, attempt: string, extra: Partial<Reading> = {}): Reading {
  return { kind, rank, involves, done, attempt, ...extra };
}

/** Lower-cases the first letter, to continue a sentence. */
export function continueSentence(sentence: string): string {
  return sentence ? `${sentence[0].toLowerCase()}${sentence.slice(1)}` : sentence;
}

/** An authz MsgExec's grantee and inner messages; null for any other message. */
export function execOf(message: Record<string, unknown>): { grantee: string; msgs: Record<string, unknown>[] } | null {
  const typeUrl = typeUrlOf(message);
  if (!typeUrl.endsWith(".MsgExec") || !typeUrl.includes("authz")) return null;
  const msgs = (Array.isArray(message.msgs) ? message.msgs : [])
    .slice(0, 50)
    .map(asRecord)
    .filter((inner): inner is Record<string, unknown> => inner !== null);
  return { grantee: text(message.grantee), msgs };
}

/**
 * Staking messages withdraw the pending rewards of the validators they touch
 * (to the delegator, unless a withdraw address is set). Those coins are the
 * only ones that reach the account in such a message, so the sentence names
 * them; otherwise "Undelegated 5,000 SAF" would sit beside a "+1.49 SAF" the
 * row cannot explain.
 */
function withAutoClaim(sentence: string, received: readonly Coin[], ctx: ReadContext, mine: boolean): string {
  if (!mine || !ctx.attributed || received.length === 0) return sentence;
  return `${sentence} and received ${coinsWords(received, ctx.identify)} in rewards`;
}

/**
 * Read one message. `flows` are the coins this message moved for
 * `ctx.address` (empty for a failed transaction); `signer` is the
 * transaction's first signer, the party of messages that name nobody else.
 */
export function readMessage(
  message: Record<string, unknown>,
  index: number,
  ctx: ReadContext,
  flows: Flows | undefined,
  signer: string | null = null,
): MessageReading {
  const typeUrl = typeUrlOf(message);
  const type = shortTypeName(typeUrl);
  const result = readBody(message, typeUrl, ctx, flows, signer);
  return { index, typeUrl, type, ...result };
}

function readBody(
  m: Record<string, unknown>,
  typeUrl: string,
  ctx: ReadContext,
  flows: Flows | undefined,
  signer: string | null,
): Reading {
  const me = ctx.address;
  const words = (coins: readonly Coin[]) => coinsWords(coins, ctx.identify);
  const received = inbound(flows);
  const spent = outbound(flows);

  if (typeUrl.endsWith(".MsgSend")) {
    const from = text(m.from_address);
    const to = text(m.to_address);
    const amount = words(messageCoins(m.amount));
    const zuniaFee = ctx.swapTx && to !== "" && to === feeRecipientOf(ctx);
    if (me !== null && me === from) {
      return zuniaFee
        ? reading("send", RANK.fee, true, `Paid the Zunia swap fee of ${amount}`, `pay the Zunia swap fee of ${amount}`, { counterparty: to })
        : reading("send", RANK.send, true, `Sent ${amount} to ${short(to)}`, `send ${amount} to ${short(to)}`, { counterparty: to });
    }
    if (me !== null && me === to) {
      const got = received.length > 0 ? words(received) : amount;
      return zuniaFee
        ? reading("receive", RANK.receive, true, `Received a Zunia swap fee of ${got} from ${short(from)}`, `receive ${got} from ${short(from)}`, { counterparty: from })
        : reading("receive", RANK.receive, true, `Received ${got} from ${short(from)}`, `receive ${got} from ${short(from)}`, { counterparty: from });
    }
    return zuniaFee
      ? reading("send", RANK.fee, false, `Paid the Zunia swap fee of ${amount}`, `pay the Zunia swap fee of ${amount}`)
      : reading("send", RANK.send, false, `Sent ${amount} from ${short(from)} to ${short(to)}`, `send ${amount} from ${short(from)} to ${short(to)}`);
  }

  if (typeUrl.endsWith(".MsgMultiSend")) {
    const inputs = (Array.isArray(m.inputs) ? m.inputs : []).map(asRecord);
    const outputs = (Array.isArray(m.outputs) ? m.outputs : []).map(asRecord);
    const mine = (rows: Array<Record<string, unknown> | null>) =>
      rows.filter((row) => me !== null && text(row?.address) === me).flatMap((row) => messageCoins(row?.coins));
    const paid = mine(inputs);
    const got = mine(outputs);
    const count = outputs.length;
    if (paid.length > 0) {
      const amount = words(sumCoins(paid));
      return reading("send", RANK.send, true, `Sent ${amount} to ${count} addresses`, `send ${amount} to ${count} addresses`);
    }
    if (got.length > 0) {
      const amount = words(received.length > 0 ? received : sumCoins(got));
      const from = text(inputs[0]?.address);
      return reading("receive", RANK.receive, true, `Received ${amount} in a multi-send`, `receive ${amount}`, from ? { counterparty: from } : {});
    }
    return reading("send", RANK.send, false, `Sent tokens to ${count} addresses`, `send tokens to ${count} addresses`);
  }

  if (typeUrl.endsWith(".MsgTransfer")) {
    const sender = text(m.sender);
    const receiver = text(m.receiver);
    const channel = text(m.source_channel);
    const amount = words(messageCoins(m.token ?? m.tokens));
    const peer = channel ? (ctx.channelPeer?.(channel) ?? null) : null;
    const ibc: ActivityIbc = { ...(channel ? { sourceChannel: channel } : {}), ...(peer ? { destChainId: peer.chainId } : {}) };
    if (me !== null && me === sender) {
      if (ctx.swapTx && memoCallsSwap(m.memo)) {
        return reading("swap", RANK.swap, true, `Sent ${amount} to swap on Osmosis`, `send ${amount} to swap on Osmosis`, { counterparty: receiver, ibc });
      }
      const where = peer?.chainName ? ` on ${peer.chainName}` : channel ? ` over IBC (${channel})` : " over IBC";
      return reading("ibc-out", RANK.ibcOut, true, `Sent ${amount} to ${short(receiver)}${where}`, `send ${amount} to ${short(receiver)}${where}`, { counterparty: receiver, ibc });
    }
    return reading("ibc-out", RANK.ibcOut, false, `Sent ${amount} over IBC from ${short(sender)} to ${short(receiver)}`, `send ${amount} over IBC from ${short(sender)} to ${short(receiver)}`, { ibc });
  }

  if (typeUrl.endsWith(".MsgRecvPacket")) {
    const packet = asRecord(m.packet);
    const data = ics20Data(decodeBase64Json(text(packet?.data)));
    const sourceChannel = text(packet?.source_channel);
    const destChannel = text(packet?.destination_channel);
    const peer = destChannel ? (ctx.channelPeer?.(destChannel) ?? null) : null;
    const ibc: ActivityIbc = {
      ...(text(packet?.sequence) ? { sequence: text(packet?.sequence) } : {}),
      ...(sourceChannel ? { sourceChannel } : {}),
      ...(destChannel ? { destChannel } : {}),
      ...(peer ? { sourceChainId: peer.chainId } : {}),
    };
    const forMe = me !== null && (data?.receiver === me || received.length > 0);
    if (forMe) {
      const sender = data?.sender ?? "";
      const where = peer?.chainName ? ` on ${peer.chainName}` : " via IBC";
      const from = sender ? ` from ${short(sender)}${where}` : where;
      if (received.length > 0) {
        const amount = words(received);
        return reading("ibc-in", RANK.ibcIn, true, `Received ${amount}${from}`, `receive ${amount}${from}`, { ...(sender ? { counterparty: sender } : {}), ibc });
      }
      // Credited and sent straight on in the same message (a packet-forward
      // hop through this account): the coins passed through, nothing stayed.
      const passed = ctx.attributed ? listCoins(flows, "in") : [];
      if (passed.length > 0) {
        const amount = words(passed);
        return reading("ibc-in", RANK.ibcIn, true, `Forwarded ${amount} received${from}`, `forward ${amount} received${from}`, { ...(sender ? { counterparty: sender } : {}), ibc });
      }
      // Delivered, but nothing credited: the receiving chain refused it, or
      // the transaction failed. The packet's own denom is the sender's trace,
      // so it is named as such, in base units, never as a local coin.
      const offered = data?.amount ? `${formatTokenAmount(data.amount, null)} of ${packetDenomWords(data.denom)}` : "an IBC transfer";
      return reading("ibc-in", RANK.ibcIn, true, `Incoming ${offered}${from} was not credited`, `receive ${offered}${from}`, { ...(sender ? { counterparty: sender } : {}), ibc });
    }
    const relayer = text(m.signer);
    if (me === null && data?.receiver) {
      // The detail view: say what the packet carried, in the sender's own
      // spelling (base units), since no flow names the credited denom here.
      const carried = data.amount ? `${formatTokenAmount(data.amount, null)} of ${packetDenomWords(data.denom)}` : "an IBC transfer";
      const from = data.sender ? ` from ${short(data.sender)}` : "";
      return reading("ibc-in", RANK.ibcIn, false, `Delivered ${carried}${from} to ${short(data.receiver)}`, `deliver ${carried}${from} to ${short(data.receiver)}`, { ...(data.sender ? { counterparty: data.sender } : {}), ibc });
    }
    return reading("other", RANK.relayer, me !== null && relayer === me, `Relayed an IBC packet${destChannel ? ` on ${destChannel}` : ""}`, `relay an IBC packet${destChannel ? ` on ${destChannel}` : ""}`, { ibc });
  }

  if (/\.(MsgAcknowledgement|MsgTimeout|MsgTimeoutOnClose)$/.test(typeUrl)) {
    const packet = asRecord(m.packet);
    const data = ics20Data(decodeBase64Json(text(packet?.data)));
    const timeout = !typeUrl.endsWith(".MsgAcknowledgement");
    if (me !== null && data?.sender === me && received.length > 0) {
      const amount = words(received);
      const why = timeout ? "the IBC transfer timed out" : "the IBC transfer was refused";
      return reading("receive", RANK.receive, true, `Refunded ${amount}: ${why}`, `refund ${amount}`, { ...(data.receiver ? { counterparty: data.receiver } : {}) });
    }
    const relayer = text(m.signer);
    const what = timeout ? "an IBC timeout" : "an IBC acknowledgement";
    return reading("other", RANK.relayer, me !== null && relayer === me, `Relayed ${what}`, `relay ${what}`);
  }

  if (typeUrl.includes(".ibc.core.") || typeUrl.startsWith("/ibc.core.")) {
    const relayer = text(m.signer);
    const done = typeUrl.endsWith(".MsgUpdateClient") ? `Updated IBC client ${text(m.client_id)}`.trim() : `IBC ${humanType(typeUrl).toLowerCase()}`;
    return reading("other", RANK.relayer, me !== null && relayer === me, done, continueSentence(done));
  }

  if (POOL_SWAP.test(typeUrl)) {
    const sender = text(m.sender);
    const offered = poolSwapOffer(m);
    const outDenom = poolSwapOutDenom(m);
    const outTicker = outDenom ? ctx.identify(outDenom).ticker : "";
    const intent = offered ? `${words([offered])}${outTicker ? ` for ${outTicker}` : ""}` : outTicker ? `tokens for ${outTicker}` : "tokens";
    const mine = me !== null && me === sender;
    if (mine && spent.length > 0 && received.length > 0) {
      return reading("swap", RANK.swap, true, `Swapped ${words(spent)} → ${words(received)}`, `swap ${intent}`);
    }
    return reading("swap", RANK.swap, mine, `Swapped ${intent}`, `swap ${intent}`);
  }

  if (/\.(MsgJoinPool|MsgJoinSwapExternAmountIn|MsgJoinSwapShareAmountOut)$/.test(typeUrl)) {
    const pool = text(m.pool_id);
    return reading("other", RANK.other, me !== null && text(m.sender) === me, `Added liquidity to pool #${pool}`, `add liquidity to pool #${pool}`);
  }
  if (/\.(MsgExitPool|MsgExitSwapExternAmountOut|MsgExitSwapShareAmountIn)$/.test(typeUrl)) {
    const pool = text(m.pool_id);
    return reading("other", RANK.other, me !== null && text(m.sender) === me, `Removed liquidity from pool #${pool}`, `remove liquidity from pool #${pool}`);
  }

  if (typeUrl.endsWith(".MsgExecuteContract")) {
    const sender = text(m.sender);
    const contract = text(m.contract);
    const call = executeMsgOf(m.msg);
    // The call's name is the contract's own JSON key: anyone's text.
    const action = cleanText(Object.keys(call ?? {})[0] ?? "", 40);
    const funds = messageCoins(m.funds);
    const mine = me !== null && me === sender;
    if (mine && (action === "osmosis_swap" || /swap/i.test(action))) {
      const offered = funds.length > 0 ? words(funds) : "tokens";
      if (spent.length > 0 && received.length > 0) {
        return reading("swap", RANK.swap, true, `Swapped ${words(spent)} → ${words(received)}`, `swap ${offered}`, { counterparty: contract });
      }
      return reading("swap", RANK.swap, true, `Swapped ${offered} on ${short(contract)}`, `swap ${offered} on ${short(contract)}`, { counterparty: contract });
    }
    const with_ = funds.length > 0 ? ` with ${words(funds)}` : "";
    const name = action || "a call";
    if (mine) {
      return reading("contract", RANK.contract, true, `Executed ${name} on ${short(contract)}${with_}`, `execute ${name} on ${short(contract)}${with_}`, { counterparty: contract });
    }
    if (me !== null && received.length > 0) {
      const amount = words(received);
      return reading("receive", RANK.receive, true, `Received ${amount} from ${short(contract)}`, `receive ${amount} from ${short(contract)}`, { counterparty: contract });
    }
    return reading("contract", RANK.contract, false, `Executed ${name} on ${short(contract)}${with_}`, `execute ${name} on ${short(contract)}${with_}`, { counterparty: contract });
  }

  if (/\.(MsgInstantiateContract|MsgInstantiateContract2)$/.test(typeUrl)) {
    const code = text(m.code_id);
    const label = cleanText(text(m.label), 40);
    const done = `Instantiated ${label ? `“${label}”` : "a contract"}${code ? ` from code #${code}` : ""}`;
    return reading("contract", RANK.contract, me !== null && text(m.sender) === me, done, continueSentence(done.replace(/^Instantiated/, "instantiate")));
  }
  if (typeUrl.endsWith(".MsgStoreCode")) {
    return reading("contract", RANK.contract, me !== null && text(m.sender) === me, "Uploaded contract code", "upload contract code");
  }
  if (typeUrl.endsWith(".MsgMigrateContract")) {
    const contract = text(m.contract);
    return reading("contract", RANK.contract, me !== null && text(m.sender) === me, `Migrated ${short(contract)}`, `migrate ${short(contract)}`, { counterparty: contract });
  }

  if (typeUrl.endsWith(".MsgDelegate")) {
    const validator = text(m.validator_address);
    const amount = words(messageCoins(m.amount));
    const mine = me !== null && text(m.delegator_address) === me;
    const done = withAutoClaim(`Delegated ${amount} to ${short(validator)}`, received, ctx, mine);
    return reading("delegate", RANK.delegate, mine, done, `delegate ${amount} to ${short(validator)}`, { counterparty: validator });
  }
  if (typeUrl.endsWith(".MsgUndelegate")) {
    const validator = text(m.validator_address);
    const amount = words(messageCoins(m.amount));
    const mine = me !== null && text(m.delegator_address) === me;
    const done = withAutoClaim(`Undelegated ${amount} from ${short(validator)}`, received, ctx, mine);
    return reading("undelegate", RANK.undelegate, mine, done, `undelegate ${amount} from ${short(validator)}`, { counterparty: validator });
  }
  if (typeUrl.endsWith(".MsgBeginRedelegate")) {
    const from = text(m.validator_src_address);
    const to = text(m.validator_dst_address);
    const amount = words(messageCoins(m.amount));
    const mine = me !== null && text(m.delegator_address) === me;
    const done = withAutoClaim(`Redelegated ${amount} from ${short(from)} to ${short(to)}`, received, ctx, mine);
    return reading("redelegate", RANK.redelegate, mine, done, `redelegate ${amount} from ${short(from)} to ${short(to)}`, { counterparty: to });
  }
  if (typeUrl.endsWith(".MsgCancelUnbondingDelegation")) {
    const validator = text(m.validator_address);
    const amount = words(messageCoins(m.amount));
    const mine = me !== null && text(m.delegator_address) === me;
    return reading("delegate", RANK.delegate, mine, `Cancelled unbonding ${amount} from ${short(validator)}`, `cancel unbonding ${amount} from ${short(validator)}`, { counterparty: validator });
  }

  if (typeUrl.endsWith(".MsgWithdrawDelegatorReward")) {
    const validator = text(m.validator_address);
    const mine = me !== null && text(m.delegator_address) === me;
    const got = received.length > 0 ? `${words(received)} in rewards` : "rewards";
    return reading("claim", RANK.claim, mine, `Claimed ${got} from ${short(validator)}`, `claim rewards from ${short(validator)}`, { counterparty: validator, validator });
  }
  if (typeUrl.endsWith(".MsgWithdrawValidatorCommission")) {
    const validator = text(m.validator_address);
    const mine = me !== null && (sameAccount(me, validator) || signer === me);
    const got = received.length > 0 ? `${words(received)} in commission` : "commission";
    return reading("claim", RANK.claim, mine, `Claimed ${got}`, "claim commission", { counterparty: validator, validator, commission: true });
  }
  if (typeUrl.endsWith(".MsgSetWithdrawAddress")) {
    const target = text(m.withdraw_address);
    const mine = me !== null && text(m.delegator_address) === me;
    return reading("other", RANK.other, mine, `Set the rewards address to ${short(target)}`, `set the rewards address to ${short(target)}`, { counterparty: target });
  }
  if (typeUrl.endsWith(".MsgFundCommunityPool")) {
    const amount = words(messageCoins(m.amount));
    const mine = me !== null && text(m.depositor) === me;
    return reading("other", RANK.other, mine, `Funded the community pool with ${amount}`, `fund the community pool with ${amount}`);
  }

  if (typeUrl.endsWith(".MsgVote") || typeUrl.endsWith(".MsgVoteWeighted")) {
    const proposal = text(m.proposal_id);
    const mine = me !== null && text(m.voter) === me;
    if (typeUrl.endsWith(".MsgVoteWeighted")) {
      return reading("vote", RANK.vote, mine, `Cast a weighted vote on proposal #${proposal}`, `vote on proposal #${proposal}`, { proposalId: proposal });
    }
    const option = VOTE_WORDS[text(m.option)] ?? "";
    return reading("vote", RANK.vote, mine, option ? `Voted ${option} on proposal #${proposal}` : `Voted on proposal #${proposal}`, `vote on proposal #${proposal}`, { proposalId: proposal });
  }
  if (typeUrl.endsWith(".MsgDeposit") && typeUrl.includes(".gov.")) {
    const proposal = text(m.proposal_id);
    const amount = words(messageCoins(m.amount));
    const mine = me !== null && text(m.depositor) === me;
    return reading("other", RANK.other, mine, `Deposited ${amount} on proposal #${proposal}`, `deposit ${amount} on proposal #${proposal}`, { proposalId: proposal });
  }
  if (typeUrl.endsWith(".MsgSubmitProposal")) {
    const title = cleanText(text(m.title), 80);
    const mine = me !== null && text(m.proposer) === me;
    const done = title ? `Submitted proposal “${title}”` : "Submitted a governance proposal";
    return reading("other", RANK.other, mine, done, "submit a governance proposal");
  }

  if (typeUrl.endsWith(".MsgGrant") && typeUrl.includes("authz")) {
    const granter = text(m.granter);
    const grantee = text(m.grantee);
    const what = grantWords(asRecord(asRecord(m.grant)?.authorization), "");
    if (me !== null && me === grantee) {
      return reading("authz", RANK.authz, true, `Got permission from ${short(granter)} to ${what}`, `get permission to ${what}`, { counterparty: granter });
    }
    return reading("authz", RANK.authz, me !== null && me === granter, `Allowed ${short(grantee)} to ${what}`, `allow ${short(grantee)} to ${what}`, { counterparty: grantee });
  }
  if (typeUrl.endsWith(".MsgRevoke") && typeUrl.includes("authz")) {
    const grantee = text(m.grantee);
    const what = grantWords(null, text(m.msg_type_url));
    return reading("authz", RANK.authz, me !== null && text(m.granter) === me, `Revoked ${short(grantee)}'s permission to ${what}`, `revoke ${short(grantee)}'s permission to ${what}`, { counterparty: grantee });
  }
  const exec = execOf(m);
  if (exec) {
    const { grantee, msgs } = exec;
    const count = msgs.length;
    const actions = `${count} action${count === 1 ? "" : "s"}`;
    const depth = (ctx.execDepth ?? 0) + 1;
    if (depth > MAX_EXEC_DEPTH) {
      return reading("authz", RANK.authz, me !== null && me === grantee, `${short(grantee)} ran ${actions} with an authz grant`, `run ${actions} with an authz grant`, { counterparty: grantee });
    }
    const nested = { ...ctx, execDepth: depth };
    // What was run, read neutrally: the grantee's own row and the detail view
    // say it in full. (The granter's row is read per inner message by
    // ./decode, which can tell their coins apart.)
    const neutral = { ...nested, address: null, attributed: false };
    const shown = msgs.slice(0, 3).map((inner, i) => continueSentence(readMessage(inner, i, neutral, undefined, signer).done));
    const list = shown.length > 0 ? `: ${shown.join("; ")}${count > shown.length ? ` (+${count - shown.length} more)` : ""}` : "";
    if (me !== null && me === grantee) {
      return reading("authz", RANK.authz, true, `Ran ${actions} with an authz grant${list}`, `run ${actions} with an authz grant`);
    }
    // Someone acting for this account (auto-compounding bots, mostly), when
    // the caller did not split the MsgExec: say what they did, from the
    // account's side.
    if (me === null) {
      return reading("authz", RANK.authz, false, `${short(grantee)} ran ${actions} with an authz grant${list}`, `run ${actions} with an authz grant`, { counterparty: grantee });
    }
    const readings = msgs.map((inner, i) => readMessage(inner, i, nested, flows, signer)).filter((r) => r.involves);
    const main = readings.sort((a, b) => a.rank - b.rank)[0];
    if (main) {
      return reading(main.kind, main.rank, true, `${short(grantee)} acted for you: ${continueSentence(main.done)}`, `act for you: ${main.attempt}`, {
        ...(main.counterparty ? { counterparty: main.counterparty } : {}),
        ...(main.proposalId ? { proposalId: main.proposalId } : {}),
        via: grantee,
      });
    }
    return reading("authz", RANK.authz, false, `${short(grantee)} ran ${actions} with an authz grant${list}`, `run ${actions} with an authz grant`, { counterparty: grantee });
  }
  if (typeUrl.endsWith(".MsgGrantAllowance")) {
    const grantee = text(m.grantee);
    return reading("authz", RANK.authz, me !== null && text(m.granter) === me, `Granted a fee allowance to ${short(grantee)}`, `grant a fee allowance to ${short(grantee)}`, { counterparty: grantee });
  }
  if (typeUrl.endsWith(".MsgRevokeAllowance")) {
    const grantee = text(m.grantee);
    return reading("authz", RANK.authz, me !== null && text(m.granter) === me, `Revoked the fee allowance of ${short(grantee)}`, `revoke the fee allowance of ${short(grantee)}`, { counterparty: grantee });
  }

  if (typeUrl.endsWith(".MsgUnjail")) {
    return reading("other", RANK.other, me !== null && signer === me, "Unjailed the validator", "unjail the validator");
  }
  if (typeUrl.endsWith(".MsgEditValidator")) {
    return reading("other", RANK.other, me !== null && signer === me, "Edited the validator's details", "edit the validator's details");
  }
  if (typeUrl.endsWith(".MsgCreateValidator")) {
    // Creating a validator bonds its self-delegation: a staking move, filed
    // with delegations so the Staking view and its totals include it.
    const moniker = cleanText(text(asRecord(m.description)?.moniker), 40);
    const self = messageCoins(m.value);
    const named = moniker ? `validator “${moniker}”` : "a validator";
    const bonded = self.length > 0 ? ` with a self-delegation of ${words(self)}` : "";
    const operator = text(m.validator_address);
    const mine = me !== null && (signer === me || text(m.delegator_address) === me || (operator !== "" && sameAccount(me, operator)));
    return reading("delegate", RANK.delegate, mine, `Created ${named}${bonded}`, `create ${named}`, operator ? { counterparty: operator } : {});
  }

  // Anything else keeps its type name. The signer is its party when the
  // message names nobody we know how to read.
  const name = humanType(typeUrl);
  return reading("other", RANK.other, me !== null && signer === me, name, `run ${name}`);
}

function poolSwapOffer(m: Record<string, unknown>): Coin | null {
  const direct = messageCoins(m.token_in)[0];
  if (direct) return direct;
  const denom = text(m.token_in_denom);
  if (!denom) return null;
  let total = BigInt(0);
  for (const route of Array.isArray(m.routes) ? m.routes : []) {
    const share = text(asRecord(route)?.token_in_amount);
    if (/^\d+$/.test(share)) total += BigInt(share);
  }
  return total > BigInt(0) ? { denom, amount: total.toString() } : null;
}

function poolSwapOutDenom(m: Record<string, unknown>): string {
  const routes = Array.isArray(m.routes) ? m.routes.map(asRecord) : [];
  const exactOut = messageCoins(m.token_out)[0];
  if (exactOut) return exactOut.denom;
  if (text(m.token_out_denom)) return text(m.token_out_denom);
  // MsgSwapExactAmountIn: routes[].token_out_denom; split routes: routes[].pools[].token_out_denom.
  const last = routes[routes.length - 1];
  if (text(last?.token_out_denom)) return text(last?.token_out_denom);
  const pools = Array.isArray(routes[0]?.pools) ? (routes[0]?.pools as unknown[]) : [];
  return text(asRecord(pools[pools.length - 1])?.token_out_denom);
}
