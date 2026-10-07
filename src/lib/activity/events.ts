/**
 * Reading a transaction's events: what actually moved, per message.
 *
 * A transaction's messages say what was asked; its events say what happened.
 * Amounts in the activity list come from the events (`coin_spent` /
 * `coin_received`), because only they know the denom a chain really credited
 * (the voucher an IBC receive minted, the output of a split-route swap) and
 * the amount after taker fees.
 *
 * Three response shapes exist in the wild, and each needs the network fee
 * kept out of the message flows differently:
 *
 * - **SDK ≥ 0.50**: `logs` is empty; every event is in `events`, and the ones a
 *   message emitted carry a `msg_index` attribute. Ante-handler events (the
 *   fee, a fee-market tip) carry none, so filtering on `msg_index` drops them.
 * - **SDK 0.46–0.47**: `logs[i].events` lists message i's events only (no ante
 *   handler), with plain-text attributes. `events` also exists, flat.
 * - **Tendermint 0.34 era**: flat `events` may have base64 keys and values.
 *   Without `msg_index` or logs, every event is read and the fee is added
 *   back by the caller.
 *
 * Pure: no I/O, no Node-only APIs (atob/TextDecoder are in browsers and Node).
 */

export interface TxEventAttribute {
  key: string;
  value: string;
}

export interface TxEvent {
  type: string;
  attributes: TxEventAttribute[];
  /** The message that emitted it; null for ante-handler events or when the node does not say. */
  msgIndex: number | null;
  /**
   * Inside an authz `MsgExec`, the inner message that emitted it
   * (`authz_msg_index`, SDK ≥ 0.47); null otherwise. A compounding bot's
   * MsgExec holds "claim rewards" and "claim commission" (or "claim" and
   * "delegate") under one `msg_index`; this is what tells their coins apart.
   */
  authzIndex?: number | null;
}

/** Where message events were read from, which decides how the fee is excluded. */
export type EventSource = "logs" | "msg_index" | "flat";

export interface Coin {
  denom: string;
  /** Base units, digits only. */
  amount: string;
}

/** In and out totals of one denom for one account, in base units. */
export interface DenomFlow {
  in: bigint;
  out: bigint;
}

export type Flows = Map<string, DenomFlow>;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

const IDENTIFIER = /^[a-z_][a-z0-9_.]*$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * An attribute key that is base64 of a plain identifier (`c2VuZGVy` →
 * `sender`). Plain keys stay as they are: `amount` is not valid base64 length,
 * and `receiver` decodes to bytes that are not an identifier.
 */
function decodedKey(key: string): string | null {
  if (IDENTIFIER.test(key) || key.length % 4 !== 0 || !BASE64.test(key)) return null;
  const decoded = decodeBase64(key);
  return decoded !== null && IDENTIFIER.test(decoded) ? decoded : null;
}

function readAttributes(raw: unknown): TxEventAttribute[] {
  if (!Array.isArray(raw)) return [];
  const out: TxEventAttribute[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const key = text(record.key);
    const value = text(record.value);
    const plainKey = decodedKey(key);
    if (plainKey !== null) {
      out.push({ key: plainKey, value: value ? (decodeBase64(value) ?? value) : "" });
    } else {
      out.push({ key, value });
    }
  }
  return out;
}

function readEvent(raw: unknown, msgIndex: number | null): TxEvent | null {
  const record = asRecord(raw);
  const type = text(record?.type);
  if (!record || !type) return null;
  const attributes = readAttributes(record.attributes);
  if (msgIndex === null) {
    const index = attributes.find((attribute) => attribute.key === "msg_index")?.value;
    if (index !== undefined && /^\d{1,4}$/.test(index)) msgIndex = Number(index);
  }
  const inner = attributes.find((attribute) => attribute.key === "authz_msg_index")?.value;
  const authzIndex = inner !== undefined && /^\d{1,4}$/.test(inner) ? Number(inner) : null;
  return { type, attributes, msgIndex, authzIndex };
}

/** The response object of a search row (`tx_responses[i]`) or a `GetTx` body. */
export function txResponseOf(raw: unknown): Record<string, unknown> | null {
  const root = asRecord(raw);
  if (!root) return null;
  return asRecord(root.tx_response) ?? (text(root.txhash) ? root : null);
}

/** The signed transaction (`body`, `auth_info`) of a search row or a `GetTx` body. */
export function txOf(raw: unknown): Record<string, unknown> | null {
  const root = asRecord(raw);
  if (!root) return null;
  return asRecord(root.tx) ?? asRecord(txResponseOf(raw)?.tx);
}

