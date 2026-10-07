/**
 * Reading "what did this address receive in this transaction" out of an LCD
 * tx search result. Pure; fixtures in `__tests__` are real Osmosis responses.
 *
 * Coins come from the `transfer` events whose recipient is the address, not
 * from the messages: events say what the bank module actually moved, which
 * covers a plain send, a multi-send, an IBC delivery (the credited `ibc/…`
 * voucher, not the sender-side trace in the packet) and a contract paying
 * out, with one rule.
 *
 * Own transactions are skipped: when the address signed the transaction
 * (`message.sender`, or the ante handler's `tx.acc_seq` = `<addr>/<seq>`), the
 * coins coming back are a swap output, a reward withdrawal or a refund the
 * user triggered and is already watching. A relayer-signed IBC delivery is not
 * the user's own, which is exactly what makes it an arrival.
 *
 * Events are plain text on SDK ≥ 0.47 (every chain checked on 2026-10-07);
 * older nodes base64-encode attribute keys and values, which is detected per
 * attribute.
 */

export interface Coin {
  readonly amount: string;
  readonly denom: string;
}

export interface IncomingTransfer {
  readonly hash: string;
  readonly height: number;
  /** Block time, epoch ms; null when absent. */
  readonly at: number | null;
  /** Summed per denom, base units. */
  readonly coins: readonly Coin[];
  readonly senders: readonly string[];
  /** Set when the tokens came in over IBC (a MsgRecvPacket in the tx). */
  readonly ibc: {
    readonly port: string;
    readonly channel: string;
    /** The sender on the source chain, from the packet. */
    readonly sender: string | null;
  } | null;
  /** The tx returned tokens from a failed or timed-out outgoing IBC transfer. */
  readonly refund: boolean;
}

interface FlatEvent {
  readonly type: string;
  readonly attributes: ReadonlyArray<readonly [string, string]>;
}