/** Every event of the transaction, flat, in emission order (ante handler included). */
export function allEvents(response: Record<string, unknown>): TxEvent[] {
  const events = Array.isArray(response.events) ? response.events : [];
  const out: TxEvent[] = [];
  for (const raw of events) {
    const event = readEvent(raw, null);
    if (event) out.push(event);
  }
  if (out.length > 0) return out;
  // Pre-0.46 nodes may answer with logs only.
  return messageEvents(response).events;
}

/**
 * The events messages emitted, without the ante handler's (fee, tip,
 * signature) where the response shape allows telling them apart.
 */
export function messageEvents(response: Record<string, unknown>): { events: TxEvent[]; source: EventSource } {
  const logs = Array.isArray(response.logs) ? response.logs : [];
  const fromLogs: TxEvent[] = [];
  logs.forEach((log, position) => {
    const record = asRecord(log);
    if (!record || !Array.isArray(record.events)) return;
    const index = text(record.msg_index);
    const msgIndex = /^\d+$/.test(index) ? Number(index) : position;
    for (const raw of record.events) {
      const event = readEvent(raw, msgIndex);
      if (event) fromLogs.push(event);
    }
  });
  if (fromLogs.length > 0) return { events: fromLogs, source: "logs" };

  const flat: TxEvent[] = [];
  for (const raw of Array.isArray(response.events) ? response.events : []) {
    const event = readEvent(raw, null);
    if (event) flat.push(event);
  }
  if (flat.some((event) => event.msgIndex !== null)) {
    return { events: flat.filter((event) => event.msgIndex !== null), source: "msg_index" };
  }
  return { events: flat, source: "flat" };
}

/** First value of `key` in an event. */
export function attr(event: TxEvent, key: string): string | undefined {
  return event.attributes.find((attribute) => attribute.key === key)?.value;
}

const COIN = /^(\d+)([a-zA-Z][a-zA-Z0-9/:._-]{1,127})$/;

/**
 * `"78179uosmo,3494518ibc/D189…"` → coins. Entries that are not a plain
 * integer amount followed by a denom are skipped, never guessed (an empty
 * `amount` attribute is normal for a zero-coin transfer).
 */
export function parseCoins(value: string | undefined): Coin[] {
  if (!value) return [];
  const out: Coin[] = [];
  for (const part of value.split(",")) {
    const match = COIN.exec(part.trim());
    if (match) out.push({ amount: match[1].replace(/^0+(?=\d)/, ""), denom: match[2] });
  }
  return out;
}

/** The well-formed coins of a message field (a coin or a list of coins). */
export function messageCoins(value: unknown): Coin[] {
  const rows = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: Coin[] = [];
  for (const row of rows) {
    const coin = asRecord(row);
    const denom = text(coin?.denom);
    const amount = (text(coin?.amount).split(".")[0] ?? "").trim();
    if (denom && /^\d+$/.test(amount)) out.push({ denom, amount });
  }
  return out;
}

function add(flows: Flows, denom: string, direction: "in" | "out", amount: bigint) {
  let flow = flows.get(denom);
  if (!flow) {
    flow = { in: BigInt(0), out: BigInt(0) };
    flows.set(denom, flow);
  }
  flow[direction] += amount;
}

export interface AddressFlows {
  /** Everything the messages moved for the account. */
  total: Flows;
  /** Per message index (absent when the node does not attribute events to messages). */
  byMessage: Map<number, Flows>;
  /**
   * Per smallest attributable unit: `"<msg>"` for a plain message,
   * `"<msg>:<inner>"` for an authz MsgExec's inner message ({@link unitKey}).
   * Pass-through detection runs per unit, so a bot's claim-then-delegate of
   * the same amount inside one MsgExec still shows both legs.
   */
  byUnit: Map<string, Flows>;
}

/** Key of {@link AddressFlows.byUnit}. */
export function unitKey(msgIndex: number, authzIndex?: number | null): string {
  return authzIndex === null || authzIndex === undefined ? String(msgIndex) : `${msgIndex}:${authzIndex}`;
}

function bucket<K>(map: Map<K, Flows>, key: K): Flows {
  let flows = map.get(key);
  if (!flows) {
    flows = new Map();
    map.set(key, flows);
  }
  return flows;
}