const KNOWN_KEYS = new Set([
  "recipient",
  "sender",
  "amount",
  "receiver",
  "spender",
  "acc_seq",
  "action",
  "module",
  "msg_index",
  "fee",
  "fee_payer",
  "signature",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function fromBase64(value: string): string | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** One attribute as plain text, decoding the base64 form older nodes return. */
function attribute(raw: unknown): readonly [string, string] | null {
  const row = record(raw);
  if (!row) return null;
  const key = str(row.key);
  const value = str(row.value);
  if (KNOWN_KEYS.has(key)) return [key, value];
  const decodedKey = fromBase64(key);
  if (decodedKey !== null && KNOWN_KEYS.has(decodedKey)) {
    return [decodedKey, fromBase64(value) ?? value];
  }
  return [key, value];
}

/** The tx's events, flattened from `events` (SDK ≥ 0.46) or `logs[].events` (older). */
export function flatEvents(tx: unknown): FlatEvent[] {
  const row = record(tx);
  if (!row) return [];
  let events: unknown[] = Array.isArray(row.events) ? row.events : [];
  if (events.length === 0 && Array.isArray(row.logs)) {
    events = row.logs.flatMap((log) => {
      const entry = record(log);
      return entry && Array.isArray(entry.events) ? entry.events : [];
    });
  }
  const out: FlatEvent[] = [];
  for (const event of events) {
    const entry = record(event);
    if (!entry || typeof entry.type !== "string" || !Array.isArray(entry.attributes)) continue;
    out.push({
      type: entry.type,
      attributes: entry.attributes
        .map(attribute)
        .filter((pair): pair is readonly [string, string] => pair !== null),
    });
  }
  return out;
}

// tsconfig targets ES2017, which has no bigint literals.
const ZERO = BigInt(0);

const COIN = /^(\d{1,80})([a-zA-Z][a-zA-Z0-9/:._-]{1,127})$/;

/** `"12uosmo,5ibc/27…"` → coins; malformed entries are dropped. */
export function parseCoinList(raw: string): Coin[] {
  const coins: Coin[] = [];
  for (const part of raw.split(",")) {
    const match = COIN.exec(part.trim());
    if (match) coins.push({ amount: match[1], denom: match[2] });
  }
  return coins;
}

function messagesOf(tx: unknown): Record<string, unknown>[] {
  const body = record(record(record(tx)?.tx)?.body);
  const messages = body && Array.isArray(body.messages) ? body.messages : [];
  return messages.map(record).filter((message): message is Record<string, unknown> => message !== null);
}

function typeOf(message: Record<string, unknown>): string {
  return str(message["@type"]);
}

interface PacketView {
  readonly port: string;
  readonly channel: string;
  readonly receiver: string;
  readonly sender: string | null;
}

/** An ICS-20 packet delivered by a MsgRecvPacket, as far as the dashboard needs it. */
function packetOf(message: Record<string, unknown>): PacketView | null {
  const packet = record(message.packet);
  if (!packet) return null;
  const raw = str(packet.data);
  let data: Record<string, unknown> | null = null;
  for (const text of [fromBase64(raw), raw]) {
    if (!text) continue;
    try {
      data = record(JSON.parse(text) as unknown);
      if (data) break;
    } catch {
      /* not this encoding */
    }
  }
  const port = str(packet.destination_port);
  const channel = str(packet.destination_channel);
  if (!data || !/^[a-zA-Z0-9._+-]{2,64}$/.test(port) || !/^channel-\d{1,10}$/.test(channel)) return null;
  return { port, channel, receiver: str(data.receiver), sender: str(data.sender) || null };
}

/**
 * What `address` received in `tx`, or null: failed tx, the address signed it,
 * or nothing was credited to it.
 */
export function readIncoming(tx: unknown, address: string): IncomingTransfer | null {
  const row = record(tx);
  if (!row) return null;
  const code = Number(row.code ?? 0);
  if (code !== 0) return null;
  const hash = str(row.txhash).toUpperCase();
  const height = Number(str(row.height));
  if (!/^[0-9A-F]{64}$/.test(hash) || !Number.isSafeInteger(height) || height <= 0) return null;

  const events = flatEvents(row);
  const signed = events.some(
    (event) =>
      (event.type === "message" && event.attributes.some(([key, value]) => key === "sender" && value === address)) ||
      (event.type === "tx" &&
        event.attributes.some(([key, value]) => key === "acc_seq" && value.startsWith(`${address}/`))),
  );
  if (signed) return null;

  const totals = new Map<string, bigint>();
  const senders: string[] = [];
  for (const event of events) {
    if (event.type !== "transfer") continue;
    // One event per transfer on current nodes (recipient, sender, amount).
    // Older nodes' `logs` merge every transfer of a message into one event
    // (recipient A, sender, amount, recipient B, sender, amount, …), so each
    // amount is credited to the recipient named most recently before it —
    // never every amount of the event to whichever recipient comes first.
    let recipient: string | null = null;
    let sender: string | null = null;
    let credited = false;
    for (const [key, value] of event.attributes) {
      if (key === "recipient") recipient = value;
      else if (key === "sender") sender = value;
      else if (key === "amount" && recipient === address) {
        for (const coin of parseCoinList(value)) {
          totals.set(coin.denom, (totals.get(coin.denom) ?? ZERO) + BigInt(coin.amount));
        }
        credited = true;
        if (sender && !senders.includes(sender)) senders.push(sender);
      }
    }
    if (credited && senders.length === 0) {
      // A node that prints the sender after the amount.
      const late = event.attributes.find(([key]) => key === "sender")?.[1];
      if (late) senders.push(late);
    }
  }
  const coins = [...totals]
    .filter(([, amount]) => amount > ZERO)
    .map(([denom, amount]) => ({ denom, amount: amount.toString() }));
  if (coins.length === 0) return null;

  const messages = messagesOf(row);
  const deliveries = messages
    .filter((message) => typeOf(message).endsWith(".MsgRecvPacket"))
    .map(packetOf)
    .filter((packet): packet is PacketView => packet !== null);
  const delivery = deliveries.find((packet) => packet.receiver === address) ?? deliveries[0] ?? null;
  const refund =
    deliveries.length === 0 &&
    messages.some((message) => /\.(MsgAcknowledgement|MsgTimeout|MsgTimeoutOnClose)$/.test(typeOf(message)));

  const at = Date.parse(str(row.timestamp));
  return {
    hash,
    height,
    at: Number.isFinite(at) ? at : null,
    coins,
    senders,
    ibc: delivery
      ? { port: delivery.port, channel: delivery.channel, sender: delivery.receiver === address ? delivery.sender : null }
      : null,
    refund,
  };
}