/**
 * Coins that entered and left `address`, from `coin_received` / `coin_spent`.
 *
 * Attributes are read in order and paired (`receiver`, `amount`, `receiver`,
 * `amount`…), because SDK 0.47 logs merge every same-type event of a message
 * into one event with repeated keys.
 */
export function flowsFor(events: readonly TxEvent[], address: string): AddressFlows {
  const total: Flows = new Map();
  const byMessage = new Map<number, Flows>();
  const byUnit = new Map<string, Flows>();
  for (const event of events) {
    const direction = event.type === "coin_received" ? "in" : event.type === "coin_spent" ? "out" : null;
    if (!direction) continue;
    const party = direction === "in" ? "receiver" : "spender";
    let current: string | null = null;
    for (const attribute of event.attributes) {
      if (attribute.key === party) {
        current = attribute.value;
      } else if (attribute.key === "amount" && current === address) {
        for (const coin of parseCoins(attribute.value)) {
          const amount = BigInt(coin.amount);
          add(total, coin.denom, direction, amount);
          if (event.msgIndex !== null) {
            add(bucket(byMessage, event.msgIndex), coin.denom, direction, amount);
            add(bucket(byUnit, unitKey(event.msgIndex, event.authzIndex)), coin.denom, direction, amount);
          }
        }
      }
    }
  }
  return { total, byMessage, byUnit };
}

/** Removes `coin` from the out side of `flows` (the fee, when events cannot exclude it). */
export function withoutFee(flows: Flows, coin: Coin | null): Flows {
  if (!coin) return flows;
  const flow = flows.get(coin.denom);
  if (!flow) return flows;
  const amount = BigInt(coin.amount);
  flow.out = flow.out > amount ? flow.out - amount : BigInt(0);
  if (flow.in === BigInt(0) && flow.out === BigInt(0)) flows.delete(coin.denom);
  return flows;
}

/**
 * Received coins of ONE message's flows, largest first. A denom received and
 * spent in equal amounts inside the message is a pass-through (a multi-hop
 * swap's intermediate token) and is dropped.
 */
export function inbound(flows: Flows | undefined): Coin[] {
  return listCoins(withoutPassThrough(flows), "in");
}

/** Spent coins of one message's flows, largest first; pass-through denoms dropped. */
export function outbound(flows: Flows | undefined): Coin[] {
  return listCoins(withoutPassThrough(flows), "out");
}

/**
 * The flows without denoms that came in and went out in equal amounts. Apply
 * it per message, never to a whole transaction: claiming 8.67 OSMO and
 * delegating those same 8.67 OSMO in the next message are two real
 * movements, not a pass-through.
 */
export function withoutPassThrough(flows: Flows | undefined): Flows {
  const out: Flows = new Map();
  if (!flows) return out;
  for (const [denom, flow] of flows) {
    if (flow.in !== flow.out) out.set(denom, { in: flow.in, out: flow.out });
  }
  return out;
}

/** Every coin of `direction` in `flows`, largest first, nothing dropped. */
export function listCoins(flows: Flows | undefined, direction: "in" | "out"): Coin[] {
  if (!flows) return [];
  const out: Array<{ denom: string; amount: bigint }> = [];
  for (const [denom, flow] of flows) {
    const amount = flow[direction];
    if (amount > BigInt(0)) out.push({ denom, amount });
  }
  out.sort((a, b) => (a.amount === b.amount ? a.denom.localeCompare(b.denom) : a.amount > b.amount ? -1 : 1));
  return out.map((coin) => ({ denom: coin.denom, amount: coin.amount.toString() }));
}

/**
 * Who pays the fee: the granter of a fee grant, an explicit payer, the
 * `fee_payer` the ante handler reported, or the first signer (`acc_seq`).
 */
export function feePayerOf(
  feeRecord: Record<string, unknown> | null,
  events: readonly TxEvent[],
): { payer: string | null; granter: string | null; signer: string | null } {
  const granter = text(feeRecord?.granter) || null;
  const explicit = text(feeRecord?.payer) || null;
  let reported: string | null = null;
  let signer: string | null = null;
  for (const event of events) {
    if (event.type !== "tx") continue;
    reported ??= attr(event, "fee_payer") ?? null;
    const sequence = attr(event, "acc_seq");
    if (sequence && signer === null) {
      const slash = sequence.lastIndexOf("/");
      signer = slash > 0 ? sequence.slice(0, slash) : null;
    }
  }
  return { payer: granter ?? explicit ?? reported ?? signer, granter, signer };
}
